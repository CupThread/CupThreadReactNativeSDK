import test, { type TestOptions } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { FeedbackClient } from '../src/client/FeedbackClient';

const supportsModuleMocks = typeof (test as any).mock?.module === 'function';

const alertCalls: any[][] = [];

const TouchableOpacityStub = (props: any) => props.children ?? null;
const TextInputStub = (_props: any) => null;

if (supportsModuleMocks) {
  (test as any).mock.module('react-native', {
    namedExports: {
      useColorScheme: () => 'light',
      View: ({ children }: any) => children ?? null,
      Text: ({ children }: any) => children ?? null,
      Image: () => null,
      TextInput: TextInputStub,
      TouchableOpacity: TouchableOpacityStub,
      ActivityIndicator: () => null,
      ScrollView: ({ children }: any) => children ?? null,
      Modal: ({ children }: any) => children ?? null,
      SafeAreaView: ({ children }: any) => children ?? null,
      RefreshControl: () => null,
      Linking: { openURL: async () => true, canOpenURL: async () => true },
      FlatList: ({ ListHeaderComponent, data, renderItem }: any) => {
        const header =
          typeof ListHeaderComponent === 'function' ? ListHeaderComponent() : ListHeaderComponent;
        return React.createElement(
          React.Fragment,
          null,
          header ?? null,
          data?.map((item: any, index: number) => renderItem?.({ item, index }) ?? null)
        );
      },
      StyleSheet: { create: (styles: any) => styles, flatten: (s: any) => s },
      Alert: { alert: (...args: any[]) => alertCalls.push(args) },
    },
  });
}

const { CupThreadProvider } = await import('../src/theme/CupThreadThemeProvider');
const { FeedbackComposer } = await import('../src/components/FeedbackComposer');
const { FeatureRequestComposeSheet } = await import('../src/components/FeatureRequestComposeSheet');
const { CommentsSection } = await import('../src/components/CommentsSection');
const { WhatsNewScreen } = await import('../src/components/WhatsNewScreen');

const renderTestOptions: TestOptions = supportsModuleMocks
  ? {}
  : {
      skip: 'node:test module mocking unavailable (needs Node >= 22.3 with --experimental-test-module-mocks)',
    };

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

/** Let pending microtasks and pending act-batched state updates settle. */
async function flush(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    await act(async () => {});
  }
}

function createTestClient(): FeedbackClient {
  return new FeedbackClient({
    baseUrl: 'https://api.cupthread.com',
    appKey: 'app_test_reentrancy',
  });
}

