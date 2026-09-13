import { useCallback, useEffect, useRef, useState } from 'react';
import type { FeedbackClient } from '../client/FeedbackClient';
import { RateLimitedException } from '../client/FeedbackException';
import type { FeatureRequestItem } from '../types';
import { SearchRateLimiter } from '../utils/searchRateLimiter';

/**
 * Tuning knobs passed through to the hook's {@link SearchRateLimiter}.
 * Production defaults keep query-bearing searches strictly under the backend's
 * 30 searches / 60s per-IP budget; overriding is mainly useful for tests or
 * for backends with different limits.
 */
export interface UseFeatureRequestsSearchLimiterOptions {
  /**
   * Minimum spacing in milliseconds between two query-bearing fetches.
   *
   * @defaultValue 2500
   */
  minSpacingMs?: number;

  /**
   * Cooldown in milliseconds applied after an HTTP 429 when the server does
   * not provide a usable `Retry-After` value.
   *
   * @defaultValue 60000
   */
  cooldownMs?: number;
}

/**
 * Builds the deduplication key for a query-bearing search: the same trimmed
 * query + version filter must not refetch when the effect re-fires.
 */
function buildSearchKey(query: string, versionId: string | null | undefined): string {
  return `${query}|${versionId || ''}`;
}

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

  /**
   * Optional tuning for the client-side search rate limiter (spacing between
   * query-bearing fetches and the post-429 cooldown). The limiter is created
   * once per hook mount from this value; later changes are ignored.
   */
  searchRateLimiterOptions?: UseFeatureRequestsSearchLimiterOptions;
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
   * True while the client-side post-429 search cooldown is active. Query
   * searches stay suppressed until it elapses; UI should show a localized
   * rate-limit notice instead of treating this as a generic failure.
   */
  isRateLimited: boolean;

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
export function useFeatureRequests(options: UseFeatureRequestsOptions): UseFeatureRequestsResult {
  const {
    client,
    userToken,
    isTokenReady = true,
    versionId,
    query,
    pageSize = 50,
    debounceMs = 0,
    searchRateLimiterOptions,
  } = options;

  const [items, setItems] = useState<FeatureRequestItem[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const [isRateLimited, setIsRateLimited] = useState<boolean>(false);

  // Created lazily on first render; option changes after mount are ignored so
  // the pacing state is never reset mid-session.
  const searchLimiterRef = useRef<SearchRateLimiter | null>(null);
  if (searchLimiterRef.current === null) {
    searchLimiterRef.current = new SearchRateLimiter(searchRateLimiterOptions);
  }
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Key of the last successfully loaded search (trimmed query + versionId).
  // Duplicate suppression: re-firing the effect with the same key must not
  // burn another search against the server's per-IP rate budget.
  const lastSearchKeyRef = useRef<string | null>(null);

  // Initial load or query/filter change
  const loadPage0 = useCallback(
    async (signal?: AbortSignal) => {
      if (!isTokenReady) return;
      const trimmedQuery = query?.trim() || '';
      const isSearch = trimmedQuery.length > 0;
      const limiter = searchLimiterRef.current!;

      // Query-bearing searches are paced client-side to stay under the
      // production 30/min per-IP search budget; plain listings are not
      // rate-limited. A skipped load (cooldown / spacing) must still run the
      // finally block so refresh()/reload() never leave a spinner stuck.
      let skipped = false;
      if (isSearch) {
        if (limiter.canFetch()) {
          limiter.markFetched();
        } else {
          skipped = true;
        }
      }

      try {
        if (skipped) return;

        const res = await client.fetchFeatureRequests({
          userToken,
          versionId: versionId || undefined,
          query: trimmedQuery || undefined,
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
        if (isSearch) {
          lastSearchKeyRef.current = buildSearchKey(trimmedQuery, versionId);
          setIsRateLimited(false);
        }
      } catch (err: any) {
        if (err?.name === 'AbortError' || signal?.aborted) return;
        if (err instanceof RateLimitedException) {
          // Enter the search cooldown (server Retry-After wins) and surface a
          // rate-limit notice instead of an endless autofire loop.
          const cooldownMs = limiter.enterCooldown(err.retryAfterMs);
          setIsRateLimited(true);
          if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
          cooldownTimerRef.current = setTimeout(() => setIsRateLimited(false), cooldownMs);
        }
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        if (!signal?.aborted) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [client, userToken, isTokenReady, versionId, query, pageSize]
  );

  useEffect(() => {
    if (!isTokenReady) return;

    loadControllerRef.current?.abort();
    loadMoreControllerRef.current?.abort();

    const trimmedQuery = query?.trim() || '';
    const isSearch = trimmedQuery.length > 0;
    const limiter = searchLimiterRef.current!;

    // Same trimmed query + version filter already loaded successfully — keep
    // the results on screen and do not refetch.
    if (isSearch && lastSearchKeyRef.current === buildSearchKey(trimmedQuery, versionId)) {
      return;
    }

    // After a 429, query-triggered fetches stay suppressed for the cooldown;
    // the screen shows a localized notice until it elapses.
    if (isSearch && limiter.cooldownRemaining() > 0) {
      return;
    }

    const controller = new AbortController();
    loadControllerRef.current = controller;

    setIsLoading(true);

    // Debounce first, then the search spacing window so a typing burst waits
    // for its turn instead of silently dropping the final query.
    const searchWaitMs = isSearch ? limiter.waitTime() : 0;
    const timer = setTimeout(
      () => {
        loadPage0(controller.signal);
      },
      (debounceMs > 0 ? debounceMs : 0) + searchWaitMs
    );

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [loadPage0, debounceMs, isTokenReady, query, versionId]);

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
        limit: pageSize,
        offset: currentOffset,
        signal: controller.signal,
      });

      if (controller.signal.aborted) return;

      const newItems = res.requests || [];
      let nextTotal = typeof res.total === 'number' ? res.total : totalRef.current;

      // Compute the deduped append count from itemsRef instead of inside a
      // functional updater: React invokes updaters during the next render,
      // so any value mutated there is not readable at the call site (and
      // StrictMode invokes updaters twice).
      const prevItems = itemsRef.current;
      const existingIds = new Set(prevItems.map((i) => i.id));
      const freshCount = newItems.filter((i) => !existingIds.has(i.id)).length;
      if (newItems.length === 0 || newItems.length < pageSize) {
        // Short page: server has no more data, so clamp total in case the
        // reported count drifted (e.g. items deleted between page fetches).
        nextTotal = Math.min(nextTotal, prevItems.length + freshCount);
      }

      setItems((prev) => {
        const ids = new Set(prev.map((i) => i.id));
        return [...prev, ...newItems.filter((i) => !ids.has(i.id))];
      });

      setTotal(nextTotal);
      setError(null);
    } catch (err: any) {
      if (err?.name === 'AbortError' || controller.signal.aborted) return;
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      // Reset even when aborted: refresh()/reload()/filter changes abort an
      // in-flight loadMore, and leaving the guard set would permanently
      // disable infinite scroll.
      isLoadingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  }, [client, userToken, isTokenReady, isLoading, isRefreshing, versionId, query, pageSize]);

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
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
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
    isRateLimited,
    loadMore,
    refresh,
    reload,
    setItems,
    applyItemChange,
  };
}
