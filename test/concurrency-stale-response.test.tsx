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

test('useFeatureRequests: a settled vote releases its pending entry so a later contradicting page-0 renders the server row (#184)', async () => {
  // After a vote settles, the pending mutation must be released — a page-0
  // that later answers with a contradicting `hasVoted` carries the
  // authoritative row (the identity changed, or the vote moved elsewhere) and
  // must not be overridden by a merge of the settled optimistic snapshot.
  // The query round-trip guarantees no intermediate page-0 revisits the row,
  // so the release cannot rely on a later matching fetch.
  let plainLoads = 0;
  const makeRow = (title: string, voteCount: number, hasVoted: boolean) => ({
    id: 'fr_settled',
    title,
    description: 'Settled probe',
    voteCount,
    hasVoted,
    isOwnRequest: false,
  });
  const mockClient = {
    fetchFeatureRequests: async ({ query }: { query?: string }) => {
      if (query) return { requests: [], total: 0 };
      plainLoads += 1;
      return plainLoads === 1
        ? { requests: [makeRow('Pre-tap title', 10, false)], total: 1 }
        : { requests: [makeRow('Post-settle title', 10, false)], total: 1 };
    },
    castVote: async () => ({ voted: true, voteCount: 11 }),
  } as unknown as FeedbackClient;
  const latest: { current: any } = { current: null };

  function SettledVoteProbe({ client, query }: { client: FeedbackClient; query: string }) {
    const requests = useFeatureRequests({
      client,
      userToken: 'tok_settled',
      query,
      searchRateLimiterOptions: { minSpacingMs: 0 },
    });
    const vote = useToggleVote(client, 'tok_settled', requests.applyItemChange);
    latest.current = { requests, vote };
    return null;
  }

  const renderer = TestRenderer.create(<SettledVoteProbe client={mockClient} query="" />);
  try {
    await flush();
    assert.equal(latest.current!.requests.items.length, 1);
    assert.equal(latest.current!.requests.items[0].hasVoted, false);

    // Vote and let it settle: the server-confirmed result is applied and the
    // pending mutation must be released.
    act(() => {
      latest.current!.vote.toggleVote(latest.current!.requests.items[0]);
    });
    await flush();
    assert.equal(latest.current!.requests.items[0].hasVoted, true);
    assert.equal(latest.current!.requests.items[0].voteCount, 11);

    // A query change drops the row from every intermediate page-0.
    act(() => {
      renderer.update(<SettledVoteProbe client={mockClient} query="beta" />);
    });
    await flush();
    assert.equal(latest.current!.requests.items.length, 0);

    // Back to the plain list: the server answers hasVoted: false.
    act(() => {
      renderer.update(<SettledVoteProbe client={mockClient} query="" />);
    });
    await flush();

    const row = latest.current!.requests.items[0];
    assert.ok(row, 'the plain query must bring the row back');
    assert.equal(
      row.title,
      'Post-settle title',
      'the settled optimistic snapshot must not override the server row'
    );
    assert.equal(
      row.hasVoted,
      false,
      'a page-0 after settlement must render the server vote state'
    );
    assert.equal(row.voteCount, 10);
  } finally {
    renderer.unmount();
  }
});