test(
  'FeedbackComposer: fast double-tap inside the same frame submits feedback exactly once',
  renderTestOptions,
  async () => {
    alertCalls.length = 0;
    const client = createTestClient();
    let postCount = 0;
    let successCallbacks = 0;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const target = url.toString();
      if (target.includes('/api/v1/feedback') && init?.method === 'POST') {
        postCount++;
        // Small delay to simulate network latency
        await new Promise((resolve) => setTimeout(resolve, 20));
        return new Response(JSON.stringify({ submissionId: 'sub_123' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    try {
      let renderer!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        renderer = TestRenderer.create(
          React.createElement(CupThreadProvider, {
            client,
            userToken: 'tok_test',
            children: React.createElement(FeedbackComposer, {
              isModal: false,
              initialDraft: { title: 'Bug report', description: 'Detailed repro steps' },
              onSubmitSuccess: () => {
                successCallbacks++;
              },
            }),
          })
        );
      });
      await flush();

      const buttons = renderer.root.findAll(
        (node) => node.type === TouchableOpacityStub && typeof node.props?.onPress === 'function'
      );
      assert.equal(buttons.length, 1, 'expected submit button');
      const submitOnPress = buttons[0].props.onPress;

      // Two taps synchronously inside the same act() — before re-render applies disabled=true
      await act(async () => {
        submitOnPress();
        submitOnPress();
      });
      await flush();

      assert.equal(postCount, 1, 'expected exactly one POST /api/v1/feedback');
      assert.equal(successCallbacks, 1, 'expected onSubmitSuccess to fire exactly once');
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
);

test(
  'FeedbackComposer: re-entrancy guard releases on error allowing retry',
  renderTestOptions,
  async () => {
    alertCalls.length = 0;
    const client = createTestClient();
    let postCount = 0;
    let shouldFail = true;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const target = url.toString();
      if (target.includes('/api/v1/feedback') && init?.method === 'POST') {
        postCount++;
        await new Promise((resolve) => setTimeout(resolve, 10));
        if (shouldFail) {
          return new Response(JSON.stringify({ message: 'Server error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ submissionId: 'sub_456' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    try {
      let renderer!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        renderer = TestRenderer.create(
          React.createElement(CupThreadProvider, {
            client,
            userToken: 'tok_test',
            children: React.createElement(FeedbackComposer, {
              isModal: false,
              initialDraft: { title: 'Bug report', description: 'Detailed repro steps' },
            }),
          })
        );
      });
      await flush();

      const buttons = renderer.root.findAll(
        (node) => node.type === TouchableOpacityStub && typeof node.props?.onPress === 'function'
      );
      const submitOnPress = buttons[0].props.onPress;

      // First tap fails
      await act(async () => {
        submitOnPress();
      });
      await flush();
      assert.equal(postCount, 1, 'first submission attempted');

      // Subsequent tap succeeds after failure
      shouldFail = false;
      await act(async () => {
        submitOnPress();
      });
      await flush();
      assert.equal(postCount, 2, 'retry submission succeeded');
      assert.equal(alertCalls.length, 1, 'success alert shown on successful retry');
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
);

test(
  'FeatureRequestComposeSheet: fast double-tap inside the same frame submits feature request exactly once',
  renderTestOptions,
  async () => {
    alertCalls.length = 0;
    const client = createTestClient();
    let postCount = 0;
    let successCallbacks = 0;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const target = url.toString();
      if (target.includes('/api/v1/feature-requests') && init?.method === 'POST') {
        postCount++;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return new Response(JSON.stringify({ featureRequestId: 'fr_123', pending: false }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    try {
      let renderer!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        renderer = TestRenderer.create(
          React.createElement(CupThreadProvider, {
            client,
            userToken: 'tok_test',
            children: React.createElement(FeatureRequestComposeSheet, {
              isModal: false,
              initialDraft: { title: 'Dark mode', description: 'Please add dark mode theme' },
              onSubmitSuccess: () => {
                successCallbacks++;
              },
            }),
          })
        );
      });
      await flush();

      const buttons = renderer.root.findAll(
        (node) => node.type === TouchableOpacityStub && typeof node.props?.onPress === 'function'
      );
      assert.equal(buttons.length, 1, 'expected submit button');
      const submitOnPress = buttons[0].props.onPress;

      // Two taps synchronously inside the same act()
      await act(async () => {
        submitOnPress();
        submitOnPress();
      });
      await flush();

      assert.equal(postCount, 1, 'expected exactly one POST /api/v1/feature-requests');
      assert.equal(successCallbacks, 1, 'expected onSubmitSuccess to fire exactly once');
      assert.equal(alertCalls.length, 1, 'expected success alert to fire exactly once');
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
);

test(
  'FeatureRequestComposeSheet: re-entrancy guard releases on error allowing retry',
  renderTestOptions,
  async () => {
    alertCalls.length = 0;
    const client = createTestClient();
    let postCount = 0;
    let shouldFail = true;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const target = url.toString();
      if (target.includes('/api/v1/feature-requests') && init?.method === 'POST') {
        postCount++;
        await new Promise((resolve) => setTimeout(resolve, 10));
        if (shouldFail) {
          return new Response(JSON.stringify({ message: 'Server error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ featureRequestId: 'fr_456', pending: false }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    try {
      let renderer!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        renderer = TestRenderer.create(
          React.createElement(CupThreadProvider, {
            client,
            userToken: 'tok_test',
            children: React.createElement(FeatureRequestComposeSheet, {
              isModal: false,
              initialDraft: { title: 'Dark mode', description: 'Please add dark mode theme' },
            }),
          })
        );
      });
      await flush();

      const buttons = renderer.root.findAll(
        (node) => node.type === TouchableOpacityStub && typeof node.props?.onPress === 'function'
      );
      const submitOnPress = buttons[0].props.onPress;

      // First attempt fails
      await act(async () => {
        submitOnPress();
      });
      await flush();
      assert.equal(postCount, 1, 'first submission attempted');

      // Retry succeeds
      shouldFail = false;
      await act(async () => {
        submitOnPress();
      });
      await flush();
      assert.equal(postCount, 2, 'retry submission succeeded');
      assert.equal(alertCalls.length, 1, 'success alert shown');
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
);

test(
  'CommentsSection: fast double-tap inside the same frame posts comment exactly once',
  renderTestOptions,
  async () => {
    alertCalls.length = 0;
    const client = createTestClient();
    let postCount = 0;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const target = url.toString();
      if (target.includes('/comments') && init?.method === 'POST') {
        postCount++;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return new Response(
          JSON.stringify({
            id: 'c_new',
            featureRequestId: 'fr_1',
            body: 'Great suggestion!',
            createdAt: new Date().toISOString(),
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
      if (target.includes('/comments') && (!init?.method || init?.method === 'GET')) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    try {
      let renderer!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        renderer = TestRenderer.create(
          React.createElement(CupThreadProvider, {
            client,
            userToken: 'tok_test',
            children: React.createElement(CommentsSection, { featureRequestId: 'fr_1' }),
          })
        );
      });
      await flush();

      // Find comment inputs and set comment text
      const inputs = renderer.root.findAll((node) => node.type === TextInputStub);
      assert.ok(inputs.length >= 2, 'expected name and comment text inputs');
      for (const input of inputs) {
        await act(async () => {
          input.props.onChangeText('Great suggestion!');
        });
      }
      await flush();

      // Find submit button
      const buttons = renderer.root.findAll(
        (node) => node.type === TouchableOpacityStub && typeof node.props?.onPress === 'function'
      );
      assert.ok(buttons.length >= 1, 'expected comment submit button');
      const submitOnPress = buttons[buttons.length - 1].props.onPress;

      // Two taps synchronously inside the same act()
      await act(async () => {
        submitOnPress();
        submitOnPress();
      });
      await flush();

      assert.equal(postCount, 1, 'expected exactly one POST /comments');
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
);

test(
  'CommentsSection: re-entrancy guard releases on error allowing retry',
  renderTestOptions,
  async () => {
    alertCalls.length = 0;
    const client = createTestClient();
    let postCount = 0;
    let shouldFail = true;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const target = url.toString();
      if (target.includes('/comments') && init?.method === 'POST') {
        postCount++;
        await new Promise((resolve) => setTimeout(resolve, 10));
        if (shouldFail) {
          return new Response(JSON.stringify({ message: 'Comment error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(
          JSON.stringify({
            id: 'c_retry',
            featureRequestId: 'fr_1',
            body: 'Retry suggestion!',
            createdAt: new Date().toISOString(),
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }
      if (target.includes('/comments') && (!init?.method || init?.method === 'GET')) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    try {
      let renderer!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        renderer = TestRenderer.create(
          React.createElement(CupThreadProvider, {
            client,
            userToken: 'tok_test',
            children: React.createElement(CommentsSection, { featureRequestId: 'fr_1' }),
          })
        );
      });
      await flush();

      const inputs = renderer.root.findAll((node) => node.type === TextInputStub);
      for (const input of inputs) {
        await act(async () => {
          input.props.onChangeText('Retry suggestion!');
        });
      }
      await flush();

      const buttons = renderer.root.findAll(
        (node) => node.type === TouchableOpacityStub && typeof node.props?.onPress === 'function'
      );
      const submitOnPress = buttons[buttons.length - 1].props.onPress;

      // First tap fails
      await act(async () => {
        submitOnPress();
      });
      await flush();
      assert.equal(postCount, 1, 'first comment attempt');

      // Retry succeeds
      shouldFail = false;
      await act(async () => {
        submitOnPress();
      });
      await flush();
      assert.equal(postCount, 2, 'retry comment succeeded');
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
);

test(
  'WhatsNewScreen: fast double-tap inside the same frame subscribes to changelog exactly once',
  renderTestOptions,
  async () => {
    alertCalls.length = 0;
    const client = createTestClient();
    let subscribeCount = 0;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const target = url.toString();
      if (target.includes('/subscribe') && init?.method === 'POST') {
        subscribeCount++;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (target.includes('/changelog') && (!init?.method || init?.method === 'GET')) {
        return new Response(JSON.stringify({ entries: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    try {
      let renderer!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        renderer = TestRenderer.create(
          React.createElement(CupThreadProvider, {
            client,
            userToken: 'tok_test',
            children: React.createElement(WhatsNewScreen, { headerTitle: "What's New" }),
          })
        );
      });
      await flush();

      const inputs = renderer.root.findAll((node) => node.type === TextInputStub);
      assert.ok(inputs.length >= 1, 'expected subscribe email input');
      await act(async () => {
        inputs[0].props.onChangeText('test@example.com');
      });
      await flush();

      const buttons = renderer.root.findAll(
        (node) => node.type === TouchableOpacityStub && typeof node.props?.onPress === 'function'
      );
      assert.ok(buttons.length >= 1, 'expected subscribe button');
      const subscribeOnPress = buttons[0].props.onPress;

      // Two taps synchronously inside the same act()
      await act(async () => {
        subscribeOnPress();
        subscribeOnPress();
      });
      await flush();

      assert.equal(subscribeCount, 1, 'expected exactly one POST /subscribe');
      assert.equal(alertCalls.length, 1, 'expected exactly one success alert');
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
);

test(
  'WhatsNewScreen: re-entrancy guard releases on error allowing retry',
  renderTestOptions,
  async () => {
    alertCalls.length = 0;
    const client = createTestClient();
    let subscribeCount = 0;
    let shouldFail = true;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const target = url.toString();
      if (target.includes('/subscribe') && init?.method === 'POST') {
        subscribeCount++;
        await new Promise((resolve) => setTimeout(resolve, 10));
        if (shouldFail) {
          return new Response(JSON.stringify({ message: 'Network error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (target.includes('/changelog') && (!init?.method || init?.method === 'GET')) {
        return new Response(JSON.stringify({ entries: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as any;

    try {
      let renderer!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        renderer = TestRenderer.create(
          React.createElement(CupThreadProvider, {
            client,
            userToken: 'tok_test',
            children: React.createElement(WhatsNewScreen, { headerTitle: "What's New" }),
          })
        );
      });
      await flush();

      const inputs = renderer.root.findAll((node) => node.type === TextInputStub);
      assert.ok(inputs.length >= 1, 'expected subscribe email input');
      await act(async () => {
        inputs[0].props.onChangeText('test@example.com');
      });
      await flush();

      const buttons = renderer.root.findAll(
        (node) => node.type === TouchableOpacityStub && typeof node.props?.onPress === 'function'
      );
      assert.ok(buttons.length >= 1, 'expected subscribe button');
      const subscribeOnPress = buttons[0].props.onPress;

      // First tap fails
      await act(async () => {
        subscribeOnPress();
      });
      await flush();
      assert.equal(subscribeCount, 1, 'first subscription attempted');
      assert.equal(alertCalls.length, 1, 'error alert shown');

      // Retry succeeds
      shouldFail = false;
      await act(async () => {
        subscribeOnPress();
      });
      await flush();
      assert.equal(subscribeCount, 2, 'retry subscription succeeded');
      assert.equal(alertCalls.length, 2, 'success alert shown');
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
);
