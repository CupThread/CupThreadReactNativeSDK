import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { FeedbackClient } from '../src/client/FeedbackClient';
import {
  AuthenticationRequiredException,
  RateLimitedException,
  UnexpectedStatusException,
} from '../src/client/FeedbackException';
import {
  MAX_SEARCH_COOLDOWN_MS,
  SEARCH_COOLDOWN_MS,
  SEARCH_MIN_SPACING_MS,
  SearchRateLimiter,
} from '../src/utils/searchRateLimiter';
import { useFeatureRequests } from '../src/hooks/useFeatureRequests';
import { enStrings } from '../src/i18n';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/** Let pending timers, microtasks, and act-batched state updates settle. */
async function flush(times = 8, sleepMs = 4): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, sleepMs));
    await act(async () => {});
  }
}

// ---------------------------------------------------------------------------
// Client-level 429 mapping
// ---------------------------------------------------------------------------

function stubFetchOnce(status: number, headers: Record<string, string> = {}, body = '') {
  const originalFetch = globalThis.fetch;
  let capturedUrl = '';
  globalThis.fetch = (async (url: string | URL | Request) => {
    capturedUrl = url.toString();
    return new Response(body, { status, headers });
  }) as any;
  return {
    capturedUrl: () => capturedUrl,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

test('HTTP 429 maps to RateLimitedException with Retry-After in milliseconds', async () => {
  const stub = stubFetchOnce(429, { 'Retry-After': '30' }, '{"error":"rate limited"}');
  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_key_abc',
    });
    await assert.rejects(
      client.fetchFeatureRequests({ userToken: 'tok', query: 'widget' }),
      (err: any) => {
        assert.ok(err instanceof RateLimitedException);
        assert.equal(err.name, 'RateLimitedException');
        assert.equal(err.status, 429);
        assert.equal(err.retryAfterMs, 30000);
        return true;
      }
    );
  } finally {
    stub.restore();
  }
});

test('HTTP 429 without Retry-After yields null retryAfterMs; other statuses unaffected', async () => {
  const originalFetch = globalThis.fetch;
  let call = 0;
  globalThis.fetch = (async () => {
    call += 1;
    return call === 1
      ? new Response('{"error":"rate limited"}', { status: 429 })
      : new Response('', { status: 401 });
  }) as any;
  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_key_abc',
    });
    await assert.rejects(
      client.fetchFeatureRequests({ userToken: 'tok', query: 'widget' }),
      (err: any) => {
        assert.ok(err instanceof RateLimitedException);
        assert.equal(err.retryAfterMs, null);
        // The raw body stays on the exception for debugging, not in the message.
        assert.equal(err.responseBody, '{"error":"rate limited"}');
        assert.ok(!err.message.includes('rate limited'));
        return true;
      }
    );
    await assert.rejects(
      client.fetchFeatureRequests({ userToken: 'tok' }),
      (err: any) => err instanceof AuthenticationRequiredException
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('parseRetryAfterMs accepts delta-seconds and HTTP-date forms', async () => {
  const stubDate = stubFetchOnce(429, {
    'Retry-After': new Date(Date.now() + 15000).toUTCString(),
  });
  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_key_abc',
    });
    await assert.rejects(
      client.fetchFeatureRequests({ userToken: 'tok', query: 'widget' }),
      (err: any) => {
        assert.ok(err instanceof RateLimitedException);
        assert.equal(typeof err.retryAfterMs, 'number');
        assert.ok(err.retryAfterMs! >= 0 && err.retryAfterMs! <= 20000);
        return true;
      }
    );
  } finally {
    stubDate.restore();
  }

  const stubGarbage = stubFetchOnce(429, { 'Retry-After': 'not-a-date' });
  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_key_abc',
    });
    await assert.rejects(
      client.fetchFeatureRequests({ userToken: 'tok', query: 'widget' }),
      (err: any) => {
        assert.ok(err instanceof RateLimitedException);
        assert.equal(err.retryAfterMs, null);
        return true;
      }
    );
  } finally {
    stubGarbage.restore();
  }
});

test('Non-429 unexpected statuses still raise UnexpectedStatusException', async () => {
  const stub = stubFetchOnce(502, {}, '<html>bad gateway</html>');
  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_key_abc',
    });
    await assert.rejects(
      client.fetchFeatureRequests({ userToken: 'tok' }),
      (err: any) => err instanceof UnexpectedStatusException
    );
  } finally {
    stub.restore();
  }
});

// ---------------------------------------------------------------------------
// SearchRateLimiter pacing (virtual clock)
// ---------------------------------------------------------------------------