test('useFeatureRequests: a vote settling mid-refresh survives the stale response but defers to the next page-0 (#184)', async () => {
  // A page-0 still in flight from before a settlement cannot disprove the
  // server-confirmed result, so the settled row survives that response — but
  // the guard is one-shot: the next page-0 starts after the settlement and
  // its (contradicting) answer wins.
  let callCount = 0;
  let deferred: ReturnType<typeof createDeferred<any>> | null = null;
  const makeRow = (title: string, voteCount: number, hasVoted: boolean) => ({
    id: 'fr_race',
    title,
    description: 'Race probe',
    voteCount,
    hasVoted,
    isOwnRequest: false,
  });
  const mockClient = {
    fetchFeatureRequests: async () => {
      callCount += 1;
      if (callCount === 1) {
        return { requests: [makeRow('Initial title', 10, false)], total: 1 };
      }
      if (callCount === 2) {
        deferred = createDeferred<any>();
        return deferred.promise;
      }
      return { requests: [makeRow('Server truth', 10, false)], total: 1 };
    },
    castVote: async () => ({ voted: true, voteCount: 11 }),
  } as unknown as FeedbackClient;
  const latest: { current: any } = { current: null };

  function SettleRaceProbe({ client }: { client: FeedbackClient }) {
    const requests = useFeatureRequests({
      client,
      userToken: 'tok_race',
      searchRateLimiterOptions: { minSpacingMs: 0 },
    });
    const vote = useToggleVote(client, 'tok_race', requests.applyItemChange);
    latest.current = { requests, vote };
    return null;
  }

  const renderer = TestRenderer.create(<SettleRaceProbe client={mockClient} />);
  try {
    await flush();
    assert.equal(latest.current!.requests.items[0].hasVoted, false);

    // Start a refresh, then vote and let it settle while the refresh is in
    // flight. The refresh's response was computed before the vote.
    act(() => {
      void latest.current!.requests.refresh();
      latest.current!.vote.toggleVote(latest.current!.requests.items[0]);
    });
    await flush();
    assert.equal(latest.current!.requests.items[0].hasVoted, true);
    assert.equal(latest.current!.requests.items[0].voteCount, 11);

    // The pre-vote response lands — with a title the server edited after the
    // fetch started, newer than the settled guard's snapshot. The settled
    // vote must survive the response, but only its vote fields may overlay:
    // the response's non-vote fields stay intact.
    act(() => {
      deferred!.resolve({ requests: [makeRow('Edited title', 10, false)], total: 1 });
    });
    await flush();
    assert.equal(latest.current!.requests.items[0].hasVoted, true);
    assert.equal(latest.current!.requests.items[0].voteCount, 11);
    assert.equal(
      latest.current!.requests.items[0].title,
      'Edited title',
      'the settled guard may only bridge the vote fields, not replay its whole row snapshot'
    );

    // The next page-0 starts after the settlement: its contradicting answer
    // is authoritative and the settled snapshot must not replay.
    act(() => {
      void latest.current!.requests.refresh();
    });
    await flush();
    assert.equal(latest.current!.requests.items[0].hasVoted, false);
    assert.equal(latest.current!.requests.items[0].voteCount, 10);
    assert.equal(latest.current!.requests.items[0].title, 'Server truth');
  } finally {
    renderer.unmount();
  }
});

