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
} from '../theme/CupThreadThemeProvider';
import type { PublicUserProfileResult } from '../types';
import { Avatar } from './Avatar';
import { formatDate } from '../utils/formatters';

export interface UserProfileScreenProps {
  userId: string;
  onBack?: () => void;
  headerTitle?: string;
}

export function UserProfileScreen({ userId, onBack, headerTitle }: UserProfileScreenProps) {
  const { colors } = useCupThreadTheme();
  const client = useCupThreadClient();
  const strings = useCupThreadStrings();
  const title = headerTitle ?? strings.userProfile.screenTitle;

  const [data, setData] = useState<PublicUserProfileResult | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    client
      .fetchUserProfile(userId)
      .then((res) => {
        setData(res);
      })
      .catch((err) => {
        setError(err?.message || 'Failed to load profile');
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [client, userId]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.topBar, { borderBottomColor: colors.border }]}>
        {onBack && (
          <TouchableOpacity onPress={onBack} style={styles.backBtn}>
            <Text style={{ color: colors.primary, fontSize: 16, fontWeight: '600' }}>←</Text>
          </TouchableOpacity>
        )}
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>{title}</Text>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : error || !data ? (
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: colors.textPrimary }]}>
            {error || 'User not found'}
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
              url={data.profile.avatarUrl}
              name={data.profile.displayName}
              size={64}
            />
            <Text style={[styles.displayName, { color: colors.textPrimary }]}>
              {data.profile.displayName || 'Anonymous Developer'}
            </Text>
            {data.profile.bio ? (
              <Text style={[styles.bio, { color: colors.textSecondary }]}>
                {data.profile.bio}
              </Text>
            ) : null}
            {data.profile.websiteUrl ? (
              <TouchableOpacity
                onPress={() => Linking.openURL(data.profile.websiteUrl!).catch(() => {})}
              >
                <Text style={[styles.website, { color: colors.primary }]}>
                  {data.profile.websiteUrl}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {data.apps && data.apps.length > 0 && (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
                Apps ({data.apps.length})
              </Text>
              {data.apps.map((app) => (
                <View
                  key={app.id}
                  style={[
                    styles.appCard,
                    { backgroundColor: colors.card, borderColor: colors.cardBorder },
                  ]}
                >
                  <Text style={[styles.appName, { color: colors.textPrimary }]}>
                    {app.name}
                  </Text>
                  {app.description && (
                    <Text
                      numberOfLines={2}
                      style={[styles.appDesc, { color: colors.textSecondary }]}
                    >
                      {app.description}
                    </Text>
                  )}
                  <Text style={[styles.appRequests, { color: colors.textMuted }]}>
                    {app.requestCount} public feature requests
                  </Text>
                </View>
              ))}
            </View>
          )}

          {!data.hideComments && data.recentComments && data.recentComments.length > 0 && (
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
                Recent Comments
              </Text>
              {data.recentComments.map((comment) => (
                <View
                  key={comment.id}
                  style={[
                    styles.commentCard,
                    { backgroundColor: colors.card, borderColor: colors.cardBorder },
                  ]}
                >
                  <Text style={[styles.commentTitle, { color: colors.textPrimary }]}>
                    on {comment.featureRequestTitle}
                  </Text>
                  <Text style={[styles.commentBody, { color: colors.textSecondary }]}>
                    "{comment.body}"
                  </Text>
                  <Text style={[styles.commentDate, { color: colors.textMuted }]}>
                    {formatDate(comment.createdAt, strings.common)} · {comment.appName}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
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
  appRequests: {
    fontSize: 12,
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
