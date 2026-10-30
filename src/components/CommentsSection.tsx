import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import {
  useCupThreadTheme,
  useCupThreadClient,
  useCupThreadUserToken,
  useCupThreadTokenReadiness,
  useCupThreadStrings,
  useCupThreadLocale,
  useCupThreadCommentSession,
} from '../theme/CupThreadThemeProvider';
import type { FeatureRequestComment, CommentDraft } from '../types';
import { AuthenticationRequiredException } from '../client/FeedbackException';
import { Avatar } from './Avatar';
import { ErrorState } from './ErrorState';
import { useAsyncData } from '../hooks/useAsyncData';
import { formatDate } from '../utils/formatters';
import { resolveEffectiveUserToken } from '../utils/userToken';
import { MarkdownText } from './MarkdownText';
import { userFacingErrorMessage } from '../utils/errors';

/**
 * Props for configuring the {@link CommentsSection} thread component.
 *
 * @example
 * ```tsx
 * <CommentsSection featureRequestId="fr_sample123" />
 * ```
 */
export interface CommentsSectionProps {
  /**
   * Unique identifier of the feature request whose comments are being displayed and posted.
   */
  featureRequestId: string;
}

/**
 * Interactive discussion thread component displaying nested comments, markdown rendering, avatars, and reply composer.
 *
 * @param props - {@link CommentsSectionProps} containing the target feature request ID.
 *
 * @remarks
 * Comment writes require a signed-in session: the composer renders only when
 * the host configured `commentSessionProvider` on `<CupThreadProvider>` (and
 * the session check succeeds at submit time). Without a session source, a
 * localized sign-in notice replaces the composer.
 *
 * @example
 * ```tsx
 * import React from 'react';
 * import { CommentsSection } from '@cupthread/react-native';
 *
 * export function FeatureCommentsTab({ id }: { id: string }) {
 *   return <CommentsSection featureRequestId={id} />;
 * }
 * ```
 */
