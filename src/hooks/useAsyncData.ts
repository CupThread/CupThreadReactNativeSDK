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
   * Preserved when a refresh fails so stale data is never blanked out.
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

  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(enabled);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<Error | null>(null);

  const controllerRef = useRef<AbortController | null>(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const mergeStaleRef = useRef(mergeStale);
  mergeStaleRef.current = mergeStale;

  const localRevisionRef = useRef<number>(0);

  const wrappedSetData: React.Dispatch<React.SetStateAction<T | null>> = useCallback((action) => {
    localRevisionRef.current += 1;
    setData(action);
  }, []);

  const runLoad = useCallback(async (signal: AbortSignal) => {
    const rev = localRevisionRef.current;
    try {
      const result = await fetcherRef.current(signal);
      if (signal?.aborted) return;

      if (localRevisionRef.current !== rev) {
        if (mergeStaleRef.current) {
          setData((prev) => mergeStaleRef.current!(prev, result));
        }
        // Stale write skipped when mergeStale is omitted
      } else {
        setData(result);
      }
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
  }, []);

  const runWithController = useCallback(
    async (mode: 'initial' | 'refresh') => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;

      if (mode === 'initial') {
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

  // Initial load, and reload when the fetcher identity or `enabled` changes.
  useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
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

  return { data, isLoading, isRefreshing, error, reload, refresh, setData: wrappedSetData };
}
