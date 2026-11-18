import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Configuration options for {@link useAsyncData}.
 */
export interface UseAsyncDataOptions<T = any> {
  /**
   * Whether the initial load should run. When `false`, no request is made
   * until the value flips to `true` or `reload`/`refresh` is called.
   *
   * @defaultValue true
   */
  enabled?: boolean;

  /**
   * Optional reconciliation strategy invoked when a background fetch resolves
   * after local mutations have been applied via `setData`.
   *
   * When provided, receives `(localData, incomingData)` and returns the merged result.
   * When omitted and local mutations occurred while the fetch was in flight,
   * the stale incoming data write is skipped to preserve the local mutations.
   */
  mergeStale?: (local: T | null, incoming: T) => T;
}

/**
 * Return type of {@link useAsyncData}.
 */
export interface UseAsyncDataResult<T> {
  /**
   * The most recently loaded value, or `null` before the first successful load.
   * Preserved across a failed refresh/reload of the same fetcher; cleared when
   * the fetcher identity changes.
   */
  data: T | null;

  /**
   * Whether the initial load (or a `reload`) is currently in flight.
   */
  isLoading: boolean;

  /**
   * Whether a pull-to-refresh request is currently in flight.
   */
  isRefreshing: boolean;

  /**
   * The most recent fetch error, if any. Cleared on the next successful load.
   */
  error: Error | null;

  /**
   * Whether at least one fetch for the current fetcher completed successfully.
   * Local `setData` writes do not set this; it resets when the fetcher identity
   * changes.
   */
  hasLoaded: boolean;

  /**
   * Runs a full reload with `isLoading = true`. Aborts any in-flight request.
   * Used to implement retry buttons.
   */
  reload: () => Promise<void>;

  /**
   * Runs a refresh with pull-to-refresh semantics: `data` stays visible while
   * `isRefreshing` is true, and a failure keeps the stale data on screen.
   */
  refresh: () => Promise<void>;

  /**
   * Direct state setter for `data`.
   */
  setData: React.Dispatch<React.SetStateAction<T | null>>;
}

/**
 * Shared load-state hook tracking `data` / `isLoading` / `isRefreshing` /
 * `error` for a single async fetch, with abort handling, retry (`reload`),
 * and pull-to-refresh (`refresh`) that never blanks out existing data.
 *
 * The `fetcher` should be wrapped in `useCallback` by the caller; when its
 * identity changes (e.g. because an input changed) the data is reloaded.
 *
 * @param fetcher - Async function that performs the fetch.
 * @param options - Hook configuration options.
 * @returns State and callbacks for rendering load / error / data states.
 *
 * @example
 * ```tsx
 * const fetchEntries = useCallback(
 *   (signal: AbortSignal) => client.fetchChangelog({ signal }),
 *   [client]
 * );
 * const { data: entries, isLoading, error, reload } = useAsyncData(fetchEntries);
 * ```
 */