test('useFeatureRequests: switching identity retires pending mutations created under the previous identity (#184)', async () => {
  // A vote cast as a guest is not attributed to the account the user signs
  // into. The page-0 under the new identity must present the new identity's
  // server row — the guest-era optimistic snapshot must neither merge over
  // it nor survive the switch (previously the mismatch re-merged on every
  // page-0, pinning the pre-login row until remount).
  const makeRow = (title: string, voteCount: number, hasVoted: boolean) => ({
    id: 'fr_identity',
    title,
    description: 'Identity probe',
    voteCount,
    hasVoted,
    isOwnRequest: false,
  });
  const deferredVote = createDeferred<VoteResult>();
  const mockClient = {
    fetchFeatureRequests: async ({ userToken }: { userToken?: string }) => {
      if (userToken === 'tok_guest') {
        return { requests: [makeRow('Guest view', 10, false)], total: 1 };
      }
      return { requests: [makeRow('User view', 7, false)], total: 1 };
    },
    castVote: () => deferredVote.promise,
  } as unknown as FeedbackClient;
  const latest: { current: any } = { current: null };

  function IdentityProbe({ client, userToken }: { client: FeedbackClient; userToken: string }) {
    const requests = useFeatureRequests({
      client,
      userToken,
      searchRateLimiterOptions: { minSpacingMs: 0 },
    });
    const vote = useToggleVote(client, userToken, requests.applyItemChange);
    latest.current = { requests, vote };
    return null;
  }

  const renderer = TestRenderer.create(<IdentityProbe client={mockClient} userToken="tok_guest" />);
  try {
    await flush();
    assert.equal(latest.current!.requests.items[0].title, 'Guest view');
    assert.equal(latest.current!.requests.items[0].hasVoted, false);

    // Tap the vote as the guest; the request stays in flight.
    act(() => {
      latest.current!.vote.toggleVote(latest.current!.requests.items[0]);
    });
    await flush();
    assert.equal(latest.current!.requests.items[0].hasVoted, true);

    // The provider resolves a signed-in token and the hook reloads under the
    // new identity.
    act(() => {
      renderer.update(<IdentityProbe client={mockClient} userToken="tok_user" />);
    });
    await flush();

    const row = latest.current!.requests.items[0];
    assert.equal(
      row.title,
      'User view',
      'the guest-era snapshot must not override the signed-in server row'
    );
    assert.equal(
      row.hasVoted,
      false,
      "the guest vote must not present as the signed-in identity's vote"
    );
    assert.equal(row.voteCount, 7);

    // Settle the stranded guest vote: it was dispatched under tok_guest, so
    // its result must be dropped entirely instead of being written onto (and
    // guarded under) the signed-in identity's row.
    act(() => {
      deferredVote.resolve({ voted: true, voteCount: 11 });
    });
    await flush();
    assert.equal(
      latest.current!.requests.items[0].title,
      'User view',
      'a settlement from the previous identity must not touch the new identity rows'
    );
    assert.equal(
      latest.current!.requests.items[0].hasVoted,
      false,
      'the guest vote result must not present as the signed-in vote'
    );
    assert.equal(latest.current!.requests.items[0].voteCount, 7);
  } finally {
    renderer.unmount();
  }
});

test('useFeatureRequests: a host setItems push mid-flight survives that page-0 exactly once and defers to the next one (#186)', async () => {
  // The host pushes rows while a page-0 is in flight. That response predates
  // the push, so the pushed snapshot must win it — but only once: the next
  // page-0 starts after the push and its contradicting answer is the server
  // truth the row must converge to (previously the pushed snapshot replayed
  // over every later page-0 and was pinned for the hook's lifetime).
  let callCount = 0;
  let deferred: ReturnType<typeof createDeferred<any>> | null = null;
  const makeRow = (title: string, voteCount: number, hasVoted: boolean) => ({
    id: 'fr_host',
    title,
    description: 'Host push probe',
    voteCount,
    hasVoted,
    isOwnRequest: false,
  });
  const mockClient = {
    fetchFeatureRequests: async () => {
      callCount += 1;
      if (callCount === 1) {
        return { requests: [makeRow('Initial title', 10, false)], total: 1 };
      }
      if (callCount === 2) {
        deferred = createDeferred<any>();
        return deferred.promise;
      }
      return { requests: [makeRow('Server truth', 10, false)], total: 1 };
    },
  } as unknown as FeedbackClient;
  const latest: { current: any } = { current: null };

  function HostPushProbe({ client }: { client: FeedbackClient }) {
    latest.current = useFeatureRequests({
      client,
      userToken: 'tok_host',
      searchRateLimiterOptions: { minSpacingMs: 0 },
    });
    return null;
  }

  const renderer = TestRenderer.create(<HostPushProbe client={mockClient} />);
  try {
    await flush();
    assert.equal(latest.current!.items[0].title, 'Initial title');

    // Start a refresh, then push a contradicting snapshot while it is in
    // flight.
    act(() => {
      void latest.current!.refresh();
    });
    await flush();
    act(() => {
      latest.current!.setItems([makeRow('Host truth', 11, true)]);
    });
    await flush();

    // The pre-push response lands: the pushed snapshot must survive it.
    act(() => {
      deferred!.resolve({ requests: [makeRow('Stale server title', 10, false)], total: 1 });
    });
    await flush();
    assert.equal(
      latest.current!.items[0].hasVoted,
      true,
      'a page-0 that started before the push must not clobber the pushed vote state'
    );
    assert.equal(latest.current!.items[0].voteCount, 11);
    assert.equal(
      latest.current!.items[0].title,
      'Host truth',
      'a page-0 that started before the push must not clobber the pushed row'
    );

    // The next page-0 starts after the push: its contradicting answer is
    // authoritative and the pushed snapshot must not replay.
    act(() => {
      void latest.current!.refresh();
    });
    await flush();
    assert.equal(
      latest.current!.items[0].hasVoted,
      false,
      'a page-0 after the push must render the server vote state'
    );
    assert.equal(latest.current!.items[0].voteCount, 10);
    assert.equal(
      latest.current!.items[0].title,
      'Server truth',
      'the pushed snapshot must be a one-shot guard, not a lifetime pin'
    );
  } finally {
    renderer.unmount();
  }
});

