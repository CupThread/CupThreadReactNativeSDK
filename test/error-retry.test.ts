import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { FeedbackClient } from '../src/client/FeedbackClient';
import { useAsyncData } from '../src/hooks/useAsyncData';
import { useFeatureRequests } from '../src/hooks/useFeatureRequests';
import type { FeatureRequestItem } from '../src/types';
import {
  enStrings,
  zhHansStrings,
  zhHantStrings,
  jaStrings,
  koStrings,
  deStrings,
  esStrings,
  frStrings,
  itStrings,
  ptStrings,
  plStrings,
  noStrings,
  trStrings,
  viStrings,
} from '../src/i18n';

// ---------------------------------------------------------------------------
// Hook test harness with proper dependency caching and effect lifecycle
// (same renderer used by pagination.test.ts)
// ---------------------------------------------------------------------------

function renderTestHook<T>(hookFn: () => T) {
  const states: any[] = [];
  const stateSetters: Array<(val: any) => void> = [];
  const refs: any[] = [];
  const callbacks: Array<{ fn: any; deps: any[] }> = [];
  const effects: Array<{ cleanup?: (() => void) | void; deps?: any[] }> = [];

  let stateIndex = 0;
  let refIndex = 0;
  let callbackIndex = 0;
  let effectIndex = 0;
  let isFlushing = false;

  const dispatcher = {
    useState<V>(initial: V | (() => V)) {
      const idx = stateIndex++;
      if (!(idx in states)) {
        states[idx] = typeof initial === 'function' ? (initial as () => V)() : initial;
      }
      if (!stateSetters[idx]) {
        stateSetters[idx] = (val: V | ((prev: V) => V)) => {
          states[idx] = typeof val === 'function' ? (val as (prev: V) => V)(states[idx]) : val;
          scheduleRender();
        };
      }
      return [states[idx], stateSetters[idx]];
    },
    useRef<V>(initial: V) {
      const idx = refIndex++;
      if (!refs[idx]) {
        refs[idx] = { current: initial };
      }
      return refs[idx];
    },
    useCallback<F extends (...args: any[]) => any>(fn: F, deps: any[]) {
      const idx = callbackIndex++;
      const prev = callbacks[idx];
      if (
        prev &&
        deps &&
        prev.deps.length === deps.length &&
        deps.every((d, i) => Object.is(d, prev.deps[i]))
      ) {
        return prev.fn;
      }
      callbacks[idx] = { fn, deps };
      return fn;
    },
    useEffect(effect: () => void | (() => void), deps?: any[]) {
      const idx = effectIndex++;
      const prev = effects[idx];
      const hasChanged =
        !prev ||
        !deps ||
        !prev.deps ||
        deps.length !== prev.deps.length ||
        deps.some((d, i) => !Object.is(d, prev.deps![i]));

      if (hasChanged) {
        pendingEffects.push({ idx, effect, deps });
      }
    },
  };

  let currentResult: T;
  let pendingEffects: Array<{ idx: number; effect: () => void | (() => void); deps?: any[] }> = [];

  let isExecuting = false;
  function executeRender() {
    stateIndex = 0;
    refIndex = 0;
    callbackIndex = 0;
    effectIndex = 0;
    pendingEffects = [];

    const reactInternals = (React as any).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
    const prev = reactInternals.ReactCurrentDispatcher.current;
    reactInternals.ReactCurrentDispatcher.current = dispatcher;
    try {
      currentResult = hookFn();
    } finally {
      reactInternals.ReactCurrentDispatcher.current = prev;
    }

    const effectsToRun = pendingEffects;
    for (const { idx, effect, deps } of effectsToRun) {
      if (typeof effects[idx]?.cleanup === 'function') {
        effects[idx]!.cleanup!();
      }
      const cleanup = effect();
      effects[idx] = { cleanup, deps };
    }
  }

  function scheduleRender() {
    if (isExecuting) {
      if (isFlushing) return;
      isFlushing = true;
      queueMicrotask(() => {
        isFlushing = false;
        scheduleRender();
      });
      return;
    }
    isExecuting = true;
    try {
      executeRender();
    } finally {
      isExecuting = false;
    }
  }

  scheduleRender();

  return {
    get result() {
      return currentResult;
    },
    rerender() {
      executeRender();
    },
    unmount() {
      for (const e of effects) {
        if (typeof e?.cleanup === 'function') e.cleanup();
      }
    },
  };
}

