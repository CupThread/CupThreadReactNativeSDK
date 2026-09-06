import test from 'node:test';
import assert from 'node:assert/strict';
import { FeedbackClient } from '../src/client/FeedbackClient';
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
    return new Response(
      JSON.stringify({ featureRequestId: 'fr_test_999', pending: false }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
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
    const overlay1 = await client.prepareChangelogOverlay({ onlyIfUnseen: true, tokenStore: testStore });
    assert.ok(overlay1);
    assert.equal(overlay1?.latestKey, '1.5.0');
    assert.equal(overlay1?.entries.length, 1);

    // 2. Mark changelog seen
    await testStore.markChangelogSeen('1.5.0');

    // 3. Query with onlyIfUnseen: true: should now be null
    const overlay2 = await client.prepareChangelogOverlay({ onlyIfUnseen: true, tokenStore: testStore });
    assert.equal(overlay2, null, 'Should return null when latest changelog version was already seen');

    // 4. Query without onlyIfUnseen: returns data
    const overlay3 = await client.prepareChangelogOverlay({ onlyIfUnseen: false, tokenStore: testStore });
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

  globalThis.fetch = (async (url: string | URL | Request) => {
    interceptedUrls.push(url.toString());
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

    const cases: Array<{ label: string; run: () => Promise<unknown>; expected: string }> = [
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
        label: 'toggleVote',
        run: () => client.toggleVote(HOSTILE_SEGMENT, 'usr_tok'),
        expected: `https://api.cupthread.com/api/v1/feature-requests/${HOSTILE_SEGMENT_ENCODED}/vote`,
      },
      {
        label: 'fetchComments',
        run: () => client.fetchComments(HOSTILE_SEGMENT),
        expected: `https://api.cupthread.com/api/v1/feature-requests/${HOSTILE_SEGMENT_ENCODED}/comments`,
      },
      {
        label: 'postComment',
        run: () => client.postComment(HOSTILE_SEGMENT, { body: 'Looks great!' }, 'usr_tok'),
        expected: `https://api.cupthread.com/api/v1/feature-requests/${HOSTILE_SEGMENT_ENCODED}/comments`,
      },
      {
        label: 'fetchChangelog',
        run: () => client.fetchChangelog(),
        expected: `https://api.cupthread.com/api/v1/public/apps/${HOSTILE_SEGMENT_ENCODED}/changelog`,
      },
      {
        label: 'subscribeToChangelog',
        run: () => client.subscribeToChangelog('user@example.com', 'usr_tok'),
        expected: `https://api.cupthread.com/api/v1/public/apps/${HOSTILE_SEGMENT_ENCODED}/changelog/subscribe`,
      },
      {
        label: 'unsubscribeFromChangelog',
        run: () => client.unsubscribeFromChangelog('user@example.com'),
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
        expected: `https://api.cupthread.com/api/v1/users/${HOSTILE_SEGMENT_ENCODED}/profile`,
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
      assert.ok(!url.includes('?'), `${testCase.label}: no raw "?" in URL`);
      assert.ok(!url.includes('#'), `${testCase.label}: no raw "#" in URL`);
      assert.ok(!url.includes(' '), `${testCase.label}: no raw space in URL`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient leaves ordinary path segments byte-identical (no double-encoding)', async () => {
  const originalFetch = globalThis.fetch;
  const interceptedUrls: string[] = [];

  globalThis.fetch = (async (url: string | URL | Request) => {
    interceptedUrls.push(url.toString());
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

    const cases: Array<{ label: string; run: () => Promise<unknown>; expected: string }> = [
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
        label: 'toggleVote',
        run: () => client.toggleVote('fr_123', 'usr_tok'),
        expected: 'https://api.cupthread.com/api/v1/feature-requests/fr_123/vote',
      },
      {
        label: 'fetchComments',
        run: () => client.fetchComments('fr_123'),
        expected: 'https://api.cupthread.com/api/v1/feature-requests/fr_123/comments',
      },
      {
        label: 'postComment',
        run: () => client.postComment('fr_123', { body: 'Nice' }, 'usr_tok'),
        expected: 'https://api.cupthread.com/api/v1/feature-requests/fr_123/comments',
      },
      {
        label: 'fetchChangelog',
        run: () => client.fetchChangelog(),
        expected: 'https://api.cupthread.com/api/v1/public/apps/app_key_abc/changelog',
      },
      {
        label: 'subscribeToChangelog',
        run: () => client.subscribeToChangelog('user@example.com', 'usr_tok'),
        expected: 'https://api.cupthread.com/api/v1/public/apps/app_key_abc/changelog/subscribe',
      },
      {
        label: 'unsubscribeFromChangelog',
        run: () => client.unsubscribeFromChangelog('user@example.com'),
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
        expected: 'https://api.cupthread.com/api/v1/users/user_42/profile',
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

    assert.equal(interceptedUrl, 'https://api.cupthread.com/api/v1/users/%C3%BCser-42/profile');
    const encodedSegment = interceptedUrl.slice(
      interceptedUrl.indexOf('/api/v1/users/') + '/api/v1/users/'.length,
      interceptedUrl.lastIndexOf('/profile')
    );
    assert.equal(decodeURIComponent(encodedSegment), 'üser-42');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
