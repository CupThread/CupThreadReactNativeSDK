import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { isSafeLinkUrl, sanitizeSafeLinkUrl } from '../src/utils/linkUrl';
import { formatDate } from '../src/utils/formatters';
import {
  useToggleVote,
  withOptimisticVote,
  withServerVote,
  withVoteRollback,
} from '../src/hooks/useToggleVote';
import { FeedbackClient } from '../src/client/FeedbackClient';
import {
  AuthenticationRequiredException,
  UnexpectedStatusException,
  UnreadableUploadResponseException,
} from '../src/client/FeedbackException';
import { UserTokenStore } from '../src/client/UserTokenStore';
import type { FeatureRequestItem } from '../src/types';

// ---------------------------------------------------------------------------
// Issue #10 — isSafeLinkUrl scheme allowlist
// ---------------------------------------------------------------------------

test('isSafeLinkUrl allows http and https URLs', () => {
  assert.equal(isSafeLinkUrl('https://cupthread.com/changelog'), true);
  assert.equal(isSafeLinkUrl('http://cupthread.com'), true);
});

test('isSafeLinkUrl normalizes whitespace and case before matching the scheme', () => {
  assert.equal(isSafeLinkUrl('  HTTPS://cupthread.com'), true);
  assert.equal(isSafeLinkUrl('https://cupthread.com '), true);
  assert.equal(isSafeLinkUrl('Http://Example.COM'), true);
  assert.equal(isSafeLinkUrl('java\nscript:alert(1)'), false);
  assert.equal(isSafeLinkUrl('\u0000javascript:alert(1)'), false);
  assert.equal(isSafeLinkUrl(' tel:+18005550199'), false);
});

test('isSafeLinkUrl rejects dangerous and custom schemes', () => {
  assert.equal(isSafeLinkUrl('javascript:alert(1)'), false);
  assert.equal(isSafeLinkUrl('tel:+18005550199'), false);
  assert.equal(isSafeLinkUrl('sms:+18005550199'), false);
  assert.equal(isSafeLinkUrl('facetime:+18005550199'), false);
  assert.equal(isSafeLinkUrl('intent://share#Intent;end'), false);
  assert.equal(isSafeLinkUrl('myapp://deep/link'), false);
  assert.equal(isSafeLinkUrl('data:text/html,<script>alert(1)</script>'), false);
  assert.equal(isSafeLinkUrl('file:///etc/passwd'), false);
});

test('isSafeLinkUrl rejects scheme-relative, relative, and empty inputs', () => {
  assert.equal(isSafeLinkUrl('//evil.example.com'), false);
  assert.equal(isSafeLinkUrl('not-a-url'), false);
  assert.equal(isSafeLinkUrl(''), false);
  assert.equal(isSafeLinkUrl('   '), false);
  assert.equal(isSafeLinkUrl(undefined as any), false);
});

test('isSafeLinkUrl handles mailto behind an explicit opt-in', () => {
  assert.equal(isSafeLinkUrl('mailto:hi@cupthread.com'), false);
  assert.equal(isSafeLinkUrl('mailto:hi@cupthread.com', { allowMailto: true }), true);
  assert.equal(isSafeLinkUrl('MAILTO:hi@cupthread.com', { allowMailto: true }), true);
});

test('sanitizeSafeLinkUrl returns trimmed safe URL or null for unsafe URLs', () => {
  assert.equal(sanitizeSafeLinkUrl('  https://cupthread.com  '), 'https://cupthread.com');
  assert.equal(sanitizeSafeLinkUrl('http://example.com/foo'), 'http://example.com/foo');
  assert.equal(sanitizeSafeLinkUrl('javascript:alert(1)'), null);
  assert.equal(sanitizeSafeLinkUrl('  tel:+12345 '), null);
  assert.equal(sanitizeSafeLinkUrl(''), null);
});

// ---------------------------------------------------------------------------
// Issue #11 — formatDate future-timestamp clamp
// ---------------------------------------------------------------------------

test('formatDate clamps small future clock skew to "Just now"', () => {
  const in30Seconds = new Date(Date.now() + 30 * 1000).toISOString();
  assert.equal(formatDate(in30Seconds), 'Just now');

  const in2Hours = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  assert.equal(formatDate(in2Hours), 'Just now');
});

test('formatDate renders far-future timestamps as a calendar date, not "Just now"', () => {
  const inOneYear = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const rendered = formatDate(inOneYear.toISOString());

  assert.notEqual(rendered, 'Just now');
  assert.ok(rendered.includes(String(inOneYear.getFullYear())), `Expected year in "${rendered}"`);
});

test('formatDate still renders past timestamps relatively', () => {
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  assert.equal(formatDate(fiveMinAgo), '5m ago');

  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  assert.equal(formatDate(twoHoursAgo), '2h ago');
});

