import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Modal,
  SafeAreaView,
} from 'react-native';
import {
  useCupThreadTheme,
  useCupThreadClient,
  useCupThreadUserToken,
  useCupThreadStrings,
  useCupThreadLocale,
} from '../theme/CupThreadThemeProvider';
import type { FeatureRequestItem } from '../types';
import { VoteButton } from './VoteButton';
import { Badge } from './Badge';
import { Avatar } from './Avatar';
import { MarkdownText } from './MarkdownText';
import { CommentsSection } from './CommentsSection';
import { formatDate } from '../utils/formatters';
import { useToggleVote, type VoteChangeApplier, type VoteChangeMeta } from '../hooks/useToggleVote';

/**
 * Props for configuring the {@link FeatureRequestDetail} modal view.
 *
 * @example
 * ```tsx
 * <FeatureRequestDetail
 *   item={selectedItem}
 *   visible={isOpen}
 *   onClose={() => setIsOpen(false)}
 *   onVoteChange={(updated) => updateLocalItem(updated)}
 * />
 * ```
 */
export interface FeatureRequestDetailProps {
  /**
   * The feature request item data model to render.
   */
  item: FeatureRequestItem;

  /**
   * Whether the full-screen modal sheet is visible.
   */
  visible: boolean;

  /**
   * Callback invoked when the user taps the back button or requests modal dismissal.
   */
  onClose: () => void;

  /**
   * Optional callback notified whenever the user toggles an upvote inside the
   * detail view. The second argument marks a rollback of a failed attempt, so
   * a host that guards in-flight optimistic rows can release the item and let
   * later server snapshots win (#139).
   */
  onVoteChange?: (updated: FeatureRequestItem, meta?: VoteChangeMeta) => void;
}

/**
 * Full-screen modal screen displaying detailed feature request descriptions, badges, upvoting, and comments.
 *
 * @param props - {@link FeatureRequestDetailProps} configuring the active item and modal actions.
 *
 * @example
 * ```tsx
 * import React from 'react';
 * import { FeatureRequestDetail, type FeatureRequestItem } from '@cupthread/react-native';
 *
 * export function RequestViewer({
 *   activeRequest,
 *   onClose,
 * }: {
 *   activeRequest: FeatureRequestItem | null;
 *   onClose: () => void;
 * }) {
 *   if (!activeRequest) return null;
 *   return <FeatureRequestDetail item={activeRequest} visible onClose={onClose} />;
 * }
 * ```
 *
 * @remarks
 * Keeping the detail mounted while a different request is passed as `item` is
 * supported: internal vote and comment state resets and the new request's
 * content renders immediately, so votes and comments always target the
 * request currently displayed.
 */