test('useFeatureRequests: a mid-flight host push matching the late response is released without replay (#186)', async () => {
  // When the pre-push response already agrees with the pushed vote state,
  // the enrollment closes on that response: the server row renders and no
  // pushed field may override it later.
  let callCount = 0;
  let deferred: ReturnType<typeof createDeferred<any>> | null = null;
  const makeRow = (title: string, voteCount: number, hasVoted: boolean) => ({
    id: 'fr_match',
    title,
    description: 'Host match probe',
    voteCount,
    hasVoted,
    isOwnRequest: false,
  });
  const mockClient = {
    fetchFeatureRequests: async () => {
      callCount += 1;
      if (callCount === 1) {
        return { requests: [makeRow('Initial title', 10, false)], total: 1 };
      }
      if (callCount === 2) {
        deferred = createDeferred<any>();
        return deferred.promise;
      }
      return { requests: [makeRow('Server truth', 10, false)], total: 1 };
    },
  } as unknown as FeedbackClient;
  const latest: { current: any } = { current: null };

  function HostMatchProbe({ client }: { client: FeedbackClient }) {
    latest.current = useFeatureRequests({
      client,
      userToken: 'tok_match',
      searchRateLimiterOptions: { minSpacingMs: 0 },
    });
    return null;
  }

  const renderer = TestRenderer.create(<HostMatchProbe client={mockClient} />);
  try {
    await flush();
    assert.equal(latest.current!.items[0].title, 'Initial title');

    // Push a row with the same vote state as the server, but a host-edited
    // title, while the refresh is in flight.
    act(() => {
      void latest.current!.refresh();
    });
    await flush();
    act(() => {
      latest.current!.setItems([makeRow('Host title', 10, false)]);
    });
    await flush();

    // The response agrees on hasVoted: the server row renders and the
    // enrollment is released.
    act(() => {
      deferred!.resolve({ requests: [makeRow('Server title', 10, false)], total: 1 });
    });
    await flush();
    assert.equal(
      latest.current!.items[0].title,
      'Server title',
      'a response that already reflects the pushed vote state decides the row'
    );

    // The next page-0 renders freely — proof the entry no longer replays.
    act(() => {
      void latest.current!.refresh();
    });
    await flush();
    assert.equal(latest.current!.items[0].title, 'Server truth');
    assert.equal(latest.current!.items[0].hasVoted, false);
  } finally {
    renderer.unmount();
  }
});