function makeMockItem(id: string, index: number): FeatureRequestItem {
  return {
    id,
    appId: 'app_test',
    title: `Feature Request #${index}`,
    description: `Description for feature request #${index}`,
    voteCount: index,
    hasVoted: false,
    isOwnRequest: false,
    status: 'planned',
    columnId: 'col_planned',
    columnName: 'Planned',
    columnColor: '#3b82f6',
    approved: true,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
  };
}

const flush = () => new Promise((r) => setTimeout(r, 20));

// ---------------------------------------------------------------------------
// useAsyncData: error surfacing, retry, and stale-data preservation
// ---------------------------------------------------------------------------

test('useAsyncData surfaces initial load errors instead of swallowing them', async () => {
  const fetcher = async (_signal: AbortSignal): Promise<string[]> => {
    throw new Error('network down');
  };

  const harness = renderTestHook(() => useAsyncData(fetcher));
  await flush();

  assert.equal(harness.result.isLoading, false, 'loading must settle after a rejection');
  assert.equal(harness.result.data, null, 'no data should be cached after a failed load');
  assert.ok(harness.result.error instanceof Error);
  assert.equal(harness.result.error!.message, 'network down');
  assert.equal(harness.result.isRefreshing, false);
});

test('useAsyncData wraps non-Error rejections into an Error', async () => {
  const fetcher = async (_signal: AbortSignal): Promise<string[]> => {
    throw 'string-failure';
  };

  const harness = renderTestHook(() => useAsyncData(fetcher));
  await flush();

  assert.ok(harness.result.error instanceof Error);
  assert.equal(harness.result.error!.message, 'string-failure');
});

test('useAsyncData retry via reload re-invokes the fetcher and clears the error on success', async () => {
  let callCount = 0;
  const fetcher = async (_signal: AbortSignal): Promise<string[]> => {
    callCount++;
    if (callCount === 1) throw new Error('flaky');
    return ['entry-a'];
  };

  const harness = renderTestHook(() => useAsyncData(fetcher));
  await flush();
  assert.equal(callCount, 1);
  assert.ok(harness.result.error, 'initial load must fail');
  assert.equal(harness.result.data, null);

  await harness.result.reload();
  await flush();

  assert.equal(callCount, 2, 'reload must re-invoke the fetcher');
  assert.equal(harness.result.error, null, 'successful retry must clear the error');
  assert.deepEqual(harness.result.data, ['entry-a']);
  assert.equal(harness.result.isLoading, false);
});

test('useAsyncData keeps stale data when a refresh fails', async () => {
  let shouldFail = false;
  const fetcher = async (_signal: AbortSignal): Promise<string[]> => {
    if (shouldFail) throw new Error('refresh failed');
    return ['v1'];
  };

  const harness = renderTestHook(() => useAsyncData(fetcher));
  await flush();
  assert.deepEqual(harness.result.data, ['v1']);

  shouldFail = true;
  await harness.result.refresh();
  await flush();

  assert.deepEqual(
    harness.result.data,
    ['v1'],
    'stale data must not be blanked on refresh failure'
  );
  assert.equal(harness.result.isRefreshing, false);
  assert.ok(harness.result.error instanceof Error);
});

test('useAsyncData with enabled=false never fetches until enabled flips to true', async () => {
  let callCount = 0;
  const fetcher = async (_signal: AbortSignal): Promise<string> => {
    callCount++;
    return 'x';
  };

  const harness = renderTestHook(() => useAsyncData(fetcher, { enabled: false }));
  await flush();
  assert.equal(callCount, 0);
  assert.equal(harness.result.isLoading, false);
  assert.equal(harness.result.data, null);
});

