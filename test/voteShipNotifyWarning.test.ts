import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { FeedbackClient } from '../src/client/FeedbackClient';
import { useToggleVote } from '../src/hooks/useToggleVote';
import type { FeatureRequestItem, VoteResult } from '../src/types';

function makeItem(overrides: Partial<FeatureRequestItem> = {}): FeatureRequestItem {
  return {
    id: 'fr_1',
    appId: 'app_1',
    title: 'Dark mode support',
    description: 'Please add a dark theme option',
    status: 'open',
    approved: true,
    voteCount: 10,
    hasVoted: false,
    isOwnRequest: false,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * Minimal hook probe: enough of the dispatcher to exercise `useToggleVote`
 * (refs, state, callbacks, effects) without a React renderer.
 */
function renderTestHook<T>(hookFn: () => T) {
  const states: any[] = [];
  const refs: any[] = [];
  const callbacks: Array<{ fn: any; deps?: any[] }> = [];
  const effects: Array<{ cleanup?: (() => void) | void; deps?: any[] }> = [];
  let stateIndex = 0;
  let refIndex = 0;
  let callbackIndex = 0;
  let effectIndex = 0;

  const dispatcher = {
    useState<V>(initial: V | (() => V)) {
      const idx = stateIndex++;
      if (!(idx in states)) {
        states[idx] = typeof initial === 'function' ? (initial as () => V)() : initial;
      }
      const setter = (val: V | ((prev: V) => V)) => {
        states[idx] = typeof val === 'function' ? (val as (prev: V) => V)(states[idx]) : val;
      };
      return [states[idx], setter];
    },
    useRef<V>(initial: V) {
      const idx = refIndex++;
      if (!(idx in refs)) refs[idx] = { current: initial };
      return refs[idx];
    },
    useCallback<F extends (...args: any[]) => any>(fn: F, deps?: any[]) {
      const idx = callbackIndex++;
      const prev = callbacks[idx];
      if (
        prev &&
        deps &&
        prev.deps &&
        deps.length === prev.deps.length &&
        deps.every((d, i) => Object.is(d, prev.deps![i]))
      ) {
        return prev.fn;
      }
      callbacks[idx] = { fn, deps };
      return fn;
    },
    useEffect(effect: () => void | (() => void), deps?: any[]) {
      const idx = effectIndex++;
      const prev = effects[idx];
      const changed =
        !prev ||
        !deps ||
        !prev.deps ||
        deps.length !== prev.deps.length ||
        deps.some((d, i) => !Object.is(d, prev.deps![i]));
      if (changed) {
        if (typeof prev?.cleanup === 'function') prev.cleanup();
        effects[idx] = { cleanup: effect(), deps };
      }
    },
  };

  let currentResult: T;
  function render() {
    stateIndex = 0;
    refIndex = 0;
    callbackIndex = 0;
    effectIndex = 0;
    const internals = (React as any).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
    const prev = internals.ReactCurrentDispatcher.current;
    internals.ReactCurrentDispatcher.current = dispatcher;
    try {
      currentResult = hookFn();
    } finally {
      internals.ReactCurrentDispatcher.current = prev;
    }
  }

  render();

  return {
    get result() {
      return currentResult;
    },
    rerender: render,
    unmount() {
      for (const e of effects) {
        if (typeof e?.cleanup === 'function') e.cleanup();
      }
    },
  };
}

const flush = (ms = 15) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A client whose vote methods resolve with a canned result and record calls.
 */
function makeStubClient(result: VoteResult) {
  const calls: Array<{ method: string; id: string; token: string; options?: unknown }> = [];
  const client = {
    castVote: async (id: string, token: string, options?: unknown) => {
      calls.push({ method: 'castVote', id, token, options });
      return result;
    },
    removeVote: async (id: string, token: string) => {
      calls.push({ method: 'removeVote', id, token });
      return result;
    },
  } as unknown as FeedbackClient;
  return { client, calls };
}

test('castVote parses the email_not_verified warning without dropping the vote', async () => {
  const originalFetch = globalThis.fetch;
  let body: any = null;

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    body = init?.body ? JSON.parse(init.body as string) : null;
    return new Response(
      JSON.stringify({
        voted: true,
        voteCount: 11,
        warning: {
          code: 'email_not_verified',
          error: 'Ship notifications on this board are bound to your signed-in email address',
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_key_abc',
    });
    const result = await client.castVote('fr_1', 'usr_token', {
      shipNotifyEmail: 'someone@example.com',
    });

    assert.equal(result.voted, true);
    assert.equal(result.voteCount, 11);
    assert.equal(result.warning?.code, 'email_not_verified');
    assert.ok(result.warning?.error.includes('signed-in email address'));
    assert.equal(body.shipNotifyEmail, 'someone@example.com');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('castVote omits warning when the opt-in is accepted', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ voted: true, voteCount: 3 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_key_abc',
    });
    const result = await client.castVote('fr_1', 'usr_token');
    assert.equal(result.voted, true);
    assert.equal(result.warning, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('useToggleVote reports the warning through onVoteWarning and still applies the vote', async () => {
  const warning = {
    code: 'email_not_verified' as const,
    error: 'Ship notifications on this board are bound to your signed-in email address',
  };
  const { client, calls } = makeStubClient({ voted: true, voteCount: 11, warning });

  let stateItem = makeItem({ voteCount: 10, hasVoted: false });
  const applyChange = (_id: string, transform: (it: FeatureRequestItem) => FeatureRequestItem) => {
    stateItem = transform(stateItem);
  };

  const warnings: Array<{ warning: unknown; item: FeatureRequestItem }> = [];
  const errors: unknown[] = [];
  const harness = renderTestHook(() =>
    useToggleVote(client, 'usr_token', applyChange, {
      onVoteWarning: (w, item) => warnings.push({ warning: w, item }),
      onVoteError: (err) => errors.push(err),
      shipNotifyEmail: 'someone@example.com',
    })
  );

  harness.result.toggleVote(stateItem);
  // Optimistic state applies immediately.
  assert.equal(stateItem.hasVoted, true);
  assert.equal(stateItem.voteCount, 11);

  await flush();
  harness.rerender();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'castVote');
  assert.deepEqual(calls[0].options, { shipNotifyEmail: 'someone@example.com' });

  assert.equal(warnings.length, 1, 'the warning must be delivered exactly once');
  assert.deepEqual(warnings[0].warning, warning);
  assert.equal(warnings[0].item.id, 'fr_1');

  assert.equal(errors.length, 0, 'a warning is not an error');
  assert.equal(harness.result.voteError, null);

  // The server truth still reconciles the item.
  assert.equal(stateItem.hasVoted, true);
  assert.equal(stateItem.voteCount, 11);
  harness.unmount();
});

test('useToggleVote does not invoke onVoteWarning for a plain successful vote', async () => {
  const { client } = makeStubClient({ voted: true, voteCount: 11 });

  let stateItem = makeItem({ voteCount: 10, hasVoted: false });
  const applyChange = (_id: string, transform: (it: FeatureRequestItem) => FeatureRequestItem) => {
    stateItem = transform(stateItem);
  };

  const warnings: unknown[] = [];
  const harness = renderTestHook(() =>
    useToggleVote(client, 'usr_token', applyChange, {
      onVoteWarning: (w) => warnings.push(w),
    })
  );

  harness.result.toggleVote(stateItem);
  await flush();
  harness.rerender();

  assert.equal(warnings.length, 0);
  assert.equal(stateItem.hasVoted, true);
  assert.equal(stateItem.voteCount, 11);
  harness.unmount();
});

test('useToggleVote sends the opt-in only when casting, never when removing a vote', async () => {
  const { client, calls } = makeStubClient({ voted: false, voteCount: 9 });

  let stateItem = makeItem({ voteCount: 10, hasVoted: true });
  const applyChange = (_id: string, transform: (it: FeatureRequestItem) => FeatureRequestItem) => {
    stateItem = transform(stateItem);
  };

  const harness = renderTestHook(() =>
    useToggleVote(client, 'usr_token', applyChange, {
      shipNotifyEmail: 'someone@example.com',
    })
  );

  harness.result.toggleVote(stateItem);
  await flush();
  harness.rerender();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'removeVote');
  assert.equal(calls[0].options, undefined);
  assert.equal(stateItem.hasVoted, false);
  assert.equal(stateItem.voteCount, 9);
  harness.unmount();
});