export function CommentsSection({ featureRequestId }: CommentsSectionProps) {
  const { colors } = useCupThreadTheme();
  const client = useCupThreadClient();
  const userToken = useCupThreadUserToken();
  const isTokenReady = useCupThreadTokenReadiness();
  const strings = useCupThreadStrings();
  const locale = useCupThreadLocale();
  const commentSessionProvider = useCupThreadCommentSession();

  const fetchComments = useCallback(
    (signal: AbortSignal) => client.fetchComments(featureRequestId, { signal }),
    [client, featureRequestId]
  );
  const mergeComments = useCallback(
    (
      local: FeatureRequestComment[] | null,
      incoming: FeatureRequestComment[]
    ): FeatureRequestComment[] => {
      if (!local || local.length === 0) return incoming;
      const incomingIds = new Set(incoming.map((c) => c.id));
      const localOnly = local.filter((c) => !incomingIds.has(c.id));
      if (localOnly.length === 0) return incoming;
      return [...incoming, ...localOnly];
    },
    []
  );

  const {
    data: commentsData,
    isLoading: isLoadingComments,
    error: loadError,
    reload: reloadComments,
    setData: setCommentsData,
  } = useAsyncData(fetchComments, { mergeStale: mergeComments });
  const comments: FeatureRequestComment[] = commentsData ?? [];

  const [commentText, setCommentText] = useState<string>('');
  const [replyTo, setReplyTo] = useState<FeatureRequestComment | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const isSubmittingRef = useRef<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  // True when a submit was refused by the session check or rejected with 401:
  // the composer yields to the sign-in notice until a session appears again.
  const [requiresSignIn, setRequiresSignIn] = useState<boolean>(false);

  // The documented host pattern keeps this section mounted while the request
  // it shows changes (FeatureRequestDetail swaps the `item` prop), and direct
  // hosts may pass a new `featureRequestId` to a mounted instance. The draft,
  // the armed reply, the error, and the loaded list all belong to the thread
  // that was displayed, so none of them may survive an id change — otherwise a
  // reply armed on the previous thread posts its `parentId` against the new
  // one. Render-phase derived-state adjustment, same semantics as
  // key={featureRequestId}: a different id resets the per-thread state while a
  // same-id re-render (fresh data for the same request) keeps it. useAsyncData
  // refetches on the id change by itself; clearing `data` here makes the
  // previous thread's comments yield to the loading spinner and, on a failed
  // fetch, to the error state.
  const lastRequestIdRef = useRef(featureRequestId);
  if (lastRequestIdRef.current !== featureRequestId) {
    lastRequestIdRef.current = featureRequestId;
    setCommentText('');
    setReplyTo(null);
    setError(null);
    setCommentsData(null);
  }

  const hasSessionSource = Boolean(commentSessionProvider);
  const showComposer = hasSessionSource && !requiresSignIn;

  // The context exposes a stable provider wrapper, so this only fires when the
  // host adds/removes the provider itself (or the host swaps it deliberately):
  // re-check on the next submit instead of keeping the dead sign-in state.
  // While sign-in state is up, the Retry button is the recovery path.
  useEffect(() => {
    setRequiresSignIn(false);
  }, [commentSessionProvider]);

  const recheckSession = useCallback(async () => {
    if (!commentSessionProvider) return;
    try {
      const token = await commentSessionProvider();
      if (token && token.trim()) {
        setRequiresSignIn(false);
      }
    } catch {
      // Session source threw — stay signed out; the next submit re-checks.
    }
  }, [commentSessionProvider]);

  const handlePostComment = async () => {
    if (isSubmittingRef.current) return;
    if (commentText.trim().length === 0 || !isTokenReady || !commentSessionProvider) return;

    isSubmittingRef.current = true;
    try {
      setIsSubmitting(true);
      setError(null);

      const sessionToken = await commentSessionProvider();
      if (!sessionToken || !sessionToken.trim()) {
        setRequiresSignIn(true);
        return;
      }

      const effectiveToken = await resolveEffectiveUserToken(userToken);
      const draft: CommentDraft = {
        body: commentText.trim(),
        parentId: replyTo?.id || undefined,
        replyToClerkId: replyTo?.authorClerkId || undefined,
        replyToAuthorName: replyTo?.authorName || undefined,
      };

      const newComment = await client.postComment(featureRequestId, draft, effectiveToken, {
        sessionToken: sessionToken.trim(),
      });
      setCommentsData((prev) => [...(prev ?? []), newComment]);
      setCommentText('');
      setReplyTo(null);
    } catch (err: any) {
      if (err instanceof AuthenticationRequiredException) {
        // Keep the draft so the text survives until the host signs the user in.
        setRequiresSignIn(true);
        return;
      }
      setError(userFacingErrorMessage(err, strings.comments.postFailed, strings.common));
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  const activeComments = comments.filter((c) => !c.isHidden);

  return (
    <View style={styles.container}>
      <Text style={[styles.heading, { color: colors.textPrimary }]}>
        {strings.comments.commentsCount(activeComments.length)}
      </Text>

      {isLoadingComments ? (
        <ActivityIndicator color={colors.primary} style={{ marginVertical: 16 }} />
      ) : activeComments.length === 0 && loadError ? (
        <ErrorState
          compact
          message={strings.common.error}
          retryLabel={strings.common.retry}
          onRetry={() => {
            reloadComments();
          }}
        />
      ) : activeComments.length === 0 ? (
        <Text style={[styles.emptyText, { color: colors.textMuted }]}>
          {strings.comments.emptyComments}
        </Text>
      ) : (
        <View style={styles.list}>
          {activeComments.map((item) => (
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
                    {item.authorName || strings.common.anonymous}
                  </Text>
                  <Text style={[styles.timeText, { color: colors.textMuted }]}>
                    {formatDate(item.createdAt, strings.common, locale)}
                  </Text>
                </View>
              </View>

              {item.replyToAuthorName && (
                <Text style={[styles.replyNotice, { color: colors.primary }]}>
                  {strings.comments.replyingTo(item.replyToAuthorName)}
                </Text>
              )}

              <MarkdownText content={item.body} style={{ fontSize: 13 }} />

              {showComposer && (
                <TouchableOpacity
                  onPress={() => setReplyTo(item)}
                  style={styles.replyButton}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                >
                  <Text style={[styles.replyButtonText, { color: colors.primary }]}>
                    {strings.comments.replyButton}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
        </View>
      )}

      {showComposer ? (
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
                {strings.comments.replyingTo(replyTo.authorName || strings.common.anonymous)}
              </Text>
              <TouchableOpacity onPress={() => setReplyTo(null)} accessibilityRole="button">
                <Text style={{ color: colors.primary, fontSize: 12, fontWeight: '700' }}>
                  {strings.comments.cancelReply}
                </Text>
              </TouchableOpacity>
            </View>
          )}

          {error && <Text style={[styles.inputError, { color: colors.danger }]}>{error}</Text>}

          <TextInput
            style={[
              styles.bodyInput,
              {
                backgroundColor: colors.inputBg,
                borderColor: colors.inputBorder,
                color: colors.textPrimary,
              },
            ]}
            placeholder={strings.comments.inputPlaceholder}
            placeholderTextColor={colors.textMuted}
            value={commentText}
            onChangeText={setCommentText}
            multiline
          />

          <TouchableOpacity
            onPress={handlePostComment}
            disabled={isSubmitting || !isTokenReady || commentText.trim().length === 0}
            style={[
              styles.sendButton,
              {
                backgroundColor: colors.primary,
                opacity: isSubmitting || !isTokenReady || commentText.trim().length === 0 ? 0.5 : 1,
              },
            ]}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityState={{
              disabled: isSubmitting || !isTokenReady || commentText.trim().length === 0,
            }}
          >
            {isSubmitting ? (
              <ActivityIndicator color={colors.primaryText} size="small" />
            ) : (
              <Text style={[styles.sendButtonText, { color: colors.primaryText }]}>
                {strings.comments.postButton}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      ) : (
        <View style={[styles.signInContainer, { backgroundColor: colors.card }]}>
          <Text style={[styles.signInText, { color: colors.textMuted }]}>
            {strings.comments.signInToComment}
          </Text>
          {requiresSignIn && (
            <TouchableOpacity
              onPress={recheckSession}
              accessibilityRole="button"
              activeOpacity={0.7}
            >
              <Text style={[styles.signInRetryText, { color: colors.primary }]}>
                {strings.common.retry}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}
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
    fontSize: 12,
    marginBottom: 6,
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
  signInContainer: {
    padding: 14,
    borderRadius: 10,
    marginTop: 8,
    alignItems: 'center',
  },
  signInText: {
    fontSize: 13,
    fontStyle: 'italic',
  },
  signInRetryText: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 8,
  },
});