test('useAsyncData aborts an in-flight request when unmounted', async () => {
  let aborted = false;
  const fetcher = (signal: AbortSignal): Promise<string> =>
    new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => {
        aborted = true;
        reject(new Error('AbortError'));
      });
      // Never resolves on its own.
    });

  const harness = renderTestHook(() => useAsyncData(fetcher));
  harness.unmount();

  assert.equal(aborted, true, 'unmount must abort the in-flight fetch');
});

// ---------------------------------------------------------------------------
// useAsyncData: disabling while a refresh/reload is in flight must release
// both loading flags (#158). The aborted operation's guarded `finally` skips
// its reset by design (#137), so the disabled early-return is the only place
// left that can clear them.
// ---------------------------------------------------------------------------

function makeAbortObservingFetcher(onAbort: () => void): (signal: AbortSignal) => Promise<string> {
  return (signal: AbortSignal) => {
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        onAbort();
        const err = new Error('Aborted');
        err.name = 'AbortError';
        reject(err);
      });
      // Never settles on its own.
    });
  };
}

test('useAsyncData releases isRefreshing when enabled flips false during a refresh', async () => {
  let enabled = true;
  let calls = 0;
  let abortObserved = false;
  const fetcher = (signal: AbortSignal): Promise<string> => {
    calls++;
    if (calls === 1) return Promise.resolve('initial');
    return makeAbortObservingFetcher(() => {
      abortObserved = true;
    })(signal);
  };

  const harness = renderTestHook(() => useAsyncData(fetcher, { enabled }));
  await flush();
  assert.equal(harness.result.data, 'initial');
  assert.equal(harness.result.isLoading, false);

  void harness.result.refresh();
  await flush();
  assert.equal(harness.result.isRefreshing, true, 'refresh must raise isRefreshing mid-flight');

  enabled = false;
  harness.rerender();
  await flush();

  assert.equal(abortObserved, true, 'disabling must abort the in-flight refresh');
  assert.equal(
    harness.result.isRefreshing,
    false,
    'isRefreshing must not stay stuck after the hook is disabled'
  );
  assert.equal(harness.result.isLoading, false);
});

test('useAsyncData releases both flags when enabled flips false during a reload', async () => {
  let enabled = true;
  let calls = 0;
  let abortObserved = false;
  const fetcher = (signal: AbortSignal): Promise<string> => {
    calls++;
    if (calls === 1) return Promise.resolve('initial');
    return makeAbortObservingFetcher(() => {
      abortObserved = true;
    })(signal);
  };

  const harness = renderTestHook(() => useAsyncData(fetcher, { enabled }));
  await flush();
  assert.equal(harness.result.data, 'initial');

  void harness.result.reload();
  await flush();
  assert.equal(harness.result.isLoading, true, 'reload must raise isLoading mid-flight');

  enabled = false;
  harness.rerender();
  await flush();

  assert.equal(abortObserved, true, 'disabling must abort the in-flight reload');
  assert.equal(harness.result.isLoading, false, 'isLoading must clear when disabled');
  assert.equal(
    harness.result.isRefreshing,
    false,
    'the refresh flag must stay clear across the disable too'
  );
});

