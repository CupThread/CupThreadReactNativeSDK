import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import type { FeedbackClient } from '../src/client/FeedbackClient';
import { useFeatureRequests, type UseFeatureRequestsResult } from '../src/hooks/useFeatureRequests';
import {
  useToggleVote,
  type UseToggleVoteOptions,
  type UseToggleVoteResult,
  type VoteChangeApplier,
  type VoteChangeMeta,
} from '../src/hooks/useToggleVote';
import type { FeatureRequestItem, VoteResult, VoteWarning } from '../src/types';

const testGlobal = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean };
testGlobal.IS_REACT_ACT_ENVIRONMENT = true;

async function flush(times = 6, sleepMs = 4): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, sleepMs));
    await act(async () => {});
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeItem(
  id: string,
  title = 'Dark mode',
  overrides: Partial<FeatureRequestItem> = {}
): FeatureRequestItem {
  return {
    id,
    appId: 'app_test',
    title,
    description: `${title} description`,
    status: 'open',
    approved: true,
    voteCount: 5,
    hasVoted: false,
    isOwnRequest: false,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

interface ProbeProps {
  client: FeedbackClient;
  userToken: string;
  applyChange: VoteChangeApplier;
  options?: UseToggleVoteOptions;
  latest: { current: UseToggleVoteResult | null };
  renderSnapshots?: Array<{
    isVotingItem1: boolean;
    voteError: Error | null;
    item1Error: Error | null;
  }>;
}

function VoteProbe({
  client,
  userToken,
  applyChange,
  options,
  latest,
  renderSnapshots,
}: ProbeProps) {
  const result = useToggleVote(client, userToken, applyChange, options);
  latest.current = result;
  renderSnapshots?.push({
    isVotingItem1: result.isVoting('fr_1'),
    voteError: result.voteError,
    item1Error: result.getVoteError('fr_1'),
  });
  return null;
}

test('useToggleVote scopes in-flight votes and rejections across userToken switches (#459)', async () => {
  const calls: Array<{ id: string; token: string }> = [];
  const deferredByToken = new Map<string, ReturnType<typeof createDeferred<VoteResult>>>();

  const client = {
    castVote: (id: string, token: string) => {
      calls.push({ id, token });
      const deferred = createDeferred<VoteResult>();
      deferredByToken.set(token, deferred);
      return deferred.promise;
    },
  } as unknown as FeedbackClient;

  const appliedChanges: Array<{ itemId: string; meta?: VoteChangeMeta }> = [];
  const applyChange: VoteChangeApplier = (itemId, _transform, meta) => {
    appliedChanges.push({ itemId, meta });
  };
  const onVoteErrorCalls: Array<{ err: unknown; itemId: string }> = [];

  const latest: { current: UseToggleVoteResult | null } = { current: null };
  const renderSnapshots: ProbeProps['renderSnapshots'] = [];
  const item = makeItem('fr_1');

  const renderer = TestRenderer.create(
    <VoteProbe
      client={client}
      userToken="tok_a"
      applyChange={applyChange}
      options={{ onVoteError: (err, it) => onVoteErrorCalls.push({ err, itemId: it.id }) }}
      latest={latest}
      renderSnapshots={renderSnapshots}
    />
  );

  try {
    act(() => {
      latest.current!.toggleVote(item);
    });
    assert.equal(latest.current!.isVoting('fr_1'), true);
    assert.deepEqual(calls, [{ id: 'fr_1', token: 'tok_a' }]);
    renderSnapshots.length = 0;

    // Switch identity while tok_a's vote is still in flight.
    act(() => {
      renderer.update(
        <VoteProbe
          client={client}
          userToken="tok_b"
          applyChange={applyChange}
          options={{ onVoteError: (err, it) => onVoteErrorCalls.push({ err, itemId: it.id }) }}
          latest={latest}
          renderSnapshots={renderSnapshots}
        />
      );
    });

    // Even on the first render under tok_b, isVoting('fr_1') must be false.
    assert.equal(renderSnapshots[0]?.isVotingItem1, false);
    assert.equal(latest.current!.isVoting('fr_1'), false);

    // Tapping the same item under tok_b must dispatch immediately rather than
    // being blocked by tok_a's stranded pending lock.
    act(() => {
      latest.current!.toggleVote(item);
    });
    assert.equal(latest.current!.isVoting('fr_1'), true);
    assert.deepEqual(calls, [
      { id: 'fr_1', token: 'tok_a' },
      { id: 'fr_1', token: 'tok_b' },
    ]);
    appliedChanges.length = 0;

    // Reject tok_a's stranded request while tok_b's request is still in flight:
    // tok_b must not receive tok_a's error, callback, rollback, or early lock release.
    await act(async () => {
      deferredByToken.get('tok_a')!.reject(new Error('tok_a unauthorized'));
    });
    await flush();

    assert.equal(latest.current!.voteError, null);
    assert.equal(latest.current!.getVoteError('fr_1'), null);
    assert.deepEqual(onVoteErrorCalls, []);
    assert.deepEqual(appliedChanges, []);
    assert.equal(
      latest.current!.isVoting('fr_1'),
      true,
      "tok_a's finally block must not clear tok_b's in-flight lock for the same item"
    );

    // Settling tok_b's request completes normally and releases tok_b's lock.
    await act(async () => {
      deferredByToken.get('tok_b')!.resolve({ voted: true, voteCount: 6 });
    });
    await flush();

    assert.equal(latest.current!.isVoting('fr_1'), false);
    assert.equal(appliedChanges.length, 1);
    assert.deepEqual(appliedChanges[0], {
      itemId: 'fr_1',
      meta: { isFinal: true, userToken: 'tok_b' },
    });
  } finally {
    renderer.unmount();
  }
});

test('useToggleVote ignores stale warning settlements and preserves new-session errors (#459)', async () => {
  const deferredA = createDeferred<VoteResult>();
  const client = {
    castVote: (_id: string, token: string) => {
      if (token === 'tok_a') return deferredA.promise;
      return Promise.reject(new Error('tok_b failure on fr_2'));
    },
  } as unknown as FeedbackClient;

  const warnings: Array<{ warning: VoteWarning; itemId: string }> = [];
  const latest: { current: UseToggleVoteResult | null } = { current: null };

  const renderer = TestRenderer.create(
    <VoteProbe
      client={client}
      userToken="tok_a"
      applyChange={() => {}}
      options={{ onVoteWarning: (warning, it) => warnings.push({ warning, itemId: it.id }) }}
      latest={latest}
    />
  );

  try {
    act(() => {
      latest.current!.toggleVote(makeItem('fr_1'));
    });

    // Switch to tok_b and record a real vote failure under tok_b.
    act(() => {
      renderer.update(
        <VoteProbe
          client={client}
          userToken="tok_b"
          applyChange={() => {}}
          options={{ onVoteWarning: (warning, it) => warnings.push({ warning, itemId: it.id }) }}
          latest={latest}
        />
      );
    });

    await act(async () => {
      latest.current!.toggleVote(makeItem('fr_2'));
    });
    await flush();

    assert.equal(latest.current!.voteError?.message, 'tok_b failure on fr_2');
    assert.equal(latest.current!.getVoteError('fr_2')?.message, 'tok_b failure on fr_2');

    // Resolve tok_a's stranded vote with a ship-notification warning: neither
    // onVoteWarning nor setVoteError(null) may fire in tok_b's session.
    await act(async () => {
      deferredA.resolve({
        voted: true,
        voteCount: 6,
        warning: { code: 'email_not_verified', error: 'Verify your email first' },
      });
    });
    await flush();

    assert.deepEqual(warnings, []);
    assert.equal(
      latest.current!.voteError?.message,
      'tok_b failure on fr_2',
      "a stale settlement from tok_a must not clear tok_b's active voteError"
    );
    assert.equal(latest.current!.getVoteError('fr_2')?.message, 'tok_b failure on fr_2');
  } finally {
    renderer.unmount();
  }
});

test('useToggleVote clears prior voteError and per-item errors on userToken or client switch (#459)', async () => {
  const clientA = {
    castVote: () => Promise.reject(new Error('clientA vote failed')),
  } as unknown as FeedbackClient;
  const clientB = {
    castVote: () => Promise.reject(new Error('clientB vote failed')),
  } as unknown as FeedbackClient;

  const latest: { current: UseToggleVoteResult | null } = { current: null };
  const current = (): UseToggleVoteResult => latest.current!;
  const renderSnapshots: ProbeProps['renderSnapshots'] = [];

  const renderer = TestRenderer.create(
    <VoteProbe
      client={clientA}
      userToken="tok_a"
      applyChange={() => {}}
      latest={latest}
      renderSnapshots={renderSnapshots}
    />
  );

  try {
    await act(async () => {
      current().toggleVote(makeItem('fr_1'));
    });
    await flush();

    assert.equal(current().voteError?.message, 'clientA vote failed');
    assert.equal(current().getVoteError('fr_1')?.message, 'clientA vote failed');
    renderSnapshots.length = 0;

    // Switching userToken clears both global and per-item errors immediately.
    act(() => {
      renderer.update(
        <VoteProbe
          client={clientA}
          userToken="tok_b"
          applyChange={() => {}}
          latest={latest}
          renderSnapshots={renderSnapshots}
        />
      );
    });
    assert.equal(renderSnapshots[0]?.voteError, null);
    assert.equal(renderSnapshots[0]?.item1Error, null);
    assert.equal(current().voteError, null);
    assert.equal(current().getVoteError('fr_1'), null);

    // Record another error under (clientA, tok_b), then swap clientA -> clientB
    // while keeping tok_b unchanged: client swap must also clear errors.
    await act(async () => {
      current().toggleVote(makeItem('fr_1'));
    });
    await flush();
    assert.equal(current().voteError?.message, 'clientA vote failed');
    renderSnapshots.length = 0;

    act(() => {
      renderer.update(
        <VoteProbe
          client={clientB}
          userToken="tok_b"
          applyChange={() => {}}
          latest={latest}
          renderSnapshots={renderSnapshots}
        />
      );
    });
    assert.equal(renderSnapshots[0]?.voteError, null);
    assert.equal(renderSnapshots[0]?.item1Error, null);
    assert.equal(current().voteError, null);
    assert.equal(current().getVoteError('fr_1'), null);
  } finally {
    renderer.unmount();
  }
});

test('useToggleVote paired with useFeatureRequests scopes same-token client swaps (#459)', async () => {
  const deferredClientAVote = createDeferred<VoteResult>();
  const clientBVoteCalls: string[] = [];

  const clientA = {
    fetchFeatureRequests: async () => ({
      requests: [makeItem('fr_shared', 'App A feature', { voteCount: 2, hasVoted: false })],
      total: 1,
    }),
    castVote: () => deferredClientAVote.promise,
  } as unknown as FeedbackClient;

  const clientB = {
    fetchFeatureRequests: async () => ({
      requests: [makeItem('fr_shared', 'App B feature', { voteCount: 10, hasVoted: false })],
      total: 1,
    }),
    castVote: async (id: string) => {
      clientBVoteCalls.push(id);
      return { voted: true, voteCount: 11 };
    },
  } as unknown as FeedbackClient;

  const latest: {
    current: { requests: UseFeatureRequestsResult; vote: UseToggleVoteResult } | null;
  } = { current: null };

  function PairedProbe({ client }: { client: FeedbackClient }) {
    const requests = useFeatureRequests({
      client,
      userToken: 'tok_same',
      searchRateLimiterOptions: { minSpacingMs: 0 },
    });
    const vote = useToggleVote(client, 'tok_same', requests.applyItemChange);
    latest.current = { requests, vote };
    return null;
  }

  const renderer = TestRenderer.create(<PairedProbe client={clientA} />);
  try {
    await flush();
    assert.equal(latest.current!.requests.items[0].title, 'App A feature');

    // Start an in-flight vote on clientA, then swap to clientB with the same userToken.
    act(() => {
      latest.current!.vote.toggleVote(latest.current!.requests.items[0]);
    });
    assert.equal(latest.current!.vote.isVoting('fr_shared'), true);

    act(() => {
      renderer.update(<PairedProbe client={clientB} />);
    });
    await flush();

    assert.equal(latest.current!.requests.items[0].title, 'App B feature');
    assert.equal(latest.current!.vote.isVoting('fr_shared'), false);

    // Resolving clientA's stranded vote must not overwrite clientB's row, even
    // though both clients share the same userToken.
    await act(async () => {
      deferredClientAVote.resolve({ voted: true, voteCount: 99 });
    });
    await flush();

    assert.equal(latest.current!.requests.items[0].hasVoted, false);
    assert.equal(latest.current!.requests.items[0].voteCount, 10);

    // Voting under clientB works normally.
    await act(async () => {
      latest.current!.vote.toggleVote(latest.current!.requests.items[0]);
    });
    await flush();

    assert.deepEqual(clientBVoteCalls, ['fr_shared']);
    assert.equal(latest.current!.requests.items[0].hasVoted, true);
    assert.equal(latest.current!.requests.items[0].voteCount, 11);
  } finally {
    renderer.unmount();
  }
});

test('useToggleVote drops pre-roundtrip vote after tok_a -> tok_b -> tok_a and preserves whitespace-equivalent sessions (#459)', async () => {
  const deferredFirstTokA = createDeferred<VoteResult>();
  let callIndex = 0;
  const client = {
    castVote: () => {
      callIndex += 1;
      if (callIndex === 1) return deferredFirstTokA.promise;
      return Promise.reject(new Error('second vote failed'));
    },
  } as unknown as FeedbackClient;

  const latest: { current: UseToggleVoteResult | null } = { current: null };
  let appliedCount = 0;

  const renderer = TestRenderer.create(
    <VoteProbe
      client={client}
      userToken="  tok_a  "
      applyChange={() => {
        appliedCount += 1;
      }}
      latest={latest}
    />
  );

  try {
    act(() => {
      latest.current!.toggleVote(makeItem('fr_1'));
    });
    assert.equal(latest.current!.isVoting('fr_1'), true);

    // Whitespace-only trim differences keep the same session and in-flight lock.
    act(() => {
      renderer.update(
        <VoteProbe
          client={client}
          userToken="tok_a"
          applyChange={() => {
            appliedCount += 1;
          }}
          latest={latest}
        />
      );
    });
    assert.equal(latest.current!.isVoting('fr_1'), true);

    // Roundtrip tok_a -> tok_b -> tok_a invalidates the pre-roundtrip vote.
    act(() => {
      renderer.update(
        <VoteProbe
          client={client}
          userToken="tok_b"
          applyChange={() => {
            appliedCount += 1;
          }}
          latest={latest}
        />
      );
    });
    act(() => {
      renderer.update(
        <VoteProbe
          client={client}
          userToken="tok_a"
          applyChange={() => {
            appliedCount += 1;
          }}
          latest={latest}
        />
      );
    });
    assert.equal(latest.current!.isVoting('fr_1'), false);
    appliedCount = 0;

    await act(async () => {
      deferredFirstTokA.resolve({ voted: true, voteCount: 42 });
    });
    await flush();

    assert.equal(
      appliedCount,
      0,
      'a vote from an earlier tok_a session must not settle after a tok_a -> tok_b -> tok_a roundtrip'
    );
  } finally {
    renderer.unmount();
  }
});
