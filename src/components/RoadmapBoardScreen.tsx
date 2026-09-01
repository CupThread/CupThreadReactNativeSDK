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
import { useCupThreadTheme, useCupThreadClient, useCupThreadUserToken } from '../theme/CupThreadThemeProvider.tsx';
import type { BoardColumn, FeatureRequestItem } from '../types/index.ts';
import { VoteButton } from './VoteButton.tsx';
import { Badge } from './Badge.tsx';
import { FeatureRequestDetail } from './FeatureRequestDetail.tsx';

export interface RoadmapBoardScreenProps {
  onBack?: () => void;
  headerTitle?: string;
}

export function RoadmapBoardScreen({
  onBack,
  headerTitle = 'Roadmap',
}: RoadmapBoardScreenProps) {
  const { colors } = useCupThreadTheme();
  const client = useCupThreadClient();
  const userToken = useCupThreadUserToken();

  const [columns, setColumns] = useState<BoardColumn[]>([]);
  const [requests, setRequests] = useState<FeatureRequestItem[]>([]);
  const [selectedColumnId, setSelectedColumnId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [selectedItem, setSelectedItem] = useState<FeatureRequestItem | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [cols, reqs] = await Promise.all([
        client.fetchColumns(),
        client.fetchFeatureRequests({ userToken, limit: 100 }),
      ]);

      const visibleCols = cols.filter((c) => c.isVisible);
      setColumns(visibleCols);
      if (visibleCols.length > 0 && !selectedColumnId) {
        setSelectedColumnId(visibleCols[0].id);
      }
      setRequests(reqs.requests || []);
    } catch {
      // Non-fatal
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [client, userToken, selectedColumnId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    loadData();
  };

  const activeColumn = columns.find((c) => c.id === selectedColumnId) || columns[0];
  const columnItems = requests.filter((r) => {
    if (!activeColumn) return true;
    return r.columnId === activeColumn.id || (!r.columnId && r.status === activeColumn.slug);
  });

  const handleToggleVote = async (target: FeatureRequestItem) => {
    if (target.isOwnRequest) return;

    const nextVoted = !target.hasVoted;
    const nextCount = target.voteCount + (nextVoted ? 1 : -1);
    setRequests((prev) =>
      prev.map((i) => (i.id === target.id ? { ...i, hasVoted: nextVoted, voteCount: Math.max(0, nextCount) } : i))
    );

    try {
      const res = await client.toggleVote(target.id, userToken);
      setRequests((prev) =>
        prev.map((i) => (i.id === target.id ? { ...i, hasVoted: res.voted, voteCount: res.voteCount } : i))
      );
    } catch {
      setRequests((prev) =>
        prev.map((i) => (i.id === target.id ? target : i))
      );
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.topBar, { borderBottomColor: colors.border }]}>
        {onBack && (
          <TouchableOpacity onPress={onBack} style={styles.backBtn}>
            <Text style={{ color: colors.primary, fontSize: 16, fontWeight: '600' }}>←</Text>
          </TouchableOpacity>
        )}
        <Text style={[styles.headerTitle, { color: colors.textPrimary }]}>{headerTitle}</Text>
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
          <Text style={[styles.emptyTitle, { color: colors.textPrimary }]}>No items in this column</Text>
          <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
            Features planned for this milestone will appear here.
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
                  disabled={item.isOwnRequest}
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