test('useFeatureRequests: a host-pushed row absent from later page-0s cannot replay its snapshot when it returns (#186)', async () => {
  // A push can enroll rows that the following page-0s never return (query
  // changes, deletions). Such entries must be retired by the next fetch
  // start instead of accumulating: when the row eventually returns from the
  // server with contradicting state, the server row renders — previously
  // the stranded entry replayed the host snapshot over it until remount.
  let plainLoads = 0;
  const makeRow = (title: string, voteCount: number, hasVoted: boolean) => ({
    id: 'fr_ghost',
    title,
    description: 'Ghost push probe',
    voteCount,
    hasVoted,
    isOwnRequest: false,
  });
  const mockClient = {
    fetchFeatureRequests: async ({ query }: { query?: string }) => {
      if (query) return { requests: [], total: 0 };
      plainLoads += 1;
      return plainLoads === 1
        ? { requests: [makeRow('Pre-push title', 3, false)], total: 1 }
        : { requests: [makeRow('Server truth', 3, false)], total: 1 };
    },
  } as unknown as FeedbackClient;
  const latest: { current: any } = { current: null };

  function GhostPushProbe({ client, query }: { client: FeedbackClient; query: string }) {
    latest.current = useFeatureRequests({
      client,
      userToken: 'tok_ghost',
      query,
      searchRateLimiterOptions: { minSpacingMs: 0 },
    });
    return null;
  }

  const renderer = TestRenderer.create(<GhostPushProbe client={mockClient} query="" />);
  try {
    await flush();
    assert.equal(latest.current!.items.length, 1);

    // Push a contradicting snapshot of the row while no fetch is in flight.
    act(() => {
      latest.current!.setItems([makeRow('Ghost title', 99, true)]);
    });
    await flush();
    assert.equal(latest.current!.items[0].title, 'Ghost title');

    // A query change pages the row out; the fetch starts after the push, so
    // its start must retire the stranded enrollment.
    act(() => {
      renderer.update(<GhostPushProbe client={mockClient} query="beta" />);
    });
    await flush();
    assert.equal(latest.current!.items.length, 0);

    // The row returns from the server with the old vote state: the server
    // row must render, not the pinned host snapshot.
    act(() => {
      renderer.update(<GhostPushProbe client={mockClient} query="" />);
    });
    await flush();

    const row = latest.current!.items[0];
    assert.ok(row, 'the restored query must bring the row back');
    assert.equal(
      row.title,
      'Server truth',
      'a page-0 that started after the push must not replay the stranded snapshot'
    );
    assert.equal(row.hasVoted, false, 'the stranded host snapshot must not present a phantom vote');
    assert.equal(row.voteCount, 3);
  } finally {
    renderer.unmount();
  }
});

test('useFeatureRequests: a host push enrolled after a fetch started cannot overlay that fetch (#186)', async () => {
  // React defers the push's state updater whenever another update is already
  // queued: when the enrollment lands only at flush time, the fetch that
  // started in the same batch captures the push's revision before the entry
  // exists, so the start-time retirement misses it. The reconciliation must
  // re-run the retirement — a fetch that started at or after the push
  // decides the rows, exactly like one scheduled later. (Two pushes force
  // the deferral deterministically: the first dispatch runs eagerly, the
  // second waits for the flush.)
  let callCount = 0;
  let deferred: ReturnType<typeof createDeferred<any>> | null = null;
  const makeRow = (title: string, voteCount: number, hasVoted: boolean) => ({
    id: 'fr_late',
    title,
    description: 'Deferred push probe',
    voteCount,
    hasVoted,
    isOwnRequest: false,
  });
  const mockClient = {
    fetchFeatureRequests: async () => {
      callCount += 1;
      if (callCount === 1) {
        return { requests: [makeRow('Initial title', 10, false)], total: 1 };
      }
      deferred = createDeferred<any>();
      return deferred.promise;
    },
  } as unknown as FeedbackClient;
  const latest: { current: any } = { current: null };

  function LateEnrollProbe({ client }: { client: FeedbackClient }) {
    latest.current = useFeatureRequests({
      client,
      userToken: 'tok_late',
      searchRateLimiterOptions: { minSpacingMs: 0 },
    });
    return null;
  }

  const renderer = TestRenderer.create(<LateEnrollProbe client={mockClient} />);
  try {
    await flush();
    assert.equal(latest.current!.items[0].title, 'Initial title');

    // Two pushes, then refresh, in one batch: the second push's enrollment
    // flushes only after the fetch below has captured its revision.
    act(() => {
      latest.current!.setItems([makeRow('First push', 10, false)]);
      latest.current!.setItems([makeRow('Host truth', 11, true)]);
      void latest.current!.refresh();
    });
    await flush();

    // The response decides the row — the late-enrolled snapshot must not
    // overlay it.
    act(() => {
      deferred!.resolve({ requests: [makeRow('Server truth', 10, false)], total: 1 });
    });
    await flush();
    assert.equal(
      latest.current!.items[0].hasVoted,
      false,
      'a fetch that started at the push revision must not be overridden by the pushed snapshot'
    );
    assert.equal(latest.current!.items[0].title, 'Server truth');
    assert.equal(latest.current!.items[0].voteCount, 10);
  } finally {
    renderer.unmount();
  }
});

