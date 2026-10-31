import test from 'node:test';
import assert from 'node:assert/strict';
import { FeedbackClient } from '../src/client/FeedbackClient';
import {
  InsecureBaseUrlException,
  InvalidResponseException,
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
    // The table only asserts URLs, but `postComment` validates its response as
    // a created-comment record, so its route needs a spec-shaped envelope.
    if (init?.method === 'POST' && url.toString().endsWith('/comments')) {
      return new Response(
        JSON.stringify({
          comment: { id: 'c_enc', body: 'ok', createdAt: '2026-10-25T00:00:00.000Z' },
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
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
  // envelopes that fail to carry a usable comment record.
  const malformedBodies: unknown[] = [
    null,
    {},
    [],
    { comment: null },
    { comment: [] },
    { comment: {} },
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