test('useAsyncData: re-enabling after the flip starts a fresh load that settles normally', async () => {
  let enabled = true;
  let calls = 0;
  let releaseFresh: (() => void) | null = null;
  const fetcher = (signal: AbortSignal): Promise<string> => {
    calls++;
    if (calls === 1) return Promise.resolve('initial');
    if (calls === 2) {
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          const err = new Error('Aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }
    return new Promise((resolve) => {
      releaseFresh = () => resolve('fresh');
    });
  };

  const harness = renderTestHook(() => useAsyncData(fetcher, { enabled }));
  await flush();
  assert.equal(harness.result.data, 'initial');

  void harness.result.refresh();
  await flush();
  assert.equal(harness.result.isRefreshing, true);

  enabled = false;
  harness.rerender();
  await flush();
  assert.equal(harness.result.isRefreshing, false, 'the flip must release the stuck flag');

  enabled = true;
  harness.rerender();
  await flush();
  assert.equal(harness.result.isLoading, true, 're-enabling must start a fresh load');

  releaseFresh!();
  await flush();
  assert.equal(harness.result.data, 'fresh');
  assert.equal(harness.result.isLoading, false);
  assert.equal(harness.result.isRefreshing, false, 'flags must settle cleanly after re-enable');
});

test('useAsyncData keeps isRefreshing true for the whole flight of an uninterrupted refresh', async () => {
  let calls = 0;
  let releaseRefresh: (() => void) | null = null;
  const fetcher = (_signal: AbortSignal): Promise<string> => {
    calls++;
    if (calls === 1) return Promise.resolve('initial');
    return new Promise((resolve) => {
      releaseRefresh = () => resolve('fresh');
    });
  };

  const harness = renderTestHook(() => useAsyncData(fetcher));
  await flush();
  assert.equal(harness.result.data, 'initial');

  void harness.result.refresh();
  await flush();
  assert.equal(
    harness.result.isRefreshing,
    true,
    'isRefreshing must stay raised while the refresh is on the wire'
  );
  assert.equal(harness.result.isLoading, false, 'a refresh must not raise isLoading');

  releaseRefresh!();
  await flush();
  assert.equal(harness.result.isRefreshing, false);
  assert.equal(harness.result.data, 'fresh');
});

// ---------------------------------------------------------------------------
// useAsyncData: a reload (or an effect-driven restart) superseding an
// in-flight refresh must release `isRefreshing` at the start of the
// replacement flight, not only when the replacement settles (#162). The
// superseded refresh's guarded `finally` skips the reset (#137), so the
// replacement's start is the only chance to hand the flag back.
// ---------------------------------------------------------------------------

test('useAsyncData: reload() over an in-flight refresh releases isRefreshing for the whole reload (#162)', async () => {
  let calls = 0;
  let releaseReload: (() => void) | null = null;
  let abortObserved = false;
  const fetcher = (signal: AbortSignal): Promise<string> => {
    calls++;
    if (calls === 1) return Promise.resolve('initial');
    if (calls === 2) {
      // The refresh: hangs on the wire until the superseding reload aborts it.
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          abortObserved = true;
          const err = new Error('Aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }
    // The superseding reload: settles only when the test releases it.
    return new Promise((resolve) => {
      releaseReload = () => resolve('reloaded');
    });
  };

  const harness = renderTestHook(() => useAsyncData(fetcher));
  await flush();
  assert.equal(harness.result.data, 'initial');

  // Pull to refresh and let it reach the wire.
  void harness.result.refresh();
  await flush();
  assert.equal(harness.result.isRefreshing, true);

  // A reload (e.g. ErrorState retry) mid-refresh supersedes it with a plain
  // load: isRefreshing must drop at once instead of riding through reload().
  void harness.result.reload();
  await flush();
  assert.equal(abortObserved, true, 'the reload must abort the superseded refresh');
  assert.equal(
    harness.result.isRefreshing,
    false,
    'isRefreshing must not stay raised for the superseding reload'
  );
  assert.equal(harness.result.isLoading, true, 'isLoading must reflect the reload in flight');

  releaseReload!();
  await flush();
  assert.equal(harness.result.isRefreshing, false, 'no flag may remain stuck after the reload');
  assert.equal(harness.result.isLoading, false);
  assert.equal(harness.result.data, 'reloaded');
});

test('useAsyncData: a fetcher identity change aborting an in-flight refresh leaves no stuck isRefreshing (#162)', async () => {
  let calls = 0;
  let activeFetcher: (signal: AbortSignal) => Promise<string>;
  let releaseReplacement: (() => void) | null = null;

  const hangingFetcher = (signal: AbortSignal): Promise<string> => {
    calls++;
    if (calls === 1) return Promise.resolve('initial');
    // The refresh: hangs until the fetcher change aborts it.
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        reject(err);
      });
    });
  };
  const replacementFetcher = (): Promise<string> =>
    new Promise((resolve) => {
      releaseReplacement = () => resolve('replacement');
    });

  activeFetcher = hangingFetcher;
  const harness = renderTestHook(() => useAsyncData(activeFetcher));
  await flush();
  assert.equal(harness.result.data, 'initial');

  void harness.result.refresh();
  await flush();
  assert.equal(harness.result.isRefreshing, true);

  // A fetcher identity change re-runs the effect: the cleanup aborts the
  // in-flight refresh and the effect's reload() starts a plain load.
  activeFetcher = replacementFetcher;
  harness.rerender();
  await flush();

  assert.equal(
    harness.result.isRefreshing,
    false,
    'isRefreshing must release when the fetcher change supersedes the refresh'
  );
  assert.equal(harness.result.isLoading, true, 'the replacement load owns isLoading');

  releaseReplacement!();
  await flush();
  assert.equal(harness.result.isRefreshing, false, 'no flag may remain stuck after the restart');
  assert.equal(harness.result.isLoading, false);
  assert.equal(harness.result.data, 'replacement');
});

