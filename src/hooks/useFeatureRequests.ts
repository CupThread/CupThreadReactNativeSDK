import { useCallback, useEffect, useRef, useState } from 'react';
import type { FeedbackClient } from '../client/FeedbackClient';
import { RateLimitedException } from '../client/FeedbackException';
import type { FeatureRequestItem } from '../types';
import { SearchRateLimiter } from '../utils/searchRateLimiter';
import type { VoteChangeMeta } from './useToggleVote';

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
 * A pending optimistic mutation remembered for one item, tagged with the user
 * identity it was created under so an identity switch (UserTokenStore
 * `setToken`/`resetToken` re-resolving the provider token) can retire the
 * previous identity's snapshots instead of replaying them over the new
 * identity's data (#184).
 */
interface PendingItemMutation {
  item: FeatureRequestItem;
  userToken: string;
}

/**
 * A settled vote parked as a one-shot guard against page-0 responses that were
 * still in flight when the vote settled. Such a response predates the
 * server-confirmed vote truth and must not wipe it from the row; the first
 * reconciliation that covers the row consumes the record, and any page-0 that
 * started after the settlement prunes it outright, so records stay bounded by
 * in-flight fetch windows instead of accumulating per vote (#184).
 */
interface SettledItemMutation extends PendingItemMutation {
  /**
   * Value of the hook's monotonic local revision at the moment the vote
   * settled. A page-0 whose starting revision is greater or equal postdates
   * the settlement, so its response wins and the record is irrelevant.
   */
  revision: number;
}

/**
 * Builds the deduplication key for a query-bearing search: the same trimmed
 * query + version filter under the same user identity must not refetch when the
 * effect re-fires.
 */
