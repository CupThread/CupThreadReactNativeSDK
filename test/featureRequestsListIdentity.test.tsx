import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import type { FeedbackClient } from '../src/client/FeedbackClient';
import {
  useFeatureRequests,
  type UseFeatureRequestsOptions,
  type UseFeatureRequestsResult,
} from '../src/hooks/useFeatureRequests';
import type { FeatureRequestItem } from '../src/types';
// Test-runner flag React reads off the global; typed here without an `any`.
const testGlobal = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean };
testGlobal.IS_REACT_ACT_ENVIRONMENT = true;

/** Let pending timers, microtasks, and act-batched state updates settle. */
async function flush(times = 8, sleepMs = 4): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, sleepMs));
    await act(async () => {});
  }
}

interface FetchOptions {
  userToken?: string;
  versionId?: string;
  query?: string;
  limit?: number;
  offset?: number;
  cursor?: string;
  signal?: AbortSignal;
}

function makeItem(
  id: string,
  title: string,
  overrides: Partial<FeatureRequestItem> = {}
): FeatureRequestItem {
  return {
    id,
    appId: 'app_swap',
    title,
    description: `${title} description`,
    status: 'open',
    approved: true,
    voteCount: 1,
    hasVoted: false,
    isOwnRequest: false,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function HookProbe({
  options,
  latest,
}: {
  options: UseFeatureRequestsOptions;
  latest: { current: UseFeatureRequestsResult | null };
}) {
  latest.current = useFeatureRequests(options);
  return null;
}

function searchOptions(
  client: FeedbackClient,
  overrides: Partial<UseFeatureRequestsOptions> = {}
): UseFeatureRequestsOptions {
  return {
    client,
    userToken: 'tok_search',
    query: 'needle',
    pageSize: 2,
    debounceMs: 0,
    searchRateLimiterOptions: { minSpacingMs: 0 },
    ...overrides,
  };
}

test('useFeatureRequests refetches an active search under a swapped client (#458)', async () => {
  const calls: Array<{ client: string; query?: string; limit?: number }> = [];
  const clientA = {
    fetchFeatureRequests: async (opts: FetchOptions) => {
      calls.push({ client: 'A', query: opts.query, limit: opts.limit });
      return { requests: [makeItem('a1', 'A search result')], total: 1 };
    },
  } as unknown as FeedbackClient;
  const clientB = {
    fetchFeatureRequests: async (opts: FetchOptions) => {
      calls.push({ client: 'B', query: opts.query, limit: opts.limit });
      return { requests: [makeItem('b1', 'B search result')], total: 1 };
    },
  } as unknown as FeedbackClient;

  const latest: { current: UseFeatureRequestsResult | null } = { current: null };
  const renderer = TestRenderer.create(
    <HookProbe options={searchOptions(clientA)} latest={latest} />
  );
  try {
    await flush();
    assert.equal(latest.current!.items.length, 1);
    assert.equal(latest.current!.items[0].id, 'a1');
    calls.length = 0;

    act(() => {
      renderer.update(<HookProbe options={searchOptions(clientB)} latest={latest} />);
    });
    await flush();

    assert.deepEqual(
      calls.map((call) => call.client),
      ['B'],
      'the swapped client must refetch the active search instead of reusing the dedupe key'
    );
    assert.equal(calls[0].query, 'needle');
    assert.equal(latest.current!.items.length, 1);
    assert.equal(latest.current!.items[0].id, 'b1');
    assert.equal(latest.current!.total, 1);
  } finally {
    renderer.unmount();
  }
});

test('useFeatureRequests refetches an active search when pageSize changes (#458)', async () => {
  const calls: Array<{ limit?: number }> = [];
  const rows = [makeItem('p1', 'Row 1'), makeItem('p2', 'Row 2'), makeItem('p3', 'Row 3')];
  const client = {
    fetchFeatureRequests: async (opts: FetchOptions) => {
      calls.push({ limit: opts.limit });
      const limit = opts.limit ?? rows.length;
      return { requests: rows.slice(0, limit), total: rows.length };
    },
  } as unknown as FeedbackClient;

  const latest: { current: UseFeatureRequestsResult | null } = { current: null };
  const renderer = TestRenderer.create(
    <HookProbe options={searchOptions(client, { pageSize: 2 })} latest={latest} />
  );
  try {
    await flush();
    assert.equal(latest.current!.items.length, 2);
    calls.length = 0;

    act(() => {
      renderer.update(
        <HookProbe options={searchOptions(client, { pageSize: 3 })} latest={latest} />
      );
    });
    await flush();

    assert.deepEqual(
      calls.map((call) => call.limit),
      [3],
      'the new page size must reach the server instead of being suppressed by the search dedupe'
    );
    assert.equal(latest.current!.items.length, 3);
  } finally {
    renderer.unmount();
  }
});

test('useFeatureRequests clears the previous client rows and cursor when the replacement fails (#458)', async () => {
  const clientA = {
    fetchFeatureRequests: async () => ({
      requests: [makeItem('a1', 'A row')],
      total: 5,
      nextCursor: 'cursor-a',
      hasMore: true,
    }),
  } as unknown as FeedbackClient;
  const clientB = {
    fetchFeatureRequests: async () => {
      throw new Error('client B unavailable');
    },
  } as unknown as FeedbackClient;

  const latest: { current: UseFeatureRequestsResult | null } = { current: null };
  const renderer = TestRenderer.create(
    <HookProbe options={{ client: clientA, userToken: 'tok_swap', pageSize: 2 }} latest={latest} />
  );
  try {
    await flush();
    assert.equal(latest.current!.items.length, 1);
    assert.equal(latest.current!.hasMore, true);

    act(() => {
      renderer.update(
        <HookProbe
          options={{ client: clientB, userToken: 'tok_swap', pageSize: 2 }}
          latest={latest}
        />
      );
    });
    await flush();

    assert.deepEqual(
      latest.current!.items,
      [],
      'rows from the previous client must not survive a failed replacement fetch'
    );
    assert.equal(latest.current!.total, 0);
    assert.equal(
      latest.current!.hasMore,
      false,
      'the previous client cursor must not keep the load-more affordance alive'
    );
    assert.equal(latest.current!.error?.message, 'client B unavailable');
  } finally {
    renderer.unmount();
  }
});

test('useFeatureRequests drops pending and settled mutations from the previous client (#458)', async () => {
  const clientA = {
    fetchFeatureRequests: async () => ({
      requests: [
        makeItem('fr_pending', 'A pending', { hasVoted: false, voteCount: 1 }),
        makeItem('fr_settled', 'A settled', { hasVoted: false, voteCount: 1 }),
      ],
      total: 2,
    }),
  } as unknown as FeedbackClient;
  const clientB = {
    fetchFeatureRequests: async () => ({
      requests: [
        makeItem('fr_pending', 'B pending', { hasVoted: false, voteCount: 7 }),
        makeItem('fr_settled', 'B settled', { hasVoted: false, voteCount: 7 }),
      ],
      total: 2,
    }),
  } as unknown as FeedbackClient;

  const latest: { current: UseFeatureRequestsResult | null } = { current: null };
  const renderer = TestRenderer.create(
    <HookProbe options={{ client: clientA, userToken: 'tok_same', pageSize: 2 }} latest={latest} />
  );
  try {
    await flush();

    act(() => {
      latest.current!.applyItemChange(
        'fr_pending',
        (item) => ({ ...item, hasVoted: true, voteCount: 2 }),
        { userToken: 'tok_same' }
      );
      latest.current!.applyItemChange(
        'fr_settled',
        (item) => ({ ...item, hasVoted: true, voteCount: 2 }),
        { userToken: 'tok_same', isFinal: true }
      );
    });
    await flush();
    assert.equal(latest.current!.items[0].hasVoted, true);
    assert.equal(latest.current!.items[1].hasVoted, true);

    act(() => {
      renderer.update(
        <HookProbe
          options={{ client: clientB, userToken: 'tok_same', pageSize: 2 }}
          latest={latest}
        />
      );
    });
    await flush();

    const byId = new Map(latest.current!.items.map((item) => [item.id, item]));
    const pendingRow = byId.get('fr_pending')!;
    const settledRow = byId.get('fr_settled')!;
    assert.equal(pendingRow.title, 'B pending');
    assert.equal(
      pendingRow.hasVoted,
      false,
      "the previous client's optimistic vote must not overlay the new client's row"
    );
    assert.equal(pendingRow.voteCount, 7);
    assert.equal(settledRow.title, 'B settled');
    assert.equal(
      settledRow.hasVoted,
      false,
      "the previous client's settled vote must not overlay the new client's row"
    );
    assert.equal(settledRow.voteCount, 7);
  } finally {
    renderer.unmount();
  }
});

test('useFeatureRequests discards a load-more page that resolves after a client swap (#458)', async () => {
  const deferredPage = createDeferred<{ requests: FeatureRequestItem[]; total: number }>();
  const clientA = {
    fetchFeatureRequests: async (opts: FetchOptions) => {
      if ((opts.offset ?? 0) === 0) {
        return { requests: [makeItem('a1', 'A row 1'), makeItem('a2', 'A row 2')], total: 100 };
      }
      return deferredPage.promise;
    },
  } as unknown as FeedbackClient;
  const clientB = {
    fetchFeatureRequests: async () => ({
      requests: [makeItem('b1', 'B row 1'), makeItem('b2', 'B row 2')],
      total: 2,
    }),
  } as unknown as FeedbackClient;

  const latest: { current: UseFeatureRequestsResult | null } = { current: null };
  const renderer = TestRenderer.create(
    <HookProbe options={{ client: clientA, userToken: 'tok_swap', pageSize: 2 }} latest={latest} />
  );
  try {
    await flush();
    assert.deepEqual(
      latest.current!.items.map((item) => item.id),
      ['a1', 'a2']
    );

    act(() => {
      void latest.current!.loadMore();
    });
    await flush();

    act(() => {
      renderer.update(
        <HookProbe
          options={{ client: clientB, userToken: 'tok_swap', pageSize: 2 }}
          latest={latest}
        />
      );
    });
    await flush();
    assert.deepEqual(
      latest.current!.items.map((item) => item.id),
      ['b1', 'b2']
    );

    deferredPage.resolve({
      requests: [makeItem('a3', 'A row 3'), makeItem('a4', 'A row 4')],
      total: 100,
    });
    await flush();

    assert.deepEqual(
      latest.current!.items.map((item) => item.id),
      ['b1', 'b2'],
      'a late page from the previous client must not append to the new list'
    );
    assert.equal(latest.current!.total, 2);
  } finally {
    renderer.unmount();
  }
});