// ---------------------------------------------------------------------------
// useFeatureRequests: error state exposure (consumed by screens for retry UI)
// ---------------------------------------------------------------------------

test('useFeatureRequests exposes load errors and reload() retry recovers', async () => {
  let shouldFail = true;
  const mockClient = {
    fetchFeatureRequests: async (_opts: any) => {
      if (shouldFail) throw new Error('offline');
      return { requests: [makeMockItem('fr_ok', 1)], total: 1 };
    },
  } as unknown as FeedbackClient;

  const harness = renderTestHook(() =>
    useFeatureRequests({ client: mockClient, userToken: 'test_token', pageSize: 50 })
  );
  await flush();

  assert.equal(harness.result.isLoading, false);
  assert.equal(harness.result.items.length, 0);
  assert.ok(harness.result.error instanceof Error, 'failed load must expose an error');
  assert.equal(harness.result.error!.message, 'offline');

  shouldFail = false;
  await harness.result.reload();
  await flush();

  assert.equal(harness.result.error, null, 'retry must clear the error on success');
  assert.equal(harness.result.items.length, 1);
  assert.equal(harness.result.items[0].id, 'fr_ok');
});

test('useFeatureRequests keeps loaded items when a pull-to-refresh fails', async () => {
  let shouldFail = false;
  const mockClient = {
    fetchFeatureRequests: async (_opts: any) => {
      if (shouldFail) throw new Error('refresh offline');
      return { requests: [makeMockItem('fr_stale', 1)], total: 1 };
    },
  } as unknown as FeedbackClient;

  const harness = renderTestHook(() =>
    useFeatureRequests({ client: mockClient, userToken: 'test_token', pageSize: 50 })
  );
  await flush();
  assert.equal(harness.result.items.length, 1);

  shouldFail = true;
  await harness.result.refresh();
  await flush();

  assert.equal(harness.result.items.length, 1, 'refresh failure must keep existing items');
  assert.equal(harness.result.items[0].id, 'fr_stale');
  assert.ok(harness.result.error instanceof Error);
});

// ---------------------------------------------------------------------------
// useFeatureRequests: split error surfaces (#54) — loadMoreError vs page-0
// error, so screens can attribute an inline refresh banner and a load-more
// footer retry independently once items are on screen
// ---------------------------------------------------------------------------

test('useFeatureRequests attributes loadMore failures to loadMoreError, not the page-0 error', async () => {
  let failLoadMore = true;
  const mockClient = {
    fetchFeatureRequests: async (opts: any) => {
      if ((opts?.offset ?? 0) > 0) {
        if (failLoadMore) throw new Error('page 2 offline');
        return { requests: [makeMockItem('fr_p2', 2)], total: 4 };
      }
      return { requests: [makeMockItem('fr_p1', 1)], total: 4 };
    },
  } as unknown as FeedbackClient;

  const harness = renderTestHook(() =>
    useFeatureRequests({ client: mockClient, userToken: 'test_token', pageSize: 2 })
  );
  await flush();
  let snap = harness.result;
  assert.equal(snap.items.length, 1);
  assert.ok(snap.error === null);
  assert.ok(snap.loadMoreError === null);

  await harness.result.loadMore();
  await flush();

  snap = harness.result;
  assert.equal(snap.items.length, 1, 'failed loadMore must not change items');
  assert.ok(snap.error === null, 'page-0 error must stay clean');
  assert.ok(snap.loadMoreError instanceof Error, 'loadMore failure must be surfaced');
  assert.equal((snap.loadMoreError as Error).message, 'page 2 offline');

  failLoadMore = false;
  await harness.result.loadMore();
  await flush();

  snap = harness.result;
  assert.equal(snap.items.length, 2, 'successful retry must append the next page');
  assert.ok(snap.loadMoreError === null, 'successful retry must clear loadMoreError');
  assert.ok(snap.error === null);
});

