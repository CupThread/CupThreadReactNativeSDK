import React, { useState } from 'react';
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
  const [isVoting, setIsVoting] = useState<boolean>(false);

  const handleToggleVote = async () => {
    if (item.isOwnRequest || isVoting) return;

    const nextVoted = !item.hasVoted;
    const nextCount = item.voteCount + (nextVoted ? 1 : -1);
    const updated = { ...item, hasVoted: nextVoted, voteCount: Math.max(0, nextCount) };
    setItem(updated);
    if (onVoteChange) onVoteChange(updated);

    try {
      setIsVoting(true);
      const res = await client.toggleVote(item.id, userToken);
      const serverUpdated = { ...item, hasVoted: res.voted, voteCount: res.voteCount };
      setItem(serverUpdated);
      if (onVoteChange) onVoteChange(serverUpdated);
    } catch {
      setItem(initialItem);
      if (onVoteChange) onVoteChange(initialItem);
    } finally {
      setIsVoting(false);
    }
  };

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
              onPress={handleToggleVote}
              disabled={item.isOwnRequest || isVoting}
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
