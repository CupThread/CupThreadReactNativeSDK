import React, { useState, useCallback } from 'react';
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
} from 'react-native';
import {
  useCupThreadTheme,
  useCupThreadClient,
  useCupThreadUserToken,
  useCupThreadTokenReadiness,
  useCupThreadStrings,
} from '../theme/CupThreadThemeProvider';
import type { FeatureRequestItem, AppVersion } from '../types';
import { VoteButton } from './VoteButton';
import { Badge } from './Badge';
import { Avatar } from './Avatar';
import { FeatureRequestDetail } from './FeatureRequestDetail';
import { FeatureRequestComposeSheet } from './FeatureRequestComposeSheet';
import { useToggleVote } from '../hooks/useToggleVote';
import { useFeatureRequests } from '../hooks/useFeatureRequests';
import { useAsyncData } from '../hooks/useAsyncData';
import { ErrorState } from './ErrorState';

/**
 * Props for configuring the {@link FeatureRequestsScreen} view.
 *
 * @example
 * ```tsx
 * <FeatureRequestsScreen
 *   headerTitle="Community Feedback"
 *   onBack={() => navigation.goBack()}
 * />
 * ```
 */
export interface FeatureRequestsScreenProps {
  /**
   * Optional callback function invoked when the user taps the top navigation back button.
   * If not provided, the back button is hidden.
   */
  onBack?: () => void;

  /**
   * Title text rendered in the top navigation bar.
   *
   * @defaultValue `'Feature Requests'`
   */
  headerTitle?: string;
}

/**
 * Full-featured feature request list screen with search bar, version filter chips, voting, and composer trigger.
 *
 * @param props - {@link FeatureRequestsScreenProps} configuring navigation and titles.
 *
 * @example
 * ```tsx
 * import React from 'react';
 * import { FeedbackClient, CupThreadProvider, FeatureRequestsScreen } from '@cupthread/react-native';
 *
 * const client = new FeedbackClient({
 *   baseUrl: 'https://api.cupthread.com',
 *   appKey: 'app_sample123',
 * });
 *
 * export default function FeedbackTab({ navigation }) {
 *   return (
 *     <CupThreadProvider client={client}>
 *       <FeatureRequestsScreen onBack={() => navigation.goBack()} />
 *     </CupThreadProvider>
 *   );
 * }
 * ```
 */
