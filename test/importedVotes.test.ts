import test from 'node:test';
import assert from 'node:assert/strict';
import { FeedbackClient } from '../src/client/FeedbackClient';
import { withOptimisticVote, withServerVote, withVoteRollback } from '../src/hooks/useToggleVote';
import type { FeatureRequestItem } from '../src/types';

// ---------------------------------------------------------------------------
// Issue #111 — voteCount is the displayed total (in-app votes plus imported
// historical votes) and importedVotes is the historical portion already
// included in it. These tests pin the contract so hosts can label both numbers
// without double counting.
// ---------------------------------------------------------------------------

const USER_TOKEN = 'usr_token_abc';

function makeItem(overrides: Partial<FeatureRequestItem> = {}): FeatureRequestItem {
  return {
    id: 'fr_111',
    appId: 'app_1',
    title: 'Import GitHub reactions',
    description: 'desc',
    status: 'open',
    approved: true,
    voteCount: 124,
    importedVotes: 120,
    hasVoted: false,
    isOwnRequest: false,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeClient(): FeedbackClient {
  return new FeedbackClient({
    baseUrl: 'https://api.cupthread.com',
    appKey: 'app_key_abc',
  });
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

test('fetchFeatureRequests keeps the summed voteCount and the imported portion', async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = '';

  globalThis.fetch = (async (url: string | URL | Request) => {
    requestUrl = url.toString();
    return jsonResponse({
      requests: [
        {
          id: 'fr_imported',
          appId: 'app_1',
          title: 'Imported from GitHub',
          description: 'desc',
          status: 'open',
          approved: true,
          voteCount: 124,
          importedVotes: 120,
          hasVoted: false,
          isOwnRequest: false,
          createdAt: '2026-09-01T00:00:00.000Z',
          updatedAt: '2026-09-01T00:00:00.000Z',
        },
        {
          id: 'fr_native',
          appId: 'app_1',
          title: 'Created in CupThread',
          description: 'desc',
          status: 'open',
          approved: true,
          voteCount: 3,
          importedVotes: 0,
          hasVoted: true,
          isOwnRequest: false,
          createdAt: '2026-09-02T00:00:00.000Z',
          updatedAt: '2026-09-02T00:00:00.000Z',
        },
      ],
      total: 2,
    });
  }) as any;

  try {
    const result = await makeClient().fetchFeatureRequests({ userToken: USER_TOKEN });

    assert.match(requestUrl, /\/api\/v1\/feature-requests\?/);

    const [imported, native] = result.requests;
    assert.equal(imported.voteCount, 124, 'the displayed total includes the imported votes');
    assert.equal(imported.importedVotes, 120, 'the historical portion stays readable for labels');
    assert.ok(
      imported.voteCount >= imported.importedVotes!,
      'the imported portion is part of the total, never a separate count'
    );

    assert.equal(native.voteCount, 3);
    assert.equal(native.importedVotes, 0, 'CupThread-created requests report no imported votes');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a payload without importedVotes still decodes as a plain summed count', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () =>
    jsonResponse({
      requests: [
        {
          id: 'fr_legacy',
          appId: 'app_1',
          title: 'Older payload shape',
          description: 'desc',
          status: 'open',
          approved: true,
          voteCount: 7,
          hasVoted: false,
          isOwnRequest: false,
          createdAt: '2026-09-03T00:00:00.000Z',
          updatedAt: '2026-09-03T00:00:00.000Z',
        },
      ],
      total: 1,
    })) as any;

  try {
    const result = await makeClient().fetchFeatureRequests({ userToken: USER_TOKEN });

    assert.equal(result.requests[0].voteCount, 7);
    assert.equal(result.requests[0].importedVotes, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// Vote toggles
// ---------------------------------------------------------------------------

test('castVote surfaces the server total with the imported votes still counted', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () => jsonResponse({ voted: true, voteCount: 124 })) as any;

  try {
    const vote = await makeClient().castVote('fr_imported', USER_TOKEN);

    assert.equal(vote.voted, true);
    assert.equal(vote.voteCount, 124, 'a new vote moves the displayed total by one, not by 121');

    const updated = withServerVote(makeItem({ hasVoted: false }), vote);
    assert.equal(updated.voteCount, 124);
    assert.equal(updated.importedVotes, 120, 'the imported portion survives the reconciliation');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('removeVote does not subtract the imported portion from the total', async () => {
  const originalFetch = globalThis.fetch;

  // Removing one in-app vote from a request with 120 imported votes.
  globalThis.fetch = (async () => jsonResponse({ voted: false, voteCount: 123 })) as any;

  try {
    const vote = await makeClient().removeVote('fr_imported', USER_TOKEN);

    assert.equal(vote.voted, false);
    assert.equal(vote.voteCount, 123, 'the imported votes are not removed with the local ballot');

    const updated = withServerVote(makeItem({ hasVoted: true }), vote);
    assert.equal(updated.voteCount, 123);
    assert.equal(updated.importedVotes, 120);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// Optimistic state and rollback
// ---------------------------------------------------------------------------

test('withOptimisticVote moves the displayed total by one and keeps the imported portion', () => {
  const item = makeItem({ hasVoted: false, voteCount: 124, importedVotes: 120 });

  const upvoted = withOptimisticVote(item);
  assert.equal(upvoted.hasVoted, true);
  assert.equal(upvoted.voteCount, 125, 'the optimistic delta applies to the summed total');
  assert.equal(upvoted.importedVotes, 120);

  const unvoted = withOptimisticVote({ ...item, hasVoted: true });
  assert.equal(unvoted.voteCount, 123);
  assert.equal(unvoted.importedVotes, 120);
});

test('withVoteRollback restores the summed total and the imported portion', () => {
  const preVoteSnapshot = { hasVoted: false, voteCount: 124 };
  const optimisticallyVoted = withOptimisticVote(
    makeItem({ hasVoted: false, voteCount: 124, importedVotes: 120 })
  );

  const rolledBack = withVoteRollback(optimisticallyVoted, preVoteSnapshot);

  assert.equal(rolledBack.hasVoted, false);
  assert.equal(rolledBack.voteCount, 124);
  assert.equal(rolledBack.importedVotes, 120, 'a failed vote must not drop the historical count');
});

test('the vote state snapshot covers only the fields the toggle changes', () => {
  const item = makeItem({ hasVoted: false, voteCount: 124, importedVotes: 120 });
  const snapshot: Pick<FeatureRequestItem, 'hasVoted' | 'voteCount'> = {
    hasVoted: item.hasVoted,
    voteCount: item.voteCount,
  };

  assert.deepEqual(Object.keys(snapshot).sort(), ['hasVoted', 'voteCount']);
  // importedVotes is untouched by every transform, so it must not be part of the
  // rollback payload — a stale copy there would resurrect a wrong historical count.
  assert.equal('importedVotes' in snapshot, false);
});
