import test, { type TestOptions } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { FeedbackClient } from '../src/client/FeedbackClient';
import { UserTokenStore } from '../src/client/UserTokenStore';

const supportsModuleMocks = typeof (test as any).mock?.module === 'function';

let lastModalProps: any = null;
const ModalStub = (props: any) => {
  lastModalProps = props;
  return props.visible ? (props.children ?? null) : null;
};

if (supportsModuleMocks) {
  (test as any).mock.module('react-native', {
    namedExports: {
      useColorScheme: () => 'light',
      View: ({ children }: any) => children ?? null,
      Text: ({ children }: any) => children ?? null,
      TextInput: () => null,
      TouchableOpacity: ({ children, onPress }: any) =>
        React.createElement('button', { onClick: onPress }, children),
      ActivityIndicator: () => null,
      ScrollView: ({ children }: any) => children ?? null,
      Modal: ModalStub,
      SafeAreaView: ({ children }: any) => children ?? null,
      StyleSheet: { create: (styles: any) => styles, flatten: (s: any) => s },
      Linking: { openURL: async () => {}, canOpenURL: async () => true },
    },
  });
}

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const { CupThreadProvider } = await import('../src/theme/CupThreadThemeProvider');
const { ChangelogOverlay } = await import('../src/components/ChangelogOverlay');

const renderTestOptions: TestOptions = supportsModuleMocks
  ? {}
  : {
      skip: 'node:test module mocking unavailable (needs Node >= 22.3 with --experimental-test-module-mocks)',
    };

async function flush(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 3));
    await act(async () => {});
  }
}

test(
  'ChangelogOverlay passes tokenStore prop to prepareChangelogOverlay and records seen status to custom store',
  renderTestOptions,
  async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      const s = url.toString();
      if (s.includes('/api/v1/public/config/')) {
        return new Response(
          JSON.stringify({
            appKey: 'app_overlay_prop_test',
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
                id: 'ch_prop_test',
                versionLabel: '3.0.0',
                title: 'Release 3.0.0',
                body: 'Release details',
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
        appKey: 'app_overlay_prop_test',
      });

      const mem: Record<string, string> = {};
      const customStore = new UserTokenStore({
        getItem: (k) => mem[k] || null,
        setItem: (k, v) => {
          mem[k] = v;
        },
      });

      let dismissed = false;
      let renderer: any = null;

      await act(async () => {
        renderer = TestRenderer.create(
          <CupThreadProvider client={client}>
            <ChangelogOverlay
              visible={true}
              onlyIfUnseen={true}
              autoMarkSeen={true}
              tokenStore={customStore}
              onClose={() => {
                dismissed = true;
              }}
            />
          </CupThreadProvider>
        );
      });

      await flush(10);

      // Verify custom store has not yet marked it seen
      assert.equal(await customStore.hasSeenChangelog('3.0.0'), false);

      // Dismiss overlay via Modal onRequestClose
      assert.ok(lastModalProps);
      await act(async () => {
        await lastModalProps.onRequestClose();
      });

      assert.equal(dismissed, true);

      // Custom store should now have marked 3.0.0 as seen
      assert.equal(await customStore.hasSeenChangelog('3.0.0'), true);

      // A cold start store using the same storage sees it as well
      const coldStartStore = new UserTokenStore({
        getItem: (k) => mem[k] || null,
        setItem: (k, v) => {
          mem[k] = v;
        },
      });
      assert.equal(await coldStartStore.hasSeenChangelog('3.0.0'), true);

      renderer?.unmount();
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
);
