import test, { type TestOptions } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { FeedbackClient } from '../src/client/FeedbackClient';
import { RateLimitedException, UnexpectedStatusException } from '../src/client/FeedbackException';
import { enStrings } from '../src/i18n';

const supportsModuleMocks = typeof (test as any).mock?.module === 'function';

interface RecordedRequest {
  url: string;
  method: string;
}

/** Serves one canned response and records the request URL. */
function installFetch(status: number, body: unknown = {}) {
  const originalFetch = globalThis.fetch;
  const requests: RecordedRequest[] = [];

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const target = url.toString();
    // The provider loads app config on mount; keep that out of the assertions.
    if (target.includes('/api/v1/public/config/')) {
      return new Response(JSON.stringify({ appKey: 'app_key_abc', sdk: { features: {} } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    requests.push({ url: target, method: init?.method || 'GET' });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '7' },
    });
  }) as any;

  return { requests, restore: () => (globalThis.fetch = originalFetch) };
}

function makeClient(appKey = 'app_key_abc'): FeedbackClient {
  return new FeedbackClient({ baseUrl: 'https://api.cupthread.com', appKey });
}

test('fetchUserProfile sends the configured appKey so app-scoped u_ ids resolve', async () => {
  const fetchMock = installFetch(200, { profile: {}, apps: [], recentComments: [] });

  try {
    await makeClient().fetchUserProfile('u_0123456789abcdef0123456789abcdef');

    assert.equal(fetchMock.requests.length, 1);
    assert.equal(fetchMock.requests[0].method, 'GET');
    const url = new URL(fetchMock.requests[0].url);
    assert.equal(url.pathname, '/api/v1/users/u_0123456789abcdef0123456789abcdef/profile');
    assert.equal(
      url.searchParams.get('appKey'),
      'app_key_abc',
      'a u_* id is only meaningful within the app that minted it'
    );
  } finally {
    fetchMock.restore();
  }
});

test('fetchUserProfile accepts a per-call appKey override for cross-app profiles', async () => {
  const fetchMock = installFetch(200, { profile: {}, apps: [], recentComments: [] });

  try {
    await makeClient('app_own').fetchUserProfile('u_abc', { appKey: 'app_other' });
    const url = new URL(fetchMock.requests[0].url);
    assert.equal(url.searchParams.get('appKey'), 'app_other');
  } finally {
    fetchMock.restore();
  }
});

test('fetchUserProfile trims the override and falls back when it is blank', async () => {
  const fetchMock = installFetch(200, { profile: {}, apps: [], recentComments: [] });

  try {
    await makeClient('app_own').fetchUserProfile('u_abc', { appKey: '  app_other  ' });
    assert.equal(new URL(fetchMock.requests[0].url).searchParams.get('appKey'), 'app_other');

    fetchMock.requests.length = 0;
    await makeClient('app_own').fetchUserProfile('u_abc', { appKey: '   ' });
    assert.equal(
      new URL(fetchMock.requests[0].url).searchParams.get('appKey'),
      'app_own',
      'a blank override must not strip the configured app key'
    );
  } finally {
    fetchMock.restore();
  }
});

test('fetchUserProfile percent-encodes an appKey with reserved characters', async () => {
  const fetchMock = installFetch(200, { profile: {}, apps: [], recentComments: [] });

  try {
    await makeClient('app key/../x?y#z').fetchUserProfile('u_abc');
    const raw = fetchMock.requests[0].url;
    assert.ok(!raw.includes('?y'), 'the app key must not inject a second query parameter');
    const url = new URL(raw);
    assert.equal(url.searchParams.get('appKey'), 'app key/../x?y#z');
  } finally {
    fetchMock.restore();
  }
});