export function FeatureRequestDetail({
  item: initialItem,
  visible,
  onClose,
  onVoteChange,
}: FeatureRequestDetailProps) {
  const { colors } = useCupThreadTheme();
  const client = useCupThreadClient();
  const userToken = useCupThreadUserToken();
  const strings = useCupThreadStrings();
  const locale = useCupThreadLocale();

  const [item, setItem] = useState<FeatureRequestItem>(initialItem);

  // The documented host pattern keeps this component mounted and swaps the
  // `item` prop (<Modal> hides children without unmounting them), so internal
  // state must follow the prop's identity. Render-phase derived-state
  // adjustment, same semantics as key={item.id}: a different id resets the
  // whole screen, while a same-id prop refresh (fresh object from host data)
  // keeps the current state, including optimistic vote changes.
  const lastInitialIdRef = useRef(initialItem.id);
  if (lastInitialIdRef.current !== initialItem.id) {
    lastInitialIdRef.current = initialItem.id;
    setItem(initialItem);
  }

  // Latest snapshot per request id. A vote settlement can arrive after this
  // component unmounts or after the host swaps `item`, when local state no
  // longer holds the request that was voted on. The snapshot keeps the host
  // reconciliation independent of this component's lifecycle.
  const knownItemsRef = useRef<Map<string, FeatureRequestItem>>(new Map());
  const onVoteChangeRef = useRef(onVoteChange);
  const mountedRef = useRef(true);

  useEffect(() => {
    onVoteChangeRef.current = onVoteChange;
  }, [onVoteChange]);

  useEffect(() => {
    knownItemsRef.current.set(item.id, item);
  }, [item]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const applyVoteChange = useCallback<VoteChangeApplier>((itemId, transform, meta) => {
    // Notify the host from the snapshot rather than from the state updater:
    // React drops updates for unmounted components, so a rollback or server
    // result that settles after unmount would otherwise never reach the host
    // list. The host applier is by id, which also keeps a late result for a
    // previously displayed item from mutating the newly shown one. The vote
    // meta rides along so a rollback releases the host's pending mutation for
    // the item instead of re-pinning the pre-tap snapshot (#139).
    const known = knownItemsRef.current.get(itemId);
    if (known) {
      const next = transform(known);
      knownItemsRef.current.set(itemId, next);
      onVoteChangeRef.current?.(next, meta);
    }

    // Use a functional state updater like list/board so transforms land on
    // the freshest state. The id guard covers an item swap between the
    // settlement and this update: local state must keep the newly shown item
    // untouched even though the host was just notified for the old one.
    if (mountedRef.current) {
      setItem((prev) => (prev.id === itemId ? transform(prev) : prev));
    }
  }, []);
  const {
    toggleVote: handleToggleVote,
    isVoting,
    voteError,
    getVoteError,
  } = useToggleVote(client, userToken, applyVoteChange);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      accessibilityViewIsModal={true}
    >
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.navBar, { borderBottomColor: colors.border }]}>
          <TouchableOpacity
            onPress={onClose}
            style={styles.backButton}
            accessibilityRole="button"
            accessibilityLabel={strings.common.back}
          >
            <Text style={[styles.backText, { color: colors.primary }]}>
              ← {strings.common.back}
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.headerRow}>
            <View style={styles.titleArea}>
              <Text style={[styles.title, { color: colors.textPrimary }]}>{item.title}</Text>
              <View style={styles.badgesRow}>
                {item.columnName && <Badge label={item.columnName} color={item.columnColor} />}
                {item.versionLabel && <Badge label={`v${item.versionLabel}`} variant="outline" />}
              </View>
            </View>
            <VoteButton
              voteCount={item.voteCount}
              hasVoted={item.hasVoted}
              onPress={() => handleToggleVote(item)}
              disabled={item.isOwnRequest || isVoting(item.id)}
              error={getVoteError(item.id)}
            />
          </View>

          {voteError && (
            <View
              style={[
                styles.voteErrorBanner,
                { backgroundColor: colors.dangerBg, borderColor: colors.dangerBorder },
              ]}
            >
              <Text style={{ color: colors.danger, fontSize: 13 }}>
                {strings.featureRequests.voteFailed}
              </Text>
            </View>
          )}

          <View style={styles.authorRow}>
            <Avatar url={item.requesterAvatarUrl} name={item.requesterName} size={24} />
            <Text style={[styles.authorName, { color: colors.textSecondary }]}>
              {item.requesterName || strings.common.anonymous}
            </Text>
            <Text style={[styles.dot, { color: colors.textMuted }]}>•</Text>
            <Text style={[styles.dateText, { color: colors.textMuted }]}>
              {formatDate(item.createdAt, strings.common, locale)}
            </Text>
          </View>

          <View
            style={[
              styles.descCard,
              { backgroundColor: colors.card, borderColor: colors.cardBorder },
            ]}
          >
            <MarkdownText content={item.description} />
          </View>

          {/* key={item.id} remounts the thread on a documented item swap, so
              the composer and the list are guaranteed fresh even if
              CommentsSection's internal id reset were bypassed. */}
          <CommentsSection key={item.id} featureRequestId={item.id} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  navBar: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  backButton: {
    paddingVertical: 4,
  },
  backText: {
    fontSize: 15,
    fontWeight: '600',
  },
  content: {
    padding: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  titleArea: {
    flex: 1,
    paddingRight: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 26,
    marginBottom: 6,
  },
  badgesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 4,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  authorName: {
    fontSize: 13,
    marginLeft: 6,
    fontWeight: '500',
  },
  dot: {
    marginHorizontal: 6,
  },
  dateText: {
    fontSize: 12,
  },
  descCard: {
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 12,
  },
  voteErrorBanner: {
    marginBottom: 12,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
});
