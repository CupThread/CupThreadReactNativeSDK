import test, { type TestOptions } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { FeedbackClient } from '../src/client/FeedbackClient';
import { resolveAllowedPlatform } from '../src/utils/platform';
import type { FeedbackDraft, PublicAppConfig } from '../src/types';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const supportsModuleMocks = typeof (test as any).mock?.module === 'function';

const alertCalls: any[][] = [];
const touchableOpacityProps: any[] = [];

const TouchableOpacityStub = (props: any) => {
  touchableOpacityProps.push(props);
  return props.children ?? null;
};

if (supportsModuleMocks) {
  (test as any).mock.module('react-native', {
    namedExports: {
      useColorScheme: () => 'light',
      View: ({ children }: any) => children ?? null,
      Text: () => null,
      TextInput: () => null,
      TouchableOpacity: TouchableOpacityStub,
      ActivityIndicator: () => null,
      ScrollView: ({ children }: any) => children ?? null,
      Modal: ({ children }: any) => children ?? null,
      SafeAreaView: ({ children }: any) => children ?? null,
      StyleSheet: { create: (styles: any) => styles, flatten: (s: any) => s },
      Alert: { alert: (...args: any[]) => alertCalls.push(args) },
      Platform: { OS: 'ios' },
    },
  });
}

const { CupThreadProvider } = await import('../src/theme/CupThreadThemeProvider');
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

// ---------------------------------------------------------------------------
// Unit tests: resolveAllowedPlatform pure helper
// ---------------------------------------------------------------------------

test('resolveAllowedPlatform: falls back to allowlist when requested is excluded', () => {
  const warnings: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: any[]) => warnings.push(args.join(' '));
  try {
    const result = resolveAllowedPlatform('ios', ['android'], 'universal');
    assert.equal(result, 'android');
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes('ios'));
    assert.ok(warnings[0].includes('android'));
  } finally {
    console.warn = origWarn;
  }
});

test('resolveAllowedPlatform: honors requested platform when present in allowlist', () => {
  const warnings: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: any[]) => warnings.push(args.join(' '));
  try {
    const result = resolveAllowedPlatform('ios', ['ios', 'android'], 'universal');
    assert.equal(result, 'ios');
    assert.equal(warnings.length, 0);
  } finally {
    console.warn = origWarn;
  }
});

test('resolveAllowedPlatform: falls back to allowlist when requested is undefined', () => {
  const warnings: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: any[]) => warnings.push(args.join(' '));
  try {
    const result = resolveAllowedPlatform(undefined, ['android'], 'universal');
    assert.equal(result, 'android');
    assert.equal(warnings.length, 1);
    assert.ok(warnings[0].includes('android'));
  } finally {
    console.warn = origWarn;
  }
});

test('resolveAllowedPlatform: passthrough when allowlist is undefined', () => {
  const warnings: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: any[]) => warnings.push(args.join(' '));
  try {
    const result = resolveAllowedPlatform('ios', undefined, 'universal');
    assert.equal(result, 'ios');
    assert.equal(warnings.length, 0);

    const fallbackResult = resolveAllowedPlatform(undefined, undefined, 'universal');
    assert.equal(fallbackResult, 'universal');
    assert.equal(warnings.length, 0);
  } finally {
    console.warn = origWarn;
  }
});

test('resolveAllowedPlatform: passthrough when allowlist is empty array', () => {
  const warnings: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: any[]) => warnings.push(args.join(' '));
  try {
    const result = resolveAllowedPlatform('ios', [], 'universal');
    assert.equal(result, 'ios');
    assert.equal(warnings.length, 0);

    const fallbackResult = resolveAllowedPlatform(undefined, [], 'universal');
    assert.equal(fallbackResult, 'universal');
    assert.equal(warnings.length, 0);
  } finally {
    console.warn = origWarn;
  }
});

test('resolveAllowedPlatform: honors fallback without warning when fallback is in allowlist and requested is undefined', () => {
  const warnings: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: any[]) => warnings.push(args.join(' '));
  try {
    const result = resolveAllowedPlatform(undefined, ['android', 'ios'], 'ios');
    assert.equal(result, 'ios');
    assert.equal(warnings.length, 0);
  } finally {
    console.warn = origWarn;
  }
});

// ---------------------------------------------------------------------------
// Integration / Component tests: FeedbackComposer wiring
// ---------------------------------------------------------------------------