test('useFeatureRequests: a host push keeps an in-flight optimistic vote protected until it settles (#186)', async () => {
  // Pushing a row must not strip a same-identity in-flight vote of its
  // lifecycle-managed protection: the page-0 that starts after the push
  // still cannot wipe the optimistic vote, which only the settlement (or a
  // rollback) releases. Otherwise the row would flicker back to the
  // pre-vote state for one response before the vote lands.
  let callCount = 0;
  let deferredRefresh: ReturnType<typeof createDeferred<any>> | null = null;
  const deferredVote = createDeferred<any>();
  const makeRow = (title: string, voteCount: number, hasVoted: boolean) => ({
    id: 'fr_pushvote',
    title,
    description: 'Push vote probe',
    voteCount,
    hasVoted,
    isOwnRequest: false,
  });
  const mockClient = {
    fetchFeatureRequests: async () => {
      callCount += 1;
      if (callCount === 1) {
        return { requests: [makeRow('Initial title', 10, false)], total: 1 };
      }
      deferredRefresh = createDeferred<any>();
      return deferredRefresh.promise;
    },
    castVote: () => deferredVote.promise,
  } as unknown as FeedbackClient;
  const latest: { current: any } = { current: null };

  function PushVoteProbe({ client }: { client: FeedbackClient }) {
    const requests = useFeatureRequests({
      client,
      userToken: 'tok_pushvote',
      searchRateLimiterOptions: { minSpacingMs: 0 },
    });
    const vote = useToggleVote(client, 'tok_pushvote', requests.applyItemChange);
    latest.current = { requests, vote };
    return null;
  }

  const renderer = TestRenderer.create(<PushVoteProbe client={mockClient} />);
  try {
    await flush();
    assert.equal(latest.current!.requests.items[0].hasVoted, false);

    // Tap the vote; the optimistic state and its pending entry land while
    // the vote request hangs.
    act(() => {
      latest.current!.vote.toggleVote(latest.current!.requests.items[0]);
    });
    await flush();
    assert.equal(latest.current!.requests.items[0].hasVoted, true);

    // The host pushes a mirrored row. The push replaces the vote entry, but
    // the entry must stay lifecycle-managed, not become a host guard.
    act(() => {
      latest.current!.requests.setItems([makeRow('Host mirror', 11, true)]);
    });
    await flush();

    // A page-0 that starts after the push lands with the pre-vote server
    // state while the vote is still in flight: the optimistic vote must
    // survive it.
    act(() => {
      void latest.current!.requests.refresh();
    });
    await flush();
    act(() => {
      deferredRefresh!.resolve({ requests: [makeRow('Pre-vote title', 10, false)], total: 1 });
    });
    await flush();
    assert.equal(
      latest.current!.requests.items[0].hasVoted,
      true,
      'the in-flight optimistic vote must survive a page-0 that started after the host push'
    );
    assert.equal(latest.current!.requests.items[0].voteCount, 11);

    // The settlement then applies the server-confirmed result and releases
    // the entry.
    act(() => {
      deferredVote.resolve({ voted: true, voteCount: 11 });
    });
    await flush();
    assert.equal(latest.current!.requests.items[0].hasVoted, true);
    assert.equal(latest.current!.requests.items[0].voteCount, 11);
  } finally {
    renderer.unmount();
  }
});
