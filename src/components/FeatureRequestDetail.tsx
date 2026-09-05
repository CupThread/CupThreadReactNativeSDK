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
} from '../theme/CupThreadThemeProvider';
import type { FeatureRequestItem } from '../types';
import { VoteButton } from './VoteButton';
import { Badge } from './Badge';
import { Avatar } from './Avatar';
import { MarkdownText } from './MarkdownText';
import { CommentsSection } from './CommentsSection';
import { formatDate } from '../utils/formatters';
import { useToggleVote, type VoteChangeApplier } from '../hooks/useToggleVote';

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
   * Optional callback notified whenever the user toggles an upvote inside the detail view.
   */
  onVoteChange?: (updated: FeatureRequestItem) => void;
}

/**
 * Full-screen modal screen displaying detailed feature request descriptions, badges, upvoting, and comments.
 *
 * @param props - {@link FeatureRequestDetailProps} configuring the active item and modal actions.
 *
 * @example
 * ```tsx
 * import React from 'react';
 * import { FeatureRequestDetail } from '@cupthread/react-native';
 *
 * export function RequestViewer({ activeRequest, onClose }) {
 *   return (
 *     <FeatureRequestDetail
 *       item={activeRequest}
 *       visible={!!activeRequest}
 *       onClose={onClose}
 *     />
 *   );
 * }
 * ```
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

  const [item, setItem] = useState<FeatureRequestItem>(initialItem);

  // State updaters must stay pure (React may run them during render and twice
  // under StrictMode), so vote changes are staged here and the host
  // `onVoteChange` notification is flushed in an effect after commit.
  const pendingVoteNotifyRef = useRef<FeatureRequestItem | null>(null);

  const applyVoteChange = useCallback<VoteChangeApplier>(
    (_itemId, transform) => {
      // Use functional state updater like list/board so transforms always land
      // on the freshest state and rollback reconciles against current item
      // instead of closing over a stale snapshot or the initialItem prop.
      setItem((prev) => {
        const next = transform(prev);
        pendingVoteNotifyRef.current = next;
        return next;
      });
    },
    []
  );

  useEffect(() => {
    const pending = pendingVoteNotifyRef.current;
    if (pending) {
      pendingVoteNotifyRef.current = null;
      onVoteChange?.(pending);
    }
  }, [item, onVoteChange]);
  const { toggleVote: handleToggleVote, isVoting } = useToggleVote(client, userToken, applyVoteChange);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.navBar, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose} style={styles.backButton}>
            <Text style={[styles.backText, { color: colors.primary }]}>← {strings.common.back}</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.headerRow}>
            <View style={styles.titleArea}>
              <Text style={[styles.title, { color: colors.textPrimary }]}>{item.title}</Text>
              <View style={styles.badgesRow}>
                {item.columnName && (
                  <Badge label={item.columnName} color={item.columnColor} />
                )}
                {item.versionLabel && (
                  <Badge label={`v${item.versionLabel}`} variant="outline" />
                )}
              </View>
            </View>
            <VoteButton
              voteCount={item.voteCount}
              hasVoted={item.hasVoted}
              onPress={() => handleToggleVote(item)}
              disabled={item.isOwnRequest || isVoting(item.id)}
            />
          </View>

          <View style={styles.authorRow}>
            <Avatar url={item.requesterAvatarUrl} name={item.requesterName} size={24} />
            <Text style={[styles.authorName, { color: colors.textSecondary }]}>
              {item.requesterName || strings.common.anonymous}
            </Text>
            <Text style={[styles.dot, { color: colors.textMuted }]}>•</Text>
            <Text style={[styles.dateText, { color: colors.textMuted }]}>
              {formatDate(item.createdAt, strings.common)}
            </Text>
          </View>

          <View style={[styles.descCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <MarkdownText content={item.description} />
          </View>

          <CommentsSection featureRequestId={item.id} />
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
});
