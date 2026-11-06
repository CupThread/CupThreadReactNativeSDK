import test, { type TestOptions } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { createFlatListStub } from './helpers/virtualizedListStub';
import { FeedbackClient } from '../src/client/FeedbackClient';
import { enStrings as en } from '../src/i18n/en';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const supportsModuleMocks = typeof (test as any).mock?.module === 'function';

const ViewStub = (props: any) => {
  return React.createElement('View', props, props.children ?? null);
};

const TextStub = (props: any) => {
  return React.createElement('Text', props, props.children ?? null);
};

const TextInputStub = (props: any) => {
  return React.createElement('TextInput', props);
};

const TouchableOpacityStub = (props: any) => {
  return React.createElement('TouchableOpacity', props, props.children ?? null);
};

const FlatListStub = createFlatListStub();

if (supportsModuleMocks) {
  (test as any).mock.module('react-native', {
    namedExports: {
      useColorScheme: () => 'light',
      View: ViewStub,
      Text: TextStub,
      TextInput: TextInputStub,
      TouchableOpacity: TouchableOpacityStub,
      ActivityIndicator: () => null,
      ScrollView: ({ children }: any) => children ?? null,
      Modal: ({ children }: any) => children ?? null,
      SafeAreaView: ({ children }: any) => children ?? null,
      FlatList: FlatListStub,
      RefreshControl: () => null,
      StyleSheet: { create: (styles: any) => styles, flatten: (s: any) => s },
      Alert: { alert: () => {} },
      Linking: { openURL: async () => {}, canOpenURL: async () => true },
    },
  });
}

const { CupThreadProvider } = supportsModuleMocks
  ? await import('../src/theme/CupThreadThemeProvider')
  : ({} as any);
const { WhatsNewScreen } = supportsModuleMocks
  ? await import('../src/components/WhatsNewScreen')
  : ({} as any);

const renderTestOptions: TestOptions = supportsModuleMocks
  ? {}
  : {
      skip: 'node:test module mocking unavailable (needs Node >= 22.3 with --experimental-test-module-mocks)',
    };

async function flush(times = 10): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2));
    await act(async () => {});
  }
}

function makeClient(appKey = 'app_whats_new_empty_test'): FeedbackClient {
  return new FeedbackClient({
    baseUrl: 'https://api.cupthread.com',
    appKey,
  });
}

function getAllTextStrings(root: TestRenderer.ReactTestInstance): string[] {
  return root.findAllByType(TextStub as any).map((t) => {
    const c = t.props?.children;
    return typeof c === 'string' ? c : Array.isArray(c) ? c.join('') : String(c ?? '');
  });
}

test(
  'WhatsNewScreen renders localized empty notice when changelog has zero entries (#243)',
  renderTestOptions,
  async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      const s = url.toString();
      if (s.includes('/api/v1/public/config/')) {
        return new Response(
          JSON.stringify({
            appKey: 'app_whats_new_empty_test',
            sdk: { features: { changelog: true } },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (s.includes('/changelog')) {
        return new Response(JSON.stringify({ entries: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200 });
    }) as any;

    try {
      let renderer!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        renderer = TestRenderer.create(
          <CupThreadProvider client={makeClient()}>
            <WhatsNewScreen />
          </CupThreadProvider>
        );
      });
      await flush();

      const texts = getAllTextStrings(renderer.root);
      assert.ok(
        texts.includes(en.changelog.emptyChangelog),
        `expected "${en.changelog.emptyChangelog}" in rendered tree, got: ${JSON.stringify(texts)}`
      );
      assert.ok(
        texts.includes(en.changelog.subscribeTitle),
        'expected subscribe header card to remain present alongside empty notice'
      );

      const flatList = renderer.root.findByType(FlatListStub as any);
      assert.ok(flatList, 'FlatList should be rendered');
      const containerStyle = flatList.props.contentContainerStyle;
      assert.ok(
        Array.isArray(containerStyle) && containerStyle.some((s: any) => s && s.flexGrow === 1),
        'contentContainerStyle should include flexGrow: 1 when entries is empty'
      );
      renderer.unmount();
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
);

test(
  'WhatsNewScreen renders release cards and hides empty notice when entries exist (#243)',
  renderTestOptions,
  async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      const s = url.toString();
      if (s.includes('/api/v1/public/config/')) {
        return new Response(
          JSON.stringify({
            appKey: 'app_whats_new_empty_test',
            sdk: { features: { changelog: true } },
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
                versionLabel: '2.5.0',
                title: 'Autumn 2026 Feature Drop',
                body: 'Detailed notes on features',
                publishedAt: '2026-10-15T12:00:00Z',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('{}', { status: 200 });
    }) as any;

    try {
      let renderer!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        renderer = TestRenderer.create(
          <CupThreadProvider client={makeClient()}>
            <WhatsNewScreen />
          </CupThreadProvider>
        );
      });
      await flush();

      const texts = getAllTextStrings(renderer.root);
      assert.ok(
        texts.includes('Autumn 2026 Feature Drop'),
        `expected release card title in rendered tree, got: ${JSON.stringify(texts)}`
      );
      assert.ok(
        !texts.includes(en.changelog.emptyChangelog),
        'empty notice should not be rendered when entries are present'
      );

      const flatList = renderer.root.findByType(FlatListStub as any);
      assert.ok(flatList, 'FlatList should be rendered');
      const containerStyle = flatList.props.contentContainerStyle;
      assert.ok(
        Array.isArray(containerStyle) && !containerStyle.some((s: any) => s && s.flexGrow === 1),
        'contentContainerStyle should not include flexGrow: 1 when entries are present'
      );
      renderer.unmount();
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
);

test(
  'WhatsNewScreen renders ErrorState and hides empty notice on initial load failure (#243)',
  renderTestOptions,
  async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      const s = url.toString();
      if (s.includes('/api/v1/public/config/')) {
        return new Response(
          JSON.stringify({
            appKey: 'app_whats_new_empty_test',
            sdk: { features: { changelog: true } },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (s.includes('/changelog')) {
        return new Response(JSON.stringify({ error: 'Server Error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200 });
    }) as any;

    try {
      let renderer!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        renderer = TestRenderer.create(
          <CupThreadProvider client={makeClient()}>
            <WhatsNewScreen />
          </CupThreadProvider>
        );
      });
      await flush();

      const texts = getAllTextStrings(renderer.root);
      assert.ok(
        texts.includes(en.common.error),
        `expected error state message, got: ${JSON.stringify(texts)}`
      );
      assert.ok(
        !texts.includes(en.changelog.emptyChangelog),
        'empty notice should not be rendered when load error is active'
      );
      renderer.unmount();
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
);

test(
  'WhatsNewScreen renders sectionUnavailable and hides empty notice when changelog is disabled (#243)',
  renderTestOptions,
  async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      const s = url.toString();
      if (s.includes('/api/v1/public/config/')) {
        return new Response(
          JSON.stringify({
            appKey: 'app_whats_new_empty_test',
            sdk: { features: { changelog: false } },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('{}', { status: 200 });
    }) as any;

    try {
      let renderer!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        renderer = TestRenderer.create(
          <CupThreadProvider client={makeClient()}>
            <WhatsNewScreen />
          </CupThreadProvider>
        );
      });
      await flush();

      const texts = getAllTextStrings(renderer.root);
      assert.ok(
        texts.includes(en.changelog.sectionUnavailable),
        `expected section unavailable notice, got: ${JSON.stringify(texts)}`
      );
      assert.ok(
        !texts.includes(en.changelog.emptyChangelog),
        'empty notice should not be rendered when surface is disabled'
      );
      renderer.unmount();
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
);
