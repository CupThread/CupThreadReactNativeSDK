import test from 'node:test';
import assert from 'node:assert/strict';
import { FeedbackClient } from '../src/client/FeedbackClient';
import {
  AuthenticationRequiredException,
  InvalidResponseException,
  RateLimitedException,
  UnexpectedStatusException,
} from '../src/client/FeedbackException';
import type { FeatureRequestItem } from '../src/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequestRecord(
  id: string,
  overrides: Partial<FeatureRequestItem> = {}
): FeatureRequestItem {
  return {
    id,
    appId: 'app_1',
    title: 'Dark mode',
    description: 'Please ship a theme.',
    status: 'planned',
    voteCount: 7,
    commentCount: 2,
    hasVoted: false,
    isOwnRequest: false,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-02T00:00:00.000Z',
    ...overrides,
  } as FeatureRequestItem;
}

interface RecordedRequest {
  url: string;
  method: string;
  userTokenHeader: string | null;
}

/**
 * Serves the single feature-request read from a fixed response and records
 * every request, including whether an `X-User-Token` header traveled.
 */
function installSingleReadFetch(respond: (target: string) => { status: number; body?: unknown }): {
  requests: RecordedRequest[];
  restore: () => void;
} {
  const originalFetch = globalThis.fetch;
  const requests: RecordedRequest[] = [];

  globalThis.fetch = (async (url: string | URL | Request, init?: any) => {
    const target = url.toString();
    if (target.includes('/feature-requests/')) {
      requests.push({
        url: target,
        method: init?.method ?? 'GET',
        userTokenHeader: init?.headers?.['X-User-Token'] ?? null,
      });
      const route = respond(target);
      return new Response(
        typeof route.body === 'string' ? route.body : JSON.stringify(route.body ?? {}),
        { status: route.status, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response('not found', { status: 404 });
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
    appKey: 'app_single_read_test',
  });
}

// ---------------------------------------------------------------------------
// fetchFeatureRequest
// ---------------------------------------------------------------------------

test('fetchFeatureRequest hits the {id} route, unwraps the record, and stays anonymous without a token', async () => {
  const record = makeRequestRecord('fr_1', { hasVoted: true, isOwnRequest: true });
  const fetchMock = installSingleReadFetch(() => ({ status: 200, body: { request: record } }));

  try {
    const result = await makeClient().fetchFeatureRequest('fr_1');
    assert.equal(result.id, 'fr_1');
    assert.equal(result.hasVoted, true, 'personalization fields must reach the caller untouched');
    assert.equal(result.isOwnRequest, true);
    assert.equal(result.title, 'Dark mode');
    assert.equal(fetchMock.requests.length, 1);
    assert.equal(fetchMock.requests[0].method, 'GET');
    assert.equal(
      fetchMock.requests[0].url,
      'https://api.cupthread.com/api/v1/feature-requests/fr_1'
    );
    assert.equal(
      fetchMock.requests[0].userTokenHeader,
      null,
      'no X-User-Token may travel for an anonymous read'
    );
  } finally {
    fetchMock.restore();
  }
});

test('fetchFeatureRequest sends the caller token as the X-User-Token header', async () => {
  const record = makeRequestRecord('fr_2', { hasVoted: true });
  const fetchMock = installSingleReadFetch(() => ({ status: 200, body: { request: record } }));

  try {
    const result = await makeClient().fetchFeatureRequest('fr_2', { userToken: 'usr_tok_abc' });
    assert.equal(result.hasVoted, true);
    assert.equal(
      fetchMock.requests[0].userTokenHeader,
      'usr_tok_abc',
      'identity must travel as the X-User-Token header'
    );
    assert.ok(
      !fetchMock.requests[0].url.includes('userToken='),
      'the token must never leak into the query string'
    );
  } finally {
    fetchMock.restore();
  }
});

test('fetchFeatureRequest percent-encodes the id into the path', async () => {
  const fetchMock = installSingleReadFetch(() => ({
    status: 200,
    body: { request: makeRequestRecord('fr_x') },
  }));

  try {
    await makeClient().fetchFeatureRequest('fr odd/1');
    assert.equal(
      fetchMock.requests[0].url,
      'https://api.cupthread.com/api/v1/feature-requests/fr%20odd%2F1',
      'the raw id must be percent-encoded into a single path segment'
    );
  } finally {
    fetchMock.restore();
  }
});

test('fetchFeatureRequest surfaces the uniform 404 as UnexpectedStatusException', async () => {
  const fetchMock = installSingleReadFetch(() => ({
    status: 404,
    body: { error: 'Feature request not found' },
  }));

  try {
    await assert.rejects(
      () => makeClient().fetchFeatureRequest('fr_missing'),
      (err: any) => {
        assert.ok(err instanceof UnexpectedStatusException);
        assert.equal(err.status, 404);
        assert.equal(err.name, 'UnexpectedStatusException');
        return true;
      },
      'existence hiding must resolve to a typed 404, not a crash on an undefined record'
    );
  } finally {
    fetchMock.restore();
  }
});

test('fetchFeatureRequest maps 401 and 429 to their typed exceptions', async () => {
  const cases: Array<{
    status: number;
    body: unknown;
    matches: (err: any) => boolean;
    label: string;
  }> = [
    {
      status: 401,
      body: { code: 'authentication_required' },
      matches: (err) => err instanceof AuthenticationRequiredException,
      label: 'AuthenticationRequiredException',
    },
    {
      status: 429,
      body: { error: 'Rate limit exceeded' },
      matches: (err) => err instanceof RateLimitedException,
      label: 'RateLimitedException',
    },
  ];
  for (const { status, body, matches, label } of cases) {
    const fetchMock = installSingleReadFetch(() => ({ status, body }));
    try {
      await assert.rejects(
        () => makeClient().fetchFeatureRequest('fr_1'),
        (err: any) => {
          assert.ok(matches(err), `HTTP ${status} must surface as ${label}`);
          return true;
        }
      );
    } finally {
      fetchMock.restore();
    }
  }
});

test('fetchFeatureRequest rejects a malformed 200 body without a request record', async () => {
  const fetchMock = installSingleReadFetch(() => ({ status: 200, body: { requests: [] } }));

  try {
    await assert.rejects(
      () => makeClient().fetchFeatureRequest('fr_1'),
      (err: any) => {
        assert.ok(err instanceof InvalidResponseException);
        assert.match(err.message, /no request record/);
        return true;
      }
    );
  } finally {
    fetchMock.restore();
  }
});

test('fetchFeatureRequest honors abort signals and request timeouts', async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  controller.abort();

  globalThis.fetch = (async (_url: any, init?: any) => {
    const signal: AbortSignal | undefined = init?.signal;
    if (signal?.aborted) {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    }
    return new Response('{}', { status: 200 });
  }) as any;

  try {
    await assert.rejects(
      () => makeClient().fetchFeatureRequest('fr_1', { signal: controller.signal }),
      (err: any) => err?.name === 'AbortError'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