test('useFeatureRequests keeps a refresh failure in error even after a successful loadMore', async () => {
  let shouldFail = false;
  const mockClient = {
    fetchFeatureRequests: async (opts: any) => {
      if ((opts?.offset ?? 0) > 0) {
        return { requests: [makeMockItem('fr_p2', 2)], total: 3 };
      }
      if (shouldFail) throw new Error('refresh offline');
      return { requests: [makeMockItem('fr_p1', 1)], total: 3 };
    },
  } as unknown as FeedbackClient;

  const harness = renderTestHook(() =>
    useFeatureRequests({ client: mockClient, userToken: 'test_token', pageSize: 50 })
  );
  await flush();
  assert.equal(harness.result.items.length, 1);

  shouldFail = true;
  await harness.result.refresh();
  await flush();
  assert.ok(harness.result.error instanceof Error);
  assert.equal(harness.result.loadMoreError, null);

  await harness.result.loadMore();
  await flush();

  assert.equal(harness.result.items.length, 2);
  assert.ok(
    harness.result.error instanceof Error,
    'refresh error must stay attributed until the next refresh succeeds'
  );
  assert.equal(harness.result.loadMoreError, null);
});

test('useFeatureRequests clears a stale loadMoreError on the next successful page-0 load', async () => {
  let failLoadMore = true;
  const mockClient = {
    fetchFeatureRequests: async (opts: any) => {
      if ((opts?.offset ?? 0) > 0) {
        if (failLoadMore) throw new Error('pagination offline');
        return { requests: [makeMockItem('fr_p2', 2)], total: 4 };
      }
      return { requests: [makeMockItem('fr_p1', 1)], total: 4 };
    },
  } as unknown as FeedbackClient;

  const harness = renderTestHook(() =>
    useFeatureRequests({ client: mockClient, userToken: 'test_token', pageSize: 2 })
  );
  await flush();

  await harness.result.loadMore();
  await flush();
  assert.ok(harness.result.loadMoreError instanceof Error);

  failLoadMore = false;
  await harness.result.refresh();
  await flush();

  assert.equal(
    harness.result.loadMoreError,
    null,
    'a successful page-0 load must clear the stale loadMoreError'
  );
  assert.equal(harness.result.error, null);
  assert.equal(harness.result.items.length, 1, 'refresh shows the fresh page-0 list');
});

// ---------------------------------------------------------------------------
// i18n: common.error and common.retry must exist in every locale
// (these strings drive the new error/retry UI)
// ---------------------------------------------------------------------------

test('all 14 locales define non-empty common.error and common.retry', () => {
  const locales: Array<[string, typeof enStrings]> = [
    ['en', enStrings],
    ['zh-Hans', zhHansStrings],
    ['zh-Hant', zhHantStrings],
    ['ja', jaStrings],
    ['ko', koStrings],
    ['de', deStrings],
    ['es', esStrings],
    ['fr', frStrings],
    ['it', itStrings],
    ['pt', ptStrings],
    ['pl', plStrings],
    ['no', noStrings],
    ['tr', trStrings],
    ['vi', viStrings],
  ];

  for (const [name, strings] of locales) {
    assert.equal(typeof strings.common.error, 'string', `${name} must define common.error`);
    assert.ok(strings.common.error.length > 0, `${name} common.error must be non-empty`);
    assert.equal(typeof strings.common.retry, 'string', `${name} must define common.retry`);
    assert.ok(strings.common.retry.length > 0, `${name} common.retry must be non-empty`);
  }
});
