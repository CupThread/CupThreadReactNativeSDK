import { useCallback, useEffect, useRef, useState } from 'react';
import type { FeedbackClient } from '../client/FeedbackClient';
import type { ChangelogEntry } from '../types';

/**
 * Configuration options for {@link useChangelogEntries}.
 */
export interface UseChangelogEntriesOptions {
  /**
   * FeedbackClient instance used to fetch data.
   */
  client: FeedbackClient;

  /**
   * Number of entries to fetch per page (server maximum: 100).
   *
   * @defaultValue 20
   */
  pageSize?: number;

  /**
   * Whether the fetch should run. When false, no requests are made.
   *
   * @defaultValue true
   */
  enabled?: boolean;
}

/**
 * Return type of {@link useChangelogEntries}.
 */
export interface UseChangelogEntriesResult {
  /**
   * Accumulated changelog entries, newest first.
   */
  entries: ChangelogEntry[];

  /**
   * Whether more pages are available from the server.
   */
  hasMore: boolean;

  /**
   * Whether the initial load or a `reload` is currently in flight.
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
   * Most recent first-page fetch error (initial load or pull-to-refresh), if any.
   */
  error: Error | null;

  /**
   * Most recent next-page (`loadMore`) fetch error, if any. Kept separate from
   * `error` so the list can keep earlier pages visible while the footer offers
   * a retry.
   */
  loadMoreError: Error | null;

  /**
   * Fetches the next page and appends it to `entries`. Safely no-ops while a
   * request is in flight or no more pages remain.
   */
  loadMore: () => Promise<void>;

  /**
   * Reloads the first page with pull-to-refresh semantics.
   */
  refresh: () => Promise<void>;

  /**
   * Reloads the first page with `isLoading = true`.
   */
  reload: () => Promise<void>;
}

/**
 * A page can only be followed when the server reports more entries, the page
 * was non-empty, and it handed back a cursor to follow. Without the cursor the
 * load-more affordance would stay visible but could never fetch anything.
 */
function pageHasMore(page: {
  entries: ChangelogEntry[];
  hasMore: boolean;
  nextCursor: string | null;
}): boolean {
  return page.hasMore && page.entries.length > 0 && page.nextCursor !== null;
}

function appendUniquePage(previous: ChangelogEntry[], page: ChangelogEntry[]): ChangelogEntry[] {
  if (page.length === 0) return previous;
  const seen = new Set(previous.map((entry) => entry.id));
  const fresh = page.filter((entry) => !seen.has(entry.id));
  if (fresh.length === 0) return previous;
  return [...previous, ...fresh];
}

/**
 * Shared hook managing cursor-paginated changelog loading: initial load,
 * load-more via the endpoint's opaque keyset cursor, pull-to-refresh,
 * deduplication, and cancellation.
 *
 * @param options - Hook configuration options.
 * @returns State and helper callbacks for rendering the paginated list.
 *
 * @example
 * ```tsx
 * const { entries, hasMore, isLoadingMore, loadMore } = useChangelogEntries({
 *   client,
 *   pageSize: 20,
 * });
 * ```
 */
