import test from 'node:test';
import assert from 'node:assert/strict';
import { FeedbackClient } from '../src/client/FeedbackClient';
import { UserTokenStore } from '../src/client/UserTokenStore';
import {
  InsecureBaseUrlException,
  InvalidConfigPayloadException,
  InvalidResponseException,
  UnreadableUploadResponseException,
} from '../src/client/FeedbackException';
import { FeedbackPlatformUtil } from '../src/utils/platform';

test('FeedbackClient normalizes baseUrl and holds config', () => {
  const client = new FeedbackClient({
    baseUrl: 'https://api.cupthread.com/',
    appKey: 'app_test_123',
    defaultPlatform: 'ios',
  });

  assert.equal(client.config.baseUrl, 'https://api.cupthread.com');
  assert.equal(client.config.appKey, 'app_test_123');
  assert.equal(client.config.defaultPlatform, 'ios');
  assert.equal(client.config.allowInsecureBaseUrl, false);
});

test('FeedbackClient rejects a cleartext baseUrl before any request can carry a token', () => {
  assert.throws(
    () =>
      new FeedbackClient({
        baseUrl: 'http://api.cupthread.com',
        appKey: 'app_test_123',
      }),
    (err: any) => {
      assert.ok(err instanceof InsecureBaseUrlException);
      assert.equal(err.name, 'InsecureBaseUrlException');
      assert.match(err.message, /https:\/\//);
      return true;
    }
  );

  // A schemeless baseUrl is not HTTPS either, so it must not slip through.
  assert.throws(
    () => new FeedbackClient({ baseUrl: 'api.cupthread.com', appKey: 'app_test_123' }),
    InsecureBaseUrlException
  );
});

test('FeedbackClient allows a cleartext baseUrl only through the explicit opt-in', () => {
  const client = new FeedbackClient({
    baseUrl: 'http://localhost:3000/',
    appKey: 'app_test_123',
    allowInsecureBaseUrl: true,
  });

  assert.equal(client.config.baseUrl, 'http://localhost:3000');
  assert.equal(client.config.allowInsecureBaseUrl, true);
});

test('FeedbackPlatformUtil maps wire values correctly', () => {
  assert.equal(FeedbackPlatformUtil.fromWire('ios'), 'ios');
  assert.equal(FeedbackPlatformUtil.fromWire('android'), 'android');
  assert.equal(FeedbackPlatformUtil.fromWire('macos'), 'macos');
  assert.equal(FeedbackPlatformUtil.fromWire('universal'), 'universal');
  assert.equal(FeedbackPlatformUtil.fromWire('invalid'), undefined);
});

test('FeedbackClient.submitFeatureRequest dispatches POST /api/v1/feature-requests with correct payload', async () => {
  const originalFetch = globalThis.fetch;
  let interceptedUrl = '';
  let interceptedMethod = '';
  let interceptedBody: any = null;

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    interceptedUrl = url.toString();
    interceptedMethod = init?.method || 'GET';
    interceptedBody = init?.body ? JSON.parse(init.body as string) : null;
    return new Response(JSON.stringify({ featureRequestId: 'fr_test_999', pending: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_key_abc',
    });

    const result = await client.submitFeatureRequest(
      {
        title: 'Dark Mode Widget',
        description: 'Support dark appearance for widgets',
        requesterName: 'Alex',
      },
      'usr_tok_123'
    );

    assert.equal(interceptedUrl, 'https://api.cupthread.com/api/v1/feature-requests');
    assert.equal(interceptedMethod, 'POST');
    assert.equal(interceptedBody.appKey, 'app_key_abc');
    assert.equal(interceptedBody.title, 'Dark Mode Widget');
    assert.equal(interceptedBody.description, 'Support dark appearance for widgets');
    assert.equal(interceptedBody.requesterName, 'Alex');
    assert.equal(interceptedBody.requesterToken, 'usr_tok_123');
    assert.equal(result.featureRequestId, 'fr_test_999');
    assert.equal(result.pending, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('prepareChangelogOverlay respects onlyIfUnseen filtering', async () => {
  const { UserTokenStore } = await import('../src/client/UserTokenStore');
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (url: string | URL | Request) => {
    const s = url.toString();
    if (s.includes('/api/v1/public/config/')) {
      return new Response(
        JSON.stringify({
          appKey: 'app_test',
          sdk: {
            features: { changelog: true },
            changelogOverlay: { entryCount: 3 },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (s.includes('/changelog')) {
      return new Response(
        JSON.stringify({
          entries: [
            {
              id: 'ch_1',
              versionLabel: '1.5.0',
              title: 'New release',
              body: 'Release notes',
              publishedAt: new Date().toISOString(),
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response('{}', { status: 200 });
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_test',
    });

    const mem: Record<string, string> = {};
    const testStore = new UserTokenStore({
      getItem: (k) => mem[k] || null,
      setItem: (k, v) => {
        mem[k] = v;
      },
    });

    // 1. First check when unseen: returns overlay data
    const overlay1 = await client.prepareChangelogOverlay({
      onlyIfUnseen: true,
      tokenStore: testStore,
    });
    assert.ok(overlay1);
    assert.equal(overlay1?.latestKey, '1.5.0');
    assert.equal(overlay1?.entries.length, 1);

    // 2. Mark changelog seen within the client's app scope
    await testStore.markChangelogSeen('1.5.0', client.config.appKey);

    // 3. Query with onlyIfUnseen: true: should now be null
    const overlay2 = await client.prepareChangelogOverlay({
      onlyIfUnseen: true,
      tokenStore: testStore,
    });
    assert.equal(
      overlay2,
      null,
      'Should return null when latest changelog version was already seen'
    );

    // 4. Query without onlyIfUnseen: returns data
    const overlay3 = await client.prepareChangelogOverlay({
      onlyIfUnseen: false,
      tokenStore: testStore,
    });
    assert.ok(overlay3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

const HOSTILE_SEGMENT = 'a b/c?d=e#f%g';
const HOSTILE_SEGMENT_ENCODED = 'a%20b%2Fc%3Fd%3De%23f%25g';

test('FeedbackClient percent-encodes appKey, featureRequestId, and userId path segments', async () => {
  const originalFetch = globalThis.fetch;
  const interceptedUrls: string[] = [];

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    interceptedUrls.push(url.toString());
    // The table only asserts URLs, but `postComment` and vote endpoints validate
    // their responses, so their routes need spec-shaped envelopes.
    if (init?.method === 'POST' && url.toString().endsWith('/comments')) {
      return new Response(
        JSON.stringify({
          comment: { id: 'c_enc', body: 'ok', createdAt: '2026-10-25T00:00:00.000Z' },
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url.toString().endsWith('/vote')) {
      return new Response(
        JSON.stringify({
          voted: true,
          voteCount: 1,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url.toString().endsWith('/changelog/subscribe')) {
      return new Response(
        JSON.stringify({
          subscribed: true,
          alreadySubscribed: false,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (
      url.toString().endsWith('/changelog/unsubscribe') ||
      url.toString().endsWith('/digest/unsubscribe')
    ) {
      return new Response(
        JSON.stringify({
          unsubscribed: true,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url.toString().endsWith('/user')) {
      return new Response(
        JSON.stringify({
          ok: true,
          updatedAt: '2026-09-01T10:00:00.000Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: HOSTILE_SEGMENT,
    });

    const cases: Array<{
      label: string;
      run: () => Promise<unknown>;
      expected: string;
      expectedQuery?: string;
    }> = [
      {
        label: 'fetchAppConfig',
        run: () => client.fetchAppConfig(),
        expected: `https://api.cupthread.com/api/v1/public/config/${HOSTILE_SEGMENT_ENCODED}`,
      },
      {
        label: 'fetchColumns',
        run: () => client.fetchColumns(),
        expected: `https://api.cupthread.com/api/v1/public/columns/${HOSTILE_SEGMENT_ENCODED}`,
      },
      {
        label: 'fetchVersions',
        run: () => client.fetchVersions(),
        expected: `https://api.cupthread.com/api/v1/public/versions/${HOSTILE_SEGMENT_ENCODED}`,
      },
      {
        label: 'castVote',
        run: () => client.castVote(HOSTILE_SEGMENT, 'usr_tok'),
        expected: `https://api.cupthread.com/api/v1/feature-requests/${HOSTILE_SEGMENT_ENCODED}/vote`,
      },
      {
        label: 'removeVote',
        run: () => client.removeVote(HOSTILE_SEGMENT, 'usr_tok'),
        expected: `https://api.cupthread.com/api/v1/feature-requests/${HOSTILE_SEGMENT_ENCODED}/vote`,
      },
      {
        label: 'toggleVote',
        run: () => client.toggleVote(HOSTILE_SEGMENT, 'usr_tok'),
        expected: `https://api.cupthread.com/api/v1/feature-requests/${HOSTILE_SEGMENT_ENCODED}/vote`,
      },
      {
        label: 'listComments',
        run: () => client.listComments(HOSTILE_SEGMENT),
        expected: `https://api.cupthread.com/api/v1/feature-requests/${HOSTILE_SEGMENT_ENCODED}/comments?limit=200`,
        expectedQuery: '?limit=200',
      },
      {
        label: 'fetchComments',
        run: () => client.fetchComments(HOSTILE_SEGMENT),
        expected: `https://api.cupthread.com/api/v1/feature-requests/${HOSTILE_SEGMENT_ENCODED}/comments?limit=200`,
        expectedQuery: '?limit=200',
      },
      {
        label: 'postComment',
        run: () => client.postComment(HOSTILE_SEGMENT, { body: 'Looks great!' }, 'usr_tok'),
        expected: `https://api.cupthread.com/api/v1/feature-requests/${HOSTILE_SEGMENT_ENCODED}/comments`,
      },
      {
        label: 'fetchChangelog',
        run: () => client.fetchChangelog(),
        expected: `https://api.cupthread.com/api/v1/public/apps/${HOSTILE_SEGMENT_ENCODED}/changelog?limit=100`,
        expectedQuery: '?limit=100',
      },
      {
        label: 'subscribeToChangelog',
        run: () => client.subscribeToChangelog('user@example.com', 'usr_tok'),
        expected: `https://api.cupthread.com/api/v1/public/apps/${HOSTILE_SEGMENT_ENCODED}/changelog/subscribe`,
      },
      {
        label: 'unsubscribeFromChangelog',
        run: () => client.unsubscribeFromChangelog('unsub.token.value'),
        expected: `https://api.cupthread.com/api/v1/public/apps/${HOSTILE_SEGMENT_ENCODED}/changelog/unsubscribe`,
      },
      {
        label: 'updateUserAttributes',
        run: () => client.updateUserAttributes({ userToken: 'usr_tok', isPaying: true }),
        expected: `https://api.cupthread.com/api/v1/public/apps/${HOSTILE_SEGMENT_ENCODED}/user`,
      },
      {
        label: 'fetchUserProfile',
        run: () => client.fetchUserProfile(HOSTILE_SEGMENT),
        // `URLSearchParams` encodes a query-string space as `+` (RFC 3986 form encoding).
        expected: `https://api.cupthread.com/api/v1/users/${HOSTILE_SEGMENT_ENCODED}/profile?appKey=${HOSTILE_SEGMENT_ENCODED.replace('%20', '+')}`,
        expectedQuery: `?appKey=${HOSTILE_SEGMENT_ENCODED.replace('%20', '+')}`,
      },
    ];

    for (const testCase of cases) {
      interceptedUrls.length = 0;
      await testCase.run();
      assert.equal(interceptedUrls.length, 1, testCase.label);
      const url = interceptedUrls[0];
      assert.equal(url, testCase.expected, testCase.label);
      // Segment containment: reserved characters must never escape into the
      // URL structure (no stray query, fragment, or unencoded separators).
      // The changelog list is the one method allowed a query string (cursor
      // pagination parameters), so its declared query is stripped first.
      const withoutQuery =
        testCase.expectedQuery && url.endsWith(testCase.expectedQuery)
          ? url.slice(0, url.length - testCase.expectedQuery.length)
          : url;
      assert.ok(!withoutQuery.includes('?'), `${testCase.label}: no raw "?" in URL`);
      assert.ok(!withoutQuery.includes('#'), `${testCase.label}: no raw "#" in URL`);
      assert.ok(!url.includes(' '), `${testCase.label}: no raw space in URL`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient leaves ordinary path segments byte-identical (no double-encoding)', async () => {
  const originalFetch = globalThis.fetch;
  const interceptedUrls: string[] = [];

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    interceptedUrls.push(url.toString());
    // Same spec-shaped envelope requirement as the hostile-segment table.
    if (init?.method === 'POST' && url.toString().endsWith('/comments')) {
      return new Response(
        JSON.stringify({
          comment: { id: 'c_plain', body: 'ok', createdAt: '2026-10-25T00:00:00.000Z' },
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url.toString().endsWith('/vote')) {
      return new Response(
        JSON.stringify({
          voted: true,
          voteCount: 1,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url.toString().endsWith('/changelog/subscribe')) {
      return new Response(
        JSON.stringify({
          subscribed: true,
          alreadySubscribed: false,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (
      url.toString().endsWith('/changelog/unsubscribe') ||
      url.toString().endsWith('/digest/unsubscribe')
    ) {
      return new Response(
        JSON.stringify({
          unsubscribed: true,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url.toString().endsWith('/user')) {
      return new Response(
        JSON.stringify({
          ok: true,
          updatedAt: '2026-09-01T10:00:00.000Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_key_abc',
    });

    const cases: Array<{
      label: string;
      run: () => Promise<unknown>;
      expected: string;
      expectedQuery?: string;
    }> = [
      {
        label: 'fetchAppConfig',
        run: () => client.fetchAppConfig(),
        expected: 'https://api.cupthread.com/api/v1/public/config/app_key_abc',
      },
      {
        label: 'fetchColumns',
        run: () => client.fetchColumns(),
        expected: 'https://api.cupthread.com/api/v1/public/columns/app_key_abc',
      },
      {
        label: 'fetchVersions',
        run: () => client.fetchVersions(),
        expected: 'https://api.cupthread.com/api/v1/public/versions/app_key_abc',
      },
      {
        label: 'castVote',
        run: () => client.castVote('fr_123', 'usr_tok'),
        expected: 'https://api.cupthread.com/api/v1/feature-requests/fr_123/vote',
      },
      {
        label: 'removeVote',
        run: () => client.removeVote('fr_123', 'usr_tok'),
        expected: 'https://api.cupthread.com/api/v1/feature-requests/fr_123/vote',
      },
      {
        label: 'toggleVote',
        run: () => client.toggleVote('fr_123', 'usr_tok'),
        expected: 'https://api.cupthread.com/api/v1/feature-requests/fr_123/vote',
      },
      {
        label: 'listComments',
        run: () => client.listComments('fr_123'),
        expected: 'https://api.cupthread.com/api/v1/feature-requests/fr_123/comments?limit=200',
      },
      {
        label: 'fetchComments',
        run: () => client.fetchComments('fr_123'),
        expected: 'https://api.cupthread.com/api/v1/feature-requests/fr_123/comments?limit=200',
      },
      {
        label: 'postComment',
        run: () => client.postComment('fr_123', { body: 'Nice' }, 'usr_tok'),
        expected: 'https://api.cupthread.com/api/v1/feature-requests/fr_123/comments',
      },
      {
        label: 'fetchChangelog',
        run: () => client.fetchChangelog(),
        expected: 'https://api.cupthread.com/api/v1/public/apps/app_key_abc/changelog?limit=100',
      },
      {
        label: 'subscribeToChangelog',
        run: () => client.subscribeToChangelog('user@example.com', 'usr_tok'),
        expected: 'https://api.cupthread.com/api/v1/public/apps/app_key_abc/changelog/subscribe',
      },
      {
        label: 'unsubscribeFromChangelog',
        run: () => client.unsubscribeFromChangelog('unsub.token.value'),
        expected: 'https://api.cupthread.com/api/v1/public/apps/app_key_abc/changelog/unsubscribe',
      },
      {
        label: 'updateUserAttributes',
        run: () => client.updateUserAttributes({ userToken: 'usr_tok', isPaying: true }),
        expected: 'https://api.cupthread.com/api/v1/public/apps/app_key_abc/user',
      },
      {
        label: 'fetchUserProfile',
        run: () => client.fetchUserProfile('user_42'),
        expected: 'https://api.cupthread.com/api/v1/users/user_42/profile?appKey=app_key_abc',
      },
    ];

    for (const testCase of cases) {
      interceptedUrls.length = 0;
      await testCase.run();
      assert.equal(interceptedUrls.length, 1, testCase.label);
      assert.equal(interceptedUrls[0], testCase.expected, testCase.label);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient round-trips non-ASCII path segments through UTF-8 percent-encoding', async () => {
  const originalFetch = globalThis.fetch;
  let interceptedUrl = '';

  globalThis.fetch = (async (url: string | URL | Request) => {
    interceptedUrl = url.toString();
    return new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_key_abc',
    });

    await client.fetchUserProfile('üser-42');

    assert.equal(
      interceptedUrl,
      'https://api.cupthread.com/api/v1/users/%C3%BCser-42/profile?appKey=app_key_abc'
    );
    const encodedSegment = interceptedUrl.slice(
      interceptedUrl.indexOf('/api/v1/users/') + '/api/v1/users/'.length,
      interceptedUrl.lastIndexOf('/profile')
    );
    assert.equal(decodeURIComponent(encodedSegment), 'üser-42');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient.castVote sends POST /api/v1/feature-requests/:id/vote with optional shipNotifyEmail and turnstileToken', async () => {
  const originalFetch = globalThis.fetch;
  const captured: Array<{ url: string; method?: string; body?: any }> = [];

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    captured.push({
      url: url.toString(),
      method: init?.method,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(JSON.stringify({ voted: true, voteCount: 12 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_vote_test',
    });

    // 1. Plain castVote omits optional fields
    const res1 = await client.castVote('fr_100', 'usr_tok_1');
    assert.deepEqual(res1, { voted: true, voteCount: 12 });
    assert.equal(captured.length, 1);
    assert.equal(captured[0].url, 'https://api.cupthread.com/api/v1/feature-requests/fr_100/vote');
    assert.equal(captured[0].method, 'POST');
    assert.deepEqual(captured[0].body, {
      appKey: 'app_vote_test',
      userToken: 'usr_tok_1',
    });

    // 2. castVote trims shipNotifyEmail and turnstileToken, omitting blank values
    await client.castVote('fr_100', 'usr_tok_1', {
      shipNotifyEmail: '  notify@example.com  ',
      turnstileToken: '  ts_tok_abc  ',
    });
    assert.equal(captured.length, 2);
    assert.equal(captured[1].method, 'POST');
    assert.deepEqual(captured[1].body, {
      appKey: 'app_vote_test',
      userToken: 'usr_tok_1',
      shipNotifyEmail: 'notify@example.com',
      turnstileToken: 'ts_tok_abc',
    });

    // 3. Whitespace-only optional fields are omitted
    await client.castVote('fr_100', 'usr_tok_1', {
      shipNotifyEmail: '   ',
      turnstileToken: '',
    });
    assert.equal(captured.length, 3);
    assert.deepEqual(captured[2].body, {
      appKey: 'app_vote_test',
      userToken: 'usr_tok_1',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient.removeVote sends DELETE /api/v1/feature-requests/:id/vote with { appKey, userToken } body', async () => {
  const originalFetch = globalThis.fetch;
  let capturedUrl = '';
  let capturedMethod: string | undefined;
  let capturedBody: any;

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    capturedUrl = url.toString();
    capturedMethod = init?.method;
    capturedBody = init?.body ? JSON.parse(String(init.body)) : undefined;
    return new Response(JSON.stringify({ voted: false, voteCount: 11 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_vote_test',
    });

    const res = await client.removeVote('fr_100', 'usr_tok_1');
    assert.deepEqual(res, { voted: false, voteCount: 11 });
    assert.equal(capturedUrl, 'https://api.cupthread.com/api/v1/feature-requests/fr_100/vote');
    assert.equal(capturedMethod, 'DELETE');
    assert.deepEqual(capturedBody, {
      appKey: 'app_vote_test',
      userToken: 'usr_tok_1',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient.castVote and removeVote reject empty or whitespace userToken without issuing network requests', async () => {
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;

  globalThis.fetch = (async () => {
    networkCalls++;
    return new Response(JSON.stringify({ voted: true, voteCount: 1 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_vote_validation',
    });

    const invalidTokens: any[] = ['', '   ', '\t\n', null, undefined, 123, {}];

    for (const invalidToken of invalidTokens) {
      await assert.rejects(
        () => client.castVote('fr_100', invalidToken),
        (err: any) => {
          assert.ok(err instanceof TypeError);
          assert.match(err.message, /Expected a non-empty string for userToken/);
          return true;
        }
      );

      await assert.rejects(
        () => client.removeVote('fr_100', invalidToken),
        (err: any) => {
          assert.ok(err instanceof TypeError);
          assert.match(err.message, /Expected a non-empty string for userToken/);
          return true;
        }
      );

      await assert.rejects(
        () => client.toggleVote('fr_100', invalidToken),
        (err: any) => {
          assert.ok(err instanceof TypeError);
          assert.match(err.message, /Expected a non-empty string for userToken/);
          return true;
        }
      );
    }

    assert.equal(networkCalls, 0, 'No network requests should be issued for invalid userTokens');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient.castVote and removeVote trim whitespace from userToken in request body', async () => {
  const originalFetch = globalThis.fetch;
  const capturedBodies: any[] = [];

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    capturedBodies.push(init?.body ? JSON.parse(String(init.body)) : undefined);
    return new Response(JSON.stringify({ voted: true, voteCount: 1 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_vote_trim_test',
    });

    await client.castVote('fr_100', '   usr_padded_token_1   ');
    await client.removeVote('fr_100', ' \t usr_padded_token_2 \n ');

    assert.equal(capturedBodies.length, 2);
    assert.equal(capturedBodies[0].userToken, 'usr_padded_token_1');
    assert.equal(capturedBodies[1].userToken, 'usr_padded_token_2');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient.submitFeatureRequest rejects empty or whitespace userToken without issuing network requests', async () => {
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;

  globalThis.fetch = (async () => {
    networkCalls++;
    return new Response(JSON.stringify({ featureRequestId: 'fr_test', pending: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_submit_validation',
    });

    const invalidTokens: any[] = ['', '   ', '\t\n', null, undefined, 123, {}];

    for (const invalidToken of invalidTokens) {
      await assert.rejects(
        () =>
          client.submitFeatureRequest(
            { title: 'Feature Title', description: 'Feature Description' },
            invalidToken
          ),
        (err: any) => {
          assert.ok(err instanceof TypeError);
          assert.match(err.message, /Expected a non-empty string for userToken/);
          return true;
        }
      );
    }

    assert.equal(networkCalls, 0, 'No network requests should be issued for invalid userTokens');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient.submitFeatureRequest rejects invalid draft title or description without issuing network requests', async () => {
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;

  globalThis.fetch = (async () => {
    networkCalls++;
    return new Response(JSON.stringify({ featureRequestId: 'fr_test', pending: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_submit_draft_validation',
    });

    const invalidValues: any[] = ['', '   ', '\t\n', null, undefined, 123, {}];

    for (const invalidTitle of invalidValues) {
      await assert.rejects(
        () =>
          client.submitFeatureRequest(
            { title: invalidTitle, description: 'Valid Description' } as any,
            'usr_valid_token'
          ),
        (err: any) => {
          assert.ok(err instanceof TypeError);
          assert.match(err.message, /Expected a non-empty string for draft\.title/);
          return true;
        }
      );
    }

    for (const invalidDesc of invalidValues) {
      await assert.rejects(
        () =>
          client.submitFeatureRequest(
            { title: 'Valid Title', description: invalidDesc } as any,
            'usr_valid_token'
          ),
        (err: any) => {
          assert.ok(err instanceof TypeError);
          assert.match(err.message, /Expected a non-empty string for draft\.description/);
          return true;
        }
      );
    }

    // null, undefined, or non-object draft
    for (const invalidDraft of [null, undefined, 'draft', 123, true]) {
      await assert.rejects(
        () => client.submitFeatureRequest(invalidDraft as any, 'usr_valid_token'),
        (err: any) => {
          assert.ok(err instanceof TypeError);
          assert.match(err.message, /Expected a draft object for submitFeatureRequest/);
          return true;
        }
      );
    }

    assert.equal(networkCalls, 0, 'No network requests should be issued for invalid draft fields');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient.submitFeatureRequest trims whitespace from userToken and draft fields in request body', async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: any = null;

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    capturedBody = init?.body ? JSON.parse(String(init.body)) : undefined;
    return new Response(JSON.stringify({ featureRequestId: 'fr_test_padded', pending: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_submit_trim_test',
    });

    await client.submitFeatureRequest(
      {
        title: '   Export CSV and JSON   ',
        description: '   Add CSV export button to metrics view   ',
        requesterName: '   Taylor   ',
      },
      '   usr_padded_token_123   '
    );

    assert.ok(capturedBody);
    assert.equal(capturedBody.title, 'Export CSV and JSON');
    assert.equal(capturedBody.description, 'Add CSV export button to metrics view');
    assert.equal(capturedBody.requesterName, 'Taylor');
    assert.equal(capturedBody.requesterToken, 'usr_padded_token_123');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient.submitFeatureRequest defensively handles non-string or whitespace-only draft.requesterName', async () => {
  const originalFetch = globalThis.fetch;
  const capturedBodies: any[] = [];

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    capturedBodies.push(init?.body ? JSON.parse(String(init.body)) : undefined);
    return new Response(
      JSON.stringify({ featureRequestId: 'fr_test_non_string', pending: false }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_requester_name_test',
    });

    const nonStringOrWhitespaceValues: any[] = [1042, true, false, {}, [], '   ', ''];
    for (const val of nonStringOrWhitespaceValues) {
      await client.submitFeatureRequest(
        {
          title: 'Export to JSON',
          description: 'Allow exporting user records to JSON format',
          requesterName: val,
        },
        'usr_tok'
      );
    }

    assert.equal(capturedBodies.length, nonStringOrWhitespaceValues.length);
    for (const body of capturedBodies) {
      assert.equal(body.title, 'Export to JSON');
      assert.equal(body.description, 'Allow exporting user records to JSON format');
      assert.equal(body.requesterName, undefined);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient resolveTurnstileToken defensively handles non-string explicit tokens and non-string provider results', async () => {
  const originalFetch = globalThis.fetch;
  const capturedBodies: any[] = [];

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    capturedBodies.push(init?.body ? JSON.parse(String(init.body)) : undefined);
    return new Response(
      JSON.stringify({
        featureRequestId: 'fr_turnstile_test',
        submissionId: 'sub_1',
        id: 'fb_1',
        pending: false,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }) as any;

  try {
    // 1. Non-string explicit tokens on submitFeatureRequest and submit without provider
    const clientWithoutProvider = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_turnstile_non_string',
    });

    await clientWithoutProvider.submitFeatureRequest(
      {
        title: 'Feature Title',
        description: 'Feature Description',
        turnstileToken: 12345 as any,
      },
      'usr_tok'
    );
    assert.equal(capturedBodies[0].turnstileToken, undefined);

    await clientWithoutProvider.submit({
      title: 'Feedback Title',
      description: 'Feedback Description',
      turnstileToken: { token: 'invalid' } as any,
    });
    assert.equal(capturedBodies[1].turnstileToken, undefined);

    // 2. Provider returning non-string values
    const clientWithInvalidProvider = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_turnstile_invalid_prov',
      turnstileTokenProvider: async () => ({ token: 'abc' }) as any,
    });

    await clientWithInvalidProvider.submitFeatureRequest(
      {
        title: 'Feature Title 2',
        description: 'Feature Description 2',
      },
      'usr_tok'
    );
    assert.equal(capturedBodies[2].turnstileToken, undefined);

    await clientWithInvalidProvider.submit({
      title: 'Feedback Title 2',
      description: 'Feedback Description 2',
    });
    assert.equal(capturedBodies[3].turnstileToken, undefined);

    // 3. Provider returning padded valid token
    const clientWithPaddedProvider = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_turnstile_padded_prov',
      turnstileTokenProvider: async () => '   tok_from_provider   ',
    });

    await clientWithPaddedProvider.submitFeatureRequest(
      {
        title: 'Feature Title 3',
        description: 'Feature Description 3',
      },
      'usr_tok'
    );
    assert.equal(capturedBodies[4].turnstileToken, 'tok_from_provider');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient.submit rejects invalid draft title or description without issuing network requests', async () => {
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;

  globalThis.fetch = (async () => {
    networkCalls++;
    return new Response(JSON.stringify({ feedbackId: 'fb_test', status: 'created' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_submit_draft_validation',
    });

    const invalidValues: any[] = ['', '   ', '\t\n', null, undefined, 123, {}];

    for (const invalidTitle of invalidValues) {
      await assert.rejects(
        () =>
          client.submit({
            title: invalidTitle,
            description: 'Valid Description',
          } as any),
        (err: any) => {
          assert.ok(err instanceof TypeError);
          assert.match(err.message, /Expected a non-empty string for draft\.title/);
          return true;
        }
      );
    }

    for (const invalidDesc of invalidValues) {
      await assert.rejects(
        () =>
          client.submit({
            title: 'Valid Title',
            description: invalidDesc,
          } as any),
        (err: any) => {
          assert.ok(err instanceof TypeError);
          assert.match(err.message, /Expected a non-empty string for draft\.description/);
          return true;
        }
      );
    }

    // null, undefined, or non-object draft
    for (const invalidDraft of [null, undefined, 'draft', 123, true]) {
      await assert.rejects(
        () => client.submit(invalidDraft as any),
        (err: any) => {
          assert.ok(err instanceof TypeError);
          assert.match(err.message, /Expected a draft object for submit/);
          return true;
        }
      );
    }

    assert.equal(networkCalls, 0, 'No network requests should be issued for invalid draft fields');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient.submit trims whitespace from draft title and description in request body', async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: any = null;

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    capturedBody = init?.body ? JSON.parse(String(init.body)) : undefined;
    return new Response(
      JSON.stringify({
        submissionId: 'sub_test_trim',
        feedbackId: 'fb_test_trim',
        status: 'created',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_submit_trim_test',
    });

    await client.submit({
      title: '   Settings screen layout glitch   ',
      description: '   Elements overlap on rotation   ',
    });

    assert.ok(capturedBody);
    assert.equal(capturedBody.title, 'Settings screen layout glitch');
    assert.equal(capturedBody.description, 'Elements overlap on rotation');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient.submit validates reporterEmail and defensively handles optional fields (#231)', async () => {
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  let capturedBody: any = null;

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    networkCalls++;
    capturedBody = init?.body ? JSON.parse(String(init.body)) : undefined;
    return new Response(
      JSON.stringify({
        submissionId: 'sub_test_email',
        feedbackId: 'fb_test_email',
        status: 'created',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_submit_email_validation',
    });

    const invalidEmails: any[] = [
      'invalid-email',
      'user@',
      '@domain.com',
      '.user@example.com',
      'user.@example.com',
      'a..b@example.com',
      'user@domain..com',
      '"alice\nbob"@example.com',
      '"alice\\\nbob"@example.com',
      '"alice\x00bob"@example.com',
      123,
      true,
      {},
      ['user@example.com'],
    ];

    for (const invalidEmail of invalidEmails) {
      networkCalls = 0;
      await assert.rejects(
        () =>
          client.submit({
            title: 'Bug report',
            description: 'Something crashed',
            reporterEmail: invalidEmail,
          }),
        (err: any) => {
          assert.ok(err instanceof TypeError);
          assert.match(err.message, /Expected a valid email address for draft\.reporterEmail/);
          return true;
        }
      );
      assert.equal(
        networkCalls,
        0,
        `network call must not be made for invalid reporterEmail: ${JSON.stringify(invalidEmail)}`
      );
    }

    // Turnstile provider must not be invoked if reporterEmail is invalid
    let turnstileCalls = 0;
    const clientWithTurnstile = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_submit_email_turnstile',
      turnstileTokenProvider: async () => {
        turnstileCalls++;
        throw new Error('turnstileTokenProvider should not be called');
      },
    });

    await assert.rejects(
      () =>
        clientWithTurnstile.submit({
          title: 'Bug report',
          description: 'Something crashed',
          reporterEmail: 'bad-email',
        }),
      (err: any) => {
        assert.ok(err instanceof TypeError);
        assert.match(err.message, /Expected a valid email address for draft\.reporterEmail/);
        return true;
      }
    );
    assert.equal(
      turnstileCalls,
      0,
      'turnstile provider must not be called when reporterEmail is invalid'
    );

    // Padded valid email and padded optional string fields should be trimmed
    networkCalls = 0;
    await client.submit({
      title: 'Valid title',
      description: 'Valid description',
      reporterEmail: '   user@example.com   ',
      reporterName: '   Jane Doe   ',
      appVersion: '   2.1.0   ',
      buildNumber: '   456   ',
    });
    assert.equal(networkCalls, 1);
    assert.equal(capturedBody.reporterEmail, 'user@example.com');
    assert.equal(capturedBody.reporterName, 'Jane Doe');
    assert.equal(capturedBody.appVersion, '2.1.0');
    assert.equal(capturedBody.buildNumber, '456');

    // Empty or whitespace-only optional strings should be normalized to undefined
    networkCalls = 0;
    await client.submit({
      title: 'Valid title',
      description: 'Valid description',
      reporterEmail: '   ',
      reporterName: '   ',
      appVersion: '',
      buildNumber: '   ',
    });
    assert.equal(networkCalls, 1);
    assert.equal(capturedBody.reporterEmail, undefined);
    assert.equal(capturedBody.reporterName, undefined);
    assert.equal(capturedBody.appVersion, undefined);
    assert.equal(capturedBody.buildNumber, undefined);

    // Valid email with quoted local part containing dots should reach the wire
    networkCalls = 0;
    await client.submit({
      title: 'Valid title',
      description: 'Valid description',
      reporterEmail: '   ".user."@example.com   ',
    });
    assert.equal(networkCalls, 1);
    assert.equal(capturedBody.reporterEmail, '".user."@example.com');

    // Non-string values for reporterName, appVersion, buildNumber should not throw TypeError
    networkCalls = 0;
    await client.submit({
      title: 'Valid title',
      description: 'Valid description',
      reporterName: 123 as any,
      appVersion: 1.5 as any,
      buildNumber: 108 as any,
    });
    assert.equal(networkCalls, 1);
    assert.equal(capturedBody.reporterName, undefined);
    assert.equal(capturedBody.appVersion, undefined);
    assert.equal(capturedBody.buildNumber, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient.submit with attachments falls back to UserTokenStore when userToken is empty or whitespace-only', async () => {
  const originalFetch = globalThis.fetch;
  let capturedHeaders: any = null;

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    capturedHeaders = new Headers(init?.headers);
    return new Response(
      JSON.stringify({
        submissionId: 'sub_test_store',
        feedbackId: 'fb_test_store',
        status: 'created',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_submit_store_token_test',
    });

    const storeToken = await UserTokenStore.shared.getToken();
    assert.ok(storeToken, 'UserTokenStore should provide an identity token');

    await client.submit(
      {
        title: 'Crash report with screenshot',
        description: 'App terminated unexpectedly',
        attachments: [
          {
            kind: 'image',
            key: 'screenshot.png',
            uploadId: 'upl_session_file_1',
          },
        ],
      },
      '   '
    );

    assert.ok(capturedHeaders);
    assert.equal(capturedHeaders.get('x-user-token'), storeToken);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient.submit trims whitespace from userToken in X-User-Token header', async () => {
  const originalFetch = globalThis.fetch;
  let capturedHeaders: any = null;

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    capturedHeaders = new Headers(init?.headers);
    return new Response(
      JSON.stringify({
        submissionId: 'sub_test_padded',
        feedbackId: 'fb_test_padded',
        status: 'created',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_submit_padded_token_test',
    });

    await client.submit(
      {
        title: 'Feature suggestion',
        description: 'Add dark mode toggle',
      },
      '   usr_padded_custom_token   '
    );

    assert.ok(capturedHeaders);
    assert.equal(capturedHeaders.get('x-user-token'), 'usr_padded_custom_token');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient.submit without attachments omits X-User-Token header when userToken is whitespace-only', async () => {
  const originalFetch = globalThis.fetch;
  let capturedHeaders: any = null;

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    capturedHeaders = new Headers(init?.headers);
    return new Response(
      JSON.stringify({
        submissionId: 'sub_test_empty_token',
        feedbackId: 'fb_test_empty_token',
        status: 'created',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_submit_empty_token_test',
    });

    await client.submit(
      {
        title: 'Feature suggestion',
        description: 'Add export option',
      },
      '   \t\n  '
    );

    assert.ok(capturedHeaders);
    assert.equal(capturedHeaders.get('x-user-token'), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient.submit: safely handles non-array attachments without throwing TypeError (#350)', async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: any = null;

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    capturedBody = JSON.parse(init?.body as string);
    return new Response(
      JSON.stringify({
        submissionId: 'sub_non_array_test',
        feedbackId: 'fb_non_array_test',
        status: 'created',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_non_array_test',
    });

    // Object instead of array
    await client.submit({
      title: 'Valid title',
      description: 'Valid description',
      attachments: { file: 'screenshot.png' } as any,
    });
    assert.equal(capturedBody.uploadIds, undefined);

    // Number instead of array
    await client.submit({
      title: 'Valid title',
      description: 'Valid description',
      attachments: 42 as any,
    });
    assert.equal(capturedBody.uploadIds, undefined);

    // Via submitFeedback alias
    capturedBody = null;
    await client.submitFeedback({
      title: 'Valid title',
      description: 'Valid description',
      attachments: { uploadId: 'up_1' } as any,
    });
    assert.ok(capturedBody);
    assert.equal(capturedBody.uploadIds, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient.submit: safely handles null/undefined/primitive elements in attachments (#350)', async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: any = null;

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    capturedBody = JSON.parse(init?.body as string);
    return new Response(
      JSON.stringify({
        submissionId: 'sub_null_att_test',
        feedbackId: 'fb_null_att_test',
        status: 'created',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_null_att_test',
    });

    await client.submit({
      title: 'Valid title',
      description: 'Valid description',
      attachments: [null as any, undefined as any, 123 as any, 'malformed' as any],
    });
    assert.equal(capturedBody.uploadIds, undefined);

    // Via submitFeedback alias
    capturedBody = null;
    await client.submitFeedback({
      title: 'Valid title',
      description: 'Valid description',
      attachments: [null as any, undefined as any],
    });
    assert.ok(capturedBody);
    assert.equal(capturedBody.uploadIds, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient.submit: extracts valid uploadIds from mixed attachments and trims whitespace (#350)', async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: any = null;

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    capturedBody = JSON.parse(init?.body as string);
    return new Response(
      JSON.stringify({
        submissionId: 'sub_mixed_att_test',
        feedbackId: 'fb_mixed_att_test',
        status: 'created',
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_mixed_att_test',
    });

    await client.submit({
      title: 'Valid title',
      description: 'Valid description',
      attachments: [
        null as any,
        { kind: 'image', key: 'img.png', uploadId: '  up_valid_123  ' },
        undefined as any,
        { kind: 'r2', key: 'log.txt', uploadId: '   ' },
        { kind: 'r2', key: 'num.txt', uploadId: 99999 as any },
        { kind: 'r2', key: 'log2.txt' },
      ],
    });
    assert.deepEqual(capturedBody.uploadIds, ['up_valid_123']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Deprecated FeedbackClient.toggleVote delegates to castVote (POST)', async () => {
  const originalFetch = globalThis.fetch;
  const methods: string[] = [];

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    methods.push(init?.method || 'GET');
    return new Response(JSON.stringify({ voted: true, voteCount: 5 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_vote_test',
    });

    const first = await client.toggleVote('fr_100', 'usr_tok_1');
    const second = await client.toggleVote('fr_100', 'usr_tok_1');
    assert.deepEqual(first, { voted: true, voteCount: 5 });
    assert.deepEqual(second, { voted: true, voteCount: 5 });
    assert.deepEqual(methods, ['POST', 'POST']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient.postComment sends only schema-accepted body fields over the anonymous credential', async () => {
  const originalFetch = globalThis.fetch;
  const captured: Array<{
    url: string;
    method?: string;
    headers: Record<string, string>;
    body?: any;
  }> = [];

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const headerBag = new Headers(init?.headers);
    const headers: Record<string, string> = {};
    headerBag.forEach((value: string, key: string) => {
      headers[key.toLowerCase()] = value;
    });
    captured.push({
      url: url.toString(),
      method: init?.method,
      headers,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    // Documented wire shape: `FeatureRequestCommentCreated` wraps the record
    // in a `comment` envelope.
    return new Response(
      JSON.stringify({
        comment: { id: 'c_1', body: 'hi', createdAt: '2026-10-25T00:00:00.000Z' },
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    );
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_comment_test',
    });

    // Legacy call shape: the anonymous end-user token rides X-User-Token and no
    // Authorization header is present.
    await client.postComment(
      'fr_123',
      {
        body: '  Shape check  ',
        authorName: 'Ignored Name',
        authorAvatarUrl: 'https://example.com/a.png',
        parentId: 'c_parent',
        replyToClerkId: 'user_ignored',
        replyToAuthorName: '  Replied Author  ',
      },
      'usr_tok'
    );

    assert.equal(captured.length, 1);
    assert.equal(
      captured[0].url,
      'https://api.cupthread.com/api/v1/feature-requests/fr_123/comments'
    );
    assert.equal(captured[0].method, 'POST');
    assert.equal(captured[0].headers['x-user-token'], 'usr_tok');
    assert.equal(captured[0].headers['authorization'], undefined);
    // Contract (CreateFeatureRequestCommentInput): only body / parentId /
    // replyToAuthorName are accepted; author-naming fields are stripped
    // server-side and must not even be sent.
    assert.deepEqual(captured[0].body, {
      body: 'Shape check',
      parentId: 'c_parent',
      replyToAuthorName: 'Replied Author',
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient.postComment with a sessionToken sends Bearer auth and no X-User-Token', async () => {
  const originalFetch = globalThis.fetch;
  const captured: Array<{ headers: Record<string, string>; body?: any }> = [];

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const headerBag = new Headers(init?.headers);
    const headers: Record<string, string> = {};
    headerBag.forEach((value: string, key: string) => {
      headers[key.toLowerCase()] = value;
    });
    captured.push({ headers, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(
      JSON.stringify({
        comment: { id: 'c_2', body: 'hi', createdAt: '2026-10-25T00:00:00.000Z' },
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    );
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_comment_test',
    });

    await client.postComment('fr_123', { body: 'Signed comment' }, 'usr_tok_anonymous', {
      sessionToken: '  clerk_jwt_token  ',
    });

    assert.equal(captured.length, 1);
    // The Clerk session is the only accepted credential on this route: it
    // replaces the anonymous identity rather than stacking on top of it.
    assert.equal(captured[0].headers['authorization'], 'Bearer clerk_jwt_token');
    assert.equal(captured[0].headers['x-user-token'], undefined);
    assert.deepEqual(captured[0].body, { body: 'Signed comment' });

    // A blank/whitespace sessionToken falls back to the anonymous credential.
    await client.postComment('fr_123', { body: 'Fallback' }, 'usr_tok_anonymous', {
      sessionToken: '   ',
    });
    assert.equal(captured.length, 2);
    assert.equal(captured[1].headers['authorization'], undefined);
    assert.equal(captured[1].headers['x-user-token'], 'usr_tok_anonymous');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient.postComment rejects invalid draft or draft.body without issuing network requests', async () => {
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;

  globalThis.fetch = (async () => {
    networkCalls++;
    return new Response(
      JSON.stringify({
        comment: { id: 'c_test', body: 'body', createdAt: '2026-10-25T00:00:00.000Z' },
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    );
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_comment_test',
    });

    for (const invalidDraft of [null, undefined, 'string', 123, true]) {
      await assert.rejects(
        () => client.postComment('fr_123', invalidDraft as any, 'usr_tok'),
        (err: any) => {
          assert.ok(err instanceof TypeError);
          assert.match(err.message, /Expected a draft object for postComment/);
          return true;
        }
      );
    }

    const invalidBodies: any[] = ['', '   ', '\t\n', null, undefined, 123, {}];
    for (const invalidBody of invalidBodies) {
      await assert.rejects(
        () => client.postComment('fr_123', { body: invalidBody } as any, 'usr_tok'),
        (err: any) => {
          assert.ok(err instanceof TypeError);
          assert.match(err.message, /Expected a non-empty string for draft\.body/);
          return true;
        }
      );
    }

    assert.equal(networkCalls, 0, 'No network requests should be issued for invalid draft fields');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient.postComment normalizes whitespace in parentId, replyToAuthorName, and userToken', async () => {
  const originalFetch = globalThis.fetch;
  const captured: Array<{ headers: Record<string, string>; body?: any }> = [];

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const headerBag = new Headers(init?.headers);
    const headers: Record<string, string> = {};
    headerBag.forEach((value: string, key: string) => {
      headers[key.toLowerCase()] = value;
    });
    captured.push({ headers, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(
      JSON.stringify({
        comment: { id: 'c_norm', body: 'hi', createdAt: '2026-10-25T00:00:00.000Z' },
      }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    );
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_comment_test',
    });

    // 1. Whitespace parentId and replyToAuthorName normalize to undefined
    await client.postComment(
      'fr_123',
      {
        body: '  Trimmed comment  ',
        parentId: '   ',
        replyToAuthorName: '   \t  ',
      },
      '   usr_padded_token   '
    );

    assert.equal(captured.length, 1);
    assert.deepEqual(captured[0].body, {
      body: 'Trimmed comment',
    });
    assert.equal(captured[0].headers['x-user-token'], 'usr_padded_token');

    // 2. Whitespace-only userToken omits X-User-Token header
    await client.postComment(
      'fr_123',
      {
        body: 'Another comment',
        parentId: '   parent_123   ',
        replyToAuthorName: '  Bob  ',
      },
      '   \n\t  '
    );

    assert.equal(captured.length, 2);
    assert.deepEqual(captured[1].body, {
      body: 'Another comment',
      parentId: 'parent_123',
      replyToAuthorName: 'Bob',
    });
    assert.equal(captured[1].headers['x-user-token'], undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient.postComment maps a 401 authentication_required rejection to AuthenticationRequiredException', async () => {
  const originalFetch = globalThis.fetch;
  let requestCount = 0;

  globalThis.fetch = (async () => {
    requestCount++;
    return new Response(
      JSON.stringify({ error: 'Sign-in required', code: 'authentication_required' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_comment_test',
    });

    await assert.rejects(
      () => client.postComment('fr_123', { body: 'no session' }, 'usr_tok'),
      (err: any) => {
        assert.equal(err.name, 'AuthenticationRequiredException');
        return true;
      }
    );

    await assert.rejects(
      () =>
        client.postComment('fr_123', { body: 'expired session' }, 'usr_tok', {
          sessionToken: 'expired_jwt',
        }),
      (err: any) => {
        assert.equal(err.name, 'AuthenticationRequiredException');
        return true;
      }
    );
    assert.equal(requestCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient.postComment unwraps the documented FeatureRequestCommentCreated envelope', async () => {
  const originalFetch = globalThis.fetch;
  const innerComment = {
    id: 'c_new',
    body: 'Wire truth',
    authorName: 'Alice',
    createdAt: '2026-10-25T12:00:00.000Z',
  };

  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ comment: innerComment }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    })) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_comment_test',
    });

    const comment = await client.postComment('fr_123', { body: 'Wire truth' }, 'usr_tok', {
      sessionToken: 'clerk_jwt',
    });

    // The resolved value must be the record itself, not the `{ comment }`
    // wrapper — a wrapper leaking through would be appended to threads as a
    // blank card (id/author/body/date all undefined).
    assert.deepEqual(comment, innerComment);
    assert.equal(comment.id, 'c_new');
    assert.equal((comment as any).comment, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient.postComment tolerates a bare comment record for proxies that pre-unwrapped', async () => {
  const originalFetch = globalThis.fetch;
  const bareComment = { id: 'c_bare', body: 'Bare', createdAt: '2026-10-25T12:00:00.000Z' };

  globalThis.fetch = (async () =>
    new Response(JSON.stringify(bareComment), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    })) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_comment_test',
    });

    const comment = await client.postComment('fr_123', { body: 'Bare' }, 'usr_tok');
    assert.deepEqual(comment, bareComment);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient.postComment rejects malformed create responses with InvalidResponseException', async () => {
  const originalFetch = globalThis.fetch;
  // Each body is answered verbatim: bare junk (`null`, `[]`, `{}`) as well as
  // envelopes that fail to carry a usable comment record — including records
  // missing the schema-required `body` or `createdAt`, which would otherwise
  // render a partially blank card in the thread.
  const malformedBodies: unknown[] = [
    null,
    {},
    [],
    { comment: null },
    { comment: [] },
    { comment: {} },
    { comment: { id: 'c_partial' } },
    { comment: { id: 'c_partial', body: 'no date' } },
    { comment: { id: 'c_partial', createdAt: '2026-10-25T00:00:00.000Z' } },
    { comment: { id: 'c_partial', body: 'b', createdAt: 'not-a-date' } },
    // A non-string authorName would crash the card render (Avatar's initial
    // fallback calls name.trim()); absent and null stay tolerated.
    { comment: { id: 'c_x', body: 'b', createdAt: '2026-10-25T00:00:00.000Z', authorName: 42 } },
  ];
  let next = 0;

  globalThis.fetch = (async () =>
    new Response(JSON.stringify(malformedBodies[next++]), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    })) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_comment_test',
    });

    for (const body of malformedBodies) {
      await assert.rejects(
        () => client.postComment('fr_123', { body: 'nope' }, 'usr_tok'),
        (err: unknown) => {
          assert.ok(
            err instanceof InvalidResponseException,
            `expected InvalidResponseException for ${JSON.stringify(body)}`
          );
          assert.match(err.message, /returned no comment record/);
          return true;
        }
      );
    }
    assert.equal(next, malformedBodies.length, 'every malformed body must be exercised');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient.fetchAppConfig rejects malformed config responses with InvalidResponseException (#389)', async () => {
  const originalFetch = globalThis.fetch;
  const malformedBodies: unknown[] = [null, [], ['invalid'], 123, true, 'ok'];
  let next = 0;

  globalThis.fetch = (async () => {
    const item = malformedBodies[next++];
    return new Response(JSON.stringify(item), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_config_validation_test',
    });

    for (let i = 0; i < malformedBodies.length; i++) {
      await assert.rejects(
        () => client.fetchAppConfig(),
        (err: unknown) => {
          assert.ok(
            err instanceof InvalidResponseException,
            `expected InvalidResponseException for malformed item index ${i}`
          );
          assert.match((err as Error).message, /invalid app config response payload/);
          return true;
        }
      );
    }
    assert.equal(next, malformedBodies.length, 'every malformed body must be exercised');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient constructor rejects empty, whitespace-only, or missing appKey', () => {
  assert.throws(
    () => new FeedbackClient({ baseUrl: 'https://api.cupthread.com', appKey: '' }),
    (err: any) => {
      assert.ok(err instanceof TypeError);
      assert.match(err.message, /Expected a non-empty string for appKey/);
      return true;
    }
  );

  assert.throws(
    () => new FeedbackClient({ baseUrl: 'https://api.cupthread.com', appKey: '   ' }),
    (err: any) => {
      assert.ok(err instanceof TypeError);
      assert.match(err.message, /Expected a non-empty string for appKey/);
      return true;
    }
  );

  assert.throws(
    () => new FeedbackClient({ baseUrl: 'https://api.cupthread.com', appKey: null as any }),
    (err: any) => {
      assert.ok(err instanceof TypeError);
      assert.match(err.message, /Expected a non-empty string for appKey/);
      return true;
    }
  );

  for (const dotKey of ['.', '..', ' . ', ' .. ']) {
    assert.throws(
      () => new FeedbackClient({ baseUrl: 'https://api.cupthread.com', appKey: dotKey }),
      (err: any) => {
        assert.ok(err instanceof TypeError);
        assert.match(err.message, /Expected a non-empty string for appKey/);
        return true;
      }
    );
  }

  // Whitespace-padded appKey is trimmed cleanly
  const client = new FeedbackClient({
    baseUrl: 'https://api.cupthread.com',
    appKey: '  app_trimmed_123  ',
  });
  assert.equal(client.config.appKey, 'app_trimmed_123');
});

test('FeedbackClient rejects empty, whitespace-only, or dot segment featureRequestId before issuing requests', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCallCount = 0;
  globalThis.fetch = (async () => {
    fetchCallCount++;
    return new Response(JSON.stringify({}), { status: 200 });
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_id_test',
    });

    for (const emptyId of ['', '   ', '\t\n', '.', '..', ' . ', ' .. ']) {
      await assert.rejects(
        () => client.fetchFeatureRequest(emptyId),
        (err: any) => {
          assert.ok(err instanceof TypeError);
          assert.match(err.message, /Expected a non-empty string for featureRequestId/);
          return true;
        }
      );

      await assert.rejects(
        () => client.castVote(emptyId, 'usr_1'),
        (err: any) => {
          assert.ok(err instanceof TypeError);
          assert.match(err.message, /Expected a non-empty string for featureRequestId/);
          return true;
        }
      );

      await assert.rejects(
        () => client.removeVote(emptyId, 'usr_1'),
        (err: any) => {
          assert.ok(err instanceof TypeError);
          assert.match(err.message, /Expected a non-empty string for featureRequestId/);
          return true;
        }
      );

      await assert.rejects(
        () => client.listComments(emptyId),
        (err: any) => {
          assert.ok(err instanceof TypeError);
          assert.match(err.message, /Expected a non-empty string for featureRequestId/);
          return true;
        }
      );

      await assert.rejects(
        () => client.postComment(emptyId, { body: 'hello' }, 'usr_1'),
        (err: any) => {
          assert.ok(err instanceof TypeError);
          assert.match(err.message, /Expected a non-empty string for featureRequestId/);
          return true;
        }
      );
    }

    assert.equal(
      fetchCallCount,
      0,
      'zero network requests should be dispatched when ID validation fails'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient rejects empty, whitespace-only, or dot segment userId before issuing requests', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCallCount = 0;
  globalThis.fetch = (async () => {
    fetchCallCount++;
    return new Response(JSON.stringify({}), { status: 200 });
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_id_test',
    });

    for (const emptyUserId of ['', '   ', '\t', '.', '..', ' . ', ' .. ']) {
      await assert.rejects(
        () => client.fetchUserProfile(emptyUserId),
        (err: any) => {
          assert.ok(err instanceof TypeError);
          assert.match(err.message, /Expected a non-empty string for userId/);
          return true;
        }
      );
    }

    assert.equal(
      fetchCallCount,
      0,
      'zero network requests should be dispatched when userId validation fails'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient trims valid resource IDs and encodes reserved characters safely', async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request) => {
    requestedUrls.push(url.toString());
    return new Response(
      JSON.stringify({
        request: {
          id: 'fr_123',
          appId: 'app_1',
          title: 'T',
          description: 'D',
          status: 'planned',
          approved: true,
          voteCount: 0,
          commentCount: 0,
          hasVoted: false,
          isOwnRequest: false,
          createdAt: '2026-10-01T00:00:00.000Z',
          updatedAt: '2026-10-01T00:00:00.000Z',
        },
        profile: {
          id: 'u_123',
          displayName: 'Dev',
          joinedAt: '2026-01-01T00:00:00.000Z',
          apps: [],
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_id_test',
    });

    // Padded ID is trimmed
    await client.fetchFeatureRequest('  fr_123  ');
    assert.equal(requestedUrls[0], 'https://api.cupthread.com/api/v1/feature-requests/fr_123');

    // Reserved characters (e.g. slashes and spaces) are encoded
    await client.fetchUserProfile('  u_user/with space  ');
    assert.equal(
      requestedUrls[1],
      'https://api.cupthread.com/api/v1/users/u_user%2Fwith%20space/profile?appKey=app_id_test'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('initUploadSession validates slot uploadId when uploadUrl is omitted', async () => {
  const originalFetch = globalThis.fetch;
  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_id_test',
    });

    for (const invalidUploadId of ['', '   ', '.', '..', undefined, null]) {
      globalThis.fetch = (async () => {
        return new Response(
          JSON.stringify({
            session: {
              sessionId: 'ups_1',
              sessionToken: 'tok_1',
              expiresAt: '2026-10-23T13:00:00.000Z',
              maxFileSizeBytes: 10485760,
              maxFiles: 8,
            },
            files: [
              {
                clientFileId: 'f1',
                uploadId: invalidUploadId,
                maxSizeBytes: 10485760,
              },
            ],
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      }) as any;

      await assert.rejects(
        () =>
          client.uploadAttachment({
            file: { uri: 'file:///tmp/a.png' },
            filename: 'a.png',
            mimeType: 'image/png',
            size: 100,
          }),
        (err: any) => {
          assert.ok(err instanceof UnreadableUploadResponseException);
          return true;
        }
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('subscribeToChangelog validates and trims email parameter', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  let sentBody: any = null;

  globalThis.fetch = (async (_url: string, init: any) => {
    fetchCalled = true;
    sentBody = JSON.parse(init.body);
    return new Response(JSON.stringify({ subscribed: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_key_abc',
    });

    const invalidEmails = [
      '',
      '   ',
      'not-an-email',
      'user@',
      '@domain.com',
      '.user@example.com',
      'user.@example.com',
      'a..b@example.com',
      null as any,
      undefined as any,
      123 as any,
    ];
    for (const invalid of invalidEmails) {
      fetchCalled = false;
      await assert.rejects(
        () => client.subscribeToChangelog(invalid, 'usr_tok'),
        (err: any) => {
          assert.ok(err instanceof TypeError);
          assert.equal(err.message, 'Expected a valid email address');
          return true;
        }
      );
      assert.strictEqual(fetchCalled, false, 'network call must not be made for invalid email');
    }

    // Valid email with quoted local part containing dots should reach the wire
    fetchCalled = false;
    await client.subscribeToChangelog('"a..b"@example.com', 'usr_tok');
    assert.strictEqual(fetchCalled, true);
    assert.deepStrictEqual(sentBody, { email: '"a..b"@example.com' });

    // Valid email with padding should trim and reach the wire
    fetchCalled = false;
    const res = await client.subscribeToChangelog('   padded@example.com   ', 'usr_tok');
    assert.strictEqual(fetchCalled, true);
    assert.strictEqual(res.subscribed, true);
    assert.deepStrictEqual(sentBody, { email: 'padded@example.com' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient handles non-string optional inputs gracefully (#298)', async () => {
  const originalFetch = globalThis.fetch;
  const captured: { url: string; method: string; headers: Record<string, string>; body: any }[] =
    [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    if (init?.headers) {
      if (typeof (init.headers as Headers).forEach === 'function') {
        (init.headers as Headers).forEach((v: string, k: string) => {
          headers[k.toLowerCase()] = v;
        });
      } else {
        for (const [k, v] of Object.entries(init.headers as Record<string, string>)) {
          headers[k.toLowerCase()] = String(v);
        }
      }
    }
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    captured.push({ url, method: init?.method || 'GET', headers, body });

    if (url.includes('/api/v1/feature-requests/fr_123/vote')) {
      return new Response(JSON.stringify({ voted: true, voteCount: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.includes('/api/v1/feature-requests/fr_123/comments')) {
      return new Response(
        JSON.stringify({
          comment: {
            id: 'c_1',
            featureRequestId: 'fr_123',
            body: 'test comment',
            authorName: 'Tester',
            createdAt: '2026-10-01T00:00:00.000Z',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (url.includes('/api/v1/feature-requests/fr_123')) {
      return new Response(
        JSON.stringify({
          request: {
            id: 'fr_123',
            title: 'Test',
            description: 'Desc',
            voteCount: 1,
            voted: false,
            status: 'open',
            isOwnRequest: false,
            createdAt: '2026-10-01T00:00:00.000Z',
            updatedAt: '2026-10-01T00:00:00.000Z',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (url.includes('/profile')) {
      return new Response(
        JSON.stringify({
          profile: {
            id: 'u_123',
            displayName: 'Dev',
            joinedAt: '2026-01-01T00:00:00.000Z',
            apps: [],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (url.includes('/vote')) {
      return new Response(
        JSON.stringify({
          voted: true,
          voteCount: 1,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_default_test',
    });

    // 1. fetchFeatureRequest with non-string userToken does not throw and omits X-User-Token
    await client.fetchFeatureRequest('fr_123', { userToken: 12345 as any });
    assert.equal(captured.length, 1);
    assert.equal(captured[0].headers['x-user-token'], undefined);

    await client.fetchFeatureRequest('fr_123', { userToken: {} as any });
    assert.equal(captured.length, 2);
    assert.equal(captured[1].headers['x-user-token'], undefined);

    // 2. fetchUserProfile with non-string appKey falls back to config.appKey
    await client.fetchUserProfile('u_123', { appKey: 999 as any });
    assert.equal(captured.length, 3);
    assert.equal(
      captured[2].url,
      'https://api.cupthread.com/api/v1/users/u_123/profile?appKey=app_default_test'
    );

    await client.fetchUserProfile('u_123', { appKey: { custom: true } as any });
    assert.equal(captured.length, 4);
    assert.equal(
      captured[3].url,
      'https://api.cupthread.com/api/v1/users/u_123/profile?appKey=app_default_test'
    );

    // 3. castVote with non-string shipNotifyEmail and turnstileToken ignores them
    await client.castVote('fr_123', 'tok_abc', {
      shipNotifyEmail: true as any,
      turnstileToken: 123 as any,
    });
    assert.equal(captured.length, 5);
    assert.deepEqual(captured[4].body, {
      appKey: 'app_default_test',
      userToken: 'tok_abc',
    });

    // 4. postComment with non-string sessionToken falls back to userToken
    await client.postComment('fr_123', { body: 'test' }, 'tok_abc', {
      sessionToken: {} as any,
    });
    assert.equal(captured.length, 6);
    assert.equal(captured[5].headers['authorization'], undefined);
    assert.equal(captured[5].headers['x-user-token'], 'tok_abc');

    await client.postComment('fr_123', { body: 'test 2' }, 'tok_abc', {
      sessionToken: 9999 as any,
    });
    assert.equal(captured.length, 7);
    assert.equal(captured[6].headers['authorization'], undefined);
    assert.equal(captured[6].headers['x-user-token'], 'tok_abc');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchColumns, fetchVersions, and listChangelog safely handle nullish, non-array, and corrupted entries (#357)', async () => {
  const originalFetch = globalThis.fetch;
  try {
    let mockResponse: any = {};
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_test_123',
    });

    // 1. fetchColumns: nullish and non-array responses
    mockResponse = { columns: null };
    assert.deepEqual(await client.fetchColumns(), []);

    mockResponse = { columns: {} };
    assert.deepEqual(await client.fetchColumns(), []);

    // Sparse/corrupted columns array with null, undefined, non-object elements, and non-numeric positions
    mockResponse = {
      columns: [
        null,
        undefined,
        'invalid',
        { id: 'c2', name: 'In Progress', position: 20 },
        { id: 'c1', name: 'Backlog', position: 10 },
        { id: 'c3', name: 'No Position' },
      ],
    };
    const columns = await client.fetchColumns();
    assert.equal(columns.length, 3);
    assert.deepEqual(
      columns.map((c) => c.id),
      ['c3', 'c1', 'c2']
    );

    // 2. fetchVersions: nullish and non-array responses
    mockResponse = { versions: null };
    assert.deepEqual(await client.fetchVersions(), []);

    mockResponse = { versions: 'invalid' };
    assert.deepEqual(await client.fetchVersions(), []);

    // Sparse/corrupted versions array
    mockResponse = {
      versions: [
        null,
        undefined,
        42,
        { id: 'v2', versionNumber: '2.0', position: 200 },
        { id: 'v1', versionNumber: '1.0', position: 100 },
        { id: 'v0', versionNumber: '0.1' },
      ],
    };
    const versions = await client.fetchVersions();
    assert.equal(versions.length, 3);
    assert.deepEqual(
      versions.map((v) => v.id),
      ['v0', 'v1', 'v2']
    );

    // 3. listChangelog: nullish, non-array, and malformed dates
    mockResponse = { entries: null, hasMore: false, nextCursor: null };
    const emptyResult = await client.listChangelog();
    assert.deepEqual(emptyResult.entries, []);

    mockResponse = { entries: {}, hasMore: false, nextCursor: null };
    const invalidResult = await client.listChangelog();
    assert.deepEqual(invalidResult.entries, []);

    // Sparse/corrupted entries array with nulls and invalid publishedAt
    mockResponse = {
      entries: [
        null,
        undefined,
        { id: 'e_invalid', title: 'Invalid Date', publishedAt: 'not-a-date' },
        { id: 'e_old', title: 'Old', publishedAt: '2026-01-01T00:00:00.000Z' },
        { id: 'e_new', title: 'New', publishedAt: '2026-06-01T00:00:00.000Z' },
        { id: 'e_nodate', title: 'No Date' },
      ],
      hasMore: false,
      nextCursor: null,
    };
    const changelogResult = await client.listChangelog();
    assert.equal(changelogResult.entries.length, 4);
    assert.equal(changelogResult.entries[0].id, 'e_new');
    assert.equal(changelogResult.entries[1].id, 'e_old');

    // 4. fetchChangelog also safely sorts with invalid dates
    const allChangelog = await client.fetchChangelog();
    assert.equal(allChangelog.length, 4);
    assert.equal(allChangelog[0].id, 'e_new');
    assert.equal(allChangelog[1].id, 'e_old');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient.fetchFeatureRequests defensively normalizes nullish, empty, and malformed responses (#376)', async () => {
  const originalFetch = globalThis.fetch;
  let mockPayload: any = null;

  globalThis.fetch = (async () => {
    return new Response(
      typeof mockPayload === 'string' ? mockPayload : JSON.stringify(mockPayload),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_normalize_fr',
    });

    // 1. null or non-object bodies
    for (const body of [null, {}, 'null', '""', '[]', '123']) {
      mockPayload = body;
      const res = await client.fetchFeatureRequests();
      assert.deepEqual(res, {
        requests: [],
        total: 0,
        hasMore: false,
        nextCursor: null,
      });
    }

    // 2. filtering null, undefined, primitives, arrays from requests
    mockPayload = {
      requests: [
        null,
        undefined,
        'string-entry',
        123,
        [],
        { id: 'fr_valid_1', title: 'Valid 1' },
        { id: 'fr_valid_2', title: 'Valid 2' },
      ],
      total: -10,
      nextCursor: '   ',
    };
    const filteredRes = await client.fetchFeatureRequests();
    assert.equal(filteredRes.requests.length, 2);
    assert.equal(filteredRes.requests[0].id, 'fr_valid_1');
    assert.equal(filteredRes.requests[1].id, 'fr_valid_2');
    assert.equal(filteredRes.total, 2, 'negative total falls back to filtered requests length');
    assert.equal(filteredRes.hasMore, false);
    assert.equal(filteredRes.nextCursor, null, 'whitespace nextCursor normalizes to null');

    // 3. NaN total and whitespace trimmed cursor with hasMore
    mockPayload = {
      requests: [{ id: 'fr_1', title: 'Request 1' }],
      total: NaN,
      hasMore: true,
      nextCursor: '   cur_next_123   ',
    };
    const cursorRes = await client.fetchFeatureRequests();
    assert.equal(cursorRes.requests.length, 1);
    assert.equal(cursorRes.total, 1, 'NaN total falls back to requests length');
    assert.equal(cursorRes.hasMore, true);
    assert.equal(cursorRes.nextCursor, 'cur_next_123', 'padded nextCursor is trimmed');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient.fetchFeatureRequests filters out items with missing, empty, or non-string IDs and trims whitespace (#405)', async () => {
  const originalFetch = globalThis.fetch;
  let mockPayload: any = null;

  globalThis.fetch = (async () => {
    return new Response(JSON.stringify(mockPayload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_filter_fr_ids',
    });

    mockPayload = {
      requests: [
        { id: '', title: 'Empty string id' },
        { id: '   \t\n  ', title: 'Whitespace only id' },
        { id: null, title: 'Null id' },
        { id: undefined, title: 'Undefined id' },
        { id: 123, title: 'Numeric id' },
        { id: [], title: 'Array id' },
        { id: {}, title: 'Object id' },
        { title: 'Missing id property' },
        { id: '  fr_padded_1  ', title: 'Padded ID 1' },
        { id: 'fr_clean_2', title: 'Clean ID 2' },
      ],
      total: 10,
    };

    const res = await client.fetchFeatureRequests();
    assert.equal(res.requests.length, 2);
    assert.equal(res.requests[0].id, 'fr_padded_1');
    assert.equal(res.requests[0].title, 'Padded ID 1');
    assert.equal(res.requests[1].id, 'fr_clean_2');
    assert.equal(res.requests[1].title, 'Clean ID 2');
    assert.equal(res.total, 10);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient.listComments filters out comment items with missing, empty, or non-string IDs and trims whitespace (#406)', async () => {
  const originalFetch = globalThis.fetch;
  let mockPayload: any = null;

  globalThis.fetch = (async () => {
    return new Response(JSON.stringify(mockPayload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_filter_comment_ids',
    });

    mockPayload = {
      comments: [
        { id: '', body: 'Empty string id' },
        { id: '   \t\n  ', body: 'Whitespace only id' },
        { id: null, body: 'Null id' },
        { id: undefined, body: 'Undefined id' },
        { id: 123, body: 'Numeric id' },
        { id: [], body: 'Array id' },
        { id: {}, body: 'Object id' },
        { body: 'Missing id property' },
        { id: '  c_padded_1  ', body: 'Padded ID 1' },
        { id: 'c_clean_2', body: 'Clean ID 2' },
      ],
      total: 10,
    };

    const res = await client.listComments('fr_1');
    assert.equal(res.comments.length, 2);
    assert.equal(res.comments[0].id, 'c_padded_1');
    assert.equal(res.comments[0].body, 'Padded ID 1');
    assert.equal(res.comments[1].id, 'c_clean_2');
    assert.equal(res.comments[1].body, 'Clean ID 2');
    assert.equal(res.total, 10);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient.fetchVersions filters out version items with missing, empty, or non-string IDs and trims whitespace (#412)', async () => {
  const originalFetch = globalThis.fetch;
  let mockPayload: any = null;

  globalThis.fetch = (async () => {
    return new Response(JSON.stringify(mockPayload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_filter_version_ids',
    });

    // 1. Wrapped response: { versions: [...] }
    mockPayload = {
      versions: [
        { id: '', label: 'Empty string id', position: 10 },
        { id: '   \t\n  ', label: 'Whitespace only id', position: 20 },
        { id: null, label: 'Null id', position: 30 },
        { id: undefined, label: 'Undefined id', position: 40 },
        { id: 123, label: 'Numeric id', position: 50 },
        { id: [], label: 'Array id', position: 60 },
        { id: {}, label: 'Object id', position: 70 },
        { label: 'Missing id property', position: 80 },
        { id: '  v_padded_2  ', label: 'Padded ID 2', position: 200 },
        { id: 'v_clean_1', label: 'Clean ID 1', position: 100 },
      ],
    };

    const resWrapped = await client.fetchVersions();
    assert.equal(resWrapped.length, 2);
    assert.equal(resWrapped[0].id, 'v_clean_1');
    assert.equal(resWrapped[0].label, 'Clean ID 1');
    assert.equal(resWrapped[1].id, 'v_padded_2');
    assert.equal(resWrapped[1].label, 'Padded ID 2');

    // 2. Direct array payload: [...]
    mockPayload = [
      { id: '', label: 'Empty' },
      { id: null, label: 'Null' },
      { id: '   ', label: 'Whitespace' },
      { id: '  v_trimmed_0  ', label: 'Zero', position: -10 },
      { id: 'v_1', label: 'One', position: 10 },
    ];

    const resArray = await client.fetchVersions();
    assert.equal(resArray.length, 2);
    assert.equal(resArray[0].id, 'v_trimmed_0');
    assert.equal(resArray[1].id, 'v_1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient.listChangelog filters out changelog entries with missing, empty, or non-string IDs and trims whitespace (#409)', async () => {
  const originalFetch = globalThis.fetch;
  let mockPayload: any = null;

  globalThis.fetch = (async () => {
    return new Response(JSON.stringify(mockPayload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_filter_changelog_ids',
    });

    mockPayload = {
      entries: [
        { id: '', title: 'Empty string id', publishedAt: '2026-03-01T00:00:00.000Z' },
        { id: '   \t\n  ', title: 'Whitespace only id', publishedAt: '2026-03-02T00:00:00.000Z' },
        { id: null, title: 'Null id', publishedAt: '2026-03-03T00:00:00.000Z' },
        { id: undefined, title: 'Undefined id', publishedAt: '2026-03-04T00:00:00.000Z' },
        { id: 123, title: 'Numeric id', publishedAt: '2026-03-05T00:00:00.000Z' },
        { id: [], title: 'Array id', publishedAt: '2026-03-06T00:00:00.000Z' },
        { id: {}, title: 'Object id', publishedAt: '2026-03-07T00:00:00.000Z' },
        { title: 'Missing id property', publishedAt: '2026-03-08T00:00:00.000Z' },
        { id: '  chg_padded_1  ', title: 'Padded ID 1', publishedAt: '2026-03-09T00:00:00.000Z' },
        { id: 'chg_clean_2', title: 'Clean ID 2', publishedAt: '2026-03-10T00:00:00.000Z' },
      ],
      hasMore: true,
      nextCursor: 'cur_next',
    };

    const res = await client.listChangelog();
    assert.equal(res.entries.length, 2);
    assert.equal(res.entries[0].id, 'chg_clean_2');
    assert.equal(res.entries[0].title, 'Clean ID 2');
    assert.equal(res.entries[1].id, 'chg_padded_1');
    assert.equal(res.entries[1].title, 'Padded ID 1');
    assert.equal(res.hasMore, true);
    assert.equal(res.nextCursor, 'cur_next');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchColumns and fetchVersions safely handle null, non-object, and direct array responses (#375)', async () => {
  const originalFetch = globalThis.fetch;
  let mockPayload: any = null;

  globalThis.fetch = (async () => {
    return new Response(JSON.stringify(mockPayload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_col_ver_guard',
    });

    // 1. fetchColumns: null, empty object, or non-object bodies
    for (const body of [null, {}, 'null', '""', '123', true]) {
      mockPayload = body;
      const res = await client.fetchColumns();
      assert.deepEqual(res, []);
    }

    // 2. fetchColumns: direct array responses
    mockPayload = [
      null,
      undefined,
      'invalid',
      [],
      { id: 'col_2', name: 'In Progress', position: 20 },
      { id: 'col_1', name: 'Planned', position: 10 },
      { id: 'col_0', name: 'Backlog' },
    ];
    const directColumns = await client.fetchColumns();
    assert.equal(directColumns.length, 3);
    assert.deepEqual(
      directColumns.map((c) => c.id),
      ['col_0', 'col_1', 'col_2']
    );

    // 3. fetchVersions: null, empty object, or non-object bodies
    for (const body of [null, {}, 'null', '""', '123', true]) {
      mockPayload = body;
      const res = await client.fetchVersions();
      assert.deepEqual(res, []);
    }

    // 4. fetchVersions: direct array responses
    mockPayload = [
      null,
      undefined,
      'invalid',
      [],
      { id: 'ver_2', versionNumber: '2.0.0', position: 200 },
      { id: 'ver_1', versionNumber: '1.0.0', position: 100 },
      { id: 'ver_0', versionNumber: '0.9.0' },
    ];
    const directVersions = await client.fetchVersions();
    assert.equal(directVersions.length, 3);
    assert.deepEqual(
      directVersions.map((v) => v.id),
      ['ver_0', 'ver_1', 'ver_2']
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('listChangelog safely handles null, non-object, and direct array responses (#379)', async () => {
  const originalFetch = globalThis.fetch;
  let mockPayload: any = null;

  globalThis.fetch = (async () => {
    return new Response(JSON.stringify(mockPayload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_changelog_guard',
    });

    // 1. null, empty object, or non-object bodies
    for (const body of [null, {}, 'null', '""', '123', true]) {
      mockPayload = body;
      const res = await client.listChangelog();
      assert.deepEqual(res, { entries: [], hasMore: false, nextCursor: null });
    }

    // 2. Direct array response with corrupted elements and publishedAt sorting
    mockPayload = [
      null,
      undefined,
      'invalid',
      [],
      { id: 'chg_old', title: 'Old Release', publishedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'chg_new', title: 'New Release', publishedAt: '2026-06-01T00:00:00.000Z' },
      { id: 'chg_nodate', title: 'No Date' },
    ];
    const directResult = await client.listChangelog();
    assert.equal(directResult.hasMore, false);
    assert.equal(directResult.nextCursor, null);
    assert.equal(directResult.entries.length, 3);
    assert.deepEqual(
      directResult.entries.map((e) => e.id),
      ['chg_new', 'chg_old', 'chg_nodate']
    );

    // 3. fetchChangelog also works with direct array payload
    const fetched = await client.fetchChangelog();
    assert.equal(fetched.length, 3);
    assert.deepEqual(
      fetched.map((e) => e.id),
      ['chg_new', 'chg_old', 'chg_nodate']
    );

    // 4. Whitespace nextCursor normalizes to null
    mockPayload = {
      entries: [{ id: 'chg_1', title: 'Release 1' }],
      hasMore: true,
      nextCursor: '   \t  \n  ',
    };
    const whitespaceCursorResult = await client.listChangelog();
    assert.equal(whitespaceCursorResult.nextCursor, null);
    assert.equal(whitespaceCursorResult.hasMore, true);

    // 5. Valid trimmed nextCursor preserved
    mockPayload = {
      entries: [{ id: 'chg_1', title: 'Release 1' }],
      hasMore: true,
      nextCursor: '  cursor_123  ',
    };
    const validCursorResult = await client.listChangelog();
    assert.equal(validCursorResult.nextCursor, 'cursor_123');
    assert.equal(validCursorResult.hasMore, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('prepareChangelogOverlay safely handles null, non-object, and missing sdk responses (#380)', async () => {
  const originalFetch = globalThis.fetch;
  let configPayload: any = null;
  const changelogPayload: any = {
    entries: [
      {
        id: 'chg_1',
        versionLabel: '1.0.0',
        title: 'First Release',
        publishedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  };

  globalThis.fetch = (async (url: string | URL | Request) => {
    const s = url.toString();
    if (s.includes('/api/v1/public/config/')) {
      return new Response(JSON.stringify(configPayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (s.includes('/changelog')) {
      return new Response(JSON.stringify(changelogPayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('{}', { status: 200 });
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_overlay_guard',
    });

    // 1. null, primitives, and array config bodies safely return null without throwing TypeError
    for (const body of [null, 'null', '""', 123, true, []]) {
      configPayload = body;
      const res = await client.prepareChangelogOverlay();
      assert.equal(res, null, `expected null when config is ${JSON.stringify(body)}`);
    }

    // 2. Empty object or object with missing sdk property safely falls back to appearance: {}
    configPayload = {};
    const resNoSdk = await client.prepareChangelogOverlay();
    assert.ok(resNoSdk, 'expected overlay payload when config is empty object');
    assert.deepEqual(resNoSdk.appearance, {});
    assert.equal(resNoSdk.latestKey, '1.0.0');
    assert.equal(resNoSdk.entries.length, 1);

    // 3. Object with non-object sdk property also safely falls back to appearance: {}
    configPayload = { sdk: 'invalid' };
    const resInvalidSdk = await client.prepareChangelogOverlay();
    assert.ok(resInvalidSdk, 'expected overlay payload when sdk is a primitive');
    assert.deepEqual(resInvalidSdk.appearance, {});

    // 4. Object with valid sdk appearance preserves appearance object
    configPayload = { sdk: { theme: 'dark', changelogOverlay: { entryCount: 5 } } };
    const resValidSdk = await client.prepareChangelogOverlay();
    assert.ok(resValidSdk);
    assert.equal(resValidSdk.appearance.theme, 'dark');

    // 5. Network transport failures propagate as InvalidResponseException instead of swallowing as null
    globalThis.fetch = (async () => {
      throw new TypeError('Failed to fetch');
    }) as any;

    await assert.rejects(
      () => client.prepareChangelogOverlay(),
      (err: unknown) => {
        assert.ok(err instanceof InvalidResponseException);
        assert.ok(
          !(err instanceof InvalidConfigPayloadException),
          'network transport failure must not be an InvalidConfigPayloadException'
        );
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient.isDevelopment() respects process.env.NODE_ENV and __DEV__ (#383)', () => {
  const originalDev = (globalThis as any).__DEV__;
  const originalEnv = process.env.NODE_ENV;

  try {
    // 1. Explicit __DEV__ flag takes precedence over NODE_ENV
    (globalThis as any).__DEV__ = true;
    process.env.NODE_ENV = 'production';
    assert.equal((FeedbackClient as any).isDevelopment(), true);

    (globalThis as any).__DEV__ = false;
    process.env.NODE_ENV = 'development';
    assert.equal((FeedbackClient as any).isDevelopment(), false);

    // 2. When __DEV__ is undefined, process.env.NODE_ENV determines development mode
    delete (globalThis as any).__DEV__;

    process.env.NODE_ENV = 'production';
    assert.equal((FeedbackClient as any).isDevelopment(), false);

    process.env.NODE_ENV = 'development';
    assert.equal((FeedbackClient as any).isDevelopment(), true);

    process.env.NODE_ENV = 'test';
    assert.equal((FeedbackClient as any).isDevelopment(), true);

    delete process.env.NODE_ENV;
    assert.equal((FeedbackClient as any).isDevelopment(), true);

    // 3. When neither __DEV__ nor process is available, falls back safely to false
    const originalProcess = (globalThis as any).process;
    try {
      (globalThis as any).process = undefined;
      assert.equal((FeedbackClient as any).isDevelopment(), false);
    } finally {
      (globalThis as any).process = originalProcess;
    }
  } finally {
    if (originalDev !== undefined) {
      (globalThis as any).__DEV__ = originalDev;
    } else {
      delete (globalThis as any).__DEV__;
    }
    if (originalEnv !== undefined) {
      process.env.NODE_ENV = originalEnv;
    } else {
      delete process.env.NODE_ENV;
    }
  }
});

test('FeedbackClient.submit suppresses legacy attachment warning in production (#383)', async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const originalDev = (globalThis as any).__DEV__;
  const originalEnv = process.env.NODE_ENV;
  const warnings: string[] = [];

  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  };
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ submissionId: 'sub_prod_1', forwardedToGithub: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_legacy_suppress',
    });

    delete (globalThis as any).__DEV__;
    process.env.NODE_ENV = 'production';

    await client.submit({
      title: 'Legacy attachment in production',
      description: 'Should not emit console warnings in production',
      platform: 'ios',
      attachments: [{ kind: 'r2', key: 'legacy-key', url: 'https://cdn.example/legacy.log' }],
    });

    assert.equal(
      warnings.filter((w) => w.includes('without an uploadId')).length,
      0,
      'no warning should be logged in production'
    );

    // In development mode, the warning is emitted
    process.env.NODE_ENV = 'development';
    await client.submit({
      title: 'Legacy attachment in development',
      description: 'Should emit console warnings in development',
      platform: 'ios',
      attachments: [{ kind: 'r2', key: 'legacy-key', url: 'https://cdn.example/legacy.log' }],
    });

    assert.ok(
      warnings.some((w) => w.includes('without an uploadId')),
      'expected dev warning when NODE_ENV is development'
    );
  } finally {
    console.warn = originalWarn;
    globalThis.fetch = originalFetch;
    if (originalDev !== undefined) {
      (globalThis as any).__DEV__ = originalDev;
    } else {
      delete (globalThis as any).__DEV__;
    }
    if (originalEnv !== undefined) {
      process.env.NODE_ENV = originalEnv;
    } else {
      delete process.env.NODE_ENV;
    }
  }
});

test('FeedbackClient.submit rejects malformed responses with InvalidResponseException (#392)', async () => {
  const originalFetch = globalThis.fetch;
  const malformedBodies: unknown[] = [
    null,
    [],
    ['invalid'],
    123,
    true,
    'ok',
    {},
    { submissionId: null },
    { submissionId: 123 },
    { submissionId: '' },
    { submissionId: '   ' },
  ];
  let next = 0;

  globalThis.fetch = (async () => {
    const item = malformedBodies[next++];
    return new Response(JSON.stringify(item), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_submit_malformed_test',
    });

    for (let i = 0; i < malformedBodies.length; i++) {
      await assert.rejects(
        () => client.submit({ title: 'Bug report', description: 'Something broke' }, 'usr_test_1'),
        (err: unknown) => {
          assert.ok(err instanceof InvalidResponseException);
          assert.match(
            (err as Error).message,
            /Feedback submission returned no valid submission record/
          );
          return true;
        }
      );
    }

    // Resolves successfully with valid payload
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          submissionId: 'sub_valid_123',
          forwardedToGithub: true,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }) as any;

    const result = await client.submit(
      { title: 'Bug report', description: 'Something broke' },
      'usr_test_1'
    );
    assert.equal(result.submissionId, 'sub_valid_123');
    assert.equal(result.forwardedToGithub, true);

    // Also via submitFeedback alias
    const aliasResult = await client.submitFeedback(
      { title: 'Bug report', description: 'Something broke' },
      'usr_test_1'
    );
    assert.equal(aliasResult.submissionId, 'sub_valid_123');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient.submitFeatureRequest rejects malformed responses with InvalidResponseException (#392)', async () => {
  const originalFetch = globalThis.fetch;
  const malformedBodies: unknown[] = [
    null,
    [],
    ['invalid'],
    123,
    true,
    'ok',
    {},
    { featureRequestId: 'fr_1' }, // missing pending
    { featureRequestId: 'fr_1', pending: 'false' }, // non-boolean pending
    { featureRequestId: 'fr_1', pending: null }, // non-boolean pending
    { featureRequestId: '', pending: false }, // empty featureRequestId
    { featureRequestId: '   ', pending: true }, // whitespace featureRequestId
    { featureRequestId: 123, pending: false }, // non-string featureRequestId
  ];
  let next = 0;

  globalThis.fetch = (async () => {
    const item = malformedBodies[next++];
    return new Response(JSON.stringify(item), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_submit_fr_malformed_test',
    });

    for (let i = 0; i < malformedBodies.length; i++) {
      await assert.rejects(
        () =>
          client.submitFeatureRequest(
            { title: 'Feature idea', description: 'Make it faster' },
            'usr_test_1'
          ),
        (err: unknown) => {
          assert.ok(err instanceof InvalidResponseException);
          assert.match(
            (err as Error).message,
            /Feature request submission returned no valid submission record/
          );
          return true;
        }
      );
    }

    // Resolves successfully with valid payload (200 or 201)
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          featureRequestId: 'fr_valid_123',
          pending: true,
        }),
        {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }) as any;

    const result = await client.submitFeatureRequest(
      { title: 'Feature idea', description: 'Make it faster' },
      'usr_test_1'
    );
    assert.equal(result.featureRequestId, 'fr_valid_123');
    assert.equal(result.pending, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient.castVote and removeVote reject malformed responses with InvalidResponseException (#391)', async () => {
  const originalFetch = globalThis.fetch;
  const malformedBodies: unknown[] = [
    null,
    [],
    ['invalid'],
    123,
    true,
    'ok',
    {},
    { voted: true }, // missing voteCount
    { voted: true, voteCount: '12' }, // non-numeric voteCount
    { voted: true, voteCount: null }, // non-numeric voteCount
    { voted: true, voteCount: NaN }, // non-finite voteCount
    { voted: true, voteCount: Infinity }, // non-finite voteCount
    { voted: true, voteCount: -Infinity }, // non-finite voteCount
    { voteCount: 5 }, // missing voted
    { voted: 'true', voteCount: 5 }, // non-boolean voted
    { voted: null, voteCount: 5 }, // non-boolean voted
    { voted: undefined, voteCount: 5 }, // non-boolean voted
    { voted: 1, voteCount: 5 }, // non-boolean voted
  ];
  let next = 0;

  globalThis.fetch = (async () => {
    const item = malformedBodies[next++];
    return new Response(JSON.stringify(item), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_vote_malformed_test',
    });

    for (let i = 0; i < malformedBodies.length; i++) {
      await assert.rejects(
        () => client.castVote('fr_123', 'usr_test_1'),
        (err: unknown) => {
          assert.ok(err instanceof InvalidResponseException);
          assert.match(
            (err as Error).message,
            /Vote operation for fr_123 returned invalid response payload/
          );
          return true;
        }
      );
    }

    // Also test removeVote with the same malformed bodies
    next = 0;
    for (let i = 0; i < malformedBodies.length; i++) {
      await assert.rejects(
        () => client.removeVote('fr_123', 'usr_test_1'),
        (err: unknown) => {
          assert.ok(err instanceof InvalidResponseException);
          assert.match(
            (err as Error).message,
            /Vote operation for fr_123 returned invalid response payload/
          );
          return true;
        }
      );
    }

    // Resolves successfully with valid payload
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          voted: true,
          voteCount: 15,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }) as any;

    const castResult = await client.castVote('fr_123', 'usr_test_1');
    assert.equal(castResult.voted, true);
    assert.equal(castResult.voteCount, 15);

    // Resolves successfully with valid payload including warning
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          voted: true,
          voteCount: 15,
          warning: { code: 'email_not_verified', error: 'Email verification needed' },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }) as any;

    const warningResult = await client.castVote('fr_123', 'usr_test_1');
    assert.equal(warningResult.voted, true);
    assert.equal(warningResult.voteCount, 15);
    assert.deepEqual(warningResult.warning, {
      code: 'email_not_verified',
      error: 'Email verification needed',
    });

    // Resolves successfully for removeVote
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          voted: false,
          voteCount: 14,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }) as any;

    const removeResult = await client.removeVote('fr_123', 'usr_test_1');
    assert.equal(removeResult.voted, false);
    assert.equal(removeResult.voteCount, 14);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('subscribeToChangelog, unsubscribeFromChangelog, and unsubscribeFromDigest validate response against null, array, or missing boolean fields (#394)', async () => {
  const originalFetch = globalThis.fetch;
  const malformedBodies = [
    null,
    undefined,
    'ok',
    123,
    true,
    false,
    [],
    ['item'],
    {},
    { other: 'value' },
  ];

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_sub_unsub_malformed_test',
    });

    // 1. subscribeToChangelog rejects on malformed response payloads
    for (const body of [
      ...malformedBodies,
      { subscribed: 'true' },
      { subscribed: null },
      { subscribed: undefined },
      { subscribed: 1 },
      { alreadySubscribed: true }, // missing subscribed
    ]) {
      globalThis.fetch = (async () => {
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as any;

      await assert.rejects(
        () => client.subscribeToChangelog('user@example.com', 'usr_tok'),
        (err: unknown) => {
          assert.ok(err instanceof InvalidResponseException);
          assert.match(
            (err as Error).message,
            /Changelog subscription returned no valid subscription confirmation/
          );
          return true;
        }
      );
    }

    // 2. unsubscribeFromChangelog rejects on malformed response payloads
    for (const body of [
      ...malformedBodies,
      { unsubscribed: 'true' },
      { unsubscribed: null },
      { unsubscribed: undefined },
      { unsubscribed: 1 },
    ]) {
      globalThis.fetch = (async () => {
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as any;

      await assert.rejects(
        () => client.unsubscribeFromChangelog('unsub.token.value'),
        (err: unknown) => {
          assert.ok(err instanceof InvalidResponseException);
          assert.match(
            (err as Error).message,
            /Changelog unsubscribe returned no valid unsubscribe confirmation/
          );
          return true;
        }
      );
    }

    // 3. unsubscribeFromDigest rejects on malformed response payloads
    for (const body of [
      ...malformedBodies,
      { unsubscribed: 'true' },
      { unsubscribed: null },
      { unsubscribed: undefined },
      { unsubscribed: 1 },
    ]) {
      globalThis.fetch = (async () => {
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as any;

      await assert.rejects(
        () => client.unsubscribeFromDigest('digest.token.value'),
        (err: unknown) => {
          assert.ok(err instanceof InvalidResponseException);
          assert.match(
            (err as Error).message,
            /Digest unsubscribe returned no valid unsubscribe confirmation/
          );
          return true;
        }
      );
    }

    // 4. Resolves successfully with valid payloads
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          subscribed: true,
          alreadySubscribed: false,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as any;
    const subRes = await client.subscribeToChangelog('user@example.com', 'usr_tok');
    assert.equal(subRes.subscribed, true);
    assert.equal(subRes.alreadySubscribed, false);

    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          unsubscribed: true,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as any;
    const unsubRes = await client.unsubscribeFromChangelog('unsub.token.value');
    assert.equal(unsubRes.unsubscribed, true);

    const digestRes = await client.unsubscribeFromDigest('digest.token.value');
    assert.equal(digestRes.unsubscribed, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient.updateUserAttributes rejects invalid response payloads and resolves valid payloads (#396)', async () => {
  const originalFetch = globalThis.fetch;
  const malformedBodies = [
    null,
    'ok',
    123,
    true,
    false,
    [],
    ['item'],
    {},
    { success: true },
    { ok: 'true', updatedAt: '2026-09-01T10:00:00.000Z' },
    { ok: null, updatedAt: '2026-09-01T10:00:00.000Z' },
    { ok: undefined, updatedAt: '2026-09-01T10:00:00.000Z' },
    { ok: 1, updatedAt: '2026-09-01T10:00:00.000Z' },
    { updatedAt: '2026-09-01T10:00:00.000Z' },
    { ok: true },
    { ok: true, updatedAt: '' },
    { ok: true, updatedAt: '   ' },
    { ok: true, updatedAt: 123 },
    { ok: true, updatedAt: null },
    { ok: true, updatedAt: undefined },
    { ok: true, updatedAt: [] },
    { ok: true, updatedAt: {} },
  ];

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_user_attr_test',
    });

    for (const body of malformedBodies) {
      globalThis.fetch = (async () => {
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as any;

      await assert.rejects(
        () => client.updateUserAttributes({ userToken: 'usr_tok', isPaying: true }),
        (err: unknown) => {
          assert.ok(err instanceof InvalidResponseException);
          assert.match(
            (err as Error).message,
            /User attributes update returned no valid confirmation record/
          );
          return true;
        }
      );
    }

    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          ok: true,
          updatedAt: '2026-09-01T10:00:00.000Z',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as any;

    const res = await client.updateUserAttributes({ userToken: 'usr_tok', isPaying: true });
    assert.equal(res.ok, true);
    assert.equal(res.updatedAt, '2026-09-01T10:00:00.000Z');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
