import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  SafeAreaView,
  Alert,
} from 'react-native';
import {
  useCupThreadTheme,
  useCupThreadClient,
  useCupThreadUserToken,
  useCupThreadStrings,
} from '../theme/CupThreadThemeProvider';
import type { ChangelogEntry } from '../types';
import { Badge } from './Badge';
import { MarkdownText } from './MarkdownText';
import { formatDate } from '../utils/formatters';

export interface WhatsNewScreenProps {
  onBack?: () => void;
  headerTitle?: string;
}

export function WhatsNewScreen({
  onBack,
  headerTitle,
}: WhatsNewScreenProps) {
  const { colors } = useCupThreadTheme();
  const client = useCupThreadClient();
  const userToken = useCupThreadUserToken();
  const strings = useCupThreadStrings();
  const title = headerTitle ?? strings.changelog.overlayTitle;

  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [email, setEmail] = useState<string>('');
  const [isSubscribing, setIsSubscribing] = useState<boolean>(false);
  const [isSubscribed, setIsSubscribed] = useState<boolean>(false);

  const loadData = useCallback(async () => {
    try {
      const list = await client.fetchChangelog();
      setEntries(list || []);
    } catch {
      // Non-fatal
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [client]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    loadData();
  };

  const handleSubscribe = async () => {
    if (!email.trim() || !email.includes('@')) {
      Alert.alert(strings.common.error, 'Please enter a valid email address.');
      return;
    }

    try {
      setIsSubscribing(true);
      await client.subscribeToChangelog(email.trim(), userToken);
      setIsSubscribed(true);
      Alert.alert(strings.changelog.subscribedSuccess);
    } catch (err: any) {
      Alert.alert(strings.common.error, err?.message || 'Failed to subscribe to changelog.');
    } finally {
      setIsSubscribing(false);
    }
  };

  const renderHeader = () => (
    <View
      style={[
        styles.subscribeCard,
        {
          backgroundColor: colors.card,
          borderColor: colors.cardBorder,
        },
      ]}
    >
      <Text style={[styles.subscribeTitle, { color: colors.textPrimary }]}>
        {strings.changelog.subscribeTitle}
      </Text>
      <Text style={[styles.subscribeSubtitle, { color: colors.textSecondary }]}>
        {strings.changelog.subscribeSubtitle}
      </Text>

      {isSubscribed ? (
        <View style={[styles.subscribedBanner, { backgroundColor: colors.chipBg }]}>
          <Text style={[styles.subscribedText, { color: colors.primary }]}>
            ✓ {strings.changelog.subscribedSuccess} ({email})
          </Text>
        </View>
      ) : (
        <View style={styles.subscribeForm}>
          <TextInput
            style={[
              styles.subscribeInput,
              {
                backgroundColor: colors.inputBg,
                borderColor: colors.inputBorder,
                color: colors.textPrimary,
              },
            ]}
            placeholder={strings.changelog.emailPlaceholder}
            placeholderTextColor={colors.textMuted}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <TouchableOpacity
            onPress={handleSubscribe}
            disabled={isSubscribing}
            style={[styles.subscribeButton, { backgroundColor: colors.primary }]}
          >
            {isSubscribing ? (
              <ActivityIndicator color={colors.primaryText} size="small" />
            ) : (
              <Text style={[styles.subscribeButtonText, { color: colors.primaryText }]}>
                {strings.changelog.subscribeButton}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

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
        <View style={styles.centerLoading}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={renderHeader}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
            />
          }
          renderItem={({ item }) => (
            <View
              style={[
                styles.card,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.cardBorder,
                },
              ]}
            >
              <View style={styles.cardHeader}>
                <Text style={[styles.entryTitle, { color: colors.textPrimary }]}>
                  {item.title}
                </Text>
                {item.versionLabel && (
                  <Badge label={`v${item.versionLabel}`} variant="outline" />
                )}
              </View>

              <Text style={[styles.publishedDate, { color: colors.textMuted }]}>
                {formatDate(item.publishedAt, strings.common)}
              </Text>

              {item.linkedRequests && item.linkedRequests.length > 0 && (
                <View style={styles.linkedRequestsRow}>
                  {item.linkedRequests.map((req) => (
                    <Badge key={req.id} label={`★ ${req.title}`} />
                  ))}
                </View>
              )}

              <View style={styles.bodyArea}>
                <MarkdownText content={item.body} />
              </View>
            </View>
          )}
        />
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
  listContent: {
    padding: 16,
  },
  subscribeCard: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 20,
  },
  subscribeTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  subscribeSubtitle: {
    fontSize: 13,
    marginBottom: 12,
  },
  subscribeForm: {
    flexDirection: 'row',
  },
  subscribeInput: {
    flex: 1,
    height: 40,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 14,
    marginRight: 8,
  },
  subscribeButton: {
    paddingHorizontal: 16,
    height: 40,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subscribeButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  subscribedBanner: {
    padding: 10,
    borderRadius: 8,
  },
  subscribedText: {
    fontSize: 13,
    fontWeight: '600',
  },
  card: {
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  entryTitle: {
    fontSize: 17,
    fontWeight: '700',
    flex: 1,
    paddingRight: 8,
  },
  publishedDate: {
    fontSize: 12,
    marginBottom: 8,
  },
  linkedRequestsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  bodyArea: {
    marginTop: 4,
  },
  centerLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
