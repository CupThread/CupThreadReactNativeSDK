import test, { type TestOptions } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { FeedbackClient } from '../src/client/FeedbackClient';
import { UserTokenStore } from '../src/client/UserTokenStore';
import type { TokenStorageAdapter } from '../src/client/UserTokenStore';

const STORAGE_KEY = 'cupthread_user_token_v1';

// The component-level regression tests render `WhatsNewScreen`, which imports
// react-native — unloadable under plain Node. Mock every symbol the screen and
// its children use with lightweight stubs, then dynamically import the real
// modules so the mock is in place before evaluation. Module mocking needs
// Node >= 22.3 with --experimental-test-module-mocks; without it those tests
// are skipped (client- and helper-level coverage below is unaffected).
const supportsModuleMocks = typeof (test as any).mock?.module === 'function';

const alertCalls: any[][] = [];
const touchableOpacityProps: any[] = [];
const textInputProps: any[] = [];

const TouchableOpacityStub = (props: any) => {
  touchableOpacityProps.push(props);
  return props.children ?? null;
};

const TextInputStub = (props: any) => {
  textInputProps.push(props);
  return null;
};

if (supportsModuleMocks) {
  (test as any).mock.module('react-native', {
    namedExports: {
      useColorScheme: () => 'light',
      // Layout stubs must pass children through so nested pressables stay in
      // the rendered tree.
      View: ({ children }: any) => children ?? null,
      Text: () => null,
      TextInput: TextInputStub,
      TouchableOpacity: TouchableOpacityStub,
      ActivityIndicator: () => null,
      ScrollView: ({ children }: any) => children ?? null,
      Modal: ({ children }: any) => children ?? null,
      SafeAreaView: ({ children }: any) => children ?? null,
      // The subscribe card is the list header, so the FlatList stub must
      // render it (and any rows) for the button to appear in the tree.
      FlatList: ({ ListHeaderComponent, data, renderItem }: any) => (
        <>
          {typeof ListHeaderComponent === 'function' ? <ListHeaderComponent /> : ListHeaderComponent ?? null}
          {(data ?? []).map((item: any, index: number) => (
            <React.Fragment key={item?.id ?? index}>
              {renderItem ? renderItem({ item, index }) : null}
            </React.Fragment>
          ))}
        </>
      ),
      RefreshControl: () => null,
      StyleSheet: { create: (styles: any) => styles, flatten: (s: any) => s },
      Alert: { alert: (...args: any[]) => alertCalls.push(args) },
      Linking: { openURL: async () => {} },
    },
  });
}

const { CupThreadProvider } = supportsModuleMocks
  ? await import('../src/theme/CupThreadThemeProvider')
  : ({} as any);
const { WhatsNewScreen } = supportsModuleMocks
  ? await import('../src/components/WhatsNewScreen')
  : ({} as any);
const { resolveEffectiveUserToken } = await import('../src/utils/userToken');

const renderTestOptions: TestOptions = supportsModuleMocks
  ? {}
  : {
      skip: 'node:test module mocking unavailable (needs Node >= 22.3 with --experimental-test-module-mocks)',
    };

function makeClient(): FeedbackClient {
  return new FeedbackClient({
    baseUrl: 'https://api.cupthread.com',
    appKey: 'app_subscribe_gate',
  });
}

/** In-memory adapter whose token read resolves after `delayMs` of wall time. */
function makeDeferredAdapter(token: string, delayMs: number): TokenStorageAdapter {
  return {
    getItem: async (key: string) => {
      if (key !== STORAGE_KEY) return null;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return token;
    },
    setItem: async () => {},
  };
}

/** Instant in-memory adapter pre-seeded with the given token. */
function makeSeededAdapter(token: string): TokenStorageAdapter {
  return {
    getItem: async (key: string) => (key === STORAGE_KEY ? token : null),
    setItem: async () => {},
  };
}