test('fetchUserProfile still accepts a bare AbortSignal', async () => {
  const originalFetch = globalThis.fetch;
  let sawAbort = false;

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      const onAbort = () => {
        sawAbort = true;
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      };
      if (signal?.aborted) return onAbort();
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }) as any;

  try {
    const controller = new AbortController();
    const pending = makeClient().fetchUserProfile('u_abc', controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort();
    await assert.rejects(pending, (err: any) => err?.name === 'AbortError');
    assert.equal(sawAbort, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchUserProfile maps a spent per-IP budget to RateLimitedException with Retry-After', async () => {
  const fetchMock = installFetch(429, { error: 'Too many requests. Please try again shortly.' });

  try {
    await assert.rejects(makeClient().fetchUserProfile('u_abc'), (err: any) => {
      assert.ok(err instanceof RateLimitedException);
      assert.equal(err.status, 429);
      assert.equal(err.retryAfterMs, 7000);
      return true;
    });
  } finally {
    fetchMock.restore();
  }
});

test('fetchUserProfile maps an unknown u_ id to a 404 UnexpectedStatusException', async () => {
  const fetchMock = installFetch(404, { error: 'User profile not found' });

  try {
    await assert.rejects(makeClient().fetchUserProfile('u_unknown'), (err: any) => {
      assert.ok(err instanceof UnexpectedStatusException);
      assert.equal(err.status, 404);
      return true;
    });
  } finally {
    fetchMock.restore();
  }
});

// ---------------------------------------------------------------------------
// Screen states (needs the react-native module mocks)
// ---------------------------------------------------------------------------

const pressables: any[] = [];

const TextStub = (props: any) => {
  return props.children ?? null;
};
const ViewStub = (props: any) => props.children ?? null;
const TouchableOpacityStub = (props: any) => {
  pressables.push(props);
  return props.children ?? null;
};
const ScrollViewStub = (props: any) => props.children ?? null;

/** Collects the string children of the live tree (no stale renders). */
function collectTexts(root: TestRenderer.ReactTestRenderer['root']): string[] {
  const out: string[] = [];
  root.findAll((node: any) => {
    if (node.type === TextStub && typeof node.props?.children === 'string') {
      out.push(node.props.children);
    }
    return false;
  });
  return out;
}

if (supportsModuleMocks) {
  (test as any).mock.module('react-native', {
    namedExports: {
      useColorScheme: () => 'light',
      View: ViewStub,
      Text: TextStub,
      TextInput: () => null,
      TouchableOpacity: TouchableOpacityStub,
      ActivityIndicator: () => null,
      ScrollView: ScrollViewStub,
      Modal: (props: any) => props.children ?? null,
      SafeAreaView: (props: any) => props.children ?? null,
      FlatList: (props: any) => props.children ?? null,
      RefreshControl: () => null,
      Image: () => null,
      Linking: { openURL: () => Promise.resolve() },
      StyleSheet: { create: (styles: any) => styles, flatten: (s: any) => s },
      Alert: { alert: () => {} },
    },
  });
}

const { CupThreadProvider } = await import('../src/theme/CupThreadThemeProvider');
const { UserProfileScreen } = await import('../src/components/UserProfileScreen');

const screenTestOptions: TestOptions = supportsModuleMocks
  ? {}
  : {
      skip: 'node:test module mocking unavailable (needs Node >= 22.3 with --experimental-test-module-mocks)',
    };

async function settle(ms = 60): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
  await act(async () => {});
}

function renderProfileScreen(userId = 'u_abc') {
  return TestRenderer.create(
    React.createElement(CupThreadProvider, {
      client: makeClient(),
      children: React.createElement(UserProfileScreen, { userId }),
    })
  );
}

test(
  'UserProfileScreen shows the localized not-found state on 404',
  screenTestOptions,
  async () => {
    const fetchMock = installFetch(404, { error: 'User profile not found' });

    try {
      const renderer = renderProfileScreen();
      await settle();
      const texts = collectTexts(renderer.root);

      assert.ok(
        texts.includes(enStrings.userProfile.notFound),
        'an unknown id must render the not-found copy, not the generic failure'
      );
      assert.equal(texts.includes(enStrings.userProfile.loadFailed), false);
      renderer.unmount();
    } finally {
      fetchMock.restore();
    }
  }
);

test(
  'UserProfileScreen shows the rate-limited state with a working retry on 429',
  screenTestOptions,
  async () => {
    const fetchMock = installFetch(429, { error: 'Too many requests. Please try again shortly.' });
    pressables.length = 0;

    try {
      const renderer = renderProfileScreen();
      await settle();

      assert.ok(
        collectTexts(renderer.root).includes(enStrings.userProfile.rateLimited),
        'a spent budget must be explained, not shown as a generic failure'
      );

      const retry = pressables.find((p) => p.accessibilityLabel === enStrings.common.retry);
      assert.ok(retry, 'the rate-limited state must offer a retry affordance');

      // Retry against a now-healthy server: the profile renders.
      globalThis.fetch = (async (url: string | URL | Request) => {
        if (url.toString().includes('/api/v1/public/config/')) {
          return new Response(JSON.stringify({ appKey: 'app_key_abc', sdk: { features: {} } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(
          JSON.stringify({
            profile: {
              clerkUserId: 'u_abc',
              displayName: 'Ada Lovelace',
              avatarUrl: null,
              bio: null,
              websiteUrl: null,
            },
            apps: [],
            recentComments: [],
            hideComments: false,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }) as any;

      await act(async () => {
        retry.onPress();
      });
      await settle();

      const texts = collectTexts(renderer.root);
      assert.ok(
        texts.includes('Ada Lovelace'),
        'retry must reload the profile after the budget recovers'
      );
      assert.equal(
        texts.includes(enStrings.userProfile.rateLimited),
        false,
        'the rate-limited state must clear once the reload succeeds'
      );
      renderer.unmount();
    } finally {
      fetchMock.restore();
    }
  }
);
