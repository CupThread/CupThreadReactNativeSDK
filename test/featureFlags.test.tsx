import test, { type TestOptions } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { isSurfaceEnabled } from '../src/utils/featureFlags';
import type { PublicAppConfig, SdkFeatures } from '../src/types';
import { FeedbackClient } from '../src/client/FeedbackClient';
import { enStrings } from '../src/i18n/en';

// --- Pure Helper Unit Tests ---

test('isSurfaceEnabled: returns true when appConfig is null or undefined (config not loaded)', () => {
  assert.equal(isSurfaceEnabled(null, 'featureRequests'), true);
  assert.equal(isSurfaceEnabled(undefined, 'featureRequests'), true);
  assert.equal(isSurfaceEnabled(null, 'feedback'), true);
  assert.equal(isSurfaceEnabled(null, 'roadmap'), true);
  assert.equal(isSurfaceEnabled(null, 'changelog'), true);
});

test('isSurfaceEnabled: returns false for disabled surface, true for other enabled surfaces', () => {
  const config = {
    sdk: {
      features: {
        featureRequests: false,
        feedback: true,
        roadmap: true,
        changelog: true,
      },
    },
  } as unknown as PublicAppConfig;

  assert.equal(isSurfaceEnabled(config, 'featureRequests'), false);
  assert.equal(isSurfaceEnabled(config, 'feedback'), true);
  assert.equal(isSurfaceEnabled(config, 'roadmap'), true);
  assert.equal(isSurfaceEnabled(config, 'changelog'), true);
});

test('isSurfaceEnabled: returns true when sdk.features or flag is undefined (back-compat with older backends)', () => {
  const emptyConfig = {} as unknown as PublicAppConfig;
  assert.equal(isSurfaceEnabled(emptyConfig, 'featureRequests'), true);

  const noFeaturesConfig = { sdk: {} } as unknown as PublicAppConfig;
  assert.equal(isSurfaceEnabled(noFeaturesConfig, 'featureRequests'), true);

  const partialFeaturesConfig = {
    sdk: {
      features: {
        feedback: false,
      } as Partial<SdkFeatures>,
    },
  } as unknown as PublicAppConfig;

  assert.equal(isSurfaceEnabled(partialFeaturesConfig, 'feedback'), false);
  assert.equal(isSurfaceEnabled(partialFeaturesConfig, 'featureRequests'), true);
  assert.equal(isSurfaceEnabled(partialFeaturesConfig, 'roadmap'), true);
  assert.equal(isSurfaceEnabled(partialFeaturesConfig, 'changelog'), true);
});

test('isSurfaceEnabled: maintains isolation between flags', () => {
  const config = {
    sdk: {
      features: {
        changelog: false,
        featureRequests: true,
        feedback: true,
        roadmap: true,
      },
    },
  } as unknown as PublicAppConfig;

  assert.equal(isSurfaceEnabled(config, 'changelog'), false);
  assert.equal(isSurfaceEnabled(config, 'featureRequests'), true);
  assert.equal(isSurfaceEnabled(config, 'feedback'), true);
  assert.equal(isSurfaceEnabled(config, 'roadmap'), true);
});

// --- UI Render Tests with Mocked React Native ---

const supportsModuleMocks = typeof (test as any).mock?.module === 'function';

let renderGeneration = 0;
const renderedTexts: { gen: number; text: string }[] = [];

function finalPassTexts(): string[] {
  const gen = renderedTexts.reduce((max, t) => Math.max(max, t.gen), 0);
  return renderedTexts.filter((t) => t.gen === gen).map((t) => t.text);
}

const TextStub = (props: any) => {
  const value = Array.isArray(props.children)
    ? props.children.map((c: any) => String(c)).join('')
    : props.children == null
      ? ''
      : String(props.children);
  renderedTexts.push({ gen: renderGeneration, text: value });
  return null;
};

const SafeAreaViewStub = ({ children }: any) => {
  renderGeneration += 1;
  return children ?? null;
};

if (supportsModuleMocks) {
  (test as any).mock.module('react-native', {
    namedExports: {
      useColorScheme: () => 'light',
      View: ({ children }: any) => children ?? null,
      Text: TextStub,
      TextInput: () => null,
      TouchableOpacity: ({ children }: any) => children ?? null,
      ActivityIndicator: () => null,
      FlatList: ({ data, renderItem, keyExtractor }: any) => (
        <>
          {(data ?? []).map((item: any, index: number) => (
            <React.Fragment key={keyExtractor ? keyExtractor(item, index) : index}>
              {renderItem({ item, index })}
            </React.Fragment>
          ))}
        </>
      ),
      ScrollView: ({ children }: any) => children ?? null,
      Modal: ({ children }: any) => children ?? null,
      RefreshControl: () => null,
      SafeAreaView: SafeAreaViewStub,
      Image: () => null,
      Linking: { openURL: () => Promise.resolve() },
      Platform: { OS: 'ios', select: (options: any) => options.ios ?? options.default },
      StyleSheet: { create: (styles: any) => styles, flatten: (s: any) => s },
      Alert: { alert: () => {} },
    },
  });
}

const { CupThreadProvider } = await import('../src/theme/CupThreadThemeProvider');
const { FeatureRequestsScreen } = await import('../src/components/FeatureRequestsScreen');
const { RoadmapBoardScreen } = await import('../src/components/RoadmapBoardScreen');
const { WhatsNewScreen } = await import('../src/components/WhatsNewScreen');
const { FeedbackComposer } = await import('../src/components/FeedbackComposer');

const renderTestOptions: TestOptions = supportsModuleMocks
  ? {}
  : {
      skip: 'node:test module mocking unavailable (needs Node >= 22.3 with --experimental-test-module-mocks)',
    };

