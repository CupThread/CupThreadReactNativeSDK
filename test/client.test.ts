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