function makeVirtualClock() {
  let t = 1_000_000;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

test('SearchRateLimiter enforces minimum spacing between searches', () => {
  const clock = makeVirtualClock();
  const limiter = new SearchRateLimiter({ minSpacingMs: 2500, now: clock.now });

  assert.ok(limiter.canFetch());
  limiter.markFetched();

  clock.advance(1000);
  assert.ok(!limiter.canFetch());
  assert.equal(limiter.waitTime(), 1500);

  clock.advance(1499);
  assert.ok(!limiter.canFetch());

  clock.advance(1);
  assert.ok(limiter.canFetch());
  assert.equal(limiter.waitTime(), 0);
});

test('SearchRateLimiter default cooldown after 429 lasts 60s', () => {
  const clock = makeVirtualClock();
  const limiter = new SearchRateLimiter({ now: clock.now });

  const applied = limiter.enterCooldown(null);
  assert.equal(applied, SEARCH_COOLDOWN_MS);
  assert.ok(!limiter.canFetch());
  assert.equal(limiter.waitTime(), SEARCH_COOLDOWN_MS);

  clock.advance(SEARCH_COOLDOWN_MS - 1);
  assert.ok(!limiter.canFetch());

  clock.advance(1);
  assert.ok(limiter.canFetch());
});

test('SearchRateLimiter honors Retry-After and clamps pathological values', () => {
  const clock = makeVirtualClock();
  const limiter = new SearchRateLimiter({ now: clock.now });

  assert.equal(limiter.enterCooldown(10_000), 10_000);
  clock.advance(10_000);
  assert.ok(limiter.canFetch());

  assert.equal(limiter.enterCooldown(999_999), MAX_SEARCH_COOLDOWN_MS);
  assert.equal(limiter.cooldownRemaining(), MAX_SEARCH_COOLDOWN_MS);
});

test('Sustained typing never exceeds the 30 searches / 60s server budget', () => {
  const clock = makeVirtualClock();
  const limiter = new SearchRateLimiter({ now: clock.now });

  // Simulate a keystroke every 300ms for 10 minutes; each debounce window
  // attempts one search (the screen's 250ms debounce is subsumed by pacing).
  let fetches = 0;
  const startedAt = clock.now();
  const windowStarts: number[] = [];
  const windowCounts: number[] = [];

  for (let i = 0; i < 2000; i++) {
    clock.advance(300);
    if (limiter.canFetch()) {
      limiter.markFetched();
      fetches += 1;
      windowStarts.push(clock.now());
      windowCounts.push(1);
    }
  }

  // Sliding 60s budget check: no window of searches exceeds 30.
  for (let i = 0; i < windowStarts.length; i++) {
    let inWindow = 0;
    for (let j = i; j < windowStarts.length && windowStarts[j] - windowStarts[i] < 60_000; j++) {
      inWindow += 1;
    }
    assert.ok(inWindow <= 30, `search burst of ${inWindow} within 60s exceeds server budget`);
  }

  // 10 minutes at 2.5s spacing ≈ 240 fetches — well under 30/min * 10.
  assert.ok(fetches <= 30 * 10);
  assert.ok(fetches >= 200);
  assert.equal(clock.now() - startedAt, 2000 * 300);
});

test('SearchRateLimiter uses production defaults', () => {
  const clock = makeVirtualClock();
  const limiter = new SearchRateLimiter({ now: clock.now });
  limiter.markFetched();
  clock.advance(SEARCH_MIN_SPACING_MS - 1);
  assert.ok(!limiter.canFetch());
  clock.advance(1);
  assert.ok(limiter.canFetch());
});

// ---------------------------------------------------------------------------
// Hook wiring (render tests)
// ---------------------------------------------------------------------------

interface SearchCall {
  q: string | null;
  offset: string | null;
}

function makeSearchClient(responder: (call: SearchCall, index: number) => Response) {
  const calls: SearchCall[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    const parsed = new URL(url.toString());
    const call: SearchCall = {
      q: parsed.searchParams.get('q'),
      offset: parsed.searchParams.get('offset'),
    };
    const index = calls.length;
    calls.push(call);
    return responder(call, index);
  }) as any;
  return {
    calls,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

function page(requests: Array<{ id: string; title: string }>, total = requests.length) {
  return new Response(JSON.stringify({ requests, total }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

type LatestResult = ReturnType<typeof useFeatureRequests> | null;

function HookProbe({ options, latest }: { options: any; latest: { current: LatestResult } }) {
  latest.current = useFeatureRequests(options);
  return null;
}

const FAST_LIMITER = { minSpacingMs: 0, cooldownMs: 80 };

test('useFeatureRequests initial load populates items without rate limiting', async () => {
  const stub = makeSearchClient(() =>
    page([
      { id: 'fr_1', title: 'A' },
      { id: 'fr_2', title: 'B' },
    ])
  );
  try {
    const client = new FeedbackClient({ baseUrl: 'https://api.cupthread.com', appKey: 'app_key' });
    const latest: { current: LatestResult } = { current: null };
    const options: any = { client, userToken: 'tok', searchRateLimiterOptions: FAST_LIMITER };

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(HookProbe, { options, latest }));
    });
    await flush();

    assert.equal(latest.current!.items.length, 2);
    assert.equal(latest.current!.isLoading, false);
    assert.equal(latest.current!.isRateLimited, false);
    assert.equal(stub.calls.length, 1);
    assert.equal(stub.calls[0].q, null);
    renderer.unmount();
  } finally {
    stub.restore();
  }
});

test('useFeatureRequests does not refetch for the same trimmed query', async () => {
  const stub = makeSearchClient(() => page([{ id: 'fr_1', title: 'A' }]));
  try {
    const client = new FeedbackClient({ baseUrl: 'https://api.cupthread.com', appKey: 'app_key' });
    const latest: { current: LatestResult } = { current: null };
    let options: any = {
      client,
      userToken: 'tok',
      query: 'widget',
      searchRateLimiterOptions: FAST_LIMITER,
    };

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(HookProbe, { options, latest }));
    });
    await flush();
    assert.equal(stub.calls.length, 1);

    // Whitespace-only change: same trimmed query + version filter → no refetch.
    options = { ...options, query: ' widget ' };
    await act(async () => {
      renderer.update(React.createElement(HookProbe, { options, latest }));
    });
    await flush();
    assert.equal(stub.calls.length, 1, 'same trimmed query must not refetch');

    // A genuinely different query does fetch.
    options = { ...options, query: 'gadget' };
    await act(async () => {
      renderer.update(React.createElement(HookProbe, { options, latest }));
    });
    await flush();
    assert.equal(stub.calls.length, 2);
    assert.equal(stub.calls[1].q, 'gadget');
    renderer.unmount();
  } finally {
    stub.restore();
  }
});