export function useAsyncData<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  options: UseAsyncDataOptions<T> = {}
): UseAsyncDataResult<T> {
  const { enabled = true, mergeStale } = options;

  const [dataState, setDataState] = useState<{
    owner: (signal: AbortSignal) => Promise<T>;
    data: T | null;
    error: Error | null;
    hasLoaded: boolean;
  }>(() => ({
    owner: fetcher,
    data: null,
    error: null,
    hasLoaded: false,
  }));
  const [isLoading, setIsLoading] = useState<boolean>(enabled);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const hasLoadedRef = useRef(false);
  hasLoadedRef.current = dataState.owner === fetcher ? dataState.hasLoaded : false;

  const controllerRef = useRef<AbortController | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const activeFetcherRef = useRef(fetcher);
  const fetcherGenerationRef = useRef(0);

  const mergeStaleRef = useRef(mergeStale);
  mergeStaleRef.current = mergeStale;

  const localRevisionRef = useRef<number>(0);

  const wrappedSetData: React.Dispatch<React.SetStateAction<T | null>> = useCallback((action) => {
    localRevisionRef.current += 1;
    const targetFetcher = fetcherRef.current;
    setDataState((prev) => {
      const currentData = prev.owner === targetFetcher ? prev.data : null;
      const nextData =
        typeof action === 'function'
          ? (action as (prevState: T | null) => T | null)(currentData)
          : action;
      return {
        owner: targetFetcher,
        data: nextData,
        error: prev.owner === targetFetcher ? prev.error : null,
        hasLoaded: prev.owner === targetFetcher ? prev.hasLoaded : false,
      };
    });
  }, []);

  const runLoad = useCallback(async (signal: AbortSignal) => {
    const requestFetcher = fetcherRef.current;
    const generation = fetcherGenerationRef.current;
    const rev = localRevisionRef.current;
    const isCurrentFetcher = () => fetcherGenerationRef.current === generation;
    try {
      const result = await requestFetcher(signal);
      if (signal?.aborted || !isCurrentFetcher()) return;
      const hadLoadedBeforeFetch = hasLoadedRef.current;
      hasLoadedRef.current = true;
      setDataState((prev) => {
        const prevData = prev.owner === requestFetcher ? prev.data : null;
        let nextData: T | null;
        if (mergeStaleRef.current && prevData != null && !hadLoadedBeforeFetch) {
          nextData = mergeStaleRef.current(prevData, result);
        } else if (localRevisionRef.current !== rev) {
          nextData = mergeStaleRef.current ? mergeStaleRef.current(prevData, result) : prevData;
        } else {
          nextData = result;
        }
        return {
          owner: requestFetcher,
          data: nextData,
          error: null,
          hasLoaded: true,
        };
      });
    } catch (err: any) {
      if (err?.name === 'AbortError' || signal?.aborted || !isCurrentFetcher()) return;
      const error = err instanceof Error ? err : new Error(String(err));
      setDataState((prev) => ({
        owner: requestFetcher,
        data: prev.owner === requestFetcher ? prev.data : null,
        error,
        hasLoaded: prev.owner === requestFetcher ? prev.hasLoaded : false,
      }));
    } finally {
      if (!signal?.aborted && isCurrentFetcher()) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, []);

  const runWithController = useCallback(
    async (mode: 'initial' | 'refresh') => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      if (mode === 'initial') {
        // reload() supersedes any in-flight refresh with a plain load: release
        // the refresh flag now, or isRefreshing would stay raised for the
        // whole reload. The superseded refresh's guarded `finally` skips the
        // reset, so this is the only chance to clear it (#137).
        setIsRefreshing(false);
        setIsLoading(true);
      } else {
        setIsRefreshing(true);
      }
      await runLoad(controller.signal);
    },
    [runLoad]
  );

  const reload = useCallback(() => runWithController('initial'), [runWithController]);
  const refresh = useCallback(() => runWithController('refresh'), [runWithController]);

  // Reset `data`, `error`, and `hasLoaded` when the fetcher identity changes
  // (including while disabled) so stale data from a previous source is never
  // exposed under a new fetcher if the replacement load fails (#462).
  useEffect(() => {
    if (activeFetcherRef.current !== fetcher) {
      activeFetcherRef.current = fetcher;
      fetcherGenerationRef.current += 1;
      hasLoadedRef.current = false;
      localRevisionRef.current = 0;
      setDataState({
        owner: fetcher,
        data: null,
        error: null,
        hasLoaded: false,
      });
    }
  }, [fetcher]);

  // Initial load, and reload when the fetcher identity or `enabled` changes.
  useEffect(() => {
    if (!enabled) {
      // The cleanup below aborts any in-flight load/refresh, and an aborted
      // runLoad deliberately skips its guarded `finally` reset so it cannot
      // wipe a newer operation's flags (#137). While the hook stays disabled
      // nothing else clears them, so reset both here or a refresh aborted by
      // this flip would leave `isRefreshing` stuck true forever (#158).
      setIsLoading(false);
      setIsRefreshing(false);
      return;
    }
    setIsLoading(true);
    void reload();

    return () => {
      controllerRef.current?.abort();
    };
  }, [fetcher, enabled, reload]);

  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
    };
  }, []);

  const effectiveData = dataState.owner === fetcher ? dataState.data : null;
  const effectiveError = dataState.owner === fetcher ? dataState.error : null;
  const effectiveHasLoaded = dataState.owner === fetcher ? dataState.hasLoaded : false;

  return {
    data: effectiveData,
    isLoading,
    isRefreshing,
    error: effectiveError,
    hasLoaded: effectiveHasLoaded,
    reload,
    refresh,
    setData: wrappedSetData,
  };
}