export function useChangelogEntries(
  options: UseChangelogEntriesOptions
): UseChangelogEntriesResult {
  const { client, pageSize = 20, enabled = true } = options;

  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(enabled);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<Error | null>(null);

  // Cursor of the next unread page. `null` once the end is reached (or while
  // the first page is still loading).
  const nextCursorRef = useRef<string | null>(null);
  const hasMoreRef = useRef<boolean>(hasMore);
  hasMoreRef.current = hasMore;
  const isLoadingMoreRef = useRef<boolean>(false);
  const loadControllerRef = useRef<AbortController | null>(null);
  const loadMoreControllerRef = useRef<AbortController | null>(null);
  // Identity of the list the cursor belongs to. A keyset cursor is only
  // meaningful for the client/page size that produced it, so an identity
  // change must invalidate the old walk before the replacement resolves.
  const firstPageIdentityRef = useRef({ client, pageSize });
  // Bumped on every identity change so an in-flight load-more that resolves
  // late cannot append the previous list's page to the new one.
  const listGenerationRef = useRef(0);

  const loadFirstPage = useCallback(
    async (signal?: AbortSignal) => {
      if (!enabled) return;
      // Every first-page load replaces the list, so a load-more failure
      // against the previous list no longer applies — including when the
      // replacement fails, where the old footer error would otherwise stay
      // visible next to the new first-page error (#437).
      setLoadMoreError(null);
      try {
        const page = await client.listChangelog({ limit: pageSize, signal });
        if (signal?.aborted) return;
        nextCursorRef.current = page.nextCursor;
        setEntries(page.entries);
        // An empty page can never be followed by another one, even if a
        // buggy server left `hasMore` set; neither can a page without a cursor.
        setHasMore(pageHasMore(page));
        setError(null);
        // A fresh first page replaces the whole list, so a load-more failure
        // against the previous list no longer applies.
        setLoadMoreError(null);
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
    [client, pageSize, enabled]
  );

  // Initial load, and reload when the client / page size / enabled changes.
  useEffect(() => {
    if (!enabled) {
      // The previous effect's cleanup aborted only its own controller; a
      // manual refresh()/reload() may have replaced `loadControllerRef` with
      // a live request the cleanup never saw. Abort it here so the hook
      // cannot disable with a first page still on the wire, then clear the
      // flags its guarded `finally` would otherwise skip (#137).
      loadControllerRef.current?.abort();
      loadMoreControllerRef.current?.abort();
      setIsLoading(false);
      setIsRefreshing(false);
      return;
    }

    loadControllerRef.current?.abort();
    loadMoreControllerRef.current?.abort();

    const identity = firstPageIdentityRef.current;
    const clientChanged = identity.client !== client;
    const identityChanged = clientChanged || identity.pageSize !== pageSize;
    firstPageIdentityRef.current = { client, pageSize };
    if (identityChanged) {
      // Drop the previous list's walk before the replacement starts: a cursor
      // from another client/page size can never be followed here, and a
      // failed replacement page must not leave `loadMore` holding it.
      listGenerationRef.current += 1;
      nextCursorRef.current = null;
      hasMoreRef.current = false;
      setHasMore(false);
      setLoadMoreError(null);
      if (clientChanged) {
        // The rendered rows belong to the previous app, so a failed
        // replacement must not leave them on screen under the new client.
        // A page-size change and a refresh/reload keep the same data source,
        // so their failures still keep the stale-but-valid entries (#447).
        setEntries([]);
      }
    }

    const controller = new AbortController();
    loadControllerRef.current = controller;
    // The replacement this effect schedules is a plain load, never a
    // refresh: release the refresh flag now so a refresh aborted above
    // cannot keep RefreshControl spinning through the replacement's flight.
    // The aborted refresh's guarded `finally` will not clear it, so this is
    // the only chance to hand the flag back (#137).
    setIsRefreshing(false);
    setIsLoading(true);
    void loadFirstPage(controller.signal);

    return () => {
      controller.abort();
    };
  }, [loadFirstPage, enabled, client, pageSize]);

  const loadMore = useCallback(async () => {
    if (!enabled || isLoading || isRefreshing || isLoadingMoreRef.current) return;
    if (!hasMoreRef.current) return;
    const cursor = nextCursorRef.current;
    if (!cursor) return;
    const generation = listGenerationRef.current;

    loadMoreControllerRef.current?.abort();
    const controller = new AbortController();
    loadMoreControllerRef.current = controller;

    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);

    try {
      const page = await client.listChangelog({
        limit: pageSize,
        cursor,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      // The list was swapped while this page was in flight: its entries and
      // cursor belong to the previous client/page size, so never merge them.
      if (listGenerationRef.current !== generation) return;
      // Keyset cursors only move forward. If a refresh rewound the cursor
      // while this page was in flight, the response is stale — discard it.
      if (nextCursorRef.current !== cursor) return;

      // A cursor that does not advance can never finish the walk: the
      // contract defines `nextCursor` as the following page's cursor, so an
      // unchanged value contradicts a truthy `hasMore`. Stop pagination on
      // it instead of re-fetching the same page on every loadMore.
      const stalledCursor = page.nextCursor !== null && page.nextCursor === cursor;
      const nextCursor = stalledCursor ? null : page.nextCursor;
      nextCursorRef.current = nextCursor;
      setEntries((prev) => appendUniquePage(prev, page.entries));
      setHasMore(!stalledCursor && pageHasMore({ ...page, nextCursor }));
      setLoadMoreError(null);
    } catch (err: any) {
      if (err?.name === 'AbortError' || controller.signal.aborted) return;
      setLoadMoreError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      // Reset even when aborted: refresh()/reload() abort an in-flight
      // loadMore, and leaving the guard set would permanently disable the
      // load-more affordance.
      isLoadingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  }, [client, pageSize, enabled, isLoading, isRefreshing]);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    loadControllerRef.current?.abort();
    loadMoreControllerRef.current?.abort();

    const controller = new AbortController();
    loadControllerRef.current = controller;

    setIsRefreshing(true);
    await loadFirstPage(controller.signal);
  }, [enabled, loadFirstPage]);

  const reload = useCallback(async () => {
    if (!enabled) return;
    loadControllerRef.current?.abort();
    loadMoreControllerRef.current?.abort();

    const controller = new AbortController();
    loadControllerRef.current = controller;

    // reload() supersedes any in-flight refresh with a plain load: release
    // the refresh flag now, or isRefreshing would stay raised for the whole
    // reload. The superseded refresh's guarded `finally` skips the reset, so
    // this is the only chance to clear it (#137).
    setIsRefreshing(false);
    setIsLoading(true);
    await loadFirstPage(controller.signal);
  }, [enabled, loadFirstPage]);

  useEffect(() => {
    return () => {
      loadControllerRef.current?.abort();
      loadMoreControllerRef.current?.abort();
    };
  }, []);

  return {
    entries,
    hasMore,
    isLoading,
    isRefreshing,
    isLoadingMore,
    error,
    loadMoreError,
    loadMore,
    refresh,
    reload,
  };
}