test('useFeatureRequests enters cooldown after a 429 and keeps prior results on screen', async () => {
  const stub = makeSearchClient((call, index) => {
    if (call.q === null)
      return page([
        { id: 'fr_1', title: 'A' },
        { id: 'fr_2', title: 'B' },
      ]);
    // First search 429s; searches after the cooldown succeed.
    return index === 1
      ? new Response('{"error":"rate limited"}', { status: 429 })
      : page([{ id: 'fr_9', title: 'Found' }]);
  });
  try {
    const client = new FeedbackClient({ baseUrl: 'https://api.cupthread.com', appKey: 'app_key' });
    const latest: { current: LatestResult } = { current: null };
    let options: any = { client, userToken: 'tok', searchRateLimiterOptions: FAST_LIMITER };

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(HookProbe, { options, latest }));
    });
    await flush();
    assert.equal(latest.current!.items.length, 2);

    // Search trips the 429.
    options = { ...options, query: 'widget' };
    await act(async () => {
      renderer.update(React.createElement(HookProbe, { options, latest }));
    });
    await flush();

    assert.ok(latest.current!.error instanceof RateLimitedException);
    assert.equal(latest.current!.isRateLimited, true);
    // Non-destructive: the previously loaded results stay on screen.
    assert.equal(latest.current!.items.length, 2);

    // While the cooldown is active, further query changes do not fetch.
    options = { ...options, query: 'widget two' };
    await act(async () => {
      renderer.update(React.createElement(HookProbe, { options, latest }));
    });
    await flush();
    assert.equal(stub.calls.length, 2, 'cooldown must suppress further searches');

    // After the injected 80ms cooldown elapses, searching resumes and clears
    // the rate-limit flag on success.
    await new Promise((resolve) => setTimeout(resolve, 120));
    options = { ...options, query: 'widget three' };
    await act(async () => {
      renderer.update(React.createElement(HookProbe, { options, latest }));
    });
    await flush();

    assert.equal(latest.current!.isRateLimited, false);
    assert.equal(latest.current!.items.length, 1);
    assert.equal(latest.current!.items[0].id, 'fr_9');
    assert.equal(stub.calls.length, 3);
    renderer.unmount();
  } finally {
    stub.restore();
  }
});

test(
  'useFeatureRequests spaces consecutive searches using the limiter',
  { timeout: 5000 },
  async () => {
    const stub = makeSearchClient(() => page([{ id: 'fr_1', title: 'A' }]));
    try {
      const client = new FeedbackClient({
        baseUrl: 'https://api.cupthread.com',
        appKey: 'app_key',
      });
      const latest: { current: LatestResult } = { current: null };
      let options: any = {
        client,
        userToken: 'tok',
        query: 'a',
        searchRateLimiterOptions: { minSpacingMs: 300, cooldownMs: 80 },
      };

      let renderer!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        renderer = TestRenderer.create(React.createElement(HookProbe, { options, latest }));
      });
      await flush();
      assert.equal(stub.calls.length, 1);

      // An immediate second distinct query waits out the 300ms spacing window
      // (debounce 0 + waitTime) instead of firing right away.
      options = { ...options, query: 'b' };
      await act(async () => {
        renderer.update(React.createElement(HookProbe, { options, latest }));
      });
      await flush(4, 8); // ~32ms — still well inside the spacing window
      assert.equal(stub.calls.length, 1, 'second search must wait for spacing');

      await new Promise((resolve) => setTimeout(resolve, 350));
      await flush();
      assert.equal(stub.calls.length, 2);
      assert.equal(stub.calls[1].q, 'b');
      renderer.unmount();
    } finally {
      stub.restore();
    }
  }
);

test('localized rate-limit notice exists for the feature requests screen', () => {
  assert.equal(
    enStrings.featureRequests.rateLimited,
    'Too many searches. Please wait a moment and try again.'
  );
});
