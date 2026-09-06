import test, { beforeEach, afterEach, type TestOptions } from 'node:test';
import assert from 'node:assert/strict';
import React, { useEffect } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { FeedbackClient } from '../src/client/FeedbackClient';
import { UserTokenStore } from '../src/client/UserTokenStore';
import type { TokenStorageAdapter } from '../src/client/UserTokenStore';

// `CupThreadProvider` imports `useColorScheme` from react-native, which cannot
// load under plain Node. Mock that surface, then dynamically import the
// provider module so the mock is in place before evaluation. Module mocking
// needs Node >= 22.3 with --experimental-test-module-mocks; without it the
// render-level tests below are skipped (store-level coverage is unaffected).
const supportsModuleMocks = typeof (test as any).mock?.module === 'function';
if (supportsModuleMocks) {
  // `namedExports` is what Node 22 (the CI baseline) uses to link ESM named
  // imports against the mock; newer runtimes still accept it (deprecation
  // warning only), while the replacement `exports` option breaks Node 22.
  (test as any).mock.module('react-native', {
    namedExports: { useColorScheme: () => 'light' },
  });
}

const { CupThreadProvider, useCupThreadClient, useCupThreadUserToken, useCupThreadTokenReadiness } =
  await import('../src/theme/CupThreadThemeProvider');

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Options shared by the render-level tests: skipped cleanly when the runtime
// lacks node:test module mocking (Node < 22.3 or the flag is absent).
const renderTestOptions: TestOptions = supportsModuleMocks
  ? {}
  : {
      skip: 'node:test module mocking unavailable (needs Node >= 22.3 with --experimental-test-module-mocks)',
    };

type Observation = { token: string; ready: boolean };

function makeAsyncAdapter(): TokenStorageAdapter {
  const mem: Record<string, string> = {};
  return {
    getItem: async (key: string) => {
      await new Promise((resolve) => setTimeout(resolve, 2));
      return mem[key] ?? null;
    },
    setItem: async (key: string, val: string) => {
      await new Promise((resolve) => setTimeout(resolve, 2));
      mem[key] = val;
    },
  };
}

/** Let pending microtasks and pending act-batched state updates settle. */
async function flush(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2));
    await act(async () => {});
  }
}

function TokenProbe({ observations }: { observations: Observation[] }) {
  const userToken = useCupThreadUserToken();
  const isTokenReady = useCupThreadTokenReadiness();
  useEffect(() => {
    observations.push({ token: userToken, ready: isTokenReady });
  }, [userToken, isTokenReady, observations]);
  return null;
}

function makeClient(): FeedbackClient {
  return new FeedbackClient({
    baseUrl: 'https://api.cupthread.com',
    appKey: 'app_test_token_sync',
  });
}

// The provider fetches remote config on mount; disable the network by default.
const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = (async () => {
    throw new TypeError('network disabled in provider token-sync tests');
  }) as any;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('provider follows UserTokenStore.setToken after mount', renderTestOptions, async () => {
  const store = UserTokenStore.configure(makeAsyncAdapter());
  const observations: Observation[] = [];

  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <CupThreadProvider client={makeClient()}>
        <TokenProbe observations={observations} />
      </CupThreadProvider>
    );
  });
  await flush();

  const initial = observations[observations.length - 1];
  assert.equal(initial.ready, true);
  assert.ok(initial.token.length > 0);
  assert.equal(initial.token, store.token);
  const observationsBefore = observations.length;

  await act(async () => {
    await store.setToken('user-1');
  });
  await flush();

  const last = observations[observations.length - 1];
  assert.equal(
    last.token,
    'user-1',
    'consumers must re-render with the explicit identity after setToken()'
  );
  assert.equal(last.ready, true);
  assert.ok(observations.length > observationsBefore, 'a re-render must have been observed');
  renderer!.unmount();
});

test('provider follows UserTokenStore.resetToken after mount', renderTestOptions, async () => {
  const store = UserTokenStore.configure(makeAsyncAdapter());
  const observations: Observation[] = [];

  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <CupThreadProvider client={makeClient()}>
        <TokenProbe observations={observations} />
      </CupThreadProvider>
    );
  });
  await flush();

  const previous = observations[observations.length - 1].token;
  const fresh = await store.resetToken();
  await flush();

  assert.notEqual(fresh, previous);
  const last = observations[observations.length - 1];
  assert.equal(
    last.token,
    fresh,
    'consumers must re-render with the fresh UUID after resetToken()'
  );
  renderer!.unmount();
});

test('explicit userToken prop wins over store identity switches', renderTestOptions, async () => {
  const store = UserTokenStore.configure(makeAsyncAdapter());
  const observations: Observation[] = [];

  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <CupThreadProvider client={makeClient()} userToken="prop-token">
        <TokenProbe observations={observations} />
      </CupThreadProvider>
    );
  });
  await flush();

  assert.equal(observations[observations.length - 1].token, 'prop-token');

  await act(async () => {
    await store.setToken('user-2');
  });
  await flush();

  assert.equal(
    observations[observations.length - 1].token,
    'prop-token',
    'a store switch must not change the context while an explicit prop is set'
  );
  renderer!.unmount();
});

test('unmounting the provider unsubscribes from the store', renderTestOptions, async () => {
  const store = UserTokenStore.configure(makeAsyncAdapter());
  const observations: Observation[] = [];

  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <CupThreadProvider client={makeClient()}>
        <TokenProbe observations={observations} />
      </CupThreadProvider>
    );
  });
  await flush();

  const observationsAtUnmount = observations.length;
  renderer!.unmount();

  await store.setToken('user-after-unmount');
  await flush();

  assert.equal(
    observations.length,
    observationsAtUnmount,
    'no further state updates may be scheduled after unmount'
  );
});

test(
  'token-dependent data fetch carries the new identity after setToken',
  renderTestOptions,
  async () => {
    const store = UserTokenStore.configure(makeAsyncAdapter());
    const requestedTokens: string[] = [];

    globalThis.fetch = (async (url: string | URL | Request) => {
      const target = url.toString();
      if (target.includes('/api/v1/feature-requests')) {
        requestedTokens.push(new URL(target).searchParams.get('userToken') ?? '');
        return new Response(JSON.stringify({ requests: [], total: 0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new TypeError('unexpected endpoint in provider token-sync tests');
    }) as any;

    function FetchingProbe() {
      const client = useCupThreadClient();
      const userToken = useCupThreadUserToken();
      const isTokenReady = useCupThreadTokenReadiness();
      useEffect(() => {
        if (!isTokenReady || !userToken) return;
        client.fetchFeatureRequests({ userToken }).catch(() => {});
      }, [client, userToken, isTokenReady]);
      return null;
    }

    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <CupThreadProvider client={makeClient()}>
          <FetchingProbe />
        </CupThreadProvider>
      );
    });
    await flush();

    assert.equal(requestedTokens.length, 1, 'exactly the initial resolution fetch happens first');
    const anonymousToken = requestedTokens[0];

    await act(async () => {
      await store.setToken('user-1');
    });
    await flush();

    assert.ok(requestedTokens.length >= 2, 'the list must be re-fetched after the identity switch');
    assert.equal(requestedTokens[0], anonymousToken);
    assert.notEqual(anonymousToken, 'user-1');
    assert.equal(
      requestedTokens[requestedTokens.length - 1],
      'user-1',
      'the next list fetch must carry the new identity'
    );
    renderer!.unmount();
  }
);