async function flush(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2));
    await act(async () => {});
  }
}

function makeMockAppConfig(features: Partial<SdkFeatures>): PublicAppConfig {
  return {
    appId: 'app_test_123',
    appKey: 'key_test_123',
    slug: 'test-app',
    name: 'Test App',
    allowPublic: true,
    allowedPlatforms: ['ios', 'android'],
    maxAttachmentBytes: 10 * 1024 * 1024,
    allowAnonymousRoadmap: true,
    allowAnonymousVote: true,
    allowAnonymousFeedback: true,
    allowAnonymousChangelog: true,
    sdk: {
      theme: 'system',
      features: {
        feedback: true,
        featureRequests: true,
        roadmap: true,
        changelog: true,
        ...features,
      },
      changelogOverlay: {
        title: "What's New",
        entryCount: 3,
        primaryButton: 'Got it',
        closeButton: 'Close',
      },
    },
  };
}

test(
  'FeatureRequestsScreen renders sectionUnavailable when featureRequests is false in remote config',
  renderTestOptions,
  async () => {
    renderedTexts.length = 0;
    renderGeneration = 0;

    const originalFetch = globalThis.fetch;
    const mockConfig = makeMockAppConfig({ featureRequests: false });

    globalThis.fetch = (async (url: string | URL | Request) => {
      const target = url.toString();
      if (target.includes('/api/v1/public/config/')) {
        return new Response(JSON.stringify(mockConfig), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ requests: [], total: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const client = new FeedbackClient({
        baseUrl: 'https://api.example.test',
        appKey: 'key_test_123',
      });

      let renderer!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        renderer = TestRenderer.create(
          <CupThreadProvider client={client} userToken="user-tok-123">
            <FeatureRequestsScreen />
          </CupThreadProvider>
        );
      });

      await flush(10);

      const texts = finalPassTexts();
      assert.ok(
        texts.includes(enStrings.featureRequests.sectionUnavailable),
        `Expected rendered texts to include "${enStrings.featureRequests.sectionUnavailable}", got: ${JSON.stringify(texts)}`
      );

      renderer?.unmount();
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
);

test(
  'RoadmapBoardScreen renders sectionUnavailable when roadmap is false in remote config',
  renderTestOptions,
  async () => {
    renderedTexts.length = 0;
    renderGeneration = 0;

    const originalFetch = globalThis.fetch;
    const mockConfig = makeMockAppConfig({ roadmap: false });

    globalThis.fetch = (async (url: string | URL | Request) => {
      const target = url.toString();
      if (target.includes('/api/v1/public/config/')) {
        return new Response(JSON.stringify(mockConfig), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (target.includes('/api/v1/public/columns/')) {
        return new Response(JSON.stringify({ columns: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ requests: [], total: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const client = new FeedbackClient({
        baseUrl: 'https://api.example.test',
        appKey: 'key_test_123',
      });

      let renderer!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        renderer = TestRenderer.create(
          <CupThreadProvider client={client} userToken="user-tok-123">
            <RoadmapBoardScreen />
          </CupThreadProvider>
        );
      });

      await flush(10);

      const texts = finalPassTexts();
      assert.ok(
        texts.includes(enStrings.roadmap.sectionUnavailable),
        `Expected rendered texts to include "${enStrings.roadmap.sectionUnavailable}", got: ${JSON.stringify(texts)}`
      );

      renderer?.unmount();
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
);

test(
  'WhatsNewScreen renders sectionUnavailable when changelog is false in remote config',
  renderTestOptions,
  async () => {
    renderedTexts.length = 0;
    renderGeneration = 0;

    const originalFetch = globalThis.fetch;
    const mockConfig = makeMockAppConfig({ changelog: false });

    globalThis.fetch = (async (url: string | URL | Request) => {
      const target = url.toString();
      if (target.includes('/api/v1/public/config/')) {
        return new Response(JSON.stringify(mockConfig), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (target.includes('/changelog')) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const client = new FeedbackClient({
        baseUrl: 'https://api.example.test',
        appKey: 'key_test_123',
      });

      let renderer!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        renderer = TestRenderer.create(
          <CupThreadProvider client={client} userToken="user-tok-123">
            <WhatsNewScreen />
          </CupThreadProvider>
        );
      });

      await flush(10);

      const texts = finalPassTexts();
      assert.ok(
        texts.includes(enStrings.changelog.sectionUnavailable),
        `Expected rendered texts to include "${enStrings.changelog.sectionUnavailable}", got: ${JSON.stringify(texts)}`
      );

      renderer?.unmount();
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
);

test(
  'FeedbackComposer renders sectionUnavailable notice when feedback is false in remote config',
  renderTestOptions,
  async () => {
    renderedTexts.length = 0;
    renderGeneration = 0;

    const originalFetch = globalThis.fetch;
    const mockConfig = makeMockAppConfig({ feedback: false });

    globalThis.fetch = (async (url: string | URL | Request) => {
      const target = url.toString();
      if (target.includes('/api/v1/public/config/')) {
        return new Response(JSON.stringify(mockConfig), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    try {
      const client = new FeedbackClient({
        baseUrl: 'https://api.example.test',
        appKey: 'key_test_123',
      });

      let renderer!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        renderer = TestRenderer.create(
          <CupThreadProvider client={client} userToken="user-tok-123">
            <FeedbackComposer isModal={false} />
          </CupThreadProvider>
        );
      });

      await flush(10);

      const texts = finalPassTexts();
      assert.ok(
        texts.includes(enStrings.feedbackComposer.sectionUnavailable),
        `Expected rendered texts to include "${enStrings.feedbackComposer.sectionUnavailable}", got: ${JSON.stringify(texts)}`
      );

      renderer?.unmount();
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
);