export function FeatureRequestsScreen({ onBack, headerTitle }: FeatureRequestsScreenProps) {
  const { colors } = useCupThreadTheme();
  const client = useCupThreadClient();
  const userToken = useCupThreadUserToken();
  const isTokenReady = useCupThreadTokenReadiness();
  const strings = useCupThreadStrings();

  const title = headerTitle ?? strings.featureRequests.screenTitle;

  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedItem, setSelectedItem] = useState<FeatureRequestItem | null>(null);
  const [showCompose, setShowCompose] = useState<boolean>(false);

  const fetchVersions = useCallback(
    (signal: AbortSignal) => client.fetchVersions({ signal }),
    [client]
  );
  const {
    data: versionsData,
    isLoading: isVersionsLoading,
    error: versionsError,
    reload: reloadVersions,
  } = useAsyncData(fetchVersions, { enabled: isTokenReady });

  const versions: AppVersion[] = versionsData ?? [];

  const {
    items,
    total,
    hasMore,
    isLoading,
    isRefreshing,
    isLoadingMore,
    error: loadError,
    loadMoreError,
    isRateLimited,
    loadMore,
    refresh,
    reload,
    applyItemChange,
  } = useFeatureRequests({
    client,
    userToken,
    isTokenReady,
    versionId: selectedVersionId,
    query: searchQuery,
    pageSize: 50,
    debounceMs: 250,
  });

  const handleRefresh = useCallback(async () => {
    const tasks: Promise<any>[] = [refresh()];
    if (versionsError) {
      tasks.push(reloadVersions());
    }
    await Promise.allSettled(tasks);
  }, [refresh, versionsError, reloadVersions]);

  const { toggleVote: handleToggleVote, isVoting, voteError, getVoteError } = useToggleVote(
    client,
    userToken,
    applyItemChange
  );

  const renderItem = ({ item }: { item: FeatureRequestItem }) => (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={() => setSelectedItem(item)}
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.cardBorder,
        },
      ]}
    >
      <View style={styles.cardHeader}>
        <View style={styles.cardHeaderLeft}>
          <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>{item.title}</Text>
          <View style={styles.badgeRow}>
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

      <Text numberOfLines={2} style={[styles.cardDescription, { color: colors.textSecondary }]}>
        {item.description}
      </Text>

      {item.recentCommenters && item.recentCommenters.length > 0 && (
        <View style={styles.commentersStack}>
          {item.recentCommenters.slice(0, 3).map((commenter, idx) => (
            <View
              key={idx}
              style={[
                styles.avatarOverlap,
                { marginLeft: idx > 0 ? -8 : 0, borderColor: colors.card },
              ]}
            >
              <Avatar url={commenter.avatarUrl} name={commenter.authorName} size={20} />
            </View>
          ))}
          {item.hasMoreCommenters && (
            <Text style={[styles.moreCommenters, { color: colors.textMuted }]}>
              {strings.featureRequests.moreCommenters}
            </Text>
          )}
        </View>
      )}
    </TouchableOpacity>
  );

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
        <TouchableOpacity
          onPress={() => setShowCompose(true)}
          style={[styles.composeBtn, { backgroundColor: colors.primary }]}
          activeOpacity={0.8}
          accessibilityRole="button"
        >
          <Text style={[styles.composeBtnText, { color: colors.primaryText }]}>
            {strings.featureRequests.newButton}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.searchBar}>
        <TextInput
          style={[
            styles.searchInput,
            {
              backgroundColor: colors.inputBg,
              borderColor: colors.inputBorder,
              color: colors.textPrimary,
            },
          ]}
          placeholder={strings.featureRequests.searchPlaceholder}
          placeholderTextColor={colors.textMuted}
          value={searchQuery}
          onChangeText={setSearchQuery}
          clearButtonMode="while-editing"
        />
      </View>

      {versionsError ? (
        <View style={styles.versionsErrorContainer}>
          <ErrorState
            compact
            message={strings.common.error}
            retryLabel={strings.common.retry}
            isRetrying={isVersionsLoading}
            onRetry={reloadVersions}
          />
        </View>
      ) : versions.length > 0 ? (
        <View style={styles.chipsContainer}>
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={[{ id: 'all', label: strings.featureRequests.allVersions }, ...versions]}
            keyExtractor={(v) => v.id}
            contentContainerStyle={styles.chipsList}
            renderItem={({ item: v }) => {
              const isSelected =
                (v.id === 'all' && selectedVersionId === null) || selectedVersionId === v.id;
              return (
                <TouchableOpacity
                  onPress={() => setSelectedVersionId(v.id === 'all' ? null : v.id)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: isSelected ? colors.primary : colors.chipBg,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                >
                  <Text
                    style={[
                      styles.chipText,
                      {
                        color: isSelected ? colors.primaryText : colors.chipText,
                        fontWeight: isSelected ? '700' : '500',
                      },
                    ]}
                  >
                    {v.label}
                  </Text>
                </TouchableOpacity>
              );
            }}
          />
        </View>
      ) : null}

      {isRateLimited && items.length > 0 && (
        <View
          style={[
            styles.rateLimitBanner,
            { backgroundColor: colors.dangerBg, borderColor: colors.dangerBorder },
          ]}
        >
          <Text style={{ color: colors.danger, fontSize: 13 }}>
            {strings.featureRequests.rateLimited}
          </Text>
        </View>
      )}

      {voteError && (
        <View
          style={[
            styles.rateLimitBanner,
            { backgroundColor: colors.dangerBg, borderColor: colors.dangerBorder },
          ]}
        >
          <Text style={{ color: colors.danger, fontSize: 13 }}>
            {strings.featureRequests.voteFailed}
          </Text>
        </View>
      )}

      {/* Non-blocking refresh failure: keep the stale list visible with an
          inline retry, since the full-screen ErrorState only covers an empty
          list. Rate-limit failures are handled by the banner above. */}
      {!isLoading && items.length > 0 && loadError && !isRefreshing && !isRateLimited && (
        <View
          style={[
            styles.refreshErrorBanner,
            { backgroundColor: colors.dangerBg, borderColor: colors.dangerBorder },
          ]}
        >
          <Text style={[styles.refreshErrorBannerText, { color: colors.danger }]}>
            {strings.common.error}
          </Text>
          <TouchableOpacity
            onPress={() => {
              refresh();
            }}
            style={styles.refreshErrorRetry}
            activeOpacity={0.7}
          >
            <Text style={{ color: colors.primary, fontSize: 13, fontWeight: '600' }}>
              {strings.common.retry}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {isLoading && items.length === 0 ? (
        <View style={styles.centerLoading}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : items.length === 0 && loadError ? (
        <ErrorState
          message={isRateLimited ? strings.featureRequests.rateLimited : strings.common.error}
          retryLabel={strings.common.retry}
          onRetry={() => {
            reload();
            if (versionsError) {
              void reloadVersions();
            }
          }}
        />
      ) : items.length === 0 ? (
        <View style={styles.centerEmpty}>
          <Text style={[styles.emptyTitle, { color: colors.textPrimary }]}>
            {strings.featureRequests.emptyTitle}
          </Text>
          <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
            {strings.featureRequests.emptySubtitle}
          </Text>
          <TouchableOpacity
            onPress={() => setShowCompose(true)}
            style={[styles.emptyButton, { backgroundColor: colors.primary }]}
            accessibilityRole="button"
          >
            <Text style={[styles.emptyButtonText, { color: colors.primaryText }]}>
              {strings.featureRequests.proposeButton}
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
            />
          }
          onEndReached={() => {
            if (hasMore && !isLoadingMore && !isLoading && !isRefreshing) {
              loadMore();
            }
          }}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            isLoadingMore ? (
              <View style={styles.footerLoading}>
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={[styles.footerText, { color: colors.textMuted }]}>
                  {strings.common.loadingMore}
                </Text>
              </View>
            ) : hasMore ? (
              <View style={styles.footerAffordance}>
                {loadMoreError ? (
                  <Text style={[styles.footerAffordanceText, { color: colors.danger }]}>
                    {strings.common.error}
                  </Text>
                ) : (
                  <Text style={[styles.footerAffordanceText, { color: colors.textMuted }]}>
                    {strings.roadmap.showingCount(items.length, total)}
                  </Text>
                )}
                <TouchableOpacity
                  onPress={() => {
                    loadMore();
                  }}
                  style={[styles.loadMoreBtn, { borderColor: colors.border }]}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.loadMoreBtnText, { color: colors.primary }]}>
                    {loadMoreError ? strings.common.retry : strings.roadmap.loadMore}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null
          }
        />
      )}

      {selectedItem && (
        <FeatureRequestDetail
          item={selectedItem}
          visible={!!selectedItem}
          onClose={() => setSelectedItem(null)}
          onVoteChange={(updated) => {
            applyItemChange(updated.id, () => updated);
          }}
        />
      )}

      <FeatureRequestComposeSheet
        visible={showCompose}
        onClose={() => setShowCompose(false)}
        onSubmitSuccess={() => {
          setShowCompose(false);
          reload();
        }}
      />
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
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backBtn: {
    paddingRight: 10,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    flex: 1,
  },
  composeBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  composeBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  searchBar: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
  },
  searchInput: {
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  chipsContainer: {
    height: 44,
    marginBottom: 6,
  },
  versionsErrorContainer: {
    paddingHorizontal: 16,
    marginBottom: 6,
  },
  chipsList: {
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
  },
  chipText: {
    fontSize: 12,
  },
  rateLimitBanner: {
    marginHorizontal: 16,
    marginBottom: 6,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  refreshErrorBanner: {
    marginHorizontal: 16,
    marginBottom: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  refreshErrorBannerText: {
    flex: 1,
    fontSize: 13,
  },
  refreshErrorRetry: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  listContent: {
    padding: 16,
    paddingTop: 8,
  },
  card: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  cardHeaderLeft: {
    flex: 1,
    paddingRight: 10,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
    marginBottom: 4,
  },
  badgeRow: {
    flexDirection: 'row',
    marginTop: 2,
    marginBottom: 6,
  },
  cardDescription: {
    fontSize: 13,
    lineHeight: 18,
  },
  commentersStack: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
  },
  avatarOverlap: {
    borderWidth: 1.5,
    borderRadius: 10,
  },
  moreCommenters: {
    fontSize: 11,
    marginLeft: 6,
  },
  centerLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 6,
  },
  emptySubtitle: {
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 16,
  },
  emptyButton: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
  },
  emptyButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  footerLoading: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 16,
  },
  footerText: {
    fontSize: 13,
    marginLeft: 8,
  },
  footerAffordance: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 16,
  },
  footerAffordanceText: {
    fontSize: 13,
    marginRight: 12,
  },
  loadMoreBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
  },
  loadMoreBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
