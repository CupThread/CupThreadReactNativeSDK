import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import {
  useCupThreadTheme,
  useCupThreadClient,
  useCupThreadStrings,
  useCupThreadLocale,
} from '../theme/CupThreadThemeProvider';
import type { PublicUserProfileResult } from '../types';
import { RateLimitedException, UnexpectedStatusException } from '../client/FeedbackException';
import { Avatar } from './Avatar';
import { formatDate } from '../utils/formatters';
import { isSafeLinkUrl, openSafeLinkUrl, sanitizeSafeLinkUrl } from '../utils/linkUrl';
import { userFacingErrorMessage } from '../utils/errors';

export interface UserProfileScreenProps {
  userId: string;
  onBack?: () => void;
  headerTitle?: string;
}

export function UserProfileScreen({ userId, onBack, headerTitle }: UserProfileScreenProps) {
  const { colors } = useCupThreadTheme();
  const client = useCupThreadClient();
  const strings = useCupThreadStrings();
  const locale = useCupThreadLocale();
  const title = headerTitle ?? strings.userProfile.screenTitle;

  const [data, setData] = useState<PublicUserProfileResult | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [isRateLimited, setIsRateLimited] = useState<boolean>(false);
  const [isNotFound, setIsNotFound] = useState<boolean>(false);
  const [reloadKey, setReloadKey] = useState<number>(0);

  const profile =
    data?.profile && typeof data.profile === 'object'
      ? (data.profile as PublicUserProfileResult['profile'])
      : null;

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);
    setIsRateLimited(false);
    setIsNotFound(false);
    client
      .fetchUserProfile(userId, { signal: controller.signal })
      .then((res) => {
        if (controller.signal.aborted) return;
        setData(res);
      })
      .catch((err) => {
        if (err?.name === 'AbortError' || controller.signal.aborted) return;
        // A spent per-IP budget is transient and worth a retry; an unknown id
        // is final and gets the not-found copy.
        if (err instanceof RateLimitedException) {
          setIsRateLimited(true);
          return;
        }
        if (err instanceof UnexpectedStatusException && err.status === 404) {
          setData(null);
          setIsNotFound(true);
          return;
        }
        setError(userFacingErrorMessage(err, strings.userProfile.loadFailed, strings.common));
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [client, userId, reloadKey, strings.userProfile.loadFailed, strings.common]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.topBar, { borderBottomColor: colors.border }]}>
        {onBack && (
          <TouchableOpacity
            onPress={onBack}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel={strings.common.back}
          >
            <Text style={{ color: colors.primary, fontSize: 16, fontWeight: '600' }}>←</Text>
          </TouchableOpacity>
        )}
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>{title}</Text>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : isNotFound ? (
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: colors.textPrimary }]}>
            {strings.userProfile.notFound}
          </Text>
        </View>
      ) : isRateLimited || error ? (
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: colors.textPrimary }]}>
            {isRateLimited ? strings.userProfile.rateLimited : error}
          </Text>
          <TouchableOpacity
            onPress={() => setReloadKey((key) => key + 1)}
            style={[styles.retryBtn, { borderColor: colors.border }]}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={strings.common.retry}
          >
            <Text style={[styles.retryBtnText, { color: colors.primary }]}>
              {strings.common.retry}
            </Text>
          </TouchableOpacity>
        </View>
      ) : !data || !profile ? (
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: colors.textPrimary }]}>
            {strings.userProfile.notFound}
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <View
            style={[
              styles.profileCard,
              { backgroundColor: colors.card, borderColor: colors.cardBorder },
            ]}
          >
            <Avatar
              url={typeof profile.avatarUrl === 'string' ? profile.avatarUrl : undefined}
              name={
                typeof profile.displayName === 'string'
                  ? profile.displayName.trim() || undefined
                  : undefined
              }
              size={64}
            />
            <Text style={[styles.displayName, { color: colors.textPrimary }]}>
              {(typeof profile.displayName === 'string' && profile.displayName.trim()) ||
                strings.userProfile.anonymous}
            </Text>
            {typeof profile.bio === 'string' && profile.bio.trim() ? (
              <Text style={[styles.bio, { color: colors.textSecondary }]}>
                {profile.bio.trim()}
              </Text>
            ) : null}
            {typeof profile.websiteUrl === 'string' && profile.websiteUrl.trim() ? (
              <ProfileWebsiteLink websiteUrl={profile.websiteUrl.trim()} />
            ) : null}
          </View>

          {Array.isArray(data.publicApps) && data.publicApps.length > 0 && (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
                {strings.userProfile.appsSection(data.publicApps.length)}
              </Text>
              {data.publicApps.map((app, index) => (
                <View
                  key={app?.id ? `app-id-${app.id}` : `app-idx-${index}`}
                  style={[
                    styles.appCard,
                    { backgroundColor: colors.card, borderColor: colors.cardBorder },
                  ]}
                >
                  <Text style={[styles.appName, { color: colors.textPrimary }]}>
                    {typeof app?.name === 'string' ? app.name.trim() : ''}
                  </Text>
                  {typeof app?.description === 'string' && app.description.trim().length > 0 ? (
                    <Text
                      numberOfLines={2}
                      style={[styles.appDesc, { color: colors.textSecondary }]}
                    >
                      {app.description.trim()}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          )}

          {/* A hidden comment history never reaches the client as a flag: the
              server simply omits the comments (PRIV-06), so there is no
              client-side gate to consult. */}
          {Array.isArray(data.recentComments) && data.recentComments.length > 0 && (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
                {strings.userProfile.recentComments}
              </Text>
              {data.recentComments.map((comment, index) => {
                const title =
                  typeof comment?.featureRequestTitle === 'string' &&
                  comment.featureRequestTitle.trim().length > 0
                    ? comment.featureRequestTitle.trim()
                    : null;
                const body =
                  typeof comment?.body === 'string' && comment.body.trim().length > 0
                    ? comment.body.trim()
                    : null;
                const appName =
                  typeof comment?.appName === 'string' && comment.appName.trim().length > 0
                    ? comment.appName.trim()
                    : null;
                const dateText = formatDate(comment?.createdAt, strings.common, locale);
                const dateLine = appName
                  ? dateText
                    ? `${dateText} · ${appName}`
                    : appName
                  : dateText;

                return (
                  <View
                    key={comment?.id ? `comment-id-${comment.id}` : `comment-idx-${index}`}
                    style={[
                      styles.commentCard,
                      { backgroundColor: colors.card, borderColor: colors.cardBorder },
                    ]}
                  >
                    {title ? (
                      <Text style={[styles.commentTitle, { color: colors.textPrimary }]}>
                        {strings.userProfile.commentOn(title)}
                      </Text>
                    ) : null}
                    {body ? (
                      <Text style={[styles.commentBody, { color: colors.textSecondary }]}>
                        {`"${body}"`}
                      </Text>
                    ) : null}
                    {dateLine ? (
                      <Text style={[styles.commentDate, { color: colors.textMuted }]}>
                        {dateLine}
                      </Text>
                    ) : null}
                  </View>
                );
              })}
            </View>
          )}

          {(!Array.isArray(data.publicApps) || data.publicApps.length === 0) &&
            (!Array.isArray(data.recentComments) || data.recentComments.length === 0) && (
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
                  {strings.userProfile.activityTitle}
                </Text>
                <Text style={[{ color: colors.textMuted }]}>{strings.userProfile.noActivity}</Text>
              </View>
            )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

/**
 * Renders a profile website link behind the same http(s) scheme allowlist used
 * for markdown links ({@link sanitizeSafeLinkUrl}), so a remote profile cannot
 * trigger dialer, SMS, intent, or custom deep-link schemes on tap.
 *
 * Safe URLs open once through {@link openSafeLinkUrl}; unsafe URLs fall back to
 * inert text with no press handler and no link styling.
 */
function ProfileWebsiteLink({ websiteUrl }: { websiteUrl: string }) {
  const { colors } = useCupThreadTheme();
  const trimmedUrl = websiteUrl.trim();
  const isPressable = isSafeLinkUrl(trimmedUrl);

  if (!isPressable) {
    return (
      <Text
        selectable
        style={[styles.website, styles.websiteInert, { color: colors.textSecondary }]}
      >
        {trimmedUrl}
      </Text>
    );
  }

  return (
    <TouchableOpacity
      onPress={() => {
        openSafeLinkUrl(trimmedUrl, (safeUrl) => {
          Linking.openURL(safeUrl).catch(() => {});
        });
      }}
      accessibilityRole="link"
    >
      <Text style={[styles.website, { color: colors.primary }]}>
        {sanitizeSafeLinkUrl(trimmedUrl)}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backBtn: {
    paddingRight: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  errorText: {
    fontSize: 16,
    fontWeight: '500',
    textAlign: 'center',
    paddingHorizontal: 24,
  },
  retryBtn: {
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
  },
  retryBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  content: {
    padding: 16,
  },
  profileCard: {
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    marginBottom: 20,
  },
  displayName: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: 10,
    marginBottom: 4,
  },
  bio: {
    fontSize: 14,
    textAlign: 'center',
    marginVertical: 4,
  },
  website: {
    fontSize: 13,
    marginTop: 4,
    textDecorationLine: 'underline',
  },
  websiteInert: {
    textDecorationLine: 'none',
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 10,
  },
  appCard: {
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 10,
  },
  appName: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 4,
  },
  appDesc: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 6,
  },
  commentCard: {
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 10,
  },
  commentTitle: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 4,
  },
  commentBody: {
    fontSize: 13,
    fontStyle: 'italic',
    lineHeight: 18,
    marginBottom: 6,
  },
  commentDate: {
    fontSize: 11,
  },
});
