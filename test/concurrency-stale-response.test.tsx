import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { FeedbackClient } from '../src/client/FeedbackClient';
import { useFeatureRequests, type UseFeatureRequestsResult } from '../src/hooks/useFeatureRequests';
import { useToggleVote } from '../src/hooks/useToggleVote';
import { useAsyncData, type UseAsyncDataResult } from '../src/hooks/useAsyncData';
import type { FeatureRequestComment, FeatureRequestItem, VoteResult } from '../src/types';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/** Let pending timers, microtasks, and act-batched state updates settle. */
async function flush(times = 8, sleepMs = 4): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, sleepMs));
    await act(async () => {});
  }
}

function createDeferred<T>() {
  let resolve!: (val: T) => void;
  let reject!: (err: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function HookProbeFeatureRequests({
  options,
  latest,
}: {
  options: any;
  latest: { current: UseFeatureRequestsResult | null };
}) {
  latest.current = useFeatureRequests(options);
  return null;
}

function HookProbeAsyncData<T>({
  fetcher,
  options,
  latest,
}: {
  fetcher: (signal: AbortSignal) => Promise<T>;
  options?: any;
  latest: { current: UseAsyncDataResult<T> | null };
}) {
  latest.current = useAsyncData<T>(fetcher, options);
  return null;
}

test('useFeatureRequests: vote applied during in-flight page-0 refresh is preserved when stale response lands', async () => {
  let callCount = 0;
  let deferred: ReturnType<typeof createDeferred<any>> | null = null;

  const mockClient = {
    fetchFeatureRequests: async () => {
      callCount += 1;
      if (callCount === 1) {
        // Initial load
        return {
          requests: [
            {
              id: 'fr_1',
              title: 'Support Apple Watch',
              description: 'Watch app',
              voteCount: 0,
              hasVoted: false,
              isOwnRequest: false,
            },
          ],
          total: 1,
        };
      }
      // Subsequent refresh returns deferred
      deferred = createDeferred<any>();
      return deferred.promise;
    },
  } as unknown as FeedbackClient;

  const latest = { current: null as ReturnType<typeof useFeatureRequests> | null };
  const renderer = TestRenderer.create(
    <HookProbeFeatureRequests
      options={{
        client: mockClient,
        userToken: 'test-token',
        searchRateLimiterOptions: { minSpacingMs: 0 },
      }}
      latest={latest}
    />
  );

  await flush();
  assert.equal(latest.current!.items.length, 1);
  assert.equal(latest.current!.items[0].id, 'fr_1');
  assert.equal(latest.current!.items[0].hasVoted, false);
  assert.equal(latest.current!.items[0].voteCount, 0);

  // Trigger refresh
  act(() => {
    void latest.current!.refresh();
  });
  await flush();
  assert.ok(latest.current!.isRefreshing);

  // While fetch is in flight, user taps vote
  act(() => {
    latest.current!.applyItemChange('fr_1', (item: FeatureRequestItem) => ({
      ...item,
      hasVoted: true,
      voteCount: item.voteCount + 1,
    }));
  });
  await flush();
  assert.equal(latest.current!.items[0].hasVoted, true);
  assert.equal(latest.current!.items[0].voteCount, 1);

  // Stale server response lands with older snapshot (hasVoted: false, voteCount: 0)
  act(() => {
    deferred!.resolve({
      requests: [
        {
          id: 'fr_1',
          title: 'Support Apple Watch',
          description: 'Watch app',
          voteCount: 0,
          hasVoted: false,
          isOwnRequest: false,
        },
      ],
      total: 1,
    });
  });
  await flush();

  // Optimistic vote must still be preserved
  assert.equal(latest.current!.isRefreshing, false);
  assert.equal(latest.current!.items[0].hasVoted, true);
  assert.equal(latest.current!.items[0].voteCount, 1);

  renderer.unmount();
});

test('useFeatureRequests: subsequent refresh adopting server truth clears pending mutation', async () => {
  let callCount = 0;

  const mockClient = {
    fetchFeatureRequests: async () => {
      callCount += 1;
      if (callCount === 1) {
        return {
          requests: [
            {
              id: 'fr_1',
              title: 'Test',
              description: '',
              voteCount: 0,
              hasVoted: false,
              isOwnRequest: false,
            },
          ],
          total: 1,
        };
      }
      if (callCount === 2) {
        // Stale response
        return {
          requests: [
            {
              id: 'fr_1',
              title: 'Test',
              description: '',
              voteCount: 0,
              hasVoted: false,
              isOwnRequest: false,
            },
          ],
          total: 1,
        };
      }
      // Third call: server processed vote and returns fresh snapshot
      return {
        requests: [
          {
            id: 'fr_1',
            title: 'Test (server updated)',
            description: '',
            voteCount: 1,
            hasVoted: true,
            isOwnRequest: false,
          },
        ],
        total: 1,
      };
    },
  } as unknown as FeedbackClient;

  const latest = { current: null as ReturnType<typeof useFeatureRequests> | null };
  const renderer = TestRenderer.create(
    <HookProbeFeatureRequests
      options={{
        client: mockClient,
        userToken: 'test-token',
        searchRateLimiterOptions: { minSpacingMs: 0 },
      }}
      latest={latest}
    />
  );

  await flush();

  // Apply vote mid-refresh
  act(() => {
    void latest.current!.refresh();
    latest.current!.applyItemChange('fr_1', (item: FeatureRequestItem) => ({
      ...item,
      hasVoted: true,
      voteCount: 1,
    }));
  });
  await flush();
  assert.equal(latest.current!.items[0].hasVoted, true);

  // Another refresh lands with server confirming hasVoted: true
  act(() => {
    void latest.current!.refresh();
  });
  await flush();
  assert.equal(latest.current!.items[0].title, 'Test (server updated)');
  assert.equal(latest.current!.items[0].hasVoted, true);
  assert.equal(latest.current!.items[0].voteCount, 1);

  renderer.unmount();
});

test('useFeatureRequests: plain refresh with no local mutations replaces items exactly', async () => {
  let callCount = 0;

  const mockClient = {
    fetchFeatureRequests: async () => {
      callCount += 1;
      if (callCount === 1) {
        return {
          requests: [
            {
              id: 'fr_old',
              title: 'Old item',
              description: '',
              voteCount: 0,
              hasVoted: false,
              isOwnRequest: false,
            },
          ],
          total: 1,
        };
      }
      return {
        requests: [
          {
            id: 'fr_new',
            title: 'New item',
            description: '',
            voteCount: 10,
            hasVoted: false,
            isOwnRequest: false,
          },
        ],
        total: 1,
      };
    },
  } as unknown as FeedbackClient;

  const latest = { current: null as ReturnType<typeof useFeatureRequests> | null };
  const renderer = TestRenderer.create(
    <HookProbeFeatureRequests
      options={{
        client: mockClient,
        userToken: 'test-token',
        searchRateLimiterOptions: { minSpacingMs: 0 },
      }}
      latest={latest}
    />
  );

  await flush();
  assert.equal(latest.current!.items[0].id, 'fr_old');

  act(() => {
    void latest.current!.refresh();
  });
  await flush();
  assert.equal(latest.current!.items.length, 1);
  assert.equal(latest.current!.items[0].id, 'fr_new');

  renderer.unmount();
});

test('useFeatureRequests: vote applied during in-flight loadMore is preserved', async () => {
  let callCount = 0;
  let deferredMore: ReturnType<typeof createDeferred<any>> | null = null;

  const mockClient = {
    fetchFeatureRequests: async ({ offset }: { offset: number }) => {
      callCount += 1;
      if (offset === 0) {
        return {
          requests: [
            {
              id: 'fr_page1',
              title: 'Page 1 item',
              description: '',
              voteCount: 5,
              hasVoted: false,
              isOwnRequest: false,
            },
          ],
          total: 2,
        };
      }
      deferredMore = createDeferred<any>();
      return deferredMore.promise;
    },
  } as unknown as FeedbackClient;

  const latest = { current: null as ReturnType<typeof useFeatureRequests> | null };
  const renderer = TestRenderer.create(
    <HookProbeFeatureRequests
      options={{
        client: mockClient,
        userToken: 'test-token',
        pageSize: 1,
        searchRateLimiterOptions: { minSpacingMs: 0 },
      }}
      latest={latest}
    />
  );

  await flush();
  assert.equal(latest.current!.items.length, 1);
  assert.equal(latest.current!.hasMore, true);

  // Trigger loadMore
  act(() => {
    void latest.current!.loadMore();
  });
  await flush();
  assert.ok(latest.current!.isLoadingMore);

  // While loadMore is in flight, user votes on page 1 item
  act(() => {
    latest.current!.applyItemChange('fr_page1', (item: FeatureRequestItem) => ({
      ...item,
      hasVoted: true,
      voteCount: item.voteCount + 1,
    }));
  });
  await flush();
  assert.equal(latest.current!.items[0].hasVoted, true);
  assert.equal(latest.current!.items[0].voteCount, 6);

  // Resolve loadMore with page 2
  act(() => {
    deferredMore!.resolve({
      requests: [
        {
          id: 'fr_page2',
          title: 'Page 2 item',
          description: '',
          voteCount: 2,
          hasVoted: false,
          isOwnRequest: false,
        },
      ],
      total: 2,
    });
  });
  await flush();

  assert.equal(latest.current!.isLoadingMore, false);
  assert.equal(latest.current!.items.length, 2);
  // Page 1 vote is preserved
  assert.equal(latest.current!.items[0].id, 'fr_page1');
  assert.equal(latest.current!.items[0].hasVoted, true);
  assert.equal(latest.current!.items[0].voteCount, 6);
  // Page 2 item appended
  assert.equal(latest.current!.items[1].id, 'fr_page2');
  assert.equal(callCount, 2);

  renderer.unmount();
});

test('useAsyncData: mergeStale keeps locally appended comments when stale response lands', async () => {
  let callCount = 0;
  let deferred: ReturnType<typeof createDeferred<FeatureRequestComment[]>> | null = null;

  const fetcher = async (): Promise<FeatureRequestComment[]> => {
    callCount += 1;
    if (callCount === 1) {
      return [];
    }
    deferred = createDeferred<FeatureRequestComment[]>();
    return deferred.promise;
  };

  const mergeComments = (
    local: FeatureRequestComment[] | null,
    incoming: FeatureRequestComment[]
  ): FeatureRequestComment[] => {
    if (!local || local.length === 0) return incoming;
    const incomingIds = new Set(incoming.map((c) => c.id));
    const localOnly = local.filter((c) => !incomingIds.has(c.id));
    if (localOnly.length === 0) return incoming;
    return [...incoming, ...localOnly];
  };

  const latest = { current: null as UseAsyncDataResult<FeatureRequestComment[]> | null };
  const renderer = TestRenderer.create(
    <HookProbeAsyncData<FeatureRequestComment[]>
      fetcher={fetcher}
      options={{ mergeStale: mergeComments }}
      latest={latest}
    />
  );

  await flush();
  assert.equal(latest.current!.data?.length, 0);

  // Trigger reload
  act(() => {
    void latest.current!.reload();
  });
  await flush();
  assert.ok(latest.current!.isLoading);

  // User posts comment mid-flight
  const newComment: FeatureRequestComment = {
    id: 'c_new',
    featureRequestId: 'fr_1',
    body: 'Freshly posted comment',
    createdAt: new Date().toISOString(),
    authorName: 'Tester',
  };
  act(() => {
    latest.current!.setData((prev) => [...(prev ?? []), newComment]);
  });
  await flush();
  assert.equal(latest.current!.data?.length, 1);
  assert.equal(latest.current!.data?.[0].id, 'c_new');

  // Stale refetch response lands (empty list from before comment was posted)
  act(() => {
    deferred!.resolve([]);
  });
  await flush();

  // Comment must NOT be wiped
  assert.equal(latest.current!.isLoading, false);
  assert.equal(latest.current!.data?.length, 1);
  assert.equal(latest.current!.data?.[0].id, 'c_new');
  assert.equal(latest.current!.data?.[0].body, 'Freshly posted comment');

  renderer.unmount();
});

test('useAsyncData: without mergeStale skips stale write when local mutation occurred', async () => {
  let callCount = 0;
  let deferred: ReturnType<typeof createDeferred<{ count: number }>> | null = null;

  const fetcher = async () => {
    callCount += 1;
    if (callCount === 1) {
      return { count: 10 };
    }
    deferred = createDeferred<{ count: number }>();
    return deferred.promise;
  };

  const latest = { current: null as UseAsyncDataResult<{ count: number }> | null };
  const renderer = TestRenderer.create(<HookProbeAsyncData fetcher={fetcher} latest={latest} />);

  await flush();
  assert.equal(latest.current!.data?.count, 10);

  // Trigger reload
  act(() => {
    void latest.current!.reload();
  });
  await flush();

  // Local mutation mid-flight
  act(() => {
    latest.current!.setData({ count: 99 });
  });
  await flush();
  assert.equal(latest.current!.data?.count, 99);

  // Late stale response resolves with count: 10
  act(() => {
    deferred!.resolve({ count: 10 });
  });
  await flush();

  // Stale write was skipped; local mutation remains
  assert.equal(latest.current!.data?.count, 99);

  renderer.unmount();
});

test('useAsyncData: updates normally when no mid-flight mutation occurred', async () => {
  let callCount = 0;

  const fetcher = async () => {
    callCount += 1;
    return { count: callCount * 10 };
  };

  const latest = { current: null as UseAsyncDataResult<{ count: number }> | null };
  const renderer = TestRenderer.create(<HookProbeAsyncData fetcher={fetcher} latest={latest} />);

  await flush();
  assert.equal(latest.current!.data?.count, 10);

  act(() => {
    void latest.current!.reload();
  });
  await flush();
  assert.equal(latest.current!.data?.count, 20);

  renderer.unmount();
});

test('useFeatureRequests: a rollback releases the pending entry even when the row already left the list (#139)', async () => {
  // A search or filter change can pull the voted row out of `items` while its
  // vote request is still in flight. When that vote then fails, the rollback
  // must still release the stranded pending mutation — otherwise the restored
  // query resurrects the optimistic snapshot over the (correct) server row.
  let plainLoads = 0;
  const makeRow = (title: string, voteCount: number, hasVoted: boolean) => ({
    id: 'fr_rollback',
    title,
    description: 'Rollback probe',
    voteCount,
    hasVoted,
    isOwnRequest: false,
  });
  const rejected = new Error('vote rejected');

  const voteAttempt = createDeferred<VoteResult>();
  const mockClient = {
    fetchFeatureRequests: async ({ query }: { query?: string }) => {
      if (query) return { requests: [], total: 0 };
      plainLoads += 1;
      return plainLoads === 1
        ? { requests: [makeRow('Original title', 10, false)], total: 1 }
        : { requests: [makeRow('Restored title', 10, false)], total: 1 };
    },
    castVote: () => voteAttempt.promise,
  } as unknown as FeedbackClient;
  const latest: { current: any } = { current: null };

  function VoteRollbackProbe({ client, query }: { client: FeedbackClient; query: string }) {
    const requests = useFeatureRequests({
      client,
      userToken: 'tok_rollback',
      query,
      searchRateLimiterOptions: { minSpacingMs: 0 },
    });
    const vote = useToggleVote(client, 'tok_rollback', requests.applyItemChange);
    latest.current = { requests, vote };
    return null;
  }

  const renderer = TestRenderer.create(<VoteRollbackProbe client={mockClient} query="" />);

  try {
    await flush();
    assert.equal(latest.current!.requests.items.length, 1);
    assert.equal(latest.current!.requests.items[0].hasVoted, false);

    // Tap the vote: the optimistic state lands and is remembered as a pending
    // mutation while the request hangs.
    act(() => {
      latest.current!.vote.toggleVote(latest.current!.requests.items[0]);
    });
    await flush();
    assert.equal(latest.current!.requests.items[0].hasVoted, true);
    assert.equal(latest.current!.requests.items[0].voteCount, 11);

    // A search change removes the row from `items` mid-flight.
    act(() => {
      renderer.update(<VoteRollbackProbe client={mockClient} query="beta" />);
    });
    await flush();
    assert.equal(latest.current!.requests.items.length, 0);

    // The vote fails while the row is off-list: the rollback must release the
    // stranded pending entry even though the updater maps over no matching row.
    act(() => {
      voteAttempt.reject(rejected);
    });
    await flush();

    // The query is restored and the server answers with the truth — the vote
    // was never counted, and the row was edited in the meantime.
    act(() => {
      renderer.update(<VoteRollbackProbe client={mockClient} query="" />);
    });
    await flush();

    const row = latest.current!.requests.items[0];
    assert.ok(row, 'the restored query must bring the row back');
    assert.equal(
      row.hasVoted,
      false,
      'the failed vote must not resurrect as a phantom vote over the restored row'
    );
    assert.equal(row.voteCount, 10);
    assert.equal(
      row.title,
      'Restored title',
      'no field of the stranded pre-tap snapshot may override the restored server row'
    );
  } finally {
    renderer.unmount();
  }
});
