import test, { type TestOptions } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { FeedbackClient } from '../src/client/FeedbackClient';

// `FeatureRequestComposeSheet` and `CupThreadProvider` import react-native,
// which cannot load under plain Node. Mock every symbol they use with
// lightweight stubs, then dynamically import the real modules so the mock is
// in place before evaluation. Module mocking needs Node >= 22.3 with
// --experimental-test-module-mocks; without it the render-level tests below
// are skipped.
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
      // Layout stubs must pass children through so nested pressables stay in
      // the rendered tree.
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
    },
  });
}

const { CupThreadProvider } = await import('../src/theme/CupThreadThemeProvider');
const { FeatureRequestComposeSheet } = await import('../src/components/FeatureRequestComposeSheet');

const renderTestOptions: TestOptions = supportsModuleMocks
  ? {}
  : {
      skip: 'node:test module mocking unavailable (needs Node >= 22.3 with --experimental-test-module-mocks)',
    };

/** Let pending microtasks and pending act-batched state updates settle. */
async function flush(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2));
    await act(async () => {});
  }
}

/**
 * Fetch stub: the provider's config fetch gets a rejection (non-fatal),
 * feature-request submissions resolve with the configured result.
 */
function stubFetch(submitResult: object) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const target = url.toString();
    if (target.includes('/api/v1/feature-requests') && init?.method === 'POST') {
      return new Response(JSON.stringify(submitResult), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  }) as any;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

interface SheetHarness {
  renderer: TestRenderer.ReactTestRenderer;
  restoreFetch: () => void;
}

async function renderSheet(
  submitResult: object,
  sheetProps: Record<string, any> = {}
): Promise<SheetHarness> {
  const client = new FeedbackClient({
    baseUrl: 'https://api.cupthread.com',
    appKey: 'app_test_moderation',
  });
  const restoreFetch = stubFetch(submitResult);

  const sheet = React.createElement(FeatureRequestComposeSheet, {
    initialDraft: { title: 'Widget support', description: 'Add home screen widgets' },
    ...sheetProps,
  });

  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(CupThreadProvider, {
        client,
        userToken: 'usr_tok_test',
        children: sheet,
      })
    );
  });
  await flush();
  return { renderer, restoreFetch };
}

/** Presses the submit button: the last pressable in tree order (header close ✕ renders first). */
async function pressSubmit(harness: SheetHarness): Promise<void> {
  const buttons = harness.renderer.root.findAll(
    (node) => node.type === TouchableOpacityStub && typeof node.props?.onPress === 'function'
  );
  assert.ok(buttons.length >= 1, 'expected a pressable submit button');
  await act(async () => {
    await buttons[buttons.length - 1].props.onPress();
  });
  await flush();
}

test(
  'compose sheet surfaces the moderation notice for a pending submission alongside onSubmitSuccess',
  renderTestOptions,
  async () => {
    alertCalls.length = 0;
    touchableOpacityProps.length = 0;
    const harness = await renderSheet(
      { featureRequestId: 'fr_1', pending: true },
      {
        onSubmitSuccess: (result: any) => {
          assert.equal(result.pending, true);
        },
      }
    );
    try {
      await pressSubmit(harness);
      assert.equal(alertCalls.length, 1, 'moderation notice alert must be shown');
      assert.equal(alertCalls[0][0], 'Proposal Submitted');
      assert.equal(
        alertCalls[0][1],
        'Your request has been submitted and will appear publicly after moderation.'
      );
    } finally {
      harness.restoreFetch();
      harness.renderer.unmount();
    }
  }
);

test(
  'compose sheet surfaces the plain success message for a non-pending submission',
  renderTestOptions,
  async () => {
    alertCalls.length = 0;
    touchableOpacityProps.length = 0;
    const harness = await renderSheet(
      { featureRequestId: 'fr_2', pending: false },
      { onSubmitSuccess: () => {} }
    );
    try {
      await pressSubmit(harness);
      assert.equal(alertCalls.length, 1);
      assert.equal(alertCalls[0][1], 'Thank you! Your feature proposal has been submitted.');
    } finally {
      harness.restoreFetch();
      harness.renderer.unmount();
    }
  }
);

test(
  'compose sheet closes itself with the notice when no onSubmitSuccess callback is provided',
  renderTestOptions,
  async () => {
    alertCalls.length = 0;
    touchableOpacityProps.length = 0;
    let closed = false;
    const harness = await renderSheet(
      { featureRequestId: 'fr_3', pending: true },
      { onClose: () => (closed = true) }
    );
    try {
      await pressSubmit(harness);
      assert.equal(alertCalls.length, 1);
      assert.equal(
        alertCalls[0][1],
        'Your request has been submitted and will appear publicly after moderation.'
      );
      assert.equal(closed, true, 'sheet must close itself in the no-callback branch');
    } finally {
      harness.restoreFetch();
      harness.renderer.unmount();
    }
  }
);

test(
  'showSuccessFeedback={false} suppresses the notice while still invoking onSubmitSuccess',
  renderTestOptions,
  async () => {
    alertCalls.length = 0;
    touchableOpacityProps.length = 0;
    let successResult: any = null;
    const harness = await renderSheet(
      { featureRequestId: 'fr_4', pending: true },
      {
        showSuccessFeedback: false,
        onSubmitSuccess: (result: any) => {
          successResult = result;
        },
      }
    );
    try {
      await pressSubmit(harness);
      assert.equal(alertCalls.length, 0, 'host opted out of sheet-level feedback');
      assert.equal(successResult?.featureRequestId, 'fr_4');
    } finally {
      harness.restoreFetch();
      harness.renderer.unmount();
    }
  }
);
