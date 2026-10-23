import test from 'node:test';
import assert from 'node:assert/strict';
import { FeedbackClient } from '../src/client/FeedbackClient';
import {
  MissingUnsubscribeTokenException,
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
function installFetch(status: number, body: unknown = { unsubscribed: true }) {
  const originalFetch = globalThis.fetch;
  const requests: RecordedRequest[] = [];

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: url.toString(),
      method: init?.method || 'GET',
      headers: (init?.headers || {}) as Record<string, string>,
      body: init?.body ? JSON.parse(init.body as string) : null,
    });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
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

test('unsubscribeFromChangelog posts the signed token and pins JSON content negotiation', async () => {
  const fetchMock = installFetch(200);

  try {
    const result = await makeClient().unsubscribeFromChangelog('signed.unsub.token');

    assert.deepEqual(result, { unsubscribed: true });
    assert.equal(fetchMock.requests.length, 1);

    const [request] = fetchMock.requests;
    assert.equal(
      request.url,
      'https://api.cupthread.com/api/v1/public/apps/app_key_abc/changelog/unsubscribe'
    );
    assert.equal(request.method, 'POST');
    assert.deepEqual(
      request.body,
      { token: 'signed.unsub.token' },
      'the removed bare-email payload must not be sent'
    );
    assert.equal((request.body as Record<string, unknown>).email, undefined);
    assert.equal(
      request.headers['Accept'],
      'application/json',
      'the endpoint renders an HTML landing page for browsers unless JSON is requested'
    );
    assert.equal(request.headers['Content-Type'], 'application/json');
  } finally {
    fetchMock.restore();
  }
});

test('unsubscribeFromChangelog trims surrounding whitespace from the token', async () => {
  const fetchMock = installFetch(200);

  try {
    await makeClient().unsubscribeFromChangelog('  signed.unsub.token\n');
    assert.deepEqual(fetchMock.requests[0].body, { token: 'signed.unsub.token' });
  } finally {
    fetchMock.restore();
  }
});

test('unsubscribeFromChangelog rejects a blank token locally without a request', async () => {
  const fetchMock = installFetch(200);

  try {
    for (const token of ['', '   ', '\n\t']) {
      await assert.rejects(
        makeClient().unsubscribeFromChangelog(token),
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

test('unsubscribeFromChangelog percent-encodes the app key path segment', async () => {
  const fetchMock = installFetch(200);

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app key/../x?y#z',
    });
    await client.unsubscribeFromChangelog('signed.unsub.token');

    const url = fetchMock.requests[0].url;
    assert.ok(url.includes('/changelog/unsubscribe'));
    assert.ok(!url.includes('app key/'), 'the app key must not escape its path segment');
    assert.ok(!url.includes('?y'), 'the app key must not inject a query string');
  } finally {
    fetchMock.restore();
  }
});

test('unsubscribeFromChangelog maps a 403 on a private app to UnexpectedStatusException', async () => {
  const fetchMock = installFetch(403, {
    error: 'Public surfaces are disabled for this app',
  });

  try {
    await assert.rejects(
      makeClient().unsubscribeFromChangelog('signed.unsub.token'),
      (err: any) => {
        assert.ok(err instanceof UnexpectedStatusException);
        assert.equal(err.status, 403);
        assert.equal(err.message.includes('Public surfaces are disabled'), false);
        assert.ok(err.responseBody.includes('Public surfaces are disabled'));
        return true;
      }
    );
  } finally {
    fetchMock.restore();
  }
});

test('unsubscribeFromChangelog maps an unverifiable token 400 to UnexpectedStatusException', async () => {
  const fetchMock = installFetch(400, { error: 'Invalid or expired unsubscribe token' });

  try {
    await assert.rejects(makeClient().unsubscribeFromChangelog('forged.token'), (err: any) => {
      assert.ok(err instanceof UnexpectedStatusException);
      assert.equal(err.status, 400);
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
    const pending = makeClient().unsubscribeFromChangelog(
      'signed.unsub.token',
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

test('unsubscribeFromChangelog forwards the caller abort signal', async () => {
  const { sawAbort } = await abortInFlight((controller) => ({ signal: controller.signal }));
  assert.equal(sawAbort, true, 'aborting the caller must reach the in-flight request');
});

test('unsubscribeFromChangelog accepts a bare AbortSignal as its second argument', async () => {
  const { sawAbort } = await abortInFlight((controller) => controller.signal);
  assert.equal(sawAbort, true, 'aborting the caller must reach the in-flight request');
});
