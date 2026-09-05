import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
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
import type { FeatureRequestItem } from '../types';
import { VoteButton } from './VoteButton';
import { Badge } from './Badge';
import { FeatureRequestDetail } from './FeatureRequestDetail';
import { useToggleVote, type VoteChangeApplier } from '../hooks/useToggleVote';
import { useFeatureRequests } from '../hooks/useFeatureRequests';
import { useAsyncData } from '../hooks/useAsyncData';
import { ErrorState } from './ErrorState';

/**
 * Props for configuring the {@link RoadmapBoardScreen} component.
 *
 * @example
 * ```tsx
 * <RoadmapBoardScreen
 *   headerTitle="Product Roadmap"
 *   onBack={() => navigation.goBack()}
 * />
 * ```
 */
export interface RoadmapBoardScreenProps {
  /**
   * Optional callback function invoked when the user taps the top navigation back button.
   * If omitted, the back button is hidden.
   */
  onBack?: () => void;

  /**
   * Header title displayed at the top of the roadmap screen.
   *
   * @defaultValue `'Roadmap'` (or localized equivalent)
   */
  headerTitle?: string;
}

/**
 * Multi-column Kanban roadmap board screen showing milestones such as "Under Consideration", "In Progress", and "Shipped".
 *
 * @param props - {@link RoadmapBoardScreenProps} configuring navigation and titles.
 *
 * @example
 * ```tsx
 * import React from 'react';
 * import { FeedbackClient, CupThreadProvider, RoadmapBoardScreen } from '@cupthread/react-native';
 *
 * const client = new FeedbackClient({
 *   baseUrl: 'https://api.cupthread.com',
 *   appKey: 'app_prod_123',
 * });
 *
 * export function RoadmapRoute({ navigation }) {
 *   return (
 *     <CupThreadProvider client={client}>
 *       <RoadmapBoardScreen onBack={() => navigation.goBack()} />
 *     </CupThreadProvider>
 *   );
 * }
 * ```
 */
