import test from 'node:test';
import assert from 'node:assert/strict';
import { FeedbackClient } from '../src/client/FeedbackClient';
import {
  MissingUnsubscribeTokenException,
  RateLimitedException,
  UnexpectedStatusException,
} from '../src/client/FeedbackException';

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
}

/**
 * Installs a fetch stub that records the unsubscribe request and answers with
 * the given status/body.
 */
function installFetch(status: number, body: unknown = { unsubscribed: true }, retryAfter?: string) {
  const originalFetch = globalThis.fetch;
  const requests: RecordedRequest[] = [];

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: url.toString(),
      method: init?.method || 'GET',
      headers: (init?.headers || {}) as Record<string, string>,
      body: init?.body ? JSON.parse(init.body as string) : null,
    });
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (retryAfter) headers['Retry-After'] = retryAfter;
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers,
    });
  }) as any;

  return {
    requests,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

function makeClient(): FeedbackClient {
  return new FeedbackClient({
    baseUrl: 'https://api.cupthread.com',
    appKey: 'app_key_abc',
  });
}

test('unsubscribeFromDigest posts the signed token to the workspace-scoped path and pins JSON', async () => {
  const fetchMock = installFetch(200);

  try {
    const result = await makeClient().unsubscribeFromDigest('signed.digest.token');

    assert.deepEqual(result, { unsubscribed: true });
    assert.equal(fetchMock.requests.length, 1);

    const [request] = fetchMock.requests;
    assert.equal(request.url, 'https://api.cupthread.com/api/v1/public/digest/unsubscribe');
    assert.equal(request.method, 'POST');
    assert.deepEqual(request.body, { token: 'signed.digest.token' });
    assert.equal(
      request.headers['Accept'],
      'application/json',
      'the endpoint renders an HTML landing page for browser form submissions unless JSON is requested'
    );
    assert.equal(request.headers['Content-Type'], 'application/json');
    assert.equal(
      request.url.includes('app_key_abc'),
      false,
      'the digest token is workspace-scoped, so the app key must not be sent'
    );
    assert.equal(
      (request.body as Record<string, unknown>).appKey,
      undefined,
      'the digest token is workspace-scoped, so the app key must not be sent'
    );
  } finally {
    fetchMock.restore();
  }
});

test('unsubscribeFromDigest trims surrounding whitespace from the token', async () => {
  const fetchMock = installFetch(200);

  try {
    await makeClient().unsubscribeFromDigest('  signed.digest.token\n');
    assert.deepEqual(fetchMock.requests[0].body, { token: 'signed.digest.token' });
  } finally {
    fetchMock.restore();
  }
});

test('unsubscribeFromDigest rejects a blank token locally without a request', async () => {
  const fetchMock = installFetch(200);

  try {
    for (const token of ['', '   ', '\n\t']) {
      await assert.rejects(
        makeClient().unsubscribeFromDigest(token),
        (err: any) => {
          assert.ok(err instanceof MissingUnsubscribeTokenException);
          return true;
        },
        `blank token ${JSON.stringify(token)} must be rejected locally`
      );
    }
    assert.equal(fetchMock.requests.length, 0, 'no request may be dispatched');
  } finally {
    fetchMock.restore();
  }
});

test('unsubscribeFromDigest keeps the token out of the URL so it cannot inject a query string', async () => {
  const fetchMock = installFetch(200);
  const token = 'signed&unsubscribed=true#frag';

  try {
    await makeClient().unsubscribeFromDigest(token);

    const [request] = fetchMock.requests;
    assert.equal(request.url, 'https://api.cupthread.com/api/v1/public/digest/unsubscribe');
    assert.equal(request.url.includes('unsubscribed=true'), false);
    assert.deepEqual(request.body, { token });
  } finally {
    fetchMock.restore();
  }
});

test('unsubscribeFromDigest replays the POST instead of short-circuiting on a prior success', async () => {
  const fetchMock = installFetch(200);

  try {
    const client = makeClient();
    await client.unsubscribeFromDigest('signed.digest.token');
    await client.unsubscribeFromDigest('signed.digest.token');

    assert.equal(
      fetchMock.requests.length,
      2,
      'the server treats replay as idempotent, so the client must not cache the outcome'
    );
    assert.deepEqual(fetchMock.requests[1].body, { token: 'signed.digest.token' });
  } finally {
    fetchMock.restore();
  }
});

test('unsubscribeFromDigest maps an invalid or expired token 400 to UnexpectedStatusException', async () => {
  const fetchMock = installFetch(400, { error: 'Invalid or expired unsubscribe token' });

  try {
    await assert.rejects(makeClient().unsubscribeFromDigest('forged.token'), (err: any) => {
      assert.ok(err instanceof UnexpectedStatusException);
      assert.equal(err.status, 400);
      assert.equal(err.message.includes('Invalid or expired'), false);
      assert.ok(err.responseBody.includes('Invalid or expired'));
      return true;
    });
  } finally {
    fetchMock.restore();
  }
});

test('unsubscribeFromDigest surfaces the 429 retry hint from Retry-After', async () => {
  const fetchMock = installFetch(429, { error: 'Too many requests' }, '30');

  try {
    await assert.rejects(makeClient().unsubscribeFromDigest('signed.digest.token'), (err: any) => {
      assert.ok(err instanceof RateLimitedException);
      assert.equal(err.status, 429);
      assert.equal(err.retryAfterMs, 30_000);
      return true;
    });
  } finally {
    fetchMock.restore();
  }
});

/**
 * Starts an unsubscribe whose fetch never settles on its own, aborts the
 * caller's controller while it is in flight, and reports the signal fetch saw.
 */
async function abortInFlight(
  passSignal: (controller: AbortController) => AbortSignal | { signal: AbortSignal }
): Promise<{ sawAbort: boolean }> {
  const originalFetch = globalThis.fetch;
  let sawAbort = false;
  let receivedSignal: AbortSignal | undefined;

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    receivedSignal = init?.signal ?? undefined;
    return new Promise<Response>((_resolve, reject) => {
      const onAbort = () => {
        sawAbort = true;
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      };
      if (receivedSignal?.aborted) return onAbort();
      receivedSignal?.addEventListener('abort', onAbort, { once: true });
    });
  }) as any;

  try {
    const controller = new AbortController();
    const pending = makeClient().unsubscribeFromDigest(
      'signed.digest.token',
      passSignal(controller) as any
    );
    // Let the request reach fetch before aborting it.
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    await assert.rejects(pending, (err: any) => err?.name === 'AbortError');
    return { sawAbort };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('unsubscribeFromDigest forwards the caller abort signal', async () => {
  const { sawAbort } = await abortInFlight((controller) => ({ signal: controller.signal }));
  assert.equal(sawAbort, true, 'aborting the caller must reach the in-flight request');
});

test('unsubscribeFromDigest accepts a bare AbortSignal as its second argument', async () => {
  const { sawAbort } = await abortInFlight((controller) => controller.signal);
  assert.equal(sawAbort, true, 'aborting the caller must reach the in-flight request');
});
