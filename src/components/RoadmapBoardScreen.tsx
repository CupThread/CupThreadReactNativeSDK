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
import type { BoardColumn, FeatureRequestItem } from '../types';
import { VoteButton } from './VoteButton';
import { Badge } from './Badge';
import { FeatureRequestDetail } from './FeatureRequestDetail';
import { useToggleVote, type VoteChangeApplier } from '../hooks/useToggleVote';

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

  const [columns, setColumns] = useState<BoardColumn[]>([]);
  const [requests, setRequests] = useState<FeatureRequestItem[]>([]);
  const [selectedColumnId, setSelectedColumnId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [selectedItem, setSelectedItem] = useState<FeatureRequestItem | null>(null);

  const loadData = useCallback(async (signal?: AbortSignal) => {
    // Wait for the persisted token: fetching earlier would evaluate
    // hasVoted/isOwnRequest against a throwaway identity.
    if (!isTokenReady) return;
    try {
      const [cols, reqs] = await Promise.all([
        client.fetchColumns({ signal }),
        client.fetchFeatureRequests({ userToken, limit: 100, signal }),
      ]);

      if (signal?.aborted) return;
      const visibleCols = cols.filter((c) => c.isVisible);
      setColumns(visibleCols);
      if (visibleCols.length > 0 && !selectedColumnId) {
        setSelectedColumnId(visibleCols[0].id);
      }
      setRequests(reqs.requests || []);
    } catch (err: any) {
      if (err?.name === 'AbortError' || signal?.aborted) return;
      // Non-fatal
    } finally {
      if (!signal?.aborted) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [client, userToken, selectedColumnId, isTokenReady]);

  useEffect(() => {
    const controller = new AbortController();
    loadData(controller.signal);
    return () => {
      controller.abort();
    };
  }, [loadData]);

  const handleRefresh = useCallback(() => {
    if (!isTokenReady) return;
    setIsRefreshing(true);
    loadData();
  }, [loadData, isTokenReady]);

  const activeColumn = columns.find((c) => c.id === selectedColumnId) || columns[0];
  const columnItems = requests.filter((r) => {
    if (!activeColumn) return true;
    return r.columnId === activeColumn.id || (!r.columnId && r.status === activeColumn.slug);
  });

  const applyVoteChange = useCallback<VoteChangeApplier>((itemId, transform) => {
    setRequests((prev) => prev.map((i) => (i.id === itemId ? transform(i) : i)));
  }, []);
  const { toggleVote: handleToggleVote, isVoting } = useToggleVote(client, userToken, applyVoteChange);

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
      ) : columnItems.length === 0 ? (
        <View style={styles.centerEmpty}>
          <Text style={[styles.emptyTitle, { color: colors.textPrimary }]}>
            {strings.roadmap.emptyColumn}
          </Text>
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
            setRequests((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
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
  },
});
