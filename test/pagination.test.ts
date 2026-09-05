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

function makeMockItem(id: string, index: number, overrides?: Partial<FeatureRequestItem>): FeatureRequestItem {
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
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    interceptedUrl = url.toString();
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
    assert.equal(parsed.searchParams.get('userToken'), 'usr_tok_page');
    assert.equal(parsed.searchParams.get('limit'), '25');
    assert.equal(parsed.searchParams.get('offset'), '50');
    assert.equal(parsed.searchParams.get('versionId'), 'v2.0');
    assert.equal(parsed.searchParams.get('q'), 'bluetooth');
  } finally {
    globalThis.fetch = originalFetch;
  }
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
          requests: [
            makeMockItem('fr_1', 1),
            makeMockItem('fr_2', 2),
          ],
          total: 3,
        };
      } else {
        // Overlap: server returns fr_2 again plus fr_3
        return {
          requests: [
            makeMockItem('fr_2', 2),
            makeMockItem('fr_3', 3),
          ],
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
  assert.deepEqual(harness.result.items.map((i) => i.id), ['fr_1', 'fr_2', 'fr_3']);
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
  let releaseHangingPage: ((value: { requests: FeatureRequestItem[]; total: number }) => void) | null =
    null;
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
      typeof strings.featureRequests.loadingMore === 'string' && strings.featureRequests.loadingMore.length > 0,
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