export function RoadmapBoardScreen({
  onBack,
  headerTitle,
}: RoadmapBoardScreenProps) {
  const { colors } = useCupThreadTheme();
  const client = useCupThreadClient();
  const userToken = useCupThreadUserToken();
  const isTokenReady = useCupThreadTokenReadiness();
  const strings = useCupThreadStrings();
  const title = headerTitle ?? strings.roadmap.screenTitle;

  const [selectedColumnId, setSelectedColumnId] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<FeatureRequestItem | null>(null);

  const {
    items: requests,
    total,
    hasMore,
    isLoading: isRequestsLoading,
    isRefreshing,
    isLoadingMore,
    error: requestsError,
    loadMore,
    refresh: refreshRequests,
    reload: reloadRequests,
    setItems: setRequests,
    applyItemChange,
  } = useFeatureRequests({
    client,
    userToken,
    isTokenReady,
    pageSize: 100,
  });

  const fetchColumns = useCallback(
    (signal: AbortSignal) => client.fetchColumns({ signal }),
    [client]
  );
  const {
    data: columnsData,
    isLoading: isColumnsLoading,
    error: columnsError,
    reload: reloadColumns,
  } = useAsyncData(fetchColumns, { enabled: isTokenReady });

  const columns = (columnsData ?? []).filter((c) => c.isVisible);

  useEffect(() => {
    if (columns.length === 0) return;
    setSelectedColumnId((prev) => prev ?? columns[0].id);
  }, [columns]);

  const handleRefresh = useCallback(async () => {
    if (!isTokenReady) return;
    await Promise.all([reloadColumns(), refreshRequests()]);
  }, [reloadColumns, refreshRequests, isTokenReady]);

  const handleRetry = useCallback(() => {
    void reloadColumns();
    void reloadRequests();
  }, [reloadColumns, reloadRequests]);

  const activeColumn = columns.find((c) => c.id === selectedColumnId) || columns[0];
  const columnItems = requests.filter((r) => {
    if (!activeColumn) return true;
    return r.columnId === activeColumn.id || (!r.columnId && r.status === activeColumn.slug);
  });

  const { toggleVote: handleToggleVote, isVoting } = useToggleVote(client, userToken, applyItemChange);

  const isLoading =
    (isColumnsLoading && columns.length === 0) || (isRequestsLoading && requests.length === 0);
  const loadError = requestsError ?? columnsError;

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

      {columns.length > 0 && (
        <View style={[styles.columnTabsContainer, { borderBottomColor: colors.border }]}>
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={columns}
            keyExtractor={(c) => c.id}
            contentContainerStyle={styles.columnTabsList}
            renderItem={({ item: col }) => {
              const isSelected = col.id === selectedColumnId;
              const count = requests.filter(
                (r) => r.columnId === col.id || (!r.columnId && r.status === col.slug)
              ).length;

              return (
                <TouchableOpacity
                  onPress={() => setSelectedColumnId(col.id)}
                  style={[
                    styles.columnTab,
                    {
                      borderBottomColor: isSelected ? (col.color || colors.primary) : 'transparent',
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.columnTabText,
                      {
                        color: isSelected ? colors.textPrimary : colors.textMuted,
                        fontWeight: isSelected ? '700' : '500',
                      },
                    ]}
                  >
                    {col.name} ({count})
                  </Text>
                </TouchableOpacity>
              );
            }}
          />
        </View>
      )}

      {isLoading ? (
        <View style={styles.centerLoading}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : requests.length === 0 && loadError ? (
        <ErrorState
          message={strings.common.error}
          retryLabel={strings.common.retry}
          onRetry={handleRetry}
        />
      ) : columnItems.length === 0 ? (
        <View style={styles.centerEmpty}>
          <Text style={[styles.emptyTitle, { color: colors.textPrimary }]}>
            {strings.roadmap.emptyColumn}
          </Text>
          {hasMore && (
            <>
              <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
                {strings.roadmap.showingCount(requests.length, total)}
              </Text>
              <TouchableOpacity
                onPress={() => loadMore()}
                style={[styles.emptyButton, { backgroundColor: colors.primary }]}
                activeOpacity={0.8}
                disabled={isLoadingMore}
              >
                {isLoadingMore ? (
                  <ActivityIndicator size="small" color={colors.primaryText} />
                ) : (
                  <Text style={[styles.emptyButtonText, { color: colors.primaryText }]}>
                    {strings.roadmap.loadMore}
                  </Text>
                )}
              </TouchableOpacity>
            </>
          )}
        </View>
      ) : (
        <FlatList
          data={columnItems}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
            />
          }
          onEndReached={() => {
            if (hasMore && !isLoadingMore && !isRequestsLoading && !isRefreshing) {
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
                <Text style={[styles.footerAffordanceText, { color: colors.textMuted }]}>
                  {strings.roadmap.showingCount(requests.length, total)}
                </Text>
                <TouchableOpacity
                  onPress={() => loadMore()}
                  style={[styles.loadMoreBtn, { borderColor: colors.border }]}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.loadMoreBtnText, { color: colors.primary }]}>
                    {strings.roadmap.loadMore}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : null
          }
          renderItem={({ item }) => (
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
                  <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>
                    {item.title}
                  </Text>
                  {item.versionLabel && (
                    <View style={styles.versionBadge}>
                      <Badge label={`v${item.versionLabel}`} variant="outline" />
                    </View>
                  )}
                </View>
                <VoteButton
                  voteCount={item.voteCount}
                  hasVoted={item.hasVoted}
                  onPress={() => handleToggleVote(item)}
                  disabled={item.isOwnRequest || isVoting(item.id)}
                />
              </View>

              <Text
                numberOfLines={3}
                style={[styles.cardDescription, { color: colors.textSecondary }]}
              >
                {item.description}
              </Text>
            </TouchableOpacity>
          )}
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
  columnTabsContainer: {
    borderBottomWidth: 1,
  },
  columnTabsList: {
    paddingHorizontal: 16,
  },
  columnTab: {
    paddingVertical: 12,
    marginRight: 18,
    borderBottomWidth: 2,
  },
  columnTabText: {
    fontSize: 14,
  },
  listContent: {
    padding: 16,
  },
  card: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  cardHeaderLeft: {
    flex: 1,
    paddingRight: 10,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
  },
  versionBadge: {
    marginTop: 4,
  },
  cardDescription: {
    fontSize: 13,
    lineHeight: 18,
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
    gap: 8,
  },
  footerText: {
    fontSize: 13,
  },
  footerAffordance: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 16,
    gap: 12,
  },
  footerAffordanceText: {
    fontSize: 13,
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