// ---------------------------------------------------------------------------
// Issue #4 — shared vote transforms (optimistic / server / delta rollback)
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<FeatureRequestItem> = {}): FeatureRequestItem {
  return {
    id: 'fr_1',
    appId: 'app_1',
    title: 'Original title',
    description: 'desc',
    status: 'open',
    approved: true,
    voteCount: 10,
    hasVoted: false,
    isOwnRequest: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

test('withOptimisticVote flips hasVoted and adjusts count, clamped at zero', () => {
  const upvoted = withOptimisticVote(makeItem({ hasVoted: false, voteCount: 10 }));
  assert.equal(upvoted.hasVoted, true);
  assert.equal(upvoted.voteCount, 11);

  const unvoted = withOptimisticVote(makeItem({ hasVoted: true, voteCount: 10 }));
  assert.equal(unvoted.hasVoted, false);
  assert.equal(unvoted.voteCount, 9);

  const clamped = withOptimisticVote(makeItem({ hasVoted: true, voteCount: 0 }));
  assert.equal(clamped.voteCount, 0);
});

test('withVoteRollback reverts only the vote fields against current state, not a stale snapshot', () => {
  const item = makeItem({ hasVoted: false, voteCount: 10 });

  // Tap: optimistic upvote applied -> current state now shows the optimistic vote
  const preVoteSnapshot = { hasVoted: item.hasVoted, voteCount: item.voteCount };
  const optimistic = withOptimisticVote(item);
  assert.equal(optimistic.hasVoted, true);
  assert.equal(optimistic.voteCount, 11);

  // Meanwhile, some other field changed (e.g. moderator renamed the request)
  const currentState = { ...optimistic, title: 'Renamed by moderator' };

  const rolledBack = withVoteRollback(currentState, preVoteSnapshot);
  assert.equal(rolledBack.hasVoted, false);
  assert.equal(rolledBack.voteCount, 10);
  // The concurrent field change survives the rollback
  assert.equal(rolledBack.title, 'Renamed by moderator');
});

test('withVoteRollback restores the exact pre-tap count even when the optimistic was clamped', () => {
  const item = makeItem({ hasVoted: true, voteCount: 1 });
  const preVoteSnapshot = { hasVoted: item.hasVoted, voteCount: item.voteCount };

  // Optimistic un-vote, then concurrent change
  const currentState = { ...withOptimisticVote(item), title: 'Touched' };
  assert.equal(currentState.voteCount, 0);

  const rolledBack = withVoteRollback(currentState, preVoteSnapshot);
  assert.equal(rolledBack.hasVoted, true);
  assert.equal(rolledBack.voteCount, 1);
  assert.equal(rolledBack.title, 'Touched');

  // Degenerate hasVoted=true + voteCount=0: optimistic clamps at 0, rollback is exact
  const zeroItem = makeItem({ hasVoted: true, voteCount: 0 });
  const zeroRollback = withVoteRollback(
    withOptimisticVote(zeroItem),
    { hasVoted: zeroItem.hasVoted, voteCount: zeroItem.voteCount }
  );
  assert.equal(zeroRollback.hasVoted, true);
  assert.equal(zeroRollback.voteCount, 0);
});

test('withServerVote applies the server truth as-is', () => {
  const current = makeItem({ hasVoted: true, voteCount: 99, title: 'Whatever current is' });
  const updated = withServerVote(current, { voted: false, voteCount: 98 });
  assert.equal(updated.hasVoted, false);
  assert.equal(updated.voteCount, 98);
  assert.equal(updated.title, 'Whatever current is');
});

// ---------------------------------------------------------------------------
// Issue #4 — Hook-level double-tap and in-flight guard tests
// ---------------------------------------------------------------------------

function renderTestHook<T>(hookFn: () => T) {
  const states: any[] = [];
  const refs: any[] = [];
  let index = 0;
  const listeners: (() => void)[] = [];

  const dispatcher = {
    useRef<V>(initial: V) {
      const idx = index++;
      if (!refs[idx]) refs[idx] = { current: initial };
      return refs[idx];
    },
    useState<V>(initial: V | (() => V)) {
      const idx = index++;
      if (!(idx in states)) {
        states[idx] = typeof initial === 'function' ? (initial as () => V)() : initial;
      }
      const setter = (val: V | ((prev: V) => V)) => {
        states[idx] = typeof val === 'function' ? (val as (prev: V) => V)(states[idx]) : val;
        listeners.forEach((l) => l());
      };
      return [states[idx], setter];
    },
    useCallback<F extends (...args: any[]) => any>(fn: F) {
      return fn;
    },
  };

  let currentResult: T;
  function render() {
    index = 0;
    const reactInternals = (React as any).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
    const prev = reactInternals.ReactCurrentDispatcher.current;
    reactInternals.ReactCurrentDispatcher.current = dispatcher;
    try {
      currentResult = hookFn();
    } finally {
      reactInternals.ReactCurrentDispatcher.current = prev;
    }
  }

  listeners.push(render);
  render();

  return {
    get result() {
      return currentResult;
    },
  };
}

test('useToggleVote prevents double-tap race and tracks isVoting in-flight state', async () => {
  let resolveVotePromise!: (res: any) => void;
  let callCount = 0;
  const mockClient = {
    toggleVote: async (_id: string, _token: string) => {
      callCount++;
      return new Promise((resolve) => {
        resolveVotePromise = resolve;
      });
    },
  } as any;

  let stateItem = makeItem({ id: 'fr_rapid', hasVoted: false, voteCount: 10 });
  const applyChange = (_id: string, transform: (item: FeatureRequestItem) => FeatureRequestItem) => {
    stateItem = transform(stateItem);
  };

  const harness = renderTestHook(() => useToggleVote(mockClient, 'test_user_token', applyChange));

  assert.equal(harness.result.isVoting('fr_rapid'), false);
  assert.equal(stateItem.hasVoted, false);
  assert.equal(stateItem.voteCount, 10);

  // First tap: triggers optimistic vote and initiates client request
  harness.result.toggleVote(stateItem);
  assert.equal(callCount, 1);
  assert.equal(stateItem.hasVoted, true);
  assert.equal(stateItem.voteCount, 11);
  assert.equal(harness.result.isVoting('fr_rapid'), true, 'isVoting must be true while in-flight');

  // Second tap while still in-flight (double-tap): must be ignored!
  harness.result.toggleVote(stateItem);
  assert.equal(callCount, 1, 'Rapid second tap must not dispatch a second request');
  assert.equal(harness.result.isVoting('fr_rapid'), true);

  // Server response resolves
  resolveVotePromise({ voted: true, voteCount: 11 });
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(harness.result.isVoting('fr_rapid'), false, 'isVoting must clear when resolved');
  assert.equal(stateItem.hasVoted, true);
  assert.equal(stateItem.voteCount, 11);
  assert.equal(callCount, 1);
});

test('useToggleVote rolls back optimistic state on network error and clears isVoting', async () => {
  let rejectVotePromise!: (err: any) => void;
  let callCount = 0;
  const mockClient = {
    toggleVote: async () => {
      callCount++;
      return new Promise((_resolve, reject) => {
        rejectVotePromise = reject;
      });
    },
  } as any;

  let stateItem = makeItem({ id: 'fr_fail', hasVoted: false, voteCount: 42 });
  const applyChange = (_id: string, transform: (item: FeatureRequestItem) => FeatureRequestItem) => {
    stateItem = transform(stateItem);
  };

  const harness = renderTestHook(() => useToggleVote(mockClient, 'test_user_token', applyChange));

  // Tap: optimistic update applied
  harness.result.toggleVote(stateItem);
  assert.equal(callCount, 1);
  assert.equal(stateItem.hasVoted, true);
  assert.equal(stateItem.voteCount, 43);
  assert.equal(harness.result.isVoting('fr_fail'), true);

  // Reject with error
  rejectVotePromise(new Error('Network disconnected'));
  await new Promise((r) => setTimeout(r, 10));

  // State should be rolled back to pre-tap state
  assert.equal(stateItem.hasVoted, false);
  assert.equal(stateItem.voteCount, 42);
  assert.equal(harness.result.isVoting('fr_fail'), false);
});

test('useToggleVote ignores own requests and empty userToken', () => {
  let callCount = 0;
  const mockClient = {
    toggleVote: async () => {
      callCount++;
      return { voted: true, voteCount: 1 };
    },
  } as any;

  let ownItem = makeItem({ id: 'fr_own', isOwnRequest: true, hasVoted: false, voteCount: 5 });
  const applyChange = (_id: string, transform: (item: FeatureRequestItem) => FeatureRequestItem) => {
    ownItem = transform(ownItem);
  };

  // With empty user token:
  const noTokenHarness = renderTestHook(() => useToggleVote(mockClient, '', applyChange));
  noTokenHarness.result.toggleVote(ownItem);
  assert.equal(callCount, 0);
  assert.equal(ownItem.hasVoted, false);

  // With own request:
  const harness = renderTestHook(() => useToggleVote(mockClient, 'user_token_123', applyChange));
  harness.result.toggleVote(ownItem);
  assert.equal(callCount, 0);
  assert.equal(ownItem.hasVoted, false);
});

// ---------------------------------------------------------------------------
// Issue #13 — uploadAttachment routed through the shared request pipeline
// ---------------------------------------------------------------------------

test('uploadAttachment sends X-User-Token and a multipart body without a JSON content type', async () => {
  const originalFetch = globalThis.fetch;
  let interceptedUrl = '';
  let interceptedMethod = '';
  let interceptedHeaders: Record<string, string> = {};
  let interceptedBody: any = null;

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    interceptedUrl = url.toString();
    interceptedMethod = init?.method || 'GET';
    interceptedHeaders = (init?.headers || {}) as Record<string, string>;
    interceptedBody = init?.body;
    return new Response(
      JSON.stringify({ kind: 'image', key: 'img_123', url: 'https://cdn.example/img_123.png' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_key_abc',
    });

    const attachment = await client.uploadAttachment({
      file: { uri: 'file:///tmp/screenshot.png' },
      filename: 'screenshot.png',
      mimeType: 'image/png',
      userToken: 'usr_tok_123',
    });

    assert.equal(interceptedUrl, 'https://api.cupthread.com/api/v1/uploads/images');
    assert.equal(interceptedMethod, 'POST');
    assert.equal(interceptedHeaders['X-User-Token'], 'usr_tok_123');
    assert.equal(
      interceptedHeaders['Content-Type'],
      undefined,
      'fetch must set the multipart boundary itself'
    );
    assert.ok(interceptedBody, 'body must be present');
    assert.equal(typeof interceptedBody.get === 'function', true, 'body must be FormData');
    assert.equal(interceptedBody.get('appKey'), 'app_key_abc');
    assert.equal(attachment.key, 'img_123');
    assert.equal(attachment.kind, 'image');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('uploadAttachment accepts 202 responses like the rest of the pipeline', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ kind: 'r2', key: 'log_1' }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    })) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_key_abc',
    });
    const attachment = await client.uploadAttachment({
      file: { uri: 'file:///tmp/crash.log' },
      filename: 'crash.log',
      mimeType: 'text/plain',
    });
    assert.equal(attachment.key, 'log_1');
    assert.equal(attachment.kind, 'r2');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('uploadAttachment maps error statuses through the shared pipeline', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () =>
    new Response('server exploded', { status: 500 })) as any;
  try {
    const client = new FeedbackClient({ baseUrl: 'https://api.cupthread.com', appKey: 'k' });
    await assert.rejects(
      client.uploadAttachment({
        file: { uri: 'file:///tmp/a.png' },
        filename: 'a.png',
        mimeType: 'image/png',
      }),
      (err: any) => {
        assert.ok(err instanceof UnexpectedStatusException);
        assert.equal(err.status, 500);
        assert.equal(err.message.includes('server exploded'), true);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })) as any;
  try {
    const client = new FeedbackClient({ baseUrl: 'https://api.cupthread.com', appKey: 'k' });
    await assert.rejects(
      client.uploadAttachment({
        file: { uri: 'file:///tmp/a.png' },
        filename: 'a.png',
        mimeType: 'image/png',
      }),
      (err: any) => {
        assert.ok(err instanceof AuthenticationRequiredException);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('uploadAttachment throws UnreadableUploadResponseException on malformed JSON', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response('this is not json {', { status: 200 })) as any;

  try {
    const client = new FeedbackClient({ baseUrl: 'https://api.cupthread.com', appKey: 'k' });
    await assert.rejects(
      client.uploadAttachment({
        file: { uri: 'file:///tmp/a.png' },
        filename: 'a.png',
        mimeType: 'image/png',
      }),
      (err: any) => {
        assert.ok(err instanceof UnreadableUploadResponseException);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// Issue #8 — async adapter race: resolved token always wins over throwaway identity
// ---------------------------------------------------------------------------

test('UserTokenStore: persisted token wins even if the sync getter was read during load', async () => {
  const EXISTING_TOKEN = 'persisted-token-wins-123';
  const mem: Record<string, string> = { 'cupthread_user_token_v1': EXISTING_TOKEN };

  const asyncAdapter = {
    getItem: async (key: string) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return mem[key] || null;
    },
    setItem: async (key: string, val: string) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      mem[key] = val;
    },
  };

  const store = new UserTokenStore(asyncAdapter);

  // Simulates the pre-fix provider seeding: sync getter during the load window
  // mints a throwaway in-memory UUID.
  const throwaway = store.token;
  assert.notEqual(throwaway, EXISTING_TOKEN);

  // Resolution must replace the throwaway identity with the persisted token…
  const resolved = await store.getToken();
  assert.equal(resolved, EXISTING_TOKEN);
  // …and the sync getter must now agree with it.
  assert.equal(store.token, EXISTING_TOKEN);
  // The throwaway UUID must never have been persisted.
  assert.equal(mem['cupthread_user_token_v1'], EXISTING_TOKEN);
});
