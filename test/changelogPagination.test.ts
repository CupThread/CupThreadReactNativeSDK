import test, { type TestOptions } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { FeedbackClient } from '../src/client/FeedbackClient';
import { useChangelogEntries } from '../src/hooks/useChangelogEntries';
import type { ChangelogEntry, ListPublicChangelogResult } from '../src/types';
import { MAX_CHANGELOG_PAGES } from '../src/client/FeedbackClient';
import { enStrings as strings } from '../src/i18n';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(id: string, publishedAt: string, title = `Release ${id}`): ChangelogEntry {
  return {
    id,
    title,
    body: `Body for ${id}`,
    versionLabel: '1.0.0',
    publishedAt,
    linkedRequests: [],
  };
}

function pageResponse(entries: ChangelogEntry[], hasMore?: boolean, nextCursor?: string | null) {
  return new Response(JSON.stringify({ entries, hasMore, nextCursor }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface RecordedRequest {
  url: string;
  cursor: string | null;
  limit: string | null;
}

/**
 * Installs a fetch stub that serves changelog pages from a map keyed by the
 * incoming `cursor` query parameter (null for the first page) and records
 * every changelog request.
 */
function installChangelogFetch(
  pages: Map<string | null, { status: number; body?: unknown }>,
  extraRoutes?: (target: string) => Response | undefined
): { requests: RecordedRequest[]; restore: () => void } {
  const originalFetch = globalThis.fetch;
  const requests: RecordedRequest[] = [];

  globalThis.fetch = (async (url: string | URL | Request) => {
    const target = url.toString();
    if (target.includes('/changelog')) {
      const query = new URLSearchParams(target.split('?')[1] ?? '');
      const cursor = query.get('cursor');
      requests.push({ url: target, cursor, limit: query.get('limit') });
      const route = pages.get(cursor);
      if (!route) {
        return new Response('not found', { status: 404 });
      }
      return new Response(
        typeof route.body === 'string' ? route.body : JSON.stringify(route.body ?? {}),
        { status: route.status, headers: { 'Content-Type': 'application/json' } }
      );
    }
    const extra = extraRoutes?.(target);
    if (extra) return extra;
    return new Response('not found', { status: 404 });
  }) as any;

  return {
    requests,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

function makeClient(): FeedbackClient {
  return new FeedbackClient({
    baseUrl: 'https://api.cupthread.com',
    appKey: 'app_pagination_test',
  });
}

const flush = (ms = 20) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Client: listChangelog
// ---------------------------------------------------------------------------

test('listChangelog requests the server-default page and normalizes a legacy response', async () => {
  const e1 = makeEntry('e1', '2026-09-01T00:00:00.000Z');
  const e2 = makeEntry('e2', '2026-09-02T00:00:00.000Z');
  // Legacy servers predate pagination: no hasMore / nextCursor at all.
  const pages = new Map([[null, { status: 200, body: { entries: [e1, e2] } }]]);
  const fetchMock = installChangelogFetch(pages);

  try {
    const result = await makeClient().listChangelog();
    assert.deepEqual(
      result,
      { entries: [e2, e1], hasMore: false, nextCursor: null } satisfies ListPublicChangelogResult,
      'legacy responses must resolve to a single exhausted page, entries newest first'
    );
    assert.equal(fetchMock.requests.length, 1);
    assert.equal(fetchMock.requests[0].limit, '100', 'default page size is the server maximum');
    assert.equal(fetchMock.requests[0].cursor, null);
  } finally {
    fetchMock.restore();
  }
});

test('listChangelog forwards limit and cursor and clamps out-of-range limits', async () => {
  for (const { options, expectedLimit } of [
    { options: { limit: 20, cursor: 'cur-9' }, expectedLimit: '20' },
    { options: { limit: 0 }, expectedLimit: '1' },
    { options: { limit: -5 }, expectedLimit: '1' },
    { options: { limit: 500 }, expectedLimit: '100' },
  ]) {
    const pages = new Map<string | null, { status: number; body?: unknown }>([
      [(options as any).cursor ?? null, { status: 200, body: { entries: [] } }],
    ]);
    const fetchMock = installChangelogFetch(pages);
    try {
      await makeClient().listChangelog(options as any);
      assert.equal(fetchMock.requests.length, 1);
      assert.equal(fetchMock.requests[0].limit, expectedLimit);
      assert.equal(
        fetchMock.requests[0].cursor,
        (options as any).cursor ?? null,
        'cursor must travel as a query parameter'
      );
    } finally {
      fetchMock.restore();
    }
  }
});

test('listChangelog normalizes a malformed pagination payload', async () => {
  const pages = new Map([
    [null, { status: 200, body: { entries: [], hasMore: 'yes', nextCursor: 42 } }],
  ]);
  const fetchMock = installChangelogFetch(pages);
  try {
    const result = await makeClient().listChangelog();
    assert.equal(result.hasMore, false, 'non-boolean hasMore must not be trusted');
    assert.equal(result.nextCursor, null, 'non-string nextCursor must not be trusted');
  } finally {
    fetchMock.restore();
  }
});

// ---------------------------------------------------------------------------
// Client: fetchChangelog auto-pagination
// ---------------------------------------------------------------------------

test('fetchChangelog follows nextCursor across pages and returns the sorted full history', async () => {
  const older = makeEntry('older', '2026-01-01T00:00:00.000Z');
  const mid = makeEntry('mid', '2026-05-01T00:00:00.000Z');
  const newer = makeEntry('newer', '2026-09-01T00:00:00.000Z');
  const newest = makeEntry('newest', '2026-10-01T00:00:00.000Z');

  const pages = new Map<string | null, { status: number; body?: unknown }>([
    [
      null,
      {
        status: 200,
        body: { entries: [newer, mid], hasMore: true, nextCursor: 'cur-2' },
      },
    ],
    [
      // Page 2 intentionally carries an entry newer than one on page 1 so the
      // final result proves a global (not per-page) sort.
      'cur-2',
      {
        status: 200,
        body: { entries: [newest, older], hasMore: false, nextCursor: null },
      },
    ],
  ]);
  const fetchMock = installChangelogFetch(pages);

  try {
    const entries = await makeClient().fetchChangelog();
    assert.deepEqual(
      entries.map((e) => e.id),
      ['newest', 'newer', 'mid', 'older']
    );
    assert.equal(fetchMock.requests.length, 2);
    assert.equal(fetchMock.requests[0].cursor, null);
    assert.equal(fetchMock.requests[1].cursor, 'cur-2', 'second page must carry the first cursor');
  } finally {
    fetchMock.restore();
  }
});

test('fetchChangelog makes a single request when the server reports no more pages', async () => {
  const pages = new Map<string | null, { status: number; body?: unknown }>([
    [null, { status: 200, body: { entries: [makeEntry('only', '2026-01-01T00:00:00.000Z')] } }],
  ]);
  const fetchMock = installChangelogFetch(pages);
  try {
    const entries = await makeClient().fetchChangelog();
    assert.equal(entries.length, 1);
    assert.equal(fetchMock.requests.length, 1, 'no cursor follow-up without hasMore');
  } finally {
    fetchMock.restore();
  }
});

test('fetchChangelog caps runaway pagination instead of looping forever', async () => {
  const pages = new Map<string | null, { status: number; body?: unknown }>();
  pages.set(null, { status: 200, body: { entries: [], hasMore: true, nextCursor: 'cur-1' } });
  for (let i = 1; i <= MAX_CHANGELOG_PAGES + 5; i++) {
    pages.set(`cur-${i}`, {
      status: 200,
      body: { entries: [], hasMore: true, nextCursor: `cur-${i + 1}` },
    });
  }
  const fetchMock = installChangelogFetch(pages);
  try {
    const entries = await makeClient().fetchChangelog();
    assert.equal(entries.length, 0);
    assert.equal(
      fetchMock.requests.length,
      MAX_CHANGELOG_PAGES,
      'pagination must stop at the defensive page cap'
    );
  } finally {
    fetchMock.restore();
  }
});

test('fetchChangelog stops early when a page has entries but no usable nextCursor', async () => {
  const pages = new Map<string | null, { status: number; body?: unknown }>([
    [
      null,
      {
        status: 200,
        body: { entries: [makeEntry('a', '2026-01-01T00:00:00.000Z')], hasMore: true },
      },
    ],
    ['lost', { status: 500, body: 'should never be requested' }],
  ]);
  const fetchMock = installChangelogFetch(pages);
  try {
    const entries = await makeClient().fetchChangelog();
    assert.equal(entries.length, 1);
    assert.equal(fetchMock.requests.length, 1, 'missing nextCursor must end pagination');
  } finally {
    fetchMock.restore();
  }
});

// ---------------------------------------------------------------------------
// Client: prepareChangelogOverlay only pulls the page it displays
// ---------------------------------------------------------------------------

test('prepareChangelogOverlay requests exactly the overlay page size', async () => {
  const originalFetch = globalThis.fetch;
  const changelogRequests: string[] = [];

  globalThis.fetch = (async (url: string | URL | Request) => {
    const target = url.toString();
    if (target.includes('/api/v1/public/config/')) {
      return new Response(
        JSON.stringify({
          appKey: 'app_pagination_test',
          sdk: {
            features: { changelog: true },
            changelogOverlay: { entryCount: 3 },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (target.includes('/changelog')) {
      changelogRequests.push(target);
      return pageResponse(
        [
          makeEntry('e5', '2026-05-01T00:00:00.000Z'),
          makeEntry('e4', '2026-04-01T00:00:00.000Z'),
          makeEntry('e3', '2026-03-01T00:00:00.000Z'),
          makeEntry('e2', '2026-02-01T00:00:00.000Z'),
          makeEntry('e1', '2026-01-01T00:00:00.000Z'),
        ],
        true,
        'cur-2'
      );
    }
    return new Response('not found', { status: 404 });
  }) as any;

  try {
    const overlay = await makeClient().prepareChangelogOverlay();
    assert.ok(overlay, 'overlay payload should resolve');
    assert.equal(overlay!.entries.length, 3);
    assert.equal(overlay!.latestKey, '1.0.0');
    assert.equal(changelogRequests.length, 1, 'overlay must not auto-paginate the full history');
    assert.ok(changelogRequests[0].includes('limit=3'), 'overlay must request only its page size');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// Hook test harness with proper dependency caching and effect lifecycle
// (same renderer used by pagination.test.ts / error-retry.test.ts)
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

// ---------------------------------------------------------------------------
// Hook: useChangelogEntries
// ---------------------------------------------------------------------------

test('useChangelogEntries loads the first page and exposes hasMore', async () => {
  const pages = new Map<string | null, { status: number; body?: unknown }>([
    [
      null,
      {
        status: 200,
        body: {
          entries: [
            makeEntry('e1', '2026-09-01T00:00:00.000Z'),
            makeEntry('e2', '2026-08-01T00:00:00.000Z'),
          ],
          hasMore: true,
          nextCursor: 'cur-2',
        },
      },
    ],
  ]);
  const fetchMock = installChangelogFetch(pages);

  try {
    const client = makeClient();
    const harness = renderTestHook(() => useChangelogEntries({ client, pageSize: 20 }));
    await flush();

    assert.equal(harness.result.isLoading, false);
    assert.deepEqual(
      harness.result.entries.map((e) => e.id),
      ['e1', 'e2']
    );
    assert.equal(harness.result.hasMore, true);
    assert.equal(harness.result.error, null);
    assert.equal(harness.result.loadMoreError, null);
    harness.unmount();
  } finally {
    fetchMock.restore();
  }
});

test('useChangelogEntries loadMore appends the next page and stops at the end', async () => {
  const pages = new Map<string | null, { status: number; body?: unknown }>([
    [
      null,
      {
        status: 200,
        body: {
          entries: [makeEntry('e1', '2026-09-01T00:00:00.000Z')],
          hasMore: true,
          nextCursor: 'cur-2',
        },
      },
    ],
    [
      'cur-2',
      {
        status: 200,
        body: {
          // e1 repeats so deduplication is exercised.
          entries: [
            makeEntry('e1', '2026-09-01T00:00:00.000Z'),
            makeEntry('e2', '2026-08-01T00:00:00.000Z'),
          ],
          hasMore: false,
          nextCursor: null,
        },
      },
    ],
  ]);
  const fetchMock = installChangelogFetch(pages);

  try {
    const client = makeClient();
    const harness = renderTestHook(() => useChangelogEntries({ client, pageSize: 20 }));
    await flush();

    await act(async () => {
      await harness.result.loadMore();
    });

    assert.deepEqual(
      harness.result.entries.map((e) => e.id),
      ['e1', 'e2']
    );
    assert.equal(harness.result.hasMore, false);
    assert.equal(harness.result.isLoadingMore, false);
    assert.equal(fetchMock.requests.length, 2);
    assert.equal(fetchMock.requests[1].cursor, 'cur-2');
    assert.equal(fetchMock.requests[1].limit, '20');

    // End of list: loadMore must be a safe no-op with no extra request.
    await harness.result.loadMore();
    assert.equal(fetchMock.requests.length, 2);
    harness.unmount();
  } finally {
    fetchMock.restore();
  }
});

test('useChangelogEntries keeps entries and offers retry after a failed load-more', async () => {
  const goodPage2 = {
    status: 200,
    body: {
      entries: [makeEntry('e2', '2026-08-01T00:00:00.000Z')],
      hasMore: false,
      nextCursor: null,
    },
  };
  const pages = new Map<string | null, { status: number; body?: unknown }>([
    [
      null,
      {
        status: 200,
        body: {
          entries: [makeEntry('e1', '2026-09-01T00:00:00.000Z')],
          hasMore: true,
          nextCursor: 'cur-2',
        },
      },
    ],
    ['cur-2', { status: 500, body: 'server error' }],
  ]);
  const fetchMock = installChangelogFetch(pages);

  try {
    const client = makeClient();
    const harness = renderTestHook(() => useChangelogEntries({ client, pageSize: 20 }));
    await flush();

    await harness.result.loadMore();
    assert.ok(harness.result.loadMoreError, 'loadMore failure must surface in loadMoreError');
    assert.equal(harness.result.error, null, 'first-page error must stay clear');
    assert.deepEqual(
      harness.result.entries.map((e) => e.id),
      ['e1'],
      'earlier pages stay visible'
    );

    // Flip the network to success and retry via the same loadMore callback.
    pages.set('cur-2', goodPage2);
    await harness.result.loadMore();
    assert.equal(harness.result.loadMoreError, null);
    assert.deepEqual(
      harness.result.entries.map((e) => e.id),
      ['e1', 'e2']
    );
    harness.unmount();
  } finally {
    fetchMock.restore();
  }
});

test('useChangelogEntries refresh rewinds to the first page and re-arms pagination', async () => {
  const firstPage = {
    status: 200,
    body: {
      entries: [makeEntry('e1', '2026-09-01T00:00:00.000Z')],
      hasMore: true,
      nextCursor: 'cur-2',
    },
  };
  const pages = new Map<string | null, { status: number; body?: unknown }>([
    [null, firstPage],
    [
      'cur-2',
      {
        status: 200,
        body: {
          entries: [makeEntry('e2', '2026-08-01T00:00:00.000Z')],
          hasMore: false,
          nextCursor: null,
        },
      },
    ],
  ]);
  const fetchMock = installChangelogFetch(pages);

  try {
    const client = makeClient();
    const harness = renderTestHook(() => useChangelogEntries({ client, pageSize: 20 }));
    await flush();

    await harness.result.loadMore();
    assert.deepEqual(
      harness.result.entries.map((e) => e.id),
      ['e1', 'e2']
    );
    assert.equal(harness.result.hasMore, false);

    await harness.result.refresh();
    assert.deepEqual(
      harness.result.entries.map((e) => e.id),
      ['e1'],
      'refresh resets to page one'
    );
    assert.equal(harness.result.hasMore, true, 'pagination re-arms after refresh');
    assert.equal(harness.result.isRefreshing, false);

    // The rewound cursor must be usable again.
    await harness.result.loadMore();
    assert.deepEqual(
      harness.result.entries.map((e) => e.id),
      ['e1', 'e2']
    );
    assert.equal(fetchMock.requests.filter((r) => r.cursor === 'cur-2').length, 2);
    harness.unmount();
  } finally {
    fetchMock.restore();
  }
});

// ---------------------------------------------------------------------------
// Hook: superseded-refresh flag ownership (#162). A reload (or an effect
// restart) that aborts an in-flight refresh must release `isRefreshing` when
// the replacement starts: the superseded refresh's guarded `finally` skips
// the reset (#137), so the replacement's start is the only chance.
// ---------------------------------------------------------------------------

/**
 * Installs a changelog fetch stub whose page-0 responses are settled manually
 * by the test, so a refresh can be held on the wire and its response can land
 * late (after a superseding reload aborted it). The raw fetch `signal` is
 * forwarded to the handlers so they can reject like a real network stack.
 */
function installDeferredChangelogFetch(handlers: {
  onPage0: (call: number, signal: AbortSignal | undefined) => Promise<Response> | Response;
  onPage2: (signal: AbortSignal | undefined) => Promise<Response> | Response;
}): { readonly count: number; restore: () => void } {
  const originalFetch = globalThis.fetch;
  const state = { count: 0 };

  globalThis.fetch = (async (url: string | URL | Request, init?: { signal?: AbortSignal }) => {
    const target = url.toString();
    if (!target.includes('/changelog')) {
      return new Response('not found', { status: 404 });
    }
    const query = new URLSearchParams(target.split('?')[1] ?? '');
    const signal = init?.signal;
    if (query.get('cursor')) return handlers.onPage2(signal);
    state.count += 1;
    return handlers.onPage0(state.count, signal);
  }) as any;

  return {
    get count() {
      return state.count;
    },
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

test('useChangelogEntries: reload() over an in-flight refresh releases isRefreshing for the whole reload (#162)', async () => {
  let releaseReload: ((response: Response) => void) | null = null;
  let releaseStaleRefresh: (() => void) | null = null;
  const fetchMock = installDeferredChangelogFetch({
    onPage0: (call) => {
      if (call === 1) {
        return pageResponse([makeEntry('e1', '2026-09-01T00:00:00.000Z')], true, 'cur-2');
      }
      if (call === 2) {
        // The refresh: hangs on the wire until aborted, and its response can
        // still be delivered afterwards to prove the discard guard holds.
        return new Promise<Response>((resolve) => {
          releaseStaleRefresh = () =>
            resolve(
              pageResponse([makeEntry('e_stale', '2026-09-02T00:00:00.000Z')], true, 'cur-2')
            );
        });
      }
      // The superseding reload: settles only when the test releases it.
      return new Promise<Response>((resolve) => {
        releaseReload = (response) => resolve(response);
      });
    },
    onPage2: () => pageResponse([makeEntry('e2', '2026-08-01T00:00:00.000Z')], false, null),
  });

  try {
    const client = makeClient();
    const harness = renderTestHook(() => useChangelogEntries({ client, pageSize: 20 }));
    await flush();
    assert.deepEqual(
      harness.result.entries.map((e) => e.id),
      ['e1']
    );
    assert.equal(harness.result.hasMore, true);

    // Pull to refresh and let it reach the wire.
    const refreshPromise = harness.result.refresh();
    await flush();
    assert.equal(fetchMock.count, 2);
    assert.equal(harness.result.isRefreshing, true);

    // A reload (e.g. ErrorState retry) mid-refresh supersedes it with a plain
    // load: isRefreshing must drop at once instead of riding through reload().
    void harness.result.reload();
    await flush();
    assert.equal(
      harness.result.isRefreshing,
      false,
      'isRefreshing must not stay raised for the superseding reload'
    );
    assert.equal(harness.result.isLoading, true, 'isLoading must reflect the reload in flight');

    // The aborted refresh's response landing late must change nothing: the
    // discard guard drops the stale page and the guarded `finally` skips the
    // flag reset for an aborted signal (#137).
    releaseStaleRefresh!();
    await refreshPromise;
    await flush();
    assert.deepEqual(
      harness.result.entries.map((e) => e.id),
      ['e1'],
      "the superseded refresh's late page must be discarded"
    );
    assert.equal(harness.result.isRefreshing, false, 'the late page must not re-raise flags');
    assert.equal(harness.result.isLoading, true);

    releaseReload!(
      pageResponse([makeEntry('e_reload', '2026-09-03T00:00:00.000Z')], true, 'cur-2')
    );
    await flush();
    assert.deepEqual(
      harness.result.entries.map((e) => e.id),
      ['e_reload']
    );
    assert.equal(harness.result.isRefreshing, false, 'no flag may remain stuck after the reload');
    assert.equal(harness.result.isLoading, false);

    // Pagination must stay usable after the superseding reload (#162).
    await harness.result.loadMore();
    assert.deepEqual(
      harness.result.entries.map((e) => e.id),
      ['e_reload', 'e2']
    );
    assert.equal(harness.result.hasMore, false);
    harness.unmount();
  } finally {
    fetchMock.restore();
  }
});

test('useChangelogEntries: disabling mid-flight aborts a manual refresh still on the wire (#162)', async () => {
  let enabled = true;
  let releaseRefresh: ((response: Response) => void) | null = null;
  let abortObserved = false;
  const fetchMock = installDeferredChangelogFetch({
    onPage0: (call, signal) => {
      if (call === 1) {
        return pageResponse([makeEntry('e1', '2026-09-01T00:00:00.000Z')], true, 'cur-2');
      }
      // The manual refresh: hangs on the wire until aborted.
      return new Promise<Response>((resolve, reject) => {
        signal?.addEventListener('abort', () => {
          abortObserved = true;
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
        // If never aborted it could still be answered by hand.
        releaseRefresh = () =>
          resolve(pageResponse([makeEntry('e2', '2026-08-01T00:00:00.000Z')], false, null));
      });
    },
    onPage2: () => pageResponse([makeEntry('e3', '2026-07-01T00:00:00.000Z')], false, null),
  });

  try {
    const client = makeClient();
    const harness = renderTestHook(() => useChangelogEntries({ client, pageSize: 20, enabled }));
    await flush();
    assert.deepEqual(
      harness.result.entries.map((e) => e.id),
      ['e1']
    );

    // A manual refresh reaches the wire: its controller now replaces the one
    // the effect cleanup would abort, so only the disabled branch can stop it.
    const refreshPromise = harness.result.refresh();
    await flush();
    assert.equal(fetchMock.count, 2);
    assert.equal(harness.result.isRefreshing, true);

    // Disable mid-refresh: the manual request must be aborted synchronously
    // and both flags cleared, not left in flight with the flags cleared
    // behind it (#162). The synchronous abort assertion is what separates a
    // real cancellation from the client's request timeout eventually tearing
    // the hanging request down.
    enabled = false;
    harness.rerender();
    assert.equal(
      abortObserved,
      true,
      'disabling must abort the manual refresh right away, not leave it on the wire'
    );
    await refreshPromise;
    await flush();
    assert.equal(
      harness.result.isRefreshing,
      false,
      'isRefreshing must not stay raised while the hook is disabled'
    );
    assert.equal(harness.result.isLoading, false);
    assert.equal(
      harness.result.error,
      null,
      'the cancelled refresh must not surface as a first-page error'
    );
    assert.deepEqual(
      harness.result.entries.map((e) => e.id),
      ['e1']
    );

    // The released (post-abort) response must change nothing while disabled.
    releaseRefresh!(pageResponse([makeEntry('e2', '2026-08-01T00:00:00.000Z')], false, null));
    await flush();
    assert.deepEqual(
      harness.result.entries.map((e) => e.id),
      ['e1'],
      'a page landing after the disable must be discarded'
    );
    harness.unmount();
  } finally {
    fetchMock.restore();
  }
});

test('useChangelogEntries forces hasMore off when a page is empty despite hasMore', async () => {
  const pages = new Map<string | null, { status: number; body?: unknown }>([
    [null, { status: 200, body: { entries: [], hasMore: true, nextCursor: 'cur-2' } }],
    ['cur-2', { status: 500, body: 'must never be requested' }],
  ]);
  const fetchMock = installChangelogFetch(pages);

  try {
    const client = makeClient();
    const harness = renderTestHook(() => useChangelogEntries({ client, pageSize: 20 }));
    await flush();

    assert.deepEqual(harness.result.entries, []);
    assert.equal(harness.result.hasMore, false, 'empty page cannot be followed by another');
    await harness.result.loadMore();
    assert.equal(fetchMock.requests.length, 1, 'loadMore must no-op after an empty page');
    harness.unmount();
  } finally {
    fetchMock.restore();
  }
});

test('useChangelogEntries clears hasMore when the server sends no cursor to follow', async () => {
  const pages = new Map<string | null, { status: number; body?: unknown }>([
    [
      null,
      {
        status: 200,
        body: {
          entries: [makeEntry('e1', '2026-09-01T00:00:00.000Z')],
          hasMore: true,
          nextCursor: null,
        },
      },
    ],
    ['cur-2', { status: 500, body: 'must never be requested' }],
  ]);
  const fetchMock = installChangelogFetch(pages);

  try {
    const client = makeClient();
    const harness = renderTestHook(() => useChangelogEntries({ client, pageSize: 20 }));
    await flush();

    assert.deepEqual(
      harness.result.entries.map((e) => e.id),
      ['e1']
    );
    assert.equal(
      harness.result.hasMore,
      false,
      'a page without a next cursor must not offer a load-more affordance'
    );
    await harness.result.loadMore();
    assert.equal(fetchMock.requests.length, 1, 'loadMore must no-op without a cursor');
    harness.unmount();
  } finally {
    fetchMock.restore();
  }
});

test('useChangelogEntries clears hasMore when a later page sends no cursor', async () => {
  const pages = new Map<string | null, { status: number; body?: unknown }>([
    [
      null,
      {
        status: 200,
        body: {
          entries: [makeEntry('e1', '2026-09-01T00:00:00.000Z')],
          hasMore: true,
          nextCursor: 'cur-2',
        },
      },
    ],
    [
      'cur-2',
      {
        status: 200,
        body: {
          entries: [makeEntry('e2', '2026-08-01T00:00:00.000Z')],
          hasMore: true,
          nextCursor: null,
        },
      },
    ],
  ]);
  const fetchMock = installChangelogFetch(pages);

  try {
    const client = makeClient();
    const harness = renderTestHook(() => useChangelogEntries({ client, pageSize: 20 }));
    await flush();

    await harness.result.loadMore();
    assert.deepEqual(
      harness.result.entries.map((e) => e.id),
      ['e1', 'e2']
    );
    assert.equal(harness.result.hasMore, false, 'a cursorless page ends pagination');
    await harness.result.loadMore();
    assert.equal(fetchMock.requests.length, 2, 'loadMore must no-op after a cursorless page');
    harness.unmount();
  } finally {
    fetchMock.restore();
  }
});

test('useChangelogEntries surfaces first-page failures and recovers via reload', async () => {
  const pages = new Map<string | null, { status: number; body?: unknown }>([
    [null, { status: 500, body: 'server error' }],
  ]);
  const fetchMock = installChangelogFetch(pages);

  try {
    const client = makeClient();
    const harness = renderTestHook(() => useChangelogEntries({ client, pageSize: 20 }));
    await flush();

    assert.ok(harness.result.error instanceof Error);
    assert.equal(harness.result.entries.length, 0);
    assert.equal(harness.result.isLoading, false);

    pages.set(null, {
      status: 200,
      body: {
        entries: [makeEntry('e1', '2026-09-01T00:00:00.000Z')],
        hasMore: false,
        nextCursor: null,
      },
    });
    await harness.result.reload();
    assert.equal(harness.result.error, null);
    assert.deepEqual(
      harness.result.entries.map((e) => e.id),
      ['e1']
    );
    harness.unmount();
  } finally {
    fetchMock.restore();
  }
});

test('useChangelogEntries does not fetch when disabled', async () => {
  const fetchMock = installChangelogFetch(new Map());
  try {
    const client = makeClient();
    const harness = renderTestHook(() => useChangelogEntries({ client, enabled: false }));
    await flush();

    assert.equal(harness.result.isLoading, false, 'disabled hook must not spin forever');
    assert.deepEqual(harness.result.entries, []);
    assert.equal(fetchMock.requests.length, 0);
    await harness.result.loadMore();
    await harness.result.refresh();
    await harness.result.reload();
    assert.equal(fetchMock.requests.length, 0, 'disabled hook must ignore manual triggers');
    harness.unmount();
  } finally {
    fetchMock.restore();
  }
});

// ---------------------------------------------------------------------------
// Screen: WhatsNewScreen load-more wiring (needs react-native module mocks)
// ---------------------------------------------------------------------------

const supportsModuleMocks = typeof (test as any).mock?.module === 'function';

const touchableOpacityProps: any[] = [];
const flatListProps: any[] = [];

const TouchableOpacityStub = (props: any) => {
  touchableOpacityProps.push(props);
  return props.children ?? null;
};

const TextStub = (props: any) => props.children ?? null;

// Renders item rows and the footer inline so text/pressable assertions see the
// real screen output; captures props so tests can drive RefreshControl.
const FlatListStub = (props: any) => {
  flatListProps.push(props);
  return React.createElement(
    React.Fragment,
    null,
    ...(props.data ?? []).map((item: any, index: number) => props.renderItem({ item, index })),
    props.ListFooterComponent ?? null
  );
};

if (supportsModuleMocks) {
  (test as any).mock.module('react-native', {
    namedExports: {
      useColorScheme: () => 'light',
      View: ({ children }: any) => children ?? null,
      Text: TextStub,
      TextInput: () => null,
      TouchableOpacity: TouchableOpacityStub,
      ActivityIndicator: () => null,
      ScrollView: ({ children }: any) => children ?? null,
      Modal: ({ children }: any) => children ?? null,
      SafeAreaView: ({ children }: any) => children ?? null,
      FlatList: FlatListStub,
      RefreshControl: () => null,
      Image: () => null,
      Linking: { openURL: () => Promise.resolve() },
      StyleSheet: { create: (styles: any) => styles, flatten: (s: any) => s },
      Alert: { alert: () => {} },
    },
  });
}

const { CupThreadProvider } = await import('../src/theme/CupThreadThemeProvider');
const { WhatsNewScreen } = await import('../src/components/WhatsNewScreen');

const renderTestOptions: TestOptions = supportsModuleMocks
  ? {}
  : {
      skip: 'node:test module mocking unavailable (needs Node >= 22.3 with --experimental-test-module-mocks)',
    };

function collectTexts(root: TestRenderer.ReactTestRenderer['root']): string[] {
  const out: string[] = [];
  root.findAll((node: any) => {
    if (node.type === TextStub && typeof node.props?.children === 'string') {
      out.push(node.props.children);
    }
    return false;
  });
  return out;
}

function findPressable(root: TestRenderer.ReactTestRenderer['root'], label: string): any {
  const matches = root.findAll((node: any) => {
    if (node.type !== TouchableOpacityStub || typeof node.props?.onPress !== 'function') {
      return false;
    }
    const kids = Array.isArray(node.props.children) ? node.props.children : [node.props.children];
    return kids.some((k: any) => React.isValidElement(k) && (k.props as any)?.children === label);
  });
  return matches[matches.length - 1] ?? null;
}

async function settle(ms = 60): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
  await act(async () => {});
}

async function waitForText(
  renderer: TestRenderer.ReactTestRenderer,
  predicate: (text: string) => boolean,
  timeoutMs = 4000
): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (collectTexts(renderer.root).some(predicate)) return;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitForText timed out after ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
    await act(async () => {});
  }
}

function installScreenFetch(routes: {
  page0: { status: number; body?: unknown };
  loadMore: { status: number; body?: unknown };
}): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    const target = url.toString();
    if (target.includes('/api/v1/public/config/')) {
      return new Response(
        JSON.stringify({
          appKey: 'app_screen_test',
          sdk: { features: { changelog: true } },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (target.includes('/changelog')) {
      const cursor = new URLSearchParams(target.split('?')[1] ?? '').get('cursor');
      const route = cursor ? routes.loadMore : routes.page0;
      return new Response(
        typeof route.body === 'string' ? route.body : JSON.stringify(route.body ?? {}),
        { status: route.status, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response('not found', { status: 404 });
  }) as any;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test(
  'WhatsNewScreen appends older entries via the load-more footer',
  renderTestOptions,
  async () => {
    const restore = installScreenFetch({
      page0: {
        status: 200,
        body: {
          entries: [makeEntry('e1', '2026-09-01T00:00:00.000Z')],
          hasMore: true,
          nextCursor: 'cur-2',
        },
      },
      loadMore: {
        status: 200,
        body: {
          entries: [makeEntry('e2', '2026-08-01T00:00:00.000Z')],
          hasMore: false,
          nextCursor: null,
        },
      },
    });

    try {
      const renderer = TestRenderer.create(
        React.createElement(CupThreadProvider, {
          client: new FeedbackClient({
            baseUrl: 'https://api.cupthread.com',
            appKey: 'app_screen_test',
          }),
          children: React.createElement(WhatsNewScreen),
        })
      );
      await waitForText(renderer, (t) => t === 'Release e1');
      await waitForText(renderer, (t) => t === strings.changelog.loadMore);

      const button = findPressable(renderer.root, strings.changelog.loadMore);
      assert.ok(button, 'load-more affordance must be pressable while hasMore');
      await act(async () => {
        button.props.onPress();
      });
      await settle();

      await waitForText(renderer, (t) => t === 'Release e2');
      assert.equal(
        collectTexts(renderer.root).includes(strings.changelog.loadMore),
        false,
        'footer must disappear once the server reports no more pages'
      );
      renderer.unmount();
    } finally {
      restore();
    }
  }
);

test(
  'WhatsNewScreen offers a retry in the footer after a failed load-more',
  renderTestOptions,
  async () => {
    const routes = {
      page0: {
        status: 200,
        body: {
          entries: [makeEntry('e1', '2026-09-01T00:00:00.000Z')],
          hasMore: true,
          nextCursor: 'cur-2',
        },
      },
      loadMore: { status: 500, body: 'server error' as unknown },
    };
    const restore = installScreenFetch(routes);

    try {
      const renderer = TestRenderer.create(
        React.createElement(CupThreadProvider, {
          client: new FeedbackClient({
            baseUrl: 'https://api.cupthread.com',
            appKey: 'app_screen_test',
          }),
          children: React.createElement(WhatsNewScreen),
        })
      );
      await waitForText(renderer, (t) => t === 'Release e1');
      await waitForText(renderer, (t) => t === strings.changelog.loadMore);

      const button = findPressable(renderer.root, strings.changelog.loadMore);
      await act(async () => {
        button.props.onPress();
      });
      await settle();

      await waitForText(renderer, (t) => t === strings.common.retry);
      assert.ok(
        collectTexts(renderer.root).includes('Release e1'),
        'existing entries must stay visible after a load-more failure'
      );

      routes.loadMore = {
        status: 200,
        body: {
          entries: [makeEntry('e2', '2026-08-01T00:00:00.000Z')],
          hasMore: false,
          nextCursor: null,
        },
      };
      const retry = findPressable(renderer.root, strings.common.retry);
      assert.ok(retry, 'footer button must switch to retry after a failure');
      await act(async () => {
        retry.props.onPress();
      });
      await settle();

      await waitForText(renderer, (t) => t === 'Release e2');
      renderer.unmount();
    } finally {
      restore();
    }
  }
);
