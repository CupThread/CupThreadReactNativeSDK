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
      assert.equal(await customStore.hasSeenChangelog('3.0.0', 'app_overlay_prop_test'), false);

      // Dismiss overlay via Modal onRequestClose
      assert.ok(lastModalProps);
      await act(async () => {
        await lastModalProps.onRequestClose();
      });

      assert.equal(dismissed, true);

      // The overlay marks the version as seen within the client's app scope
      assert.equal(await customStore.hasSeenChangelog('3.0.0', 'app_overlay_prop_test'), true);
      assert.equal(
        await customStore.hasSeenChangelog('3.0.0'),
        false,
        'the unscoped legacy set must stay untouched'
      );

      // A cold start store using the same storage sees it as well
      const coldStartStore = new UserTokenStore({
        getItem: (k) => mem[k] || null,
        setItem: (k, v) => {
          mem[k] = v;
        },
      });
      assert.equal(await coldStartStore.hasSeenChangelog('3.0.0', 'app_overlay_prop_test'), true);

      renderer?.unmount();
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
);

test(
  'ChangelogOverlay safely guards entry title against empty, whitespace, and non-string types (#333)',
  renderTestOptions,
  async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      const s = url.toString();
      if (s.includes('/api/v1/public/config/')) {
        return new Response(
          JSON.stringify({
            appKey: 'app_overlay_title_guard_test',
            sdk: {
              features: { changelog: true },
              changelogOverlay: { entryCount: 10 },
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
                id: 'ch_overlay_valid',
                versionLabel: '1.0.0',
                title: '   Trimmed Overlay Title   ',
                body: 'Release details',
                publishedAt: '2025-01-01T00:00:00.000Z',
              },
              {
                id: 'ch_overlay_object',
                versionLabel: '1.0.1',
                title: { invalid: true } as any,
                body: 'Release details object',
                publishedAt: '2025-01-02T00:00:00.000Z',
              },
              {
                id: 'ch_overlay_bool',
                versionLabel: '1.0.2',
                title: true as any,
                body: 'Release details bool',
                publishedAt: '2025-01-03T00:00:00.000Z',
              },
              {
                id: 'ch_overlay_num',
                versionLabel: '1.0.3',
                title: 12345 as any,
                body: 'Release details num',
                publishedAt: '2025-01-04T00:00:00.000Z',
              },
              {
                id: 'ch_overlay_null',
                versionLabel: '1.0.4',
                title: null as any,
                body: 'Release details null',
                publishedAt: '2025-01-05T00:00:00.000Z',
              },
              {
                id: 'ch_overlay_empty',
                versionLabel: '1.0.5',
                title: '',
                body: 'Release details empty',
                publishedAt: '2025-01-06T00:00:00.000Z',
              },
              {
                id: 'ch_overlay_ws',
                versionLabel: '1.0.6',
                title: '   \t   ',
                body: 'Release details ws',
                publishedAt: '2025-01-07T00:00:00.000Z',
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
        appKey: 'app_overlay_title_guard_test',
      });

      const mem: Record<string, string> = {};
      const customStore = new UserTokenStore({
        getItem: (k) => mem[k] || null,
        setItem: (k, v) => {
          mem[k] = v;
        },
      });

      let renderer!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        renderer = TestRenderer.create(
          <CupThreadProvider client={client}>
            <ChangelogOverlay tokenStore={customStore} />
          </CupThreadProvider>
        );
      });
      await flush();

      assert.ok(lastModalProps);
      assert.equal(lastModalProps.visible, true);

      renderer?.unmount();
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
);