test(
  'FeedbackComposer: resolves platform against appConfig.allowedPlatforms and warns in development when excluded',
  renderTestOptions,
  async () => {
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: any[]) => warnings.push(args.join(' '));

    const submittedDrafts: FeedbackDraft[] = [];
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_test_allowlist',
      defaultPlatform: 'ios',
    });

    const mockAppConfig: PublicAppConfig = {
      appId: 'app_test',
      appKey: 'app_test_allowlist',
      slug: 'test-app',
      name: 'Test App',
      iconUrl: null,
      allowPublic: true,
      allowedPlatforms: ['android'],
      maxAttachmentBytes: 10 * 1024 * 1024,
      allowAnonymousRoadmap: true,
      allowAnonymousVote: true,
      allowAnonymousFeedback: true,
      allowAnonymousChangelog: true,
      sdk: {
        theme: 'light',
        features: { feedback: true, featureRequests: true, roadmap: true, changelog: true },
        changelogOverlay: {
          title: "What's New",
          entryCount: 3,
          primaryButton: 'Got it',
          closeButton: 'Close',
        },
      },
    };

    const origFetchAppConfig = client.fetchAppConfig;
    client.fetchAppConfig = async () => mockAppConfig;

    const origSubmit = client.submit;
    client.submit = (async (draft: FeedbackDraft) => {
      submittedDrafts.push(draft);
      return { submissionId: 'sub_123', createdAt: new Date().toISOString() };
    }) as any;

    try {
      touchableOpacityProps.length = 0;
      let renderer!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        renderer = TestRenderer.create(
          <CupThreadProvider client={client} userToken="usr_test">
            <FeedbackComposer
              initialDraft={{ title: 'Crash report', description: 'App crashed on button click' }}
            />
          </CupThreadProvider>
        );
      });
      await flush();

      // Press submit button (last pressable in tree)
      const buttons = renderer.root.findAll(
        (node) => node.type === TouchableOpacityStub && typeof node.props?.onPress === 'function'
      );
      assert.ok(buttons.length >= 1, 'expected a submit button');
      await act(async () => {
        await buttons[buttons.length - 1].props.onPress();
      });
      await flush();

      assert.equal(submittedDrafts.length, 1);
      assert.equal(submittedDrafts[0].platform, 'android');
      assert.equal(warnings.length, 1, 'development warning should fire exactly once');
      assert.ok(warnings[0].includes('ios'));
      assert.ok(warnings[0].includes('android'));
    } finally {
      console.warn = origWarn;
      client.fetchAppConfig = origFetchAppConfig;
      client.submit = origSubmit;
    }
  }
);

test(
  'FeedbackComposer: retains requested platform when included in appConfig.allowedPlatforms with zero warnings',
  renderTestOptions,
  async () => {
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: any[]) => warnings.push(args.join(' '));

    const submittedDrafts: FeedbackDraft[] = [];
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_test_allowlist_match',
      defaultPlatform: 'ios',
    });

    const mockAppConfig: PublicAppConfig = {
      appId: 'app_test_match',
      appKey: 'app_test_allowlist_match',
      slug: 'test-app',
      name: 'Test App',
      iconUrl: null,
      allowPublic: true,
      allowedPlatforms: ['ios', 'android'],
      maxAttachmentBytes: 10 * 1024 * 1024,
      allowAnonymousRoadmap: true,
      allowAnonymousVote: true,
      allowAnonymousFeedback: true,
      allowAnonymousChangelog: true,
      sdk: {
        theme: 'light',
        features: { feedback: true, featureRequests: true, roadmap: true, changelog: true },
        changelogOverlay: {
          title: "What's New",
          entryCount: 3,
          primaryButton: 'Got it',
          closeButton: 'Close',
        },
      },
    };

    const origFetchAppConfig = client.fetchAppConfig;
    client.fetchAppConfig = async () => mockAppConfig;

    const origSubmit = client.submit;
    client.submit = (async (draft: FeedbackDraft) => {
      submittedDrafts.push(draft);
      return { submissionId: 'sub_456', createdAt: new Date().toISOString() };
    }) as any;

    try {
      touchableOpacityProps.length = 0;
      let renderer!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        renderer = TestRenderer.create(
          <CupThreadProvider client={client} userToken="usr_test">
            <FeedbackComposer
              initialDraft={{ title: 'UI Improvement', description: 'Make font slightly bigger' }}
            />
          </CupThreadProvider>
        );
      });
      await flush();

      const buttons = renderer.root.findAll(
        (node) => node.type === TouchableOpacityStub && typeof node.props?.onPress === 'function'
      );
      assert.ok(buttons.length >= 1, 'expected a submit button');
      await act(async () => {
        await buttons[buttons.length - 1].props.onPress();
      });
      await flush();

      assert.equal(submittedDrafts.length, 1);
      assert.equal(submittedDrafts[0].platform, 'ios');
      assert.equal(warnings.length, 0, 'no warning should be logged when platform is allowed');
    } finally {
      console.warn = origWarn;
      client.fetchAppConfig = origFetchAppConfig;
      client.submit = origSubmit;
    }
  }
);
