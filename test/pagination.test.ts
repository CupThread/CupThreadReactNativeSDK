import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { FeedbackClient } from '../src/client/FeedbackClient';
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
// ---------------------------------------------------------------------------

function renderTestHook<T>(hookFn: () => T, onRender?: (result: T) => void) {
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
      onRender?.(currentResult);
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
      // Hold the same `isExecuting` guard `scheduleRender` holds: real React
      // never re-enters a render mid-effect-flush — a setState during the
      // flush is deferred to a follow-up render after the commit. Without
      // the guard, a setState inside an effect body re-entered executeRender
      // synchronously, ran the effect against not-yet-committed deps, and
      // orphaned the cleanup of the inner run (#137).
      isExecuting = true;
      try {
        executeRender();
      } finally {
        isExecuting = false;
      }
    },
    unmount() {
      for (const e of effects) {
        if (typeof e?.cleanup === 'function') e.cleanup();
      }
    },
  };
}

function makeMockItem(
  id: string,
  index: number,
  overrides?: Partial<FeatureRequestItem>
): FeatureRequestItem {
  return {
    id,
    appId: 'app_test',
    title: `Feature Request #${index}`,
    description: `Description for feature request #${index}`,
    voteCount: index * 2,
    hasVoted: false,
    isOwnRequest: false,
    status: index % 2 === 0 ? 'planned' : 'in-progress',
    columnId: index % 2 === 0 ? 'col_planned' : 'col_progress',
    columnName: index % 2 === 0 ? 'Planned' : 'In Progress',
    columnColor: '#3b82f6',
    approved: true,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// FeedbackClient.fetchFeatureRequests query parameter serialization
// ---------------------------------------------------------------------------

test('FeedbackClient.fetchFeatureRequests serializes limit, offset, and versionId', async () => {
  let interceptedUrl = '';
  let interceptedHeaders: Record<string, string> = {};
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    interceptedUrl = url.toString();
    interceptedHeaders = (init?.headers || {}) as Record<string, string>;
    return new Response(JSON.stringify({ requests: [], total: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_pagination_test',
    });

    await client.fetchFeatureRequests({
      userToken: 'usr_tok_page',
      limit: 25,
      offset: 50,
      versionId: 'v2.0',
      query: 'bluetooth',
    });

    const parsed = new URL(interceptedUrl);
    assert.equal(parsed.pathname, '/api/v1/feature-requests');
    assert.equal(parsed.searchParams.get('appKey'), 'app_pagination_test');
    assert.equal(parsed.searchParams.get('userToken'), null);
    assert.equal(interceptedHeaders['X-User-Token'], 'usr_tok_page');
    assert.equal(parsed.searchParams.get('limit'), '25');
    assert.equal(parsed.searchParams.get('offset'), '50');
    assert.equal(parsed.searchParams.get('versionId'), 'v2.0');
    assert.equal(parsed.searchParams.get('q'), 'bluetooth');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// Regression coverage for #59: an absent or empty token must never be
// serialized as `userToken=undefined` / `userToken=` or sent as a header.
// ---------------------------------------------------------------------------

async function captureFeatureRequestsRequest(
  options: Parameters<FeedbackClient['fetchFeatureRequests']>[0],
  config: { tokenTransport?: 'query' | 'header' | 'both' } = {}
): Promise<{ parsed: URL; headers: Record<string, string>; rawUrl: string }> {
  let interceptedUrl = '';
  let interceptedHeaders: Record<string, string> = {};
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    interceptedUrl = url.toString();
    interceptedHeaders = (init?.headers || {}) as Record<string, string>;
    return new Response(JSON.stringify({ requests: [], total: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_token_serialization_test',
      ...config,
    });
    await client.fetchFeatureRequests(options);
    return { parsed: new URL(interceptedUrl), headers: interceptedHeaders, rawUrl: interceptedUrl };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('fetchFeatureRequests omits an absent or empty userToken from query and header', async () => {
  const cases: Array<{ label: string; userToken: string | undefined }> = [
    { label: 'key present with undefined', userToken: undefined },
    { label: 'empty string', userToken: '' },
  ];

  for (const tokenTransport of ['query', 'both'] as const) {
    for (const testCase of cases) {
      const { parsed, headers } = await captureFeatureRequestsRequest(
        { userToken: testCase.userToken, tokenTransport },
        { tokenTransport }
      );

      assert.equal(
        parsed.searchParams.has('userToken'),
        false,
        `${tokenTransport}/${testCase.label}: no userToken query param`
      );
      assert.equal(
        parsed.searchParams.get('userToken'),
        null,
        `${tokenTransport}/${testCase.label}: param is absent`
      );
      assert.equal(
        headers['X-User-Token'],
        undefined,
        `${tokenTransport}/${testCase.label}: no X-User-Token header`
      );
      assert.equal(parsed.searchParams.get('appKey'), 'app_token_serialization_test');
    }
  }
});

test('fetchFeatureRequests omits the token when the option key is missing entirely', async () => {
  const { parsed, headers } = await captureFeatureRequestsRequest({ limit: 10 });

  assert.equal(parsed.searchParams.has('userToken'), false);
  assert.equal(parsed.searchParams.get('limit'), '10');
  assert.equal(parsed.searchParams.get('offset'), '0');
  assert.equal(headers['X-User-Token'], undefined);
});

test('fetchFeatureRequests percent-encodes a real token on the query transport', async () => {
  const token = 'tok en&x';
  const { parsed, headers, rawUrl } = await captureFeatureRequestsRequest(
    { userToken: token, tokenTransport: 'query' },
    { tokenTransport: 'query' }
  );

  assert.equal(
    rawUrl.includes('userToken=tok+en%26x'),
    true,
    'raw URL uses form-urlencoded escaping (+ for space, %26 for &)'
  );
  assert.equal(rawUrl.includes('userToken=tok en&x'), false, 'raw token is never written verbatim');
  assert.equal(parsed.searchParams.get('userToken'), token);
  assert.equal(
    headers['X-User-Token'],
    undefined,
    'query transport keeps the token out of headers'
  );
});

test('fetchFeatureRequests sends a real token in both places on the both transport', async () => {
  const { parsed, headers } = await captureFeatureRequestsRequest(
    { userToken: 'usr_tok_both', tokenTransport: 'both' },
    { tokenTransport: 'both' }
  );

  assert.equal(parsed.searchParams.get('userToken'), 'usr_tok_both');
  assert.equal(headers['X-User-Token'], 'usr_tok_both');
});

test('fetchFeatureRequests keeps q and versionId filters on an anonymous read', async () => {
  const { parsed } = await captureFeatureRequestsRequest(
    { query: 'a b', versionId: 'v1', tokenTransport: 'query' },
    { tokenTransport: 'query' }
  );

  assert.equal(parsed.searchParams.has('userToken'), false);
  assert.equal(parsed.searchParams.get('q'), 'a b');
  assert.equal(parsed.searchParams.get('versionId'), 'v1');
});

// ---------------------------------------------------------------------------
// Mocked backend returning >50 items with pagination
// ---------------------------------------------------------------------------

test('Mocked backend with 120 items paginates properly across multiple pages', async () => {
  const TOTAL_ITEMS = 120;
  const allItems: FeatureRequestItem[] = Array.from({ length: TOTAL_ITEMS }, (_, i) =>
    makeMockItem(`fr_${i + 1}`, i + 1)
  );

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    const parsed = new URL(url.toString());
    const limit = parseInt(parsed.searchParams.get('limit') || '50', 10);
    const offset = parseInt(parsed.searchParams.get('offset') || '0', 10);

    const pageSlice = allItems.slice(offset, offset + limit);
    return new Response(
      JSON.stringify({
        requests: pageSlice,
        total: TOTAL_ITEMS,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_test',
    });

    // Page 0 (items 0..49)
    const page0 = await client.fetchFeatureRequests({ userToken: 'u1', limit: 50, offset: 0 });
    assert.equal(page0.requests.length, 50);
    assert.equal(page0.total, 120);
    assert.equal(page0.requests[0].id, 'fr_1');
    assert.equal(page0.requests[49].id, 'fr_50');

    // Page 1 (items 50..99)
    const page1 = await client.fetchFeatureRequests({ userToken: 'u1', limit: 50, offset: 50 });
    assert.equal(page1.requests.length, 50);
    assert.equal(page1.total, 120);
    assert.equal(page1.requests[0].id, 'fr_51');
    assert.equal(page1.requests[49].id, 'fr_100');

    // Page 2 (items 100..119)
    const page2 = await client.fetchFeatureRequests({ userToken: 'u1', limit: 50, offset: 100 });
    assert.equal(page2.requests.length, 20);
    assert.equal(page2.total, 120);
    assert.equal(page2.requests[0].id, 'fr_101');
    assert.equal(page2.requests[19].id, 'fr_120');

    // Page 3 (past end)
    const page3 = await client.fetchFeatureRequests({ userToken: 'u1', limit: 50, offset: 120 });
    assert.equal(page3.requests.length, 0);
    assert.equal(page3.total, 120);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// useFeatureRequests hook lifecycle & infinite scrolling
// ---------------------------------------------------------------------------

test('useFeatureRequests loads initial page, appends via loadMore, and detects hasMore accurately', async () => {
  const TOTAL_ITEMS = 120;
  const allItems: FeatureRequestItem[] = Array.from({ length: TOTAL_ITEMS }, (_, i) =>
    makeMockItem(`fr_${i + 1}`, i + 1)
  );

  const mockClient = {
    fetchFeatureRequests: async (opts: any) => {
      const limit = opts.limit ?? 50;
      const offset = opts.offset ?? 0;
      return {
        requests: allItems.slice(offset, offset + limit),
        total: TOTAL_ITEMS,
      };
    },
  } as unknown as FeedbackClient;

  const harness = renderTestHook(() =>
    useFeatureRequests({
      client: mockClient,
      userToken: 'test_token',
      pageSize: 50,
    })
  );

  // Initial load completes
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(harness.result.isLoading, false);
  assert.equal(harness.result.items.length, 50);
  assert.equal(harness.result.total, 120);
  assert.equal(harness.result.hasMore, true);
  assert.equal(harness.result.items[0].id, 'fr_1');
  assert.equal(harness.result.items[49].id, 'fr_50');

  // Load page 2 (items 50..99)
  await harness.result.loadMore();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(harness.result.items.length, 100);
  assert.equal(harness.result.total, 120);
  assert.equal(harness.result.hasMore, true);
  assert.equal(harness.result.items[50].id, 'fr_51');
  assert.equal(harness.result.items[99].id, 'fr_100');

  // Load page 3 (items 100..119)
  await harness.result.loadMore();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(harness.result.items.length, 120);
  assert.equal(harness.result.total, 120);
  assert.equal(harness.result.hasMore, false, 'hasMore must be false when all items are loaded');

  // Attempting loadMore when hasMore is false is a no-op
  await harness.result.loadMore();
  assert.equal(harness.result.items.length, 120);
});

test('useFeatureRequests deduplicates items if server returns overlapping IDs', async () => {
  const mockClient = {
    fetchFeatureRequests: async (opts: any) => {
      if (opts.offset === 0) {
        return {
          requests: [makeMockItem('fr_1', 1), makeMockItem('fr_2', 2)],
          total: 3,
        };
      } else {
        // Overlap: server returns fr_2 again plus fr_3
        return {
          requests: [makeMockItem('fr_2', 2), makeMockItem('fr_3', 3)],
          total: 3,
        };
      }
    },
  } as unknown as FeedbackClient;

  const harness = renderTestHook(() =>
    useFeatureRequests({
      client: mockClient,
      userToken: 'test_token',
      pageSize: 2,
    })
  );

  await new Promise((r) => setTimeout(r, 20));
  assert.equal(harness.result.items.length, 2);

  await harness.result.loadMore();
  await new Promise((r) => setTimeout(r, 20));
  // Must deduplicate fr_2, so items has [fr_1, fr_2, fr_3]
  assert.equal(harness.result.items.length, 3);
  assert.deepEqual(
    harness.result.items.map((i) => i.id),
    ['fr_1', 'fr_2', 'fr_3']
  );
  assert.equal(harness.result.hasMore, false);
});

test('useFeatureRequests pull-to-refresh restarts from page 0', async () => {
  const mockClient = {
    fetchFeatureRequests: async (opts: any) => {
      const offset = opts.offset ?? 0;
      return {
        requests: [makeMockItem(`fr_${offset + 1}`, offset + 1)],
        total: 100,
      };
    },
  } as unknown as FeedbackClient;

  const harness = renderTestHook(() =>
    useFeatureRequests({
      client: mockClient,
      userToken: 'test_token',
      pageSize: 1,
    })
  );

  await new Promise((r) => setTimeout(r, 20));
  assert.equal(harness.result.items.length, 1);
  assert.equal(harness.result.items[0].id, 'fr_1');

  // Load more -> 2 items
  await harness.result.loadMore();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(harness.result.items.length, 2);
  assert.equal(harness.result.items[1].id, 'fr_2');

  // Pull-to-refresh
  await harness.result.refresh();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(harness.result.items.length, 1);
  assert.equal(harness.result.items[0].id, 'fr_1');
  assert.equal(harness.result.isRefreshing, false);
});

test('useFeatureRequests loadMore recovers after refresh aborts an in-flight load-more', async () => {
  let releaseHangingPage:
    ((value: { requests: FeatureRequestItem[]; total: number }) => void) | null = null;
  let hangArmed = true;
  const mockClient = {
    fetchFeatureRequests: (opts: any) => {
      const offset = opts.offset ?? 0;
      if (offset === 1 && hangArmed) {
        // Hang only the first load-more request until the test releases it,
        // so refresh() aborts it while still in flight.
        hangArmed = false;
        return new Promise<{ requests: FeatureRequestItem[]; total: number }>((resolve) => {
          releaseHangingPage = resolve;
        });
      }
      return Promise.resolve({
        requests: [makeMockItem(`fr_${offset + 1}`, offset + 1)],
        total: 3,
      });
    },
  } as unknown as FeedbackClient;

  const harness = renderTestHook(() =>
    useFeatureRequests({
      client: mockClient,
      userToken: 'test_token',
      pageSize: 1,
    })
  );

  await new Promise((r) => setTimeout(r, 20));
  assert.equal(harness.result.items.length, 1);

  // Start a load-more that hangs, then pull-to-refresh while it is in flight.
  const pendingLoadMore = harness.result.loadMore();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(harness.result.isLoadingMore, true);

  await harness.result.refresh();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(harness.result.isRefreshing, false);

  releaseHangingPage!({ requests: [makeMockItem('fr_2', 2)], total: 3 });
  await pendingLoadMore;
  await new Promise((r) => setTimeout(r, 20));

  // The aborted request must have cleared the loading-more guard.
  assert.equal(harness.result.isLoadingMore, false);

  // Infinite scroll must still work after the aborted request.
  await harness.result.loadMore();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(harness.result.items.length, 2);
  assert.equal(harness.result.items[1].id, 'fr_2');
});

test('useFeatureRequests clamps total to loaded items when a short page arrives', async () => {
  // Server reports total 4 but only 3 retrievable items (drift, e.g. an item
  // deleted between page fetches). The last page is short (1 < pageSize 2),
  // so `total` must clamp to 3 or hasMore stays true forever and every
  // scroll-end refetches an empty page.
  const mockClient = {
    fetchFeatureRequests: async (opts: any) => {
      const offset = opts.offset ?? 0;
      if (offset === 0) {
        return {
          requests: [makeMockItem('fr_1', 1), makeMockItem('fr_2', 2)],
          total: 4,
        };
      }
      return {
        requests: [makeMockItem('fr_3', 3)],
        total: 4,
      };
    },
  } as unknown as FeedbackClient;

  const harness = renderTestHook(() =>
    useFeatureRequests({
      client: mockClient,
      userToken: 'test_token',
      pageSize: 2,
    })
  );

  await new Promise((r) => setTimeout(r, 20));
  assert.equal(harness.result.items.length, 2);
  assert.equal(harness.result.total, 4);

  await harness.result.loadMore();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(harness.result.items.length, 3);
  assert.equal(harness.result.total, 3, 'total must clamp down to the number of loaded items');
  assert.equal(harness.result.hasMore, false);
});

// ---------------------------------------------------------------------------
// Regression coverage for #159: offset pagination must track consumed server
// windows (not the deduped display length) and must not read drift overlap
// as end-of-data.
// ---------------------------------------------------------------------------

test('useFeatureRequests: an overlapped short page must not clamp total or disable load-more (#159)', async () => {
  const offsetsSeen: number[] = [];
  const mockClient = {
    fetchFeatureRequests: async (opts: any) => {
      const offset = opts.offset ?? 0;
      offsetsSeen.push(offset);
      if (offset === 0) {
        return {
          requests: [1, 2, 3, 4].map((n) => makeMockItem(`fr_${n}`, n)),
          total: 7,
        };
      }
      if (offset === 4) {
        // Drift: rows fr_3/fr_4 slid up into this window (e.g. new rows
        // sorted ahead), so the offset-4 page re-reads two already-displayed
        // rows and lands short (3 < pageSize 4) before the true end. That is
        // drift evidence, not exhaustion — total must stay 7.
        return {
          requests: [makeMockItem('fr_3', 3), makeMockItem('fr_4', 4), makeMockItem('fr_5', 5)],
          total: 7,
        };
      }
      return { requests: [makeMockItem('fr_6', 6), makeMockItem('fr_7', 7)], total: 7 };
    },
  } as unknown as FeedbackClient;

  const harness = renderTestHook(() =>
    useFeatureRequests({
      client: mockClient,
      userToken: 'test_token',
      pageSize: 4,
    })
  );

  await new Promise((r) => setTimeout(r, 20));
  assert.equal(harness.result.items.length, 4);
  assert.equal(harness.result.total, 7);

  await harness.result.loadMore();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(harness.result.items.length, 5, 'only the fresh row appends');
  assert.equal(
    harness.result.total,
    7,
    'an overlapped short page is drift, not exhaustion — total must not clamp'
  );
  assert.equal(
    harness.result.hasMore,
    true,
    'load-more must stay available while the server still holds unseen rows'
  );

  // The next request must continue from the second consumed window (2 × 4),
  // not the deduped display length (5).
  await harness.result.loadMore();
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(offsetsSeen, [0, 4, 8], 'offset must advance by consumed windows');
  assert.equal(harness.result.items.length, 7);
  assert.equal(harness.result.total, 7, 'clean short page still clamps, to the true total');
  assert.equal(harness.result.hasMore, false);
  assert.deepEqual(
    harness.result.items.map((i) => i.id),
    ['fr_1', 'fr_2', 'fr_3', 'fr_4', 'fr_5', 'fr_6', 'fr_7'],
    'every row is reachable through scrolling'
  );
});

test('useFeatureRequests: deletion drift cannot stall load-more before the true end (#159)', async () => {
  let serverRows = ['fr_0', 'fr_1', 'fr_2', 'fr_3', 'fr_4', 'fr_5', 'fr_6', 'fr_7', 'fr_8'];
  // Rows vanish from the not-yet-paginated tail between page fetches (the
  // deletions only touch positions at or after the next offset, so no live
  // row slides up into an already-consumed window). The shrinking totals
  // must never strand the affordance before every live row is displayed.
  const deletionSchedule: string[][] = [['fr_4'], ['fr_7']];
  const offsetsSeen: number[] = [];
  const mockClient = {
    fetchFeatureRequests: async (opts: any) => {
      const offset = opts.offset ?? 0;
      offsetsSeen.push(offset);
      if (offset > 0 && deletionSchedule.length > 0) {
        const gone = new Set(deletionSchedule.shift());
        serverRows = serverRows.filter((id) => !gone.has(id));
      }
      return {
        requests: serverRows.slice(offset, offset + 3).map((id, i) => makeMockItem(id, i)),
        total: serverRows.length,
      };
    },
  } as unknown as FeedbackClient;

  const harness = renderTestHook(() =>
    useFeatureRequests({
      client: mockClient,
      userToken: 'test_token',
      pageSize: 3,
    })
  );

  await new Promise((r) => setTimeout(r, 20));
  assert.equal(harness.result.items.length, 3);
  assert.equal(harness.result.hasMore, true);

  await harness.result.loadMore();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(harness.result.hasMore, true, 'the load-more affordance must stay alive mid-drift');

  // The clean short page at the drifted end is the real end-of-data: it
  // clamps, every still-live row is on screen, and load-more retires exactly
  // there.
  await harness.result.loadMore();
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(offsetsSeen, [0, 3, 6], 'offset must advance by consumed windows');
  const displayed = new Set(harness.result.items.map((i) => i.id));
  for (const id of serverRows) {
    assert.ok(displayed.has(id), `live row ${id} must be reachable through scrolling`);
  }
  assert.equal(harness.result.hasMore, false, 'load-more retires only at the true end');

  // The retired affordance must not fire another request.
  await harness.result.loadMore();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(offsetsSeen.length, 3, 'no refetch once the drifted end is reached');
});

test('useFeatureRequests: pagination offset tracks consumed windows, not the deduped display length (#159)', async () => {
  const offsetsSeen: number[] = [];
  const mockClient = {
    fetchFeatureRequests: async (opts: any) => {
      const offset = opts.offset ?? 0;
      offsetsSeen.push(offset);
      if (offset === 0) {
        return {
          requests: [makeMockItem('fr_a1', 1), makeMockItem('fr_a2', 2), makeMockItem('fr_a3', 3)],
          total: 6,
        };
      }
      if (offset === 3) {
        // A full page (3 === pageSize) whose head re-reads displayed rows:
        // the display list grows by one, but a whole window was consumed.
        return {
          requests: [makeMockItem('fr_a2', 2), makeMockItem('fr_a3', 3), makeMockItem('fr_a4', 4)],
          total: 6,
        };
      }
      return { requests: [makeMockItem('fr_a5', 5), makeMockItem('fr_a6', 6)], total: 6 };
    },
  } as unknown as FeedbackClient;

  const harness = renderTestHook(() =>
    useFeatureRequests({
      client: mockClient,
      userToken: 'test_token',
      pageSize: 3,
    })
  );

  await new Promise((r) => setTimeout(r, 20));
  assert.equal(harness.result.items.length, 3);

  await harness.result.loadMore();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(harness.result.items.length, 4, 'only the fresh row appends to the display');

  // The next request must skip past both consumed windows (offset 6), not
  // rewind to the deduped display length (4) and re-read fr_a4.
  await harness.result.loadMore();
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(
    offsetsSeen,
    [0, 3, 6],
    'offset must be pages consumed × pageSize, never the deduped length'
  );
  assert.equal(harness.result.items.length, 6);
  assert.equal(harness.result.total, 6);
  assert.equal(harness.result.hasMore, false);
});

// ---------------------------------------------------------------------------
// Keyset cursor pagination (#170)
// ---------------------------------------------------------------------------

test('useFeatureRequests: a cursor-carrying page-0 switches loadMore to the cursor walk (#170)', async () => {
  const requestsSeen: Array<Record<string, any>> = [];
  const mockClient = {
    fetchFeatureRequests: async (opts: any) => {
      requestsSeen.push({ ...opts });
      if (!opts.cursor) {
        return {
          requests: [makeMockItem('fr_c1', 1), makeMockItem('fr_c2', 2)],
          total: 4,
          hasMore: true,
          nextCursor: 'cur_page2',
        };
      }
      if (opts.cursor === 'cur_page2') {
        return {
          requests: [makeMockItem('fr_c3', 3), makeMockItem('fr_c4', 4)],
          total: 4,
          hasMore: false,
          nextCursor: null,
        };
      }
      return { requests: [], total: 4, hasMore: false, nextCursor: null };
    },
  } as unknown as FeedbackClient;

  const harness = renderTestHook(() =>
    useFeatureRequests({
      client: mockClient,
      userToken: 'test_token',
      pageSize: 2,
    })
  );

  await new Promise((r) => setTimeout(r, 20));
  assert.equal(harness.result.items.length, 2);
  // The server's exact hasMore is exposed, not the items.length < total
  // heuristic (2 === total/2 is coincidental here).
  assert.equal(harness.result.hasMore, true);

  await harness.result.loadMore();
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(
    harness.result.items.map((i) => i.id),
    ['fr_c1', 'fr_c2', 'fr_c3', 'fr_c4']
  );
  assert.equal(harness.result.hasMore, false, 'server hasMore=false ends the walk');

  const page1 = requestsSeen[1];
  assert.equal(page1.cursor, 'cur_page2', 'loadMore must send the served cursor');
  assert.ok(
    page1.offset === undefined || page1.offset === 0,
    'a cursor request must not carry a meaningful offset'
  );

  // The walk is exhausted: further loadMore calls are no-ops.
  await harness.result.loadMore();
  assert.equal(requestsSeen.length, 2, 'no fetch happens once the server reports hasMore=false');
});

test('useFeatureRequests: cursor walk never skips ids over a mutating sort (#170)', async () => {
  // A mutable "sort" the offset path cannot handle: between page fetches a
  // new row slides into the head of the list, shifting every window. A keyset
  // cursor pins the position, so no row is skipped or repeated.
  const board: FeatureRequestItem[] = [
    makeMockItem('fr_x1', 1),
    makeMockItem('fr_x2', 2),
    makeMockItem('fr_x3', 3),
    makeMockItem('fr_x4', 4),
    makeMockItem('fr_x5', 5),
  ];
  const pagesServed: string[][] = [];
  const mockClient = {
    fetchFeatureRequests: async (opts: any) => {
      if (!opts.cursor) {
        const page = board.slice(0, 2);
        pagesServed.push(page.map((i) => i.id));
        return {
          requests: page,
          total: board.length,
          hasMore: true,
          nextCursor: 'after:fr_x2',
        };
      }
      if (opts.cursor === 'after:fr_x2') {
        // A new approval slides into the consumed head region mid-walk.
        board.unshift(makeMockItem('fr_x0', 0));
        const index = board.findIndex((i) => i.id === 'fr_x2');
        const page = board.slice(index + 1, index + 3);
        pagesServed.push(page.map((i) => i.id));
        return {
          requests: page,
          total: board.length,
          hasMore: true,
          nextCursor: 'after:fr_x4',
        };
      }
      const index = board.findIndex((i) => i.id === 'fr_x4');
      const page = board.slice(index + 1, index + 3);
      pagesServed.push(page.map((i) => i.id));
      return {
        requests: page,
        total: board.length,
        hasMore: false,
        nextCursor: null,
      };
    },
  } as unknown as FeedbackClient;

  const harness = renderTestHook(() =>
    useFeatureRequests({
      client: mockClient,
      userToken: 'test_token',
      pageSize: 2,
    })
  );

  await new Promise((r) => setTimeout(r, 20));
  await harness.result.loadMore();
  await new Promise((r) => setTimeout(r, 20));
  await harness.result.loadMore();
  await new Promise((r) => setTimeout(r, 20));

  // Every row that existed when the walk started is served exactly once: no
  // duplicates and no skips, even though the mid-walk insertion shifted every
  // offset window. (fr_x0 itself slid into the *consumed* head region, so it
  // only appears after a refresh — that is keyset semantics, not a skip of
  // anything the walk had ahead of it.)
  assert.deepEqual(
    harness.result.items.map((i) => i.id),
    ['fr_x1', 'fr_x2', 'fr_x3', 'fr_x4', 'fr_x5'],
    'every pre-existing row is served exactly once despite the mid-walk insertion'
  );
  assert.deepEqual(pagesServed, [['fr_x1', 'fr_x2'], ['fr_x3', 'fr_x4'], ['fr_x5']]);
  assert.equal(harness.result.hasMore, false);
});

test('useFeatureRequests: a refresh rewinding the cursor discards an in-flight stale page (#170)', async () => {
  let releaseCursorPage: ((value: any) => void) | null = null;
  const mockClient = {
    fetchFeatureRequests: (opts: any) => {
      if (!opts.cursor) {
        // Page 0: served immediately, twice (initial load + refresh).
        return Promise.resolve({
          requests: [makeMockItem('fr_s1', 1)],
          total: 3,
          hasMore: true,
          nextCursor: 'cur_v2',
        });
      }
      // The in-flight cursor page: hangs until the test releases it.
      return new Promise((resolve) => {
        releaseCursorPage = () =>
          resolve({
            requests: [makeMockItem('fr_stale', 99)],
            total: 3,
            hasMore: false,
            nextCursor: null,
          });
      });
    },
  } as unknown as FeedbackClient;

  const harness = renderTestHook(() =>
    useFeatureRequests({
      client: mockClient,
      userToken: 'test_token',
      pageSize: 1,
    })
  );

  await new Promise((r) => setTimeout(r, 20));
  assert.equal(harness.result.items.length, 1);

  // Start a cursor loadMore (it hangs), then refresh. The refresh rewinds
  // nextCursorRef to the fresh page-0 cursor while the loadMore is on the
  // wire, and aborts its controller — the stale response must not splice in.
  const loadMorePromise = harness.result.loadMore();
  await harness.result.refresh();
  await new Promise((r) => setTimeout(r, 20));
  releaseCursorPage!({
    requests: [makeMockItem('fr_stale', 99)],
    total: 3,
    hasMore: false,
    nextCursor: null,
  });
  await loadMorePromise;
  await new Promise((r) => setTimeout(r, 20));

  assert.deepEqual(
    harness.result.items.map((i) => i.id),
    ['fr_s1'],
    'the stale cursor page must be discarded, not appended'
  );
  assert.equal(harness.result.loadMoreError, null);
});

test('useFeatureRequests: a legacy response without cursor metadata keeps offset pagination (#170)', async () => {
  const requestsSeen: Array<Record<string, any>> = [];
  const allItems = Array.from({ length: 5 }, (_, i) => makeMockItem(`fr_l${i + 1}`, i + 1));
  const mockClient = {
    fetchFeatureRequests: async (opts: any) => {
      requestsSeen.push({ ...opts });
      const offset = opts.offset ?? 0;
      return {
        requests: allItems.slice(offset, offset + (opts.limit ?? 50)),
        total: 5,
      };
    },
  } as unknown as FeedbackClient;

  const harness = renderTestHook(() =>
    useFeatureRequests({
      client: mockClient,
      userToken: 'test_token',
      pageSize: 2,
    })
  );

  await new Promise((r) => setTimeout(r, 20));
  assert.equal(harness.result.items.length, 2);
  assert.equal(harness.result.hasMore, true, 'legacy heuristic drives hasMore');

  await harness.result.loadMore();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(harness.result.items.length, 4);
  assert.equal(requestsSeen[1].offset, 2, 'the offset window bookkeeping stays in charge');
  assert.equal(requestsSeen[1].cursor, undefined, 'no cursor is sent against a legacy server');

  await harness.result.loadMore();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(harness.result.items.length, 5);
  assert.equal(harness.result.hasMore, false);
  assert.equal(harness.result.loadMoreError, null);
});

test('FeedbackClient.fetchFeatureRequests serializes cursor and omits offset for a cursor request', async () => {
  const intercepted: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    intercepted.push(url.toString());
    return new Response(
      JSON.stringify({ requests: [], total: 0, hasMore: false, nextCursor: null }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_cursor_test',
    });

    // A cursor request serializes the cursor and no offset parameter.
    await client.fetchFeatureRequests({ limit: 25, cursor: 'cur_abc', offset: 50 });
    let parsed = new URL(intercepted[0]);
    assert.equal(parsed.searchParams.get('cursor'), 'cur_abc');
    assert.equal(
      parsed.searchParams.get('offset'),
      null,
      'a cursor request must never carry an offset'
    );

    // An offset request never carries a cursor parameter.
    await client.fetchFeatureRequests({ limit: 25, offset: 50 });
    parsed = new URL(intercepted[1]);
    assert.equal(parsed.searchParams.get('cursor'), null);
    assert.equal(parsed.searchParams.get('offset'), '50');

    // Default (no cursor, no offset) still serializes offset=0.
    await client.fetchFeatureRequests({ limit: 10 });
    parsed = new URL(intercepted[2]);
    assert.equal(parsed.searchParams.get('cursor'), null);
    assert.equal(parsed.searchParams.get('offset'), '0');

    // Cursor metadata passes through to the caller untouched.
    const page = await client.fetchFeatureRequests({ cursor: 'cur_abc' });
    assert.equal(page.hasMore, false);
    assert.equal(page.nextCursor, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('useFeatureRequests: an exhausted cursor walk never falls back to an offset request (#170)', async () => {
  const requestsSeen: Array<Record<string, any>> = [];
  const mockClient = {
    fetchFeatureRequests: async (opts: any) => {
      requestsSeen.push({ ...opts });
      if (!opts.cursor) {
        return {
          requests: [makeMockItem('fr_e1', 1), makeMockItem('fr_e2', 2)],
          total: 10, // drifted high: more than the 4 rows the walk ever serves
          hasMore: true,
          nextCursor: 'cur_e2',
        };
      }
      // Terminal cursor page: hasMore=false with nextCursor=null.
      return {
        requests: [makeMockItem('fr_e3', 3), makeMockItem('fr_e4', 4)],
        total: 10,
        hasMore: false,
        nextCursor: null,
      };
    },
  } as unknown as FeedbackClient;

  const harness = renderTestHook(() =>
    useFeatureRequests({
      client: mockClient,
      userToken: 'test_token',
      pageSize: 2,
    })
  );

  await new Promise((r) => setTimeout(r, 20));
  await harness.result.loadMore();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(harness.result.items.length, 4);
  // items (4) < total (10): the offset heuristic would let this through and
  // re-read a stale window; cursor mode must refuse.
  assert.equal(harness.result.hasMore, false);

  await harness.result.loadMore();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(
    requestsSeen.length,
    2,
    'an exhausted cursor walk must not fire a stale offset request'
  );
});

test('useFeatureRequests: a terminal single-page cursor response stays in cursor mode (#170)', async () => {
  const requestsSeen: Array<Record<string, any>> = [];
  const mockClient = {
    fetchFeatureRequests: async (opts: any) => {
      requestsSeen.push({ ...opts });
      return {
        requests: [makeMockItem('fr_t1', 1)],
        total: 5,
        hasMore: false,
        nextCursor: null,
      };
    },
  } as unknown as FeedbackClient;

  const harness = renderTestHook(() =>
    useFeatureRequests({
      client: mockClient,
      userToken: 'test_token',
      pageSize: 2,
    })
  );

  await new Promise((r) => setTimeout(r, 20));
  assert.equal(harness.result.items.length, 1);
  assert.equal(harness.result.hasMore, false, 'the server-reported hasMore=false wins');

  await harness.result.loadMore();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(
    requestsSeen.length,
    1,
    'a terminal cursor page-0 must not hand pagination back to the offset window'
  );
});

test('useFeatureRequests: a non-advancing cursor ends the walk instead of looping (#170)', async () => {
  const requestsSeen: Array<Record<string, any>> = [];
  const mockClient = {
    fetchFeatureRequests: async (opts: any) => {
      requestsSeen.push({ ...opts });
      if (!opts.cursor) {
        return {
          requests: [makeMockItem('fr_n1', 1)],
          total: 4,
          hasMore: true,
          nextCursor: 'cur_stuck',
        };
      }
      // Misbehaving server: reports more pages but hands back the SAME cursor
      // it was given, so the walk could never advance.
      return {
        requests: [makeMockItem('fr_n2', 2), makeMockItem('fr_n3', 3)],
        total: 4,
        hasMore: true,
        nextCursor: 'cur_stuck',
      };
    },
  } as unknown as FeedbackClient;

  const harness = renderTestHook(() =>
    useFeatureRequests({
      client: mockClient,
      userToken: 'test_token',
      pageSize: 2,
    })
  );

  await new Promise((r) => setTimeout(r, 20));
  await harness.result.loadMore();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(harness.result.items.length, 3, 'the duplicate page still appends its fresh rows');
  assert.equal(
    harness.result.hasMore,
    false,
    'a stalled cursor must end pagination instead of keeping hasMore true'
  );

  // Further loadMore calls must not re-request the stuck page.
  await harness.result.loadMore();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(requestsSeen.length, 2, 'the walk stops instead of looping on the same cursor');
});

test('useFeatureRequests applyItemChange transforms specific item without refetching', async () => {
  const mockClient = {
    fetchFeatureRequests: async () => ({
      requests: [makeMockItem('fr_vote', 1, { voteCount: 10, hasVoted: false })],
      total: 1,
    }),
  } as unknown as FeedbackClient;

  const harness = renderTestHook(() =>
    useFeatureRequests({
      client: mockClient,
      userToken: 'test_token',
    })
  );

  await new Promise((r) => setTimeout(r, 20));
  assert.equal(harness.result.items[0].hasVoted, false);
  assert.equal(harness.result.items[0].voteCount, 10);

  harness.result.applyItemChange('fr_vote', (item) => ({
    ...item,
    hasVoted: true,
    voteCount: 11,
  }));

  assert.equal(harness.result.items[0].hasVoted, true);
  assert.equal(harness.result.items[0].voteCount, 11);
});

// ---------------------------------------------------------------------------
// Issue #140: loadMore must not paginate a new query/filter at the previous
// list's offset while that list is still on screen (deferred page-0 window)
// ---------------------------------------------------------------------------

test('useFeatureRequests: loadMore is a no-op during the deferred page-0 window of a new query (#140)', async () => {
  const requestsMade: Array<{ q: string; offset: number }> = [];
  const buildSet = (prefix: string) =>
    Array.from({ length: 120 }, (_, i) => makeMockItem(`${prefix}_${i + 1}`, i + 1));
  const datasets: Record<string, FeatureRequestItem[]> = {
    alpha: buildSet('alpha'),
    beta: buildSet('beta'),
  };

  const mockClient = {
    fetchFeatureRequests: async (opts: any) => {
      const q = opts.query || 'alpha';
      const offset = opts.offset ?? 0;
      requestsMade.push({ q, offset });
      const set = datasets[q] || datasets.alpha;
      return { requests: set.slice(offset, offset + (opts.limit ?? 50)), total: 120 };
    },
  } as unknown as FeedbackClient;

  let query = 'alpha';
  const harness = renderTestHook(() =>
    useFeatureRequests({
      client: mockClient,
      userToken: 'test_token',
      query,
      pageSize: 50,
      // A long debounce keeps the deferral window open well past runner jitter.
      debounceMs: 250,
      searchRateLimiterOptions: { minSpacingMs: 0 },
    })
  );

  // Two pages of alpha are on screen (the initial search defers behind the
  // same debounce window).
  await new Promise((r) => setTimeout(r, 350));
  await harness.result.loadMore();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(harness.result.items.length, 100);
  assert.ok(harness.result.items.every((i) => i.id.startsWith('alpha_')));

  // Switch to beta: page-0 defers behind the debounce window while the hook
  // reports fully idle.
  query = 'beta';
  harness.rerender();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(harness.result.isLoading, false, 'the deferred page-0 has not started yet');
  assert.equal(harness.result.isLoadingMore, false);

  // onEndReached fires inside the window: must be a no-op.
  await harness.result.loadMore();
  assert.deepEqual(
    requestsMade.map((r) => `${r.q}@${r.offset}`),
    ['alpha@0', 'alpha@50'],
    'loadMore must not fetch the new query at the old list offset'
  );
  assert.equal(harness.result.items.length, 100);
  assert.ok(harness.result.items.every((i) => i.id.startsWith('alpha_')));
  assert.equal(harness.result.loadMoreError, null);

  // The deferred page-0 lands: the list is replaced by beta page-0, and
  // loadMore paginates the fresh list at its own offset.
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(
    requestsMade.map((r) => `${r.q}@${r.offset}`),
    ['alpha@0', 'alpha@50', 'beta@0']
  );
  assert.equal(harness.result.items.length, 50);
  assert.ok(harness.result.items.every((i) => i.id.startsWith('beta_')));

  await harness.result.loadMore();
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(requestsMade[3], { q: 'beta', offset: 50 });
  assert.equal(harness.result.items.length, 100);
  assert.ok(harness.result.items.every((i) => i.id.startsWith('beta_')));
});

test('useFeatureRequests: an in-flight loadMore of the old query is discarded when the new page-0 lands (#140)', async () => {
  let releaseHangingPage:
    ((value: { requests: FeatureRequestItem[]; total: number }) => void) | null = null;
  let hangArmed = true;
  const alphaSet = Array.from({ length: 120 }, (_, i) => makeMockItem(`alpha_${i + 1}`, i + 1));
  const betaSet = Array.from({ length: 120 }, (_, i) => makeMockItem(`beta_${i + 1}`, i + 1));

  const mockClient = {
    fetchFeatureRequests: (opts: any) => {
      const q = opts.query || 'alpha';
      const offset = opts.offset ?? 0;
      if (q === 'beta') {
        return Promise.resolve({
          requests: betaSet.slice(offset, offset + (opts.limit ?? 50)),
          total: 120,
        });
      }
      if (offset === 50 && hangArmed) {
        hangArmed = false;
        return new Promise<{ requests: FeatureRequestItem[]; total: number }>((resolve) => {
          releaseHangingPage = resolve;
        });
      }
      return Promise.resolve({
        requests: alphaSet.slice(offset, offset + (opts.limit ?? 50)),
        total: 120,
      });
    },
  } as unknown as FeedbackClient;

  let query = 'alpha';
  const harness = renderTestHook(() =>
    useFeatureRequests({
      client: mockClient,
      userToken: 'test_token',
      query,
      pageSize: 50,
      debounceMs: 250,
      searchRateLimiterOptions: { minSpacingMs: 0 },
    })
  );

  await new Promise((r) => setTimeout(r, 350));
  assert.equal(harness.result.items.length, 50);

  // Page 2 of alpha hangs in flight while the user switches to beta.
  const pendingLoadMore = harness.result.loadMore();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(harness.result.isLoadingMore, true);

  query = 'beta';
  harness.rerender();

  // The deferred beta page-0 lands while alpha's page-2 is still hanging.
  await new Promise((r) => setTimeout(r, 350));
  assert.deepEqual(
    harness.result.items.map((i) => i.id),
    betaSet.slice(0, 50).map((i) => i.id)
  );

  releaseHangingPage!({ requests: alphaSet.slice(50, 100), total: 120 });
  await pendingLoadMore;
  await new Promise((r) => setTimeout(r, 20));

  // The late alpha response must not splice into beta's fresh list —
  // otherwise beta_51..100 would be permanently skipped.
  assert.ok(
    harness.result.items.every((i) => i.id.startsWith('beta_')),
    'a stale load-more response must never splice into the new query list'
  );
  assert.equal(harness.result.loadMoreError, null);

  // Infinite scroll recovers from the fresh list's true offset.
  await harness.result.loadMore();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(harness.result.items.length, 100);
  assert.ok(harness.result.items.every((i) => i.id.startsWith('beta_')));
});

test('useFeatureRequests: loadMore does not paginate a new versionId at the previous filter offset (#140)', async () => {
  const requestsMade: Array<{ v: string; offset: number }> = [];
  const buildSet = (v: string) =>
    Array.from({ length: 120 }, (_, i) => makeMockItem(`${v}_item_${i + 1}`, i + 1));
  const datasets: Record<string, FeatureRequestItem[]> = {
    v1: buildSet('v1'),
    v2: buildSet('v2'),
  };

  const mockClient = {
    fetchFeatureRequests: async (opts: any) => {
      const v = opts.versionId || 'v1';
      const offset = opts.offset ?? 0;
      requestsMade.push({ v, offset });
      const set = datasets[v] || datasets.v1;
      return { requests: set.slice(offset, offset + (opts.limit ?? 50)), total: 120 };
    },
  } as unknown as FeedbackClient;

  let versionId: string | null = 'v1';
  const harness = renderTestHook(() =>
    useFeatureRequests({
      client: mockClient,
      userToken: 'test_token',
      versionId,
      pageSize: 50,
    })
  );

  await new Promise((r) => setTimeout(r, 40));
  await harness.result.loadMore();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(harness.result.items.length, 100);
  assert.ok(harness.result.items.every((i) => i.id.startsWith('v1_')));

  // Chip change to v2: a non-search page-0 defers only behind setTimeout(0),
  // but a loadMore fired inside that same tick must still be refused.
  versionId = 'v2';
  harness.rerender();
  await harness.result.loadMore();
  assert.deepEqual(
    requestsMade.map((r) => `${r.v}@${r.offset}`),
    ['v1@0', 'v1@50'],
    'loadMore must not fetch the new filter at the old list offset'
  );

  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(requestsMade[2], { v: 'v2', offset: 0 });
  assert.equal(harness.result.items.length, 50);

  await harness.result.loadMore();
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(requestsMade[3], { v: 'v2', offset: 50 });
  assert.equal(harness.result.items.length, 100);
  assert.ok(harness.result.items.every((i) => i.id.startsWith('v2_')));
});

test('useFeatureRequests: returning to the previously loaded query re-arms loadMore on the on-screen list', async () => {
  const requestsMade: Array<{ q: string; offset: number }> = [];
  const buildSet = (prefix: string) =>
    Array.from({ length: 120 }, (_, i) => makeMockItem(`${prefix}_${i + 1}`, i + 1));
  const datasets: Record<string, FeatureRequestItem[]> = {
    alpha: buildSet('alpha'),
    beta: buildSet('beta'),
  };

  const mockClient = {
    fetchFeatureRequests: async (opts: any) => {
      const q = opts.query || 'alpha';
      const offset = opts.offset ?? 0;
      requestsMade.push({ q, offset });
      const set = datasets[q] || datasets.alpha;
      return { requests: set.slice(offset, offset + (opts.limit ?? 50)), total: 120 };
    },
  } as unknown as FeedbackClient;

  let query = 'alpha';
  const harness = renderTestHook(() =>
    useFeatureRequests({
      client: mockClient,
      userToken: 'test_token',
      query,
      pageSize: 50,
      debounceMs: 250,
      searchRateLimiterOptions: { minSpacingMs: 0 },
    })
  );

  await new Promise((r) => setTimeout(r, 350));
  await harness.result.loadMore();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(harness.result.items.length, 100);

  // alpha -> beta schedules a deferred page-0 (generation advances), then the
  // user returns to alpha before it fires. The dedupe branch keeps the
  // on-screen alpha list and must re-publish the current generation, or
  // loadMore would stay blocked forever with nothing scheduled to unblock it.
  query = 'beta';
  harness.rerender();
  query = 'alpha';
  harness.rerender();
  await new Promise((r) => setTimeout(r, 350));

  await harness.result.loadMore();
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(
    requestsMade.map((r) => `${r.q}@${r.offset}`),
    ['alpha@0', 'alpha@50', 'alpha@100'],
    'loadMore paginates the still-current alpha list; beta must never fetch'
  );
  assert.equal(harness.result.items.length, 120);
  assert.ok(harness.result.items.every((i) => i.id.startsWith('alpha_')));
});

// ---------------------------------------------------------------------------
// i18n: All 14 locales implement loadingMore and roadmap pagination strings
// ---------------------------------------------------------------------------

test('all 14 locales define non-empty loadingMore in common, featureRequests, and roadmap', () => {
  const locales = [
    { code: 'en', strings: enStrings },
    { code: 'zhHans', strings: zhHansStrings },
    { code: 'zhHant', strings: zhHantStrings },
    { code: 'ja', strings: jaStrings },
    { code: 'ko', strings: koStrings },
    { code: 'de', strings: deStrings },
    { code: 'es', strings: esStrings },
    { code: 'fr', strings: frStrings },
    { code: 'it', strings: itStrings },
    { code: 'pt', strings: ptStrings },
    { code: 'pl', strings: plStrings },
    { code: 'no', strings: noStrings },
    { code: 'tr', strings: trStrings },
    { code: 'vi', strings: viStrings },
  ];

  for (const { code, strings } of locales) {
    assert.ok(
      typeof strings.common.loadingMore === 'string' && strings.common.loadingMore.length > 0,
      `locale ${code} must define common.loadingMore`
    );
    assert.ok(
      typeof strings.featureRequests.loadingMore === 'string' &&
        strings.featureRequests.loadingMore.length > 0,
      `locale ${code} must define featureRequests.loadingMore`
    );
    assert.ok(
      typeof strings.roadmap.loadingMore === 'string' && strings.roadmap.loadingMore.length > 0,
      `locale ${code} must define roadmap.loadingMore`
    );
    assert.ok(
      typeof strings.roadmap.loadMore === 'string' && strings.roadmap.loadMore.length > 0,
      `locale ${code} must define roadmap.loadMore`
    );
    assert.ok(
      typeof strings.roadmap.showingCount === 'function',
      `locale ${code} must define roadmap.showingCount function`
    );
    const formatted = strings.roadmap.showingCount(25, 100);
    assert.ok(
      typeof formatted === 'string' && formatted.includes('25') && formatted.includes('100'),
      `locale ${code} showingCount must format shown and total`
    );
  }
});

// ---------------------------------------------------------------------------
// Issue #31: Search debounce isLoading decoupling & stale results preservation
// ---------------------------------------------------------------------------

test('useFeatureRequests: debounce window stays quiet and keeps prior results mounted', async () => {
  let fetchCalls = 0;
  const mockClient = {
    fetchFeatureRequests: async () => {
      fetchCalls++;
      return {
        requests: [makeMockItem('fr_init', 1)],
        total: 1,
      };
    },
  } as unknown as FeedbackClient;

  let query = '';
  const harness = renderTestHook(() =>
    useFeatureRequests({
      client: mockClient,
      userToken: 'test_token',
      query,
      debounceMs: 40,
      searchRateLimiterOptions: { minSpacingMs: 0 },
    })
  );

  // Initial load completes
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(fetchCalls, 1);
  assert.equal(harness.result.isLoading, false);
  assert.equal(harness.result.items.length, 1);
  assert.equal(harness.result.items[0].id, 'fr_init');

  // Change query (keystroke)
  query = 'search term';
  harness.rerender();

  // Immediately before debounceMs elapses (at t = 10ms < 40ms):
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(
    harness.result.isLoading,
    false,
    'isLoading must remain false during the debounce window'
  );
  assert.equal(
    harness.result.items.length,
    1,
    'items must remain cached during the debounce window'
  );
  assert.equal(harness.result.items[0].id, 'fr_init');
  assert.equal(fetchCalls, 1, 'no fetch call should have been dispatched yet');

  // After debounceMs elapses (at t = 60ms > 40ms):
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(fetchCalls, 2, 'fetch call must be dispatched once debounce elapses');
  assert.equal(harness.result.isLoading, false);
});

test('useFeatureRequests: isLoading flips true only when request is dispatched, then false on resolve', async () => {
  let resolveSecondFetch!: (val: any) => void;
  let fetchCalls = 0;

  const mockClient = {
    fetchFeatureRequests: async () => {
      fetchCalls++;
      if (fetchCalls === 1) {
        return {
          requests: [makeMockItem('fr_1', 1)],
          total: 1,
        };
      }
      return new Promise((resolve) => {
        resolveSecondFetch = resolve;
      });
    },
  } as unknown as FeedbackClient;

  let query = '';
  const harness = renderTestHook(() =>
    useFeatureRequests({
      client: mockClient,
      userToken: 'test_token',
      query,
      debounceMs: 20,
      searchRateLimiterOptions: { minSpacingMs: 0 },
    })
  );

  await new Promise((r) => setTimeout(r, 30));
  assert.equal(harness.result.isLoading, false);
  assert.equal(harness.result.items[0].id, 'fr_1');

  // Trigger search
  query = 'widget';
  harness.rerender();

  // Before debounce (at 5ms < 20ms)
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(harness.result.isLoading, false);
  assert.equal(fetchCalls, 1);

  // After debounce (at 30ms > 20ms): dispatch has occurred
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(fetchCalls, 2);
  assert.equal(harness.result.isLoading, true, 'isLoading must be true while request is in flight');
  assert.equal(harness.result.items[0].id, 'fr_1', 'prior items stay mounted while in flight');

  // Resolve the second fetch
  resolveSecondFetch({
    requests: [makeMockItem('fr_search_result', 2)],
    total: 1,
  });
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(harness.result.isLoading, false, 'isLoading must be false once request resolves');
  assert.equal(harness.result.items.length, 1);
  assert.equal(harness.result.items[0].id, 'fr_search_result');
});

test('useFeatureRequests: stale data is preserved and error is set when search fetch rejects', async () => {
  let rejectSecondFetch!: (err: any) => void;
  let fetchCalls = 0;

  const mockClient = {
    fetchFeatureRequests: async () => {
      fetchCalls++;
      if (fetchCalls === 1) {
        return {
          requests: [makeMockItem('fr_cached', 1)],
          total: 1,
        };
      }
      return new Promise((_, reject) => {
        rejectSecondFetch = reject;
      });
    },
  } as unknown as FeedbackClient;

  let query = '';
  const harness = renderTestHook(() =>
    useFeatureRequests({
      client: mockClient,
      userToken: 'test_token',
      query,
      debounceMs: 20,
      searchRateLimiterOptions: { minSpacingMs: 0 },
    })
  );

  await new Promise((r) => setTimeout(r, 30));
  assert.equal(harness.result.isLoading, false);
  assert.equal(harness.result.items[0].id, 'fr_cached');

  query = 'failing query';
  harness.rerender();

  // Wait for debounce to elapse
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(fetchCalls, 2);
  assert.equal(harness.result.isLoading, true);

  // Reject fetch
  const testError = new Error('Search network failure');
  rejectSecondFetch(testError);
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(harness.result.isLoading, false, 'isLoading must return to false after error');
  assert.equal(harness.result.items.length, 1, 'items must preserve prior results on failure');
  assert.equal(harness.result.items[0].id, 'fr_cached');
  assert.equal(harness.result.error?.message, 'Search network failure');
});

test('useFeatureRequests: regression guards for refresh() and reload() loading flags', async () => {
  let deferredPromise!: Promise<any>;
  let resolveFetch!: (val: any) => void;

  const mockClient = {
    fetchFeatureRequests: async () => {
      return deferredPromise;
    },
  } as unknown as FeedbackClient;

  deferredPromise = Promise.resolve({
    requests: [makeMockItem('fr_1', 1)],
    total: 1,
  });

  const harness = renderTestHook(() =>
    useFeatureRequests({
      client: mockClient,
      userToken: 'test_token',
    })
  );

  await new Promise((r) => setTimeout(r, 20));
  assert.equal(harness.result.isLoading, false);
  assert.equal(harness.result.isRefreshing, false);

  // refresh() flips isRefreshing and NOT isLoading
  deferredPromise = new Promise((resolve) => {
    resolveFetch = resolve;
  });
  const refreshPromise = harness.result.refresh();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(harness.result.isRefreshing, true, 'refresh() must set isRefreshing = true');
  assert.equal(harness.result.isLoading, false, 'refresh() must NOT set isLoading = true');

  resolveFetch({
    requests: [makeMockItem('fr_1', 1)],
    total: 1,
  });
  await refreshPromise;
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(harness.result.isRefreshing, false);
  assert.equal(harness.result.isLoading, false);

  // reload() flips isLoading
  deferredPromise = new Promise((resolve) => {
    resolveFetch = resolve;
  });
  const reloadPromise = harness.result.reload();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(harness.result.isLoading, true, 'reload() must set isLoading = true');
  assert.equal(harness.result.isRefreshing, false, 'reload() must NOT set isRefreshing = true');

  resolveFetch({
    requests: [makeMockItem('fr_1', 1)],
    total: 1,
  });
  await reloadPromise;
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(harness.result.isLoading, false);
  assert.equal(harness.result.isRefreshing, false);
});

// ---------------------------------------------------------------------------
// Regression coverage for #137: an aborted page-0 load must not reset the
// loading flags of the newer in-flight refresh/reload.
// ---------------------------------------------------------------------------

type DeferredPage0 = { resolve: (v: any) => void; reject: (e: any) => void };

/**
 * Mock client whose in-flight page-0 fetches reject with an `AbortError` the
 * moment their signal aborts — mirroring what a real `fetch` does. That
 * rejection microtask is what races the newer refresh()/reload() and used to
 * wipe the flags it had just raised.
 */
function makeAbortablePage0Client() {
  const pending: DeferredPage0[] = [];
  const abortError = () => Object.assign(new Error('Aborted'), { name: 'AbortError' });
  const client = {
    fetchFeatureRequests: (opts: { signal?: AbortSignal }) =>
      new Promise((resolve, reject) => {
        if (opts.signal?.aborted) {
          reject(abortError());
          return;
        }
        opts.signal?.addEventListener('abort', () => reject(abortError()), { once: true });
        pending.push({ resolve, reject });
      }),
  } as unknown as FeedbackClient;
  return {
    client,
    count: () => pending.length,
    latest: (): DeferredPage0 => pending[pending.length - 1],
  };
}

test('useFeatureRequests: refresh() over an in-flight load keeps isRefreshing raised for its whole flight (#137)', async () => {
  const { client, latest, count } = makeAbortablePage0Client();
  const harness = renderTestHook(() => useFeatureRequests({ client, userToken: 'test_token' }));

  // The initial listing is on the wire.
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(count(), 1);
  assert.equal(harness.result.isLoading, true);

  // Pull to refresh while the initial load is still in flight: refresh()
  // aborts it synchronously and raises isRefreshing before the aborted
  // load's rejection microtask gets a chance to wipe the flags.
  const refreshPromise = harness.result.refresh();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(count(), 2);
  assert.equal(
    harness.result.isRefreshing,
    true,
    'isRefreshing must stay raised for the whole refresh flight'
  );
  assert.equal(
    harness.result.isLoading,
    true,
    'isLoading must reflect the page-0 request still in flight'
  );

  latest().resolve({ requests: [makeMockItem('fr_refresh', 1)], total: 1 });
  await refreshPromise;
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(harness.result.isRefreshing, false);
  assert.equal(harness.result.isLoading, false);
  assert.equal(harness.result.items[0].id, 'fr_refresh');
});

test('useFeatureRequests: reload() over an in-flight load keeps isLoading raised until it settles (#137)', async () => {
  const { client, latest, count } = makeAbortablePage0Client();
  const harness = renderTestHook(() => useFeatureRequests({ client, userToken: 'test_token' }));

  await new Promise((r) => setTimeout(r, 10));
  assert.equal(count(), 1);
  assert.equal(harness.result.isLoading, true);

  const reloadPromise = harness.result.reload();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(count(), 2);
  assert.equal(
    harness.result.isLoading,
    true,
    'isLoading must stay raised for the whole reload flight'
  );
  assert.equal(harness.result.isRefreshing, false, 'reload() must not raise isRefreshing');

  latest().resolve({ requests: [makeMockItem('fr_reload', 1)], total: 1 });
  await reloadPromise;
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(harness.result.isLoading, false);
  assert.equal(harness.result.items[0].id, 'fr_reload');
});

test('useFeatureRequests: flags clear when the hook is disabled while a load is in flight (#137)', async () => {
  const { client } = makeAbortablePage0Client();
  let enabled = true;
  const harness = renderTestHook(() =>
    useFeatureRequests({ client, userToken: 'test_token', enabled })
  );

  await new Promise((r) => setTimeout(r, 10));
  assert.equal(harness.result.isLoading, true);

  // Disabling mid-flight aborts the in-flight load; the guarded `finally`
  // skips its reset, so the disabled branch must clear the flags instead.
  enabled = false;
  harness.rerender();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(
    harness.result.isLoading,
    false,
    'isLoading must not stick after the hook is disabled'
  );
  assert.equal(
    harness.result.isRefreshing,
    false,
    'isRefreshing must not stick after the hook is disabled'
  );

  // Re-enabling must start a fresh page-0 load.
  enabled = true;
  harness.rerender();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(harness.result.isLoading, true);
});

test('useFeatureRequests: returning to an already-loaded search key clears flags left by the aborted in-flight search (#137)', async () => {
  const { client, latest } = makeAbortablePage0Client();
  let query = '';
  const harness = renderTestHook(() =>
    useFeatureRequests({
      client,
      userToken: 'test_token',
      query,
      debounceMs: 5,
      searchRateLimiterOptions: { minSpacingMs: 0 },
    })
  );

  // Initial listing lands.
  await new Promise((r) => setTimeout(r, 15));
  latest().resolve({ requests: [makeMockItem('fr_list', 1)], total: 1 });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(harness.result.isLoading, false);
  assert.equal(harness.result.items[0].id, 'fr_list');

  // Search "dup" lands and is remembered as the loaded key.
  query = 'dup';
  harness.rerender();
  await new Promise((r) => setTimeout(r, 20));
  latest().resolve({ requests: [makeMockItem('fr_dup', 2)], total: 1 });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(harness.result.isLoading, false);
  assert.equal(harness.result.items[0].id, 'fr_dup');

  // A different query goes out and stays in flight.
  query = 'other';
  harness.rerender();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(harness.result.isLoading, true, 'the "other" search must be in flight');

  // Back to "dup": the dedupe early-return fires, the cleanup aborts the
  // in-flight "other" search, and the flags must end up clear.
  query = 'dup';
  harness.rerender();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(
    harness.result.isLoading,
    false,
    'isLoading must not stick after the dedupe early-return'
  );
  assert.equal(harness.result.isRefreshing, false);
  assert.equal(harness.result.items[0].id, 'fr_dup', 'the remembered "dup" results stay on screen');
});

test('useFeatureRequests: a query change aborting an in-flight refresh leaves no stuck isRefreshing (#137)', async () => {
  const { client, latest, count } = makeAbortablePage0Client();
  let query = '';
  const harness = renderTestHook(() =>
    useFeatureRequests({
      client,
      userToken: 'test_token',
      query,
      debounceMs: 5,
      searchRateLimiterOptions: { minSpacingMs: 0 },
    })
  );

  // Initial listing lands.
  await new Promise((r) => setTimeout(r, 15));
  latest().resolve({ requests: [makeMockItem('fr_list', 1)], total: 1 });
  await new Promise((r) => setTimeout(r, 10));

  // Pull to refresh and let it reach the wire.
  const refreshPromise = harness.result.refresh();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(count(), 2);
  assert.equal(harness.result.isRefreshing, true);

  // Change the query mid-refresh: the effect cleanup aborts the refresh and
  // schedules a new page-0 load.
  query = 'next';
  harness.rerender();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(count(), 3);
  await refreshPromise;

  // The refresh flag must be released as soon as the query change supersedes
  // the refresh — not only once the replacement settles (#137).
  assert.equal(
    harness.result.isRefreshing,
    false,
    'isRefreshing must release when the query change supersedes the refresh'
  );
  assert.equal(
    harness.result.isLoading,
    true,
    'the replacement search is on the wire and owns isLoading'
  );

  // The scheduled search settles: no flag may remain stuck.
  latest().resolve({ requests: [makeMockItem('fr_next', 2)], total: 1 });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(
    harness.result.isRefreshing,
    false,
    'isRefreshing must not remain stuck after the scheduled load settles'
  );
  assert.equal(harness.result.isLoading, false);
  assert.equal(harness.result.items[0].id, 'fr_next');
});

test('useFeatureRequests: reload() over an in-flight refresh releases isRefreshing for the whole reload (#137)', async () => {
  const { client, latest, count } = makeAbortablePage0Client();
  const harness = renderTestHook(() => useFeatureRequests({ client, userToken: 'test_token' }));

  // Initial listing lands so the hook is idle.
  await new Promise((r) => setTimeout(r, 10));
  latest().resolve({ requests: [makeMockItem('fr_list', 1)], total: 1 });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(harness.result.isLoading, false);

  // Pull to refresh and let it reach the wire.
  const refreshPromise = harness.result.refresh();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(count(), 2);
  assert.equal(harness.result.isRefreshing, true);

  // A reload (e.g. ErrorState retry) mid-refresh supersedes it with a plain
  // load: isRefreshing must drop at once instead of riding through reload().
  const reloadPromise = harness.result.reload();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(count(), 3);
  await refreshPromise;
  assert.equal(
    harness.result.isRefreshing,
    false,
    'isRefreshing must not stay raised for the superseding reload'
  );
  assert.equal(harness.result.isLoading, true, 'isLoading must reflect the reload in flight');

  latest().resolve({ requests: [makeMockItem('fr_reload', 1)], total: 1 });
  await reloadPromise;
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(harness.result.isRefreshing, false);
  assert.equal(harness.result.isLoading, false);
  assert.equal(harness.result.items[0].id, 'fr_reload');
});

test('useFeatureRequests: disabling mid-flight aborts a manual refresh still on the wire (#137)', async () => {
  const { client, latest, count } = makeAbortablePage0Client();
  let enabled = true;
  const harness = renderTestHook(() =>
    useFeatureRequests({ client, userToken: 'test_token', enabled })
  );

  // Initial listing lands so the hook is idle.
  await new Promise((r) => setTimeout(r, 10));
  latest().resolve({ requests: [makeMockItem('fr_list', 1)], total: 1 });
  await new Promise((r) => setTimeout(r, 10));

  // A manual refresh reaches the wire: its controller now replaces the one
  // the effect cleanup would abort, so only the disabled branch can stop it.
  const refreshPromise = harness.result.refresh();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(count(), 2);
  assert.equal(harness.result.isRefreshing, true);

  // Disable mid-refresh: the manual request must be aborted and its flags
  // cleared, not left in flight with the flags cleared behind it.
  enabled = false;
  harness.rerender();
  await new Promise((r) => setTimeout(r, 10));
  await refreshPromise;
  assert.equal(
    harness.result.isRefreshing,
    false,
    'isRefreshing must not stick after the hook is disabled mid-refresh'
  );
  assert.equal(
    harness.result.isLoading,
    false,
    'isLoading must not stick after the hook is disabled mid-refresh'
  );

  // Re-enabling must start a fresh page-0 load.
  enabled = true;
  harness.rerender();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(harness.result.isLoading, true);
  latest().resolve({ requests: [makeMockItem('fr_back', 1)], total: 1 });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(harness.result.items[0].id, 'fr_back');
});

// ---------------------------------------------------------------------------
// Issue #166: a manual refresh()/reload() that lands while a deferred page-0
// is pending must neutralize the stale timer — no duplicate fetch, no
// isLoading flash, no aborted in-flight loadMore. A manual load skipped by
// the limiter publishes nothing and must still let the deferred query run
// (#130/#132).
// ---------------------------------------------------------------------------

test('useFeatureRequests: a manual refresh that landed during the deferral stops the stale deferred page-0 (#166)', async () => {
  const requestsMade: Array<{ q?: string; offset: number }> = [];
  const alphaSet = Array.from({ length: 120 }, (_, i) => makeMockItem(`alpha_${i + 1}`, i + 1));

  const mockClient = {
    fetchFeatureRequests: async (opts: any) => {
      const offset = opts.offset ?? 0;
      requestsMade.push({ q: opts.query, offset });
      return {
        requests: alphaSet.slice(offset, offset + (opts.limit ?? 50)),
        total: 120,
      };
    },
  } as unknown as FeedbackClient;

  const query = 'alpha';
  // Record every committed render's isLoading: `harness.result` keeps only
  // the latest render, and a transient flash can set and clear the flag
  // between two wall-clock samples.
  const renderedLoadingStates: boolean[] = [];
  const harness = renderTestHook(
    () =>
      useFeatureRequests({
        client: mockClient,
        userToken: 'test_token',
        query,
        pageSize: 50,
        debounceMs: 250,
        searchRateLimiterOptions: { minSpacingMs: 0 },
      }),
    (result) => renderedLoadingStates.push(result.isLoading)
  );

  // The initial load defers behind the debounce window (isLoading starts
  // raised for the pending initial load; the wire is still untouched).
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(requestsMade, [], 'the deferred page-0 has not reached the wire yet');

  // Pull-to-refresh lands inside the deferral window and publishes the query.
  await harness.result.refresh();
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(requestsMade, [{ q: 'alpha', offset: 0 }]);
  assert.equal(harness.result.isLoading, false);
  assert.equal(harness.result.items.length, 50);

  // From here on, no render may ever raise isLoading again — sample across
  // the stale timer's fire boundary: it must be a silent no-op.
  renderedLoadingStates.length = 0;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.deepEqual(
    requestsMade,
    [{ q: 'alpha', offset: 0 }],
    'the stale deferred page-0 must not re-fetch the already-loaded query'
  );
  assert.equal(
    renderedLoadingStates.includes(true),
    false,
    'isLoading must stay down across the stale timer fire'
  );
  assert.equal(harness.result.items.length, 50);
  assert.ok(harness.result.items.every((i) => i.id.startsWith('alpha_')));
});

test('useFeatureRequests: a limiter-skipped refresh during the deferral must not drop the typed query (#166, #130/#132)', async () => {
  const requestsMade: Array<{ q?: string; offset: number }> = [];
  const datasets: Record<string, FeatureRequestItem[]> = {
    alpha: Array.from({ length: 120 }, (_, i) => makeMockItem(`alpha_${i + 1}`, i + 1)),
    beta: Array.from({ length: 120 }, (_, i) => makeMockItem(`beta_${i + 1}`, i + 1)),
  };

  const mockClient = {
    fetchFeatureRequests: async (opts: any) => {
      const q = opts.query || 'alpha';
      const offset = opts.offset ?? 0;
      requestsMade.push({ q, offset });
      const set = datasets[q];
      return { requests: set.slice(offset, offset + (opts.limit ?? 50)), total: 120 };
    },
  } as unknown as FeedbackClient;

  let query = 'alpha';
  const harness = renderTestHook(() =>
    useFeatureRequests({
      client: mockClient,
      userToken: 'test_token',
      query,
      pageSize: 50,
      debounceMs: 100,
      searchRateLimiterOptions: { minSpacingMs: 250 },
    })
  );

  // Alpha's deferred page-0 lands and consumes the search spacing.
  await new Promise((r) => setTimeout(r, 250));
  assert.deepEqual(requestsMade, [{ q: 'alpha', offset: 0 }]);

  // Typing beta defers the new query behind debounce + remaining spacing.
  query = 'beta';
  harness.rerender();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(harness.result.isLoading, false);

  // A refresh fired inside the spacing window is skipped by the limiter: it
  // makes no fetch and publishes no generation.
  await harness.result.refresh();
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(
    requestsMade,
    [{ q: 'alpha', offset: 0 }],
    'the limiter-skipped refresh must not reach the wire'
  );
  assert.equal(harness.result.isLoading, false, 'a skipped refresh must not stick the flag');

  // The deferred beta page-0 must still fire once the spacing elapses.
  await new Promise((r) => setTimeout(r, 450));
  assert.deepEqual(
    requestsMade,
    [
      { q: 'alpha', offset: 0 },
      { q: 'beta', offset: 0 },
    ],
    'the typed query must not be dropped by the limiter-skipped refresh'
  );
  assert.equal(harness.result.items.length, 50);
  assert.ok(harness.result.items.every((i) => i.id.startsWith('beta_')));
  assert.equal(harness.result.isLoading, false);
});

test('useFeatureRequests: the stale deferred timer must not abort an in-flight loadMore (#166)', async () => {
  const requestsMade: Array<{ q?: string; offset: number }> = [];
  const alphaSet = Array.from({ length: 120 }, (_, i) => makeMockItem(`alpha_${i + 1}`, i + 1));
  let releaseHangingPage:
    ((value: { requests: FeatureRequestItem[]; total: number }) => void) | null = null;

  const mockClient = {
    fetchFeatureRequests: (opts: any) => {
      const offset = opts.offset ?? 0;
      requestsMade.push({ q: opts.query, offset });
      if (offset === 50) {
        return new Promise<{ requests: FeatureRequestItem[]; total: number }>((resolve, reject) => {
          releaseHangingPage = resolve;
          opts.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError'))
          );
        });
      }
      return Promise.resolve({
        requests: alphaSet.slice(offset, offset + (opts.limit ?? 50)),
        total: 120,
      });
    },
  } as unknown as FeedbackClient;

  const query = 'alpha';
  const harness = renderTestHook(() =>
    useFeatureRequests({
      client: mockClient,
      userToken: 'test_token',
      query,
      pageSize: 50,
      debounceMs: 250,
      searchRateLimiterOptions: { minSpacingMs: 0 },
    })
  );

  // The refresh lands inside the deferral window; the deferred timer stays
  // pending past it.
  await new Promise((r) => setTimeout(r, 50));
  await harness.result.refresh();
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(requestsMade, [{ q: 'alpha', offset: 0 }]);

  // The user's scroll starts page-2; it hangs in flight when the stale timer
  // fires.
  const pendingLoadMore = harness.result.loadMore();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(harness.result.isLoadingMore, true);

  // The stale timer fires mid-flight and must not touch the page-2 request.
  await new Promise((r) => setTimeout(r, 350));
  assert.deepEqual(
    requestsMade,
    [
      { q: 'alpha', offset: 0 },
      { q: 'alpha', offset: 50 },
    ],
    'the stale timer must not start a duplicate page-0'
  );
  assert.equal(
    harness.result.isLoadingMore,
    true,
    'the in-flight loadMore must not be aborted by the stale timer'
  );

  // The page-2 response completes undisturbed and appends to the list.
  releaseHangingPage!({ requests: alphaSet.slice(50, 100), total: 120 });
  await pendingLoadMore;
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(harness.result.isLoadingMore, false);
  assert.equal(harness.result.items.length, 100);
  assert.ok(harness.result.items.every((i) => i.id.startsWith('alpha_')));
  assert.equal(harness.result.loadMoreError, null);
});

test('useFeatureRequests: the deferred page-0 still fires exactly once with no manual load (#166)', async () => {
  const requestsMade: Array<{ q?: string; offset: number }> = [];
  const alphaSet = Array.from({ length: 120 }, (_, i) => makeMockItem(`alpha_${i + 1}`, i + 1));

  const mockClient = {
    fetchFeatureRequests: async (opts: any) => {
      const offset = opts.offset ?? 0;
      requestsMade.push({ q: opts.query, offset });
      return {
        requests: alphaSet.slice(offset, offset + (opts.limit ?? 50)),
        total: 120,
      };
    },
  } as unknown as FeedbackClient;

  const query = 'alpha';
  const harness = renderTestHook(() =>
    useFeatureRequests({
      client: mockClient,
      userToken: 'test_token',
      query,
      pageSize: 50,
      debounceMs: 100,
      searchRateLimiterOptions: { minSpacingMs: 0 },
    })
  );

  // No manual load interferes: the deferred page-0 fires once and publishes.
  await new Promise((r) => setTimeout(r, 250));
  assert.deepEqual(requestsMade, [{ q: 'alpha', offset: 0 }]);
  assert.equal(harness.result.isLoading, false);
  assert.equal(harness.result.items.length, 50);

  // Well past the timer: nothing else may re-fire for the same query.
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(
    requestsMade,
    [{ q: 'alpha', offset: 0 }],
    'the deferred load must fire exactly once'
  );
  assert.equal(harness.result.isLoading, false);
});