/** Intercept subscribe/changelog traffic; other endpoints reject. */
function installFetch(): { subscribeCalls: Array<{ headers: any; body: any }> } {
  const subscribeCalls: Array<{ headers: any; body: any }> = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const target = url.toString();
    if (target.includes('/changelog/subscribe')) {
      subscribeCalls.push({ headers: init?.headers, body: init?.body });
      return new Response(JSON.stringify({ subscribed: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (target.endsWith('/changelog')) {
      return new Response(JSON.stringify({ entries: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new TypeError('unexpected endpoint in subscribe-gate tests');
  }) as any;
  return { subscribeCalls };
}

test('subscribeToChangelog sends the X-User-Token header', async () => {
  const { subscribeCalls } = installFetch();
  const client = makeClient();
  await client.subscribeToChangelog('user@example.com', 'tok_1');
  assert.equal(subscribeCalls.length, 1);
  assert.equal(
    (subscribeCalls[0].headers as any)?.['X-User-Token'],
    'tok_1',
    'the transport contract the readiness fallback depends on'
  );
});

test('subscribeToChangelog silently omits the header for an empty token', async () => {
  const { subscribeCalls } = installFetch();
  const client = makeClient();
  await client.subscribeToChangelog('user@example.com', '');
  assert.equal(subscribeCalls.length, 1);
  assert.equal(
    (subscribeCalls[0].headers as any)?.['X-User-Token'],
    undefined,
    'documents the failure mode: an empty token must never reach the wire'
  );
});

test('resolveEffectiveUserToken prefers a truthy context token', async () => {
  UserTokenStore.configure(makeSeededAdapter('store_tok'));
  const resolved = await resolveEffectiveUserToken('ctx_tok');
  assert.equal(
    resolved,
    'ctx_tok',
    'an explicit context token must be used verbatim, not re-read from the store'
  );
});

test('resolveEffectiveUserToken falls back to the store for an empty context token', async () => {
  UserTokenStore.configure(makeDeferredAdapter('tok_bootstrap', 60));
  const startedAt = Date.now();
  const resolved = await resolveEffectiveUserToken('');
  assert.equal(resolved, 'tok_bootstrap');
  assert.ok(
    Date.now() - startedAt >= 50,
    'the fallback must await the (possibly async) store read, not return early'
  );
});

test('resolveEffectiveUserToken treats null and undefined like empty', async () => {
  UserTokenStore.configure(makeSeededAdapter('tok_seeded'));
  assert.equal(await resolveEffectiveUserToken(null), 'tok_seeded');
  assert.equal(await resolveEffectiveUserToken(undefined), 'tok_seeded');
});

test(
  'WhatsNewScreen disables Subscribe while the token is bootstrapping',
  renderTestOptions,
  async () => {
    UserTokenStore.configure(makeDeferredAdapter('tok_bootstrap', 80));
    const { subscribeCalls } = installFetch();
    touchableOpacityProps.length = 0;
    textInputProps.length = 0;
    alertCalls.length = 0;

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <CupThreadProvider client={makeClient()}>
          <WhatsNewScreen />
        </CupThreadProvider>
      );
    });

    const getButton = () => touchableOpacityProps[touchableOpacityProps.length - 1];
    assert.ok(getButton(), 'the subscribe button must be rendered');
    assert.equal(
      getButton().disabled,
      true,
      'the button must be disabled until the persisted token is recovered'
    );
    const style = Array.isArray(getButton().style) ? getButton().style : [getButton().style];
    assert.equal(
      style[style.length - 1]?.opacity,
      0.6,
      'the disabled state must be visually communicated'
    );

    // A tap during bootstrap must be inert: valid email, but no request.
    textInputProps[textInputProps.length - 1]?.onChangeText?.('user@example.com');
    await act(async () => {});
    await act(async () => {
      await getButton().onPress?.();
    });
    assert.equal(
      subscribeCalls.length,
      0,
      'no subscribe request may leave the client before the token is ready'
    );
    renderer.unmount();
  }
);

test(
  'WhatsNewScreen subscribe after bootstrap carries X-User-Token',
  renderTestOptions,
  async () => {
    UserTokenStore.configure(makeDeferredAdapter('tok_bootstrap', 80));
    const { subscribeCalls } = installFetch();
    touchableOpacityProps.length = 0;
    textInputProps.length = 0;
    alertCalls.length = 0;

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <CupThreadProvider client={makeClient()}>
          <WhatsNewScreen />
        </CupThreadProvider>
      );
    });

    const getButton = () => touchableOpacityProps[touchableOpacityProps.length - 1];

    // Wait for the deferred adapter read to complete and the provider to
    // re-render with the recovered identity.
    let ready = false;
    for (let i = 0; i < 30 && !ready; i++) {
      await new Promise((resolve) => setTimeout(resolve, 15));
      await act(async () => {});
      ready = getButton().disabled === false;
    }
    assert.equal(ready, true, 'the button must become enabled once the token resolves');

    textInputProps[textInputProps.length - 1]?.onChangeText?.('user@example.com');
    await act(async () => {});
    await act(async () => {
      await getButton().onPress?.();
    });

    assert.equal(subscribeCalls.length, 1, 'exactly one subscribe request is sent');
    assert.equal(
      (subscribeCalls[0].headers as any)?.['X-User-Token'],
      'tok_bootstrap',
      'the request must carry the identity recovered from storage'
    );
    assert.deepEqual(JSON.parse(subscribeCalls[0].body as string), {
      email: 'user@example.com',
    });
    assert.equal(alertCalls.length, 1, 'the success path must be reported to the user');
    renderer.unmount();
  }
);
