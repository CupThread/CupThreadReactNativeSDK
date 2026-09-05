import { useCallback, useEffect, useRef, useState } from 'react';
import type { FeedbackClient } from '../client/FeedbackClient';
import type { FeatureRequestItem } from '../types';

/**
 * Configuration options for {@link useFeatureRequests}.
 */
export interface UseFeatureRequestsOptions {
  /**
   * FeedbackClient instance used to fetch data.
   */
  client: FeedbackClient;

  /**
   * User token used to evaluate vote status and ownership.
   */
  userToken: string;

  /**
   * Whether the token is fully loaded from storage.
   *
   * @defaultValue true
   */
  isTokenReady?: boolean;

  /**
   * Optional version milestone filter.
   */
  versionId?: string | null;

  /**
   * Optional search keyword query.
   */
  query?: string;

  /**
   * Optional Kanban column ID filter.
   */
  columnId?: string | null;

  /**
   * Optional status slug filter.
   */
  status?: string | null;

  /**
   * Number of items to fetch per page.
   *
   * @defaultValue 50
   */
  pageSize?: number;

  /**
   * Debounce delay in milliseconds before fetching on query or filter changes.
   *
   * @defaultValue 0
   */
  debounceMs?: number;
}

/**
 * Return type of {@link useFeatureRequests}.
 */
export interface UseFeatureRequestsResult {
  /**
   * Accumulated array of loaded feature requests.
   */
  items: FeatureRequestItem[];

  /**
   * Total count of matching feature requests reported by server.
   */
  total: number;

  /**
   * Whether there are more items available to fetch from the server.
   */
  hasMore: boolean;

  /**
   * Whether the initial load or a filter/search change request is in flight.
   */
  isLoading: boolean;

  /**
   * Whether a pull-to-refresh request is currently in flight.
   */
  isRefreshing: boolean;

  /**
   * Whether a next-page fetch (`loadMore`) is currently in flight.
   */
  isLoadingMore: boolean;

  /**
   * Most recent fetch error, if any.
   */
  error: Error | null;

  /**
   * Fetches the next page of items and appends them to `items`.
   * Safely no-ops if a request is already in flight, no more items remain,
   * or the token is not ready.
   */
  loadMore: () => Promise<void>;

  /**
   * Refreshes items from page 0 using pull-to-refresh semantics.
   */
  refresh: () => Promise<void>;

  /**
   * Reloads items from page 0 with `isLoading = true`.
   */
  reload: () => Promise<void>;

  /**
   * Direct state setter for `items`.
   */
  setItems: React.Dispatch<React.SetStateAction<FeatureRequestItem[]>>;

  /**
   * Applies a state transform to a specific item by ID (e.g. for optimistic votes).
   */
  applyItemChange: (
    itemId: string,
    transform: (item: FeatureRequestItem) => FeatureRequestItem
  ) => void;
}

/**
 * Shared hook managing paginated feature request loading, infinite scrolling,
 * filter/search resetting, pull-to-refresh, deduplication, and cancellation.
 *
 * @param options - Hook configuration options.
 * @returns State and helper callbacks for rendering paginated lists.
 *
 * @example
 * ```tsx
 * const {
 *   items,
 *   total,
 *   hasMore,
 *   isLoading,
 *   isLoadingMore,
 *   loadMore,
 *   refresh,
 * } = useFeatureRequests({ client, userToken, pageSize: 50 });
 * ```
 */
