import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useCupThreadTheme, useCupThreadClient, useCupThreadUserToken } from '../theme/CupThreadThemeProvider.tsx';
import type { FeatureRequestComment, CommentDraft } from '../types/index.ts';
import { Avatar } from './Avatar.tsx';
import { formatDate } from '../utils/formatters.ts';
import { MarkdownText } from './MarkdownText.tsx';

export interface CommentsSectionProps {
  featureRequestId: string;
}

export function CommentsSection({ featureRequestId }: CommentsSectionProps) {
  const { colors } = useCupThreadTheme();
  const client = useCupThreadClient();
  const userToken = useCupThreadUserToken();

  const [comments, setComments] = useState<FeatureRequestComment[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [commentText, setCommentText] = useState<string>('');
  const [authorName, setAuthorName] = useState<string>('');
  const [replyTo, setReplyTo] = useState<FeatureRequestComment | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const loadComments = async () => {
    try {
      setIsLoading(true);
      const list = await client.fetchComments(featureRequestId);
      setComments(list);
    } catch {
      // ignore
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadComments();
  }, [featureRequestId]);

  const handlePostComment = async () => {
    if (commentText.trim().length === 0) return;

    try {
      setIsSubmitting(true);
      setError(null);

      const draft: CommentDraft = {
        body: commentText.trim(),
        authorName: authorName.trim() || undefined,
        parentId: replyTo?.id || undefined,
        replyToClerkId: replyTo?.authorClerkId || undefined,
        replyToAuthorName: replyTo?.authorName || undefined,
      };

      const newComment = await client.postComment(featureRequestId, draft, userToken);
      setComments((prev) => [...prev, newComment]);
      setCommentText('');
      setReplyTo(null);
    } catch (err: any) {
      setError(err?.message || 'Failed to post comment');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={[styles.heading, { color: colors.textPrimary }]}>
        Discussion ({comments.filter((c) => !c.isHidden).length})
      </Text>

      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginVertical: 16 }} />
      ) : comments.length === 0 ? (
        <Text style={[styles.emptyText, { color: colors.textMuted }]}>
          No comments yet. Start the discussion!
        </Text>
      ) : (
        <View style={styles.list}>
          {comments
            .filter((c) => !c.isHidden)
            .map((item) => (
              <View
                key={item.id}
                style={[
                  styles.commentCard,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.cardBorder,
                    marginLeft: item.parentId ? 20 : 0,
                  },
                ]}
              >
                <View style={styles.authorRow}>
                  <Avatar url={item.authorAvatarUrl} name={item.authorName} size={28} />
                  <View style={styles.authorMeta}>
                    <Text style={[styles.authorName, { color: colors.textPrimary }]}>
                      {item.authorName || 'Anonymous User'}
                    </Text>
                    <Text style={[styles.timeText, { color: colors.textMuted }]}>
                      {formatDate(item.createdAt)}
                    </Text>
                  </View>
                </View>

                {item.replyToAuthorName && (
                  <Text style={[styles.replyNotice, { color: colors.primary }]}>
                    Replying to @{item.replyToAuthorName}
                  </Text>
                )}

                <MarkdownText content={item.body} style={{ fontSize: 13 }} />

                <TouchableOpacity
                  onPress={() => setReplyTo(item)}
                  style={styles.replyButton}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.replyButtonText, { color: colors.primary }]}>Reply</Text>
                </TouchableOpacity>
              </View>
            ))}
        </View>
      )}

      <View
        style={[
          styles.inputContainer,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
          },
        ]}
      >
        {replyTo && (
          <View style={[styles.replyingBar, { backgroundColor: colors.chipBg }]}>
            <Text style={[styles.replyingText, { color: colors.textSecondary }]}>
              Replying to {replyTo.authorName || 'Anonymous'}
            </Text>
            <TouchableOpacity onPress={() => setReplyTo(null)}>
              <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '700' }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        )}

        {error && <Text style={styles.inputError}>{error}</Text>}

        <TextInput
          style={[
            styles.nameInput,
            {
              backgroundColor: colors.inputBg,
              borderColor: colors.inputBorder,
              color: colors.textPrimary,
            },
          ]}
          placeholder="Your name (optional)"
          placeholderTextColor={colors.textMuted}
          value={authorName}
          onChangeText={setAuthorName}
        />

        <TextInput
          style={[
            styles.bodyInput,
            {
              backgroundColor: colors.inputBg,
              borderColor: colors.inputBorder,
              color: colors.textPrimary,
            },
          ]}
          placeholder="Write a comment..."
          placeholderTextColor={colors.textMuted}
          value={commentText}
          onChangeText={setCommentText}
          multiline
        />

        <TouchableOpacity
          onPress={handlePostComment}
          disabled={isSubmitting || commentText.trim().length === 0}
          style={[
            styles.sendButton,
            {
              backgroundColor: colors.primary,
              opacity: isSubmitting || commentText.trim().length === 0 ? 0.5 : 1,
            },
          ]}
          activeOpacity={0.8}
        >
          {isSubmitting ? (
            <ActivityIndicator color={colors.primaryText} size="small" />
          ) : (
            <Text style={[styles.sendButtonText, { color: colors.primaryText }]}>Send</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 20,
  },
  heading: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 13,
    fontStyle: 'italic',
    marginVertical: 12,
  },
  list: {
    marginBottom: 16,
  },
  commentCard: {
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 10,
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  authorMeta: {
    marginLeft: 8,
  },
  authorName: {
    fontSize: 13,
    fontWeight: '600',
  },
  timeText: {
    fontSize: 11,
  },
  replyNotice: {
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 4,
  },
  replyButton: {
    marginTop: 6,
    alignSelf: 'flex-start',
  },
  replyButtonText: {
    fontSize: 12,
    fontWeight: '600',
  },
  inputContainer: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 8,
  },
  replyingBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 6,
    borderRadius: 6,
    marginBottom: 8,
  },
  replyingText: {
    fontSize: 12,
  },
  inputError: {
    color: '#b91c1c',
    fontSize: 12,
    marginBottom: 6,
  },
  nameInput: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 13,
    marginBottom: 8,
  },
  bodyInput: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    minHeight: 60,
    marginBottom: 10,
  },
  sendButton: {
    alignSelf: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  sendButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