function buildSearchKey(
  userToken: string,
  query: string,
  versionId: string | null | undefined
): string {
  return `${userToken}|${query}|${versionId || ''}`;
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

  /**
   * Whether the fetch should be enabled. When false, no requests are made.
   *
   * @defaultValue true
   */
  enabled?: boolean;
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
   *
   * When the server serves keyset cursor pagination, this mirrors the exact
   * `hasMore` reported with the most recent page; otherwise it is derived as
   * `items.length < total` from the offset-based legacy contract.
   */
  hasMore: boolean;

  /**
   * Whether the initial load or a filter/search change request is in flight.
   *
   * Note: This reflects whether a page-0 network request is actively in flight.
   * Presentation logic (such as showing a full-screen spinner vs. keeping stale
   * results visible while reloading) is the decision of the consuming screen.
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
   * Most recent page-0 fetch error (initial load, search/filter change, or
   * pull-to-refresh), if any.
   */
  error: Error | null;

  /**
   * Most recent next-page (`loadMore`) fetch error, if any. Kept separate
   * from `error` so UI can attribute an inline refresh banner and a
   * load-more footer retry independently; cleared by the next successful
   * page-0 or load-more fetch.
   */
  loadMoreError: Error | null;

  /**
   * True while the client-side post-429 search cooldown is active. Query
   * searches stay suppressed until it elapses; UI should show a localized
   * rate-limit notice instead of treating this as a generic failure.
   */
  isRateLimited: boolean;

  /**
   * Fetches the next page of items and appends them to `items`.
   * Safely no-ops if a request is already in flight, no more items remain,
   * the token is not ready, or a page-0 load for the current query/filter has
   * not landed yet (a deferred debounce / search-spacing window included) —
   * the on-screen list then still belongs to the previous query/filter and
   * must not be paginated with the new params.
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
   *
   * The change is remembered as a pending mutation so concurrent page-0 loads
   * keep the optimistic row instead of blind-overwriting it with older server
   * data. Pass {@link VoteChangeMeta.isRollback} to mark a change that reverts
   * a failed vote, or {@link VoteChangeMeta.isFinal} for the server-confirmed
   * result of a successful vote: both end the optimistic-vote lifecycle, so
   * the pending entry is released and later server snapshots win for that row
   * again.
   */
  applyItemChange: (
    itemId: string,
    transform: (item: FeatureRequestItem) => FeatureRequestItem,
    meta?: VoteChangeMeta
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
    enabled = true,
  } = options;

  const [items, setItems] = useState<FeatureRequestItem[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(enabled);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);
  const [loadMoreError, setLoadMoreError] = useState<Error | null>(null);
  const [isRateLimited, setIsRateLimited] = useState<boolean>(false);
  // Keyset cursor mode (#170): `null` while the current list came from (or
  // still targets) an offset-only server; a boolean once a page response
  // carried a `nextCursor`, mirroring the server's exact `hasMore`. The ref
  // mirrors the state for loadMore's synchronous early-return guards.
  const [cursorHasMore, setCursorHasMore] = useState<boolean | null>(null);
  const cursorHasMoreRef = useRef<boolean | null>(null);

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

  // Generation token for page-0 loads. The main effect bumps
  // `page0GenerationRef` every time it schedules a page-0 (initial load,
  // query/filter change), and a successful load publishes its generation in
  // `loadedGenerationRef`. While the two differ, a page-0 is scheduled,
  // deferred, or in flight and the on-screen list still belongs to the
  // previous query/filter — `loadMore` must not paginate it, or it would
  // request the new query at the old list's offset and splice the response
  // into the old list's rows (#140).
  const page0GenerationRef = useRef<number>(0);
  const loadedGenerationRef = useRef<number>(-1);

  // Offset bookkeeping for loadMore (#159): the next `offset` to request for
  // the current query context, advanced by the *requested* window (pageSize)
  // per consumed page. Deriving the offset from the deduped display length
  // instead let any dedupe shrinkage rewind the request window, re-reading
  // rows that were already consumed — which then surfaced as a short
  // overlapped page and clamped `total` into a false end-of-data that
  // permanently disabled load-more. A single slot is enough: the search-key
  // dedupe only early-returns for the key remembered by the last successful
  // page-0, and any successful page-0 in between re-loads that key's window
  // from scratch, so the slot is always the right offset when loadMore runs.
  const nextOffsetRef = useRef<number>(0);

  // Keyset cursor for the next unread page (#170). `null` means either the
  // last page response carried no cursor (offset-only deployment → the legacy
  // `nextOffsetRef` window bookkeeping below drives loadMore) or the end of
  // the list has been reached in cursor mode.
  const nextCursorRef = useRef<string | null>(null);

  const localRevisionRef = useRef<number>(0);
  const pendingItemMutationsRef = useRef<Map<string, PendingItemMutation>>(new Map());
  const settledItemMutationsRef = useRef<Map<string, SettledItemMutation>>(new Map());

  // The identity of the most recent render, read by the mutation appliers
  // (which are stable callbacks and must not close over the prop).
  const userTokenRef = useRef<string>(userToken);
  userTokenRef.current = userToken;

  const applyItemChange = useCallback(
    (
      itemId: string,
      transform: (item: FeatureRequestItem) => FeatureRequestItem,
      meta?: VoteChangeMeta
    ) => {
      localRevisionRef.current += 1;
      const previousPending = pendingItemMutationsRef.current.get(itemId);
      if (meta?.isRollback || meta?.isFinal) {
        // A rollback (#139) or a settled success (#184) ends the
        // optimistic-vote lifecycle: release the item's pending mutation so
        // later server snapshots win for the row again. Released
        // unconditionally and outside the state updater — a search or filter
        // change may already have removed the row from `items` while the
        // vote was in flight, and an entry stranded in the map would override
        // the server row once the query is restored. Keeping the side effect
        // out of the updater also keeps it single-shot under StrictMode's
        // double-invoked updaters.
        pendingItemMutationsRef.current.delete(itemId);
      } else {
        // A fresh optimistic mutation supersedes any settled guard for the
        // row: from here on the pending entry owns the in-flight protection.
        settledItemMutationsRef.current.delete(itemId);
      }
      // A settled vote is parked as a one-shot guard so a page-0 response
      // still in flight from before the settlement cannot wipe the
      // server-confirmed vote (#184). Recorded before the state updater so
      // the bookkeeping is single-shot; the guard covers rows that already
      // left `items` (a query change mid-vote) as well.
      if (meta?.isFinal) {
        const current = itemsRef.current.find((row) => row.id === itemId) ?? previousPending?.item;
        if (current) {
          settledItemMutationsRef.current.set(itemId, {
            item: transform(current),
            userToken: userTokenRef.current,
            revision: localRevisionRef.current,
          });
        }
      }
      setItems((prev) =>
        prev.map((item) => {
          if (item.id === itemId) {
            const updated = transform(item);
            if (!meta?.isRollback && !meta?.isFinal) {
              pendingItemMutationsRef.current.set(itemId, {
                item: updated,
                userToken: userTokenRef.current,
              });
            }
            return updated;
          }
          return item;
        })
      );
    },
    []
  );

  const wrappedSetItems: React.Dispatch<React.SetStateAction<FeatureRequestItem[]>> = useCallback(
    (action) => {
      localRevisionRef.current += 1;
      setItems((prev) => {
        const next = typeof action === 'function' ? action(prev) : action;
        for (const item of next) {
          pendingItemMutationsRef.current.set(item.id, {
            item,
            userToken: userTokenRef.current,
          });
          settledItemMutationsRef.current.delete(item.id);
        }
        return next;
      });
    },
    []
  );

  // Key of the last successfully loaded search (trimmed query + versionId).
  // Duplicate suppression: re-firing the effect with the same key must not
  // burn another search against the server's per-IP rate budget.
  const lastSearchKeyRef = useRef<string | null>(null);

  const enterSearchCooldown = useCallback((retryAfterMs?: number | null) => {
    const limiter = searchLimiterRef.current!;
    const cooldownMs = limiter.enterCooldown(retryAfterMs);
    setIsRateLimited(true);
    if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
    cooldownTimerRef.current = setTimeout(() => setIsRateLimited(false), cooldownMs);
    return cooldownMs;
  }, []);

  // Initial load or query/filter change
  const loadPage0 = useCallback(
    async (signal?: AbortSignal) => {
      if (!isTokenReady || !enabled) return;
      // The results of this fetch belong to the generation that was current
      // when it started. The effect aborts any in-flight page-0 before
      // bumping the generation, so a settled success can never publish a
      // generation newer than its own.
      const generation = page0GenerationRef.current;
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

      const rev = localRevisionRef.current;

      // Settled-vote guards this fetch cannot need (#184): a page-0 starting
      // now postdates those settlements, so its response is authoritative
      // over them. Only guards for votes that settle while this fetch is in
      // flight survive to the reconciliation below.
      for (const [id, entry] of settledItemMutationsRef.current) {
        if (entry.revision <= rev) {
          settledItemMutationsRef.current.delete(id);
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

        // Monotonic local revision guard: if local mutations occurred (e.g. optimistic
        // votes applied while fetch was in flight), merge the pending state on top of
        // the server snapshot rather than blind-overwriting.
        const reconcileWithPending = (
          itemsToReconcile: FeatureRequestItem[]
        ): FeatureRequestItem[] => {
          // This fetch runs under `userToken`, so snapshots pinned by a
          // previous identity must not merge over (or survive into) the new
          // identity's server data: a guest-era vote does not carry over to
          // the signed-in account, and retaining such an entry would replay
          // the stale row over every later page-0 indefinitely (#184).
          for (const [id, entry] of pendingItemMutationsRef.current) {
            if (entry.userToken !== userToken) {
              pendingItemMutationsRef.current.delete(id);
            }
          }
          for (const [id, entry] of settledItemMutationsRef.current) {
            if (entry.userToken !== userToken) {
              settledItemMutationsRef.current.delete(id);
            }
          }
          if (
            pendingItemMutationsRef.current.size === 0 &&
            settledItemMutationsRef.current.size === 0
          ) {
            return itemsToReconcile;
          }
          return itemsToReconcile.map((item) => {
            const pending = pendingItemMutationsRef.current.get(item.id);
            if (pending) {
              if (item.hasVoted === pending.item.hasVoted) {
                // Server response already reflects the new vote state, clear pending mutation.
                pendingItemMutationsRef.current.delete(item.id);
                return item;
              }
              return {
                ...item,
                ...pending.item,
              };
            }
            const settled = settledItemMutationsRef.current.get(item.id);
            if (settled) {
              // The response predates this vote's settlement (the fetch
              // started before it), so it cannot disprove the server-confirmed
              // result: keep the settled row and consume the guard — the next
              // page-0 starts after the settlement and decides the row (#184).
              settledItemMutationsRef.current.delete(item.id);
              return item.hasVoted === settled.item.hasVoted ? item : { ...item, ...settled.item };
            }
            return item;
          });
        };

        const hadInterimMutation = localRevisionRef.current !== rev;
        const mergedItems =
          hadInterimMutation ||
          pendingItemMutationsRef.current.size > 0 ||
          settledItemMutationsRef.current.size > 0
            ? reconcileWithPending(fetchedItems)
            : fetchedItems;
        setItems(mergedItems);
        setTotal(reportedTotal);
        setError(null);
        // The on-screen list now belongs to this fetch's generation, so a
        // blocked loadMore may paginate again.
        loadedGenerationRef.current = generation;
        // The page-0 window [0, pageSize) is consumed; the next pagination
        // request starts at the second window, whatever the deduped display
        // length of this page turns out to be (#159). Dead bookkeeping in
        // cursor mode, kept as the fallback for offset-only servers.
        nextOffsetRef.current = pageSize;
        // Keyset cursor mode (#170): a response carrying cursor metadata
        // (`hasMore` is only served alongside the cursor) switches loadMore to
        // the exact cursor walk; a response without it keeps the legacy offset
        // behavior so existing hosts see no change. The metadata presence —
        // not a nonempty `nextCursor` — is the mode marker: a terminal cursor
        // page answers `hasMore: false, nextCursor: null`, and demoting that
        // to offset mode would let loadMore bypass the cursor contract.
        // `hasMore` only counts when a cursor exists to follow — mirroring
        // useChangelogEntries, a page that reports more entries but hands back
        // no cursor could never actually fetch them.
        const isCursorResponse = typeof res.hasMore === 'boolean';
        const nextCursor =
          isCursorResponse && typeof res.nextCursor === 'string' && res.nextCursor.length > 0
            ? res.nextCursor
            : null;
        const serverHasMore =
          isCursorResponse &&
          nextCursor !== null &&
          res.hasMore === true &&
          fetchedItems.length > 0;
        nextCursorRef.current = nextCursor;
        cursorHasMoreRef.current = isCursorResponse ? serverHasMore : null;
        setCursorHasMore(isCursorResponse ? serverHasMore : null);
        // A fresh page-0 result replaces the whole list, so a load-more
        // failure against the previous list no longer applies.
        setLoadMoreError(null);
        if (isSearch) {
          lastSearchKeyRef.current = buildSearchKey(userToken, trimmedQuery, versionId);
          setIsRateLimited(false);
        } else {
          lastSearchKeyRef.current = null;
        }
      } catch (err: any) {
        if (err?.name === 'AbortError' || signal?.aborted) return;
        if (err instanceof RateLimitedException) {
          // Enter the search cooldown (server Retry-After wins) and surface a
          // rate-limit notice instead of an endless autofire loop.
          enterSearchCooldown(err.retryAfterMs);
        }
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        // A superseded (aborted) load must not reset the flags a newer
        // refresh()/reload() just raised: the abort rejection lands on a
        // microtask after the newer operation raised them, and an
        // unconditional reset would clear them while the newer page-0 request
        // is still on the wire, snapping RefreshControl shut mid-refresh
        // (#137). Mirrors useChangelogEntries and useAsyncData.
        if (!signal?.aborted) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [client, userToken, isTokenReady, versionId, query, pageSize, enabled, enterSearchCooldown]
  );

  useEffect(() => {
    if (!isTokenReady || !enabled) {
      // The previous effect's cleanup aborted only its own deferred
      // controller; a manual refresh()/reload() may have replaced
      // `loadControllerRef` with a live request the cleanup never saw. Abort
      // it here so the hook cannot disable with a page-0 still on the wire,
      // then clear the flags its guarded `finally` would otherwise skip
      // (#137).
      loadControllerRef.current?.abort();
      loadMoreControllerRef.current?.abort();
      setIsLoading(false);
      setIsRefreshing(false);
      return;
    }

    loadControllerRef.current?.abort();
    loadMoreControllerRef.current?.abort();

    const trimmedQuery = query?.trim() || '';
    const isSearch = trimmedQuery.length > 0;
    const limiter = searchLimiterRef.current!;

    // Same trimmed query + version filter under the same identity already
    // loaded successfully — keep the results on screen and do not refetch.
    if (
      isSearch &&
      lastSearchKeyRef.current === buildSearchKey(userToken, trimmedQuery, versionId)
    ) {
      // The on-screen list was loaded under exactly this key, so it is valid
      // for the current generation: re-publish so a loadMore blocked by a
      // superseded schedule (e.g. B scheduled, then back to A) can paginate
      // again instead of staying blocked forever.
      loadedGenerationRef.current = page0GenerationRef.current;
      // The aborts above already killed any in-flight page-0 (including a
      // refresh), and its guarded `finally` skips the reset for an aborted
      // signal, while this branch schedules nothing that would reset them —
      // clear the flags here so they cannot stick true (#137).
      setIsLoading(false);
      setIsRefreshing(false);
      return;
    }

    // The replacement this effect schedules is a plain load, never a
    // refresh: release the refresh flag now so a refresh aborted above
    // cannot keep RefreshControl spinning through the debounce wait and the
    // replacement's flight. The aborted load's guarded `finally` will not
    // clear it, so this is the only chance to hand the flag back (#137).
    setIsRefreshing(false);
    // A new page-0 is on its way (possibly deferred behind the debounce /
    // search-spacing window): until it lands, the on-screen list belongs to
    // the previous query/filter and loadMore must refuse to paginate it.
    page0GenerationRef.current += 1;

    const controller = new AbortController();

    // Debounce first, then the search spacing/cooldown window so a query typed
    // during either wait is deferred to its turn instead of being dropped.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scheduleLoad = (waitMs: number) => {
      timer = setTimeout(() => {
        // Timers can fire marginally before the limiter's clock reaches the
        // boundary; wait out the remainder instead of dropping the query.
        if (isSearch && !limiter.canFetch()) {
          scheduleLoad(limiter.waitTime());
          return;
        }
        // A page-0 for this schedule already landed (a manual refresh() or
        // reload() completed while the deferral was pending): the deferred
        // attempt would only re-fetch the same query against the search
        // budget, flash `isLoading` back on, and abort an in-flight loadMore
        // — drop it instead (#166). A manual load skipped by the limiter
        // publishes no generation, so this guard stays open and the deferred
        // attempt still runs (#130/#132).
        if (loadedGenerationRef.current === page0GenerationRef.current) {
          return;
        }
        // Publish the controller only when the fetch starts: a manual
        // refresh()/reload() during the wait aborts `loadControllerRef` and
        // its own load skips while the limiter blocks, so assigning it early
        // would cancel the only deferred attempt for this query.
        loadControllerRef.current = controller;
        setIsLoading(true);
        // Belt and braces: the effect body already aborts an in-flight
        // load-more when the params change, and the generation guard keeps a
        // new one from starting during the wait, so nothing should be in
        // flight here — repeat the abort at deferred-start time anyway so a
        // late load-more response can never splice into the fresh list.
        loadMoreControllerRef.current?.abort();
        loadPage0(controller.signal);
      }, waitMs);
    };

    const searchWaitMs = isSearch ? limiter.waitTime() : 0;
    scheduleLoad((debounceMs > 0 ? debounceMs : 0) + searchWaitMs);

    return () => {
      if (timer) clearTimeout(timer);
      controller.abort();
    };
  }, [loadPage0, debounceMs, isTokenReady, query, versionId, userToken, enabled]);

  // Load next page
  const loadMore = useCallback(async () => {
    if (!isTokenReady || !enabled || isLoading || isRefreshing || isLoadingMoreRef.current) return;
    // A page-0 for the current query/filter is scheduled, deferred, or still
    // in flight: the on-screen list belongs to the previous query/filter.
    // Paginating it would request the new query at the old list's offset and
    // splice the response into the old list's rows (#140).
    if (page0GenerationRef.current !== loadedGenerationRef.current) return;
    // Cursor mode (#170): the server's exact `hasMore` gates pagination — the
    // legacy `items.length < total` heuristic must not block a cursor walk
    // when dedupe or a drifted total would read as end-of-data. Offset mode
    // keeps the heuristic. The mode marker is `cursorHasMoreRef`'s non-null
    // state, not `nextCursorRef`: a cursor walk exhausts into
    // `nextCursorRef = null` while the list stays in cursor mode, and
    // selecting the offset branch there would fire a stale offset window
    // request whenever a drifted total outruns the fetched rows.
    if (cursorHasMoreRef.current !== null) {
      if (cursorHasMoreRef.current !== true) return;
    } else if (itemsRef.current.length >= totalRef.current) {
      return;
    }
    const currentCursor = nextCursorRef.current;
    if (cursorHasMoreRef.current !== null && currentCursor === null) return;
    // The feature-requests endpoint serves both a legacy offset window and a
    // keyset cursor (DATA-01). Under the offset window the server's mutable
    // sort (new approvals, vote reorders) can still skip rows that slide into
    // already-consumed windows — unfixable from the client (#159). Once a page
    // response carries `nextCursor`, the walk below uses it instead: keyset
    // cursors are exact over the mutable sort, closing the remaining #159 gap
    // the way the changelog endpoint already paginates.

    const trimmedQuery = query?.trim() || '';
    const isSearch = trimmedQuery.length > 0;
    const limiter = searchLimiterRef.current!;

    loadMoreControllerRef.current?.abort();
    const controller = new AbortController();
    loadMoreControllerRef.current = controller;

    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);

    try {
      // While cooldown is active, query-bearing pagination is suppressed.
      if (isSearch && limiter.cooldownRemaining() > 0) return;

      if (isSearch) {
        limiter.markFetched();
      }

      // Cursor mode sends only the cursor (the API ignores `offset` on a
      // cursor request); offset mode requests the next unconsumed server
      // window (#159), not the deduped display length: display shrinkage from
      // dedupe would rewind the offset and re-read rows this list has already
      // shown.
      const res = await client.fetchFeatureRequests({
        userToken,
        versionId: versionId || undefined,
        query: trimmedQuery || undefined,
        limit: pageSize,
        ...(currentCursor !== null ? { cursor: currentCursor } : { offset: nextOffsetRef.current }),
        signal: controller.signal,
      });

      if (controller.signal.aborted) return;

      const newItems = res.requests || [];

      if (currentCursor !== null) {
        // Keyset cursors only move forward. If a refresh rewound the cursor
        // while this page was in flight, the response is stale — discard it
        // instead of splicing it into the fresh list (mirrors
        // useChangelogEntries).
        if (nextCursorRef.current !== currentCursor) return;
        const isCursorResponse = typeof res.hasMore === 'boolean';
        let nextCursor =
          isCursorResponse && typeof res.nextCursor === 'string' && res.nextCursor.length > 0
            ? res.nextCursor
            : null;
        // A cursor that does not advance can never finish the walk: the
        // contract defines `nextCursor` as the following page's cursor, so an
        // unchanged value contradicts a truthy `hasMore`. Stop pagination on
        // it instead of re-fetching the same page on every loadMore.
        const stalledCursor = nextCursor !== null && nextCursor === currentCursor;
        if (stalledCursor) {
          nextCursor = null;
        }
        const serverHasMore =
          !stalledCursor &&
          isCursorResponse &&
          nextCursor !== null &&
          res.hasMore === true &&
          newItems.length > 0;
        nextCursorRef.current = nextCursor;
        cursorHasMoreRef.current = serverHasMore;
        setCursorHasMore(serverHasMore);
        if (typeof res.total === 'number') {
          setTotal(res.total);
        }
        setItems((prev) => {
          const ids = new Set(prev.map((i) => i.id));
          return [...prev, ...newItems.filter((i) => !ids.has(i.id))];
        });
        // Diagnostic only: with hasMore forced false no surface renders a
        // retry affordance, so the stalled walk ends cleanly while hosts can
        // still tell it apart from a legitimate end-of-data.
        setLoadMoreError(
          stalledCursor
            ? new Error('The server returned a cursor that does not advance; pagination stopped.')
            : null
        );
        if (isSearch) {
          setIsRateLimited(false);
        }
        return;
      }

      let nextTotal = typeof res.total === 'number' ? res.total : totalRef.current;
      const currentOffset = nextOffsetRef.current;

      // Compute the deduped append count from itemsRef instead of inside a
      // functional updater: React invokes updaters during the next render,
      // so any value mutated there is not readable at the call site (and
      // StrictMode invokes updaters twice).
      const prevItems = itemsRef.current;
      const existingIds = new Set(prevItems.map((i) => i.id));
      const freshCount = newItems.filter((i) => !existingIds.has(i.id)).length;
      // A short page is end-of-data only when it carried no overlap (#159):
      // under the server's mutable sort, rows can slide between consumed
      // windows so an offset page legitimately re-reads already-seen rows
      // before the true end. Clamping total on such an overlapped short page
      // disabled load-more while unseen rows remained. An empty page stays a
      // clean end-of-data signal (the API returns nothing past the end).
      const overlapped = freshCount < newItems.length;
      if (newItems.length === 0 || (newItems.length < pageSize && !overlapped)) {
        // Short page with nothing already seen: server has no more data, so
        // clamp total in case the reported count drifted (e.g. items deleted
        // between page fetches).
        nextTotal = Math.min(nextTotal, prevItems.length + freshCount);
      }
      // Advance by the requested window, not the fresh count: dedupe
      // shrinkage must never rewind the offset, or the next page re-reads
      // consumed rows and reads as drift (#159).
      nextOffsetRef.current = currentOffset + pageSize;

      setItems((prev) => {
        const ids = new Set(prev.map((i) => i.id));
        return [...prev, ...newItems.filter((i) => !ids.has(i.id))];
      });

      setTotal(nextTotal);
      setLoadMoreError(null);
      if (isSearch) {
        setIsRateLimited(false);
      }
    } catch (err: any) {
      if (err?.name === 'AbortError' || controller.signal.aborted) return;
      if (isSearch && err instanceof RateLimitedException) {
        enterSearchCooldown(err.retryAfterMs);
      }
      setLoadMoreError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      // Reset even when aborted: refresh()/reload()/filter changes abort an
      // in-flight loadMore, and leaving the guard set would permanently
      // disable infinite scroll.
      isLoadingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  }, [
    client,
    userToken,
    isTokenReady,
    enabled,
    isLoading,
    isRefreshing,
    versionId,
    query,
    pageSize,
    enterSearchCooldown,
  ]);

  // Pull-to-refresh
  const refresh = useCallback(async () => {
    if (!isTokenReady || !enabled) return;
    loadControllerRef.current?.abort();
    loadMoreControllerRef.current?.abort();

    const controller = new AbortController();
    loadControllerRef.current = controller;

    setIsRefreshing(true);
    await loadPage0(controller.signal);
  }, [isTokenReady, enabled, loadPage0]);

  // Reload
  const reload = useCallback(async () => {
    if (!isTokenReady || !enabled) return;
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
    await loadPage0(controller.signal);
  }, [isTokenReady, enabled, loadPage0]);

  useEffect(() => {
    return () => {
      loadControllerRef.current?.abort();
      loadMoreControllerRef.current?.abort();
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
    };
  }, []);

  // Cursor mode exposes the server's exact hasMore; offset mode keeps the
  // legacy `items.length < total` heuristic.
  const hasMore = cursorHasMore !== null ? cursorHasMore : items.length < total;

  return {
    items,
    total,
    hasMore,
    isLoading,
    isRefreshing,
    isLoadingMore,
    error,
    loadMoreError,
    isRateLimited,
    loadMore,
    refresh,
    reload,
    setItems: wrappedSetItems,
    applyItemChange,
  };
}