export function useFeatureRequests(
  options: UseFeatureRequestsOptions
): UseFeatureRequestsResult {
  const {
    client,
    userToken,
    isTokenReady = true,
    versionId,
    query,
    columnId,
    status,
    pageSize = 50,
    debounceMs = 0,
  } = options;

  const [items, setItems] = useState<FeatureRequestItem[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  const itemsRef = useRef<FeatureRequestItem[]>(items);
  itemsRef.current = items;

  const totalRef = useRef<number>(total);
  totalRef.current = total;

  const isLoadingMoreRef = useRef<boolean>(false);
  const loadControllerRef = useRef<AbortController | null>(null);
  const loadMoreControllerRef = useRef<AbortController | null>(null);

  const applyItemChange = useCallback(
    (itemId: string, transform: (item: FeatureRequestItem) => FeatureRequestItem) => {
      setItems((prev) => prev.map((item) => (item.id === itemId ? transform(item) : item)));
    },
    []
  );

  // Initial load or query/filter change
  const loadPage0 = useCallback(
    async (signal?: AbortSignal) => {
      if (!isTokenReady) return;
      try {
        const res = await client.fetchFeatureRequests({
          userToken,
          versionId: versionId || undefined,
          query: query?.trim() || undefined,
          columnId: columnId || undefined,
          status: status || undefined,
          limit: pageSize,
          offset: 0,
          signal,
        });

        if (signal?.aborted) return;
        const fetchedItems = res.requests || [];
        const reportedTotal = typeof res.total === 'number' ? res.total : fetchedItems.length;

        setItems(fetchedItems);
        setTotal(reportedTotal);
        setError(null);
      } catch (err: any) {
        if (err?.name === 'AbortError' || signal?.aborted) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        if (!signal?.aborted) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [client, userToken, isTokenReady, versionId, query, columnId, status, pageSize]
  );

  useEffect(() => {
    if (!isTokenReady) return;

    loadControllerRef.current?.abort();
    loadMoreControllerRef.current?.abort();

    const controller = new AbortController();
    loadControllerRef.current = controller;

    setIsLoading(true);

    const timer = setTimeout(
      () => {
        loadPage0(controller.signal);
      },
      debounceMs > 0 ? debounceMs : 0
    );

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [loadPage0, debounceMs, isTokenReady]);

  // Load next page
  const loadMore = useCallback(async () => {
    if (!isTokenReady || isLoading || isRefreshing || isLoadingMoreRef.current) return;
    if (itemsRef.current.length >= totalRef.current) return;

    loadMoreControllerRef.current?.abort();
    const controller = new AbortController();
    loadMoreControllerRef.current = controller;

    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);

    try {
      const currentOffset = itemsRef.current.length;
      const res = await client.fetchFeatureRequests({
        userToken,
        versionId: versionId || undefined,
        query: query?.trim() || undefined,
        columnId: columnId || undefined,
        status: status || undefined,
        limit: pageSize,
        offset: currentOffset,
        signal: controller.signal,
      });

      if (controller.signal.aborted) return;

      const newItems = res.requests || [];
      let nextTotal = typeof res.total === 'number' ? res.total : totalRef.current;

      setItems((prev) => {
        const existingIds = new Set(prev.map((i) => i.id));
        const fresh = newItems.filter((i) => !existingIds.has(i.id));
        const next = [...prev, ...fresh];
        if (newItems.length === 0 || newItems.length < pageSize) {
          nextTotal = Math.min(nextTotal, next.length);
        }
        return next;
      });

      setTotal(nextTotal);
      setError(null);
    } catch (err: any) {
      if (err?.name === 'AbortError' || controller.signal.aborted) return;
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      if (!controller.signal.aborted) {
        isLoadingMoreRef.current = false;
        setIsLoadingMore(false);
      }
    }
  }, [client, userToken, isTokenReady, isLoading, isRefreshing, versionId, query, columnId, status, pageSize]);

  // Pull-to-refresh
  const refresh = useCallback(async () => {
    if (!isTokenReady) return;
    loadControllerRef.current?.abort();
    loadMoreControllerRef.current?.abort();

    const controller = new AbortController();
    loadControllerRef.current = controller;

    setIsRefreshing(true);
    await loadPage0(controller.signal);
  }, [isTokenReady, loadPage0]);

  // Reload
  const reload = useCallback(async () => {
    if (!isTokenReady) return;
    loadControllerRef.current?.abort();
    loadMoreControllerRef.current?.abort();

    const controller = new AbortController();
    loadControllerRef.current = controller;

    setIsLoading(true);
    await loadPage0(controller.signal);
  }, [isTokenReady, loadPage0]);

  useEffect(() => {
    return () => {
      loadControllerRef.current?.abort();
      loadMoreControllerRef.current?.abort();
    };
  }, []);

  const hasMore = items.length < total;

  return {
    items,
    total,
    hasMore,
    isLoading,
    isRefreshing,
    isLoadingMore,
    error,
    loadMore,
    refresh,
    reload,
    setItems,
    applyItemChange,
  };
}
