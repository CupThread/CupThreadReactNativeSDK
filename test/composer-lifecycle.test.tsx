import test, { type TestOptions } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { FeedbackClient } from '../src/client/FeedbackClient';

const supportsModuleMocks = typeof (test as any).mock?.module === 'function';
const alertCalls: any[][] = [];

if (supportsModuleMocks) {
  (test as any).mock.module('react-native', {
    namedExports: {
      useColorScheme: () => 'light',
      View: ({ children, ...rest }: any) => React.createElement('View', rest, children),
      Text: ({ children, ...rest }: any) => React.createElement('Text', rest, children),
      TextInput: (props: any) => React.createElement('TextInput', props),
      TouchableOpacity: ({ children, ...rest }: any) =>
        React.createElement('TouchableOpacity', rest, children),
      ActivityIndicator: () => null,
      ScrollView: ({ children, ...rest }: any) => React.createElement('ScrollView', rest, children),
      Modal: ({ children, ...rest }: any) => React.createElement('Modal', rest, children),
      SafeAreaView: ({ children, ...rest }: any) =>
        React.createElement('SafeAreaView', rest, children),
      StyleSheet: { create: (styles: any) => styles, flatten: (s: any) => s },
      Alert: { alert: (...args: any[]) => alertCalls.push(args) },
    },
  });
}

const { CupThreadProvider } = await import('../src/theme/CupThreadThemeProvider');
const { FeedbackComposer } = await import('../src/components/FeedbackComposer');
const { FeatureRequestComposeSheet } = await import('../src/components/FeatureRequestComposeSheet');

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

function stubSubmitFetch(feedbackSubmits: any[], featureRequestSubmits: any[]) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const target = url.toString();
    if (target.includes('/api/v1/feedback') && init?.method === 'POST') {
      const body = JSON.parse((init as any).body);
      feedbackSubmits.push(body);
      return new Response(
        JSON.stringify({ submissionId: `sub_${feedbackSubmits.length}`, status: 'received' }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
    if (target.includes('/api/v1/feature-requests') && init?.method === 'POST') {
      const body = JSON.parse((init as any).body);
      featureRequestSubmits.push(body);
      return new Response(
        JSON.stringify({ featureRequestId: `fr_${featureRequestSubmits.length}`, pending: false }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
    return new Response('not found', { status: 404 });
  }) as any;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

// ---------------------------------------------------------------------------
// FeedbackComposer Component Lifecycle Tests
// ---------------------------------------------------------------------------

test(
  'FeedbackComposer resets form state after successful submit so subsequent submission does not leak text or attachments',
  renderTestOptions,
  async () => {
    alertCalls.length = 0;
    const feedbackSubmits: any[] = [];
    const restoreFetch = stubSubmitFetch(feedbackSubmits, []);

    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_test_composer',
    });

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(CupThreadProvider, {
          client,
          userToken: 'usr_tok_1',
          children: React.createElement(FeedbackComposer, {
            visible: true,
            initialDraft: { title: 'First Bug', description: 'Steps to reproduce first bug' },
          }),
        })
      );
    });
    await flush();

    try {
      // Find TextInputs (title, description, reporterName, reporterEmail)
      const inputs = renderer.root.findAllByType('TextInput' as any);
      assert.ok(inputs.length >= 2, 'expected title and description inputs');
      assert.equal(inputs[0].props.value, 'First Bug');
      assert.equal(inputs[1].props.value, 'Steps to reproduce first bug');

      // Submit the first form
      const submitButtons = renderer.root.findAll(
        (node) =>
          (node.type as any) === 'TouchableOpacity' && typeof node.props?.onPress === 'function'
      );
      const submitBtn = submitButtons[submitButtons.length - 1];
      await act(async () => {
        await submitBtn.props.onPress();
      });
      await flush();

      assert.equal(feedbackSubmits.length, 1);
      assert.equal(feedbackSubmits[0].title, 'First Bug');

      // After successful submission, the form state is reset back to initialDraft defaults
      const inputsAfterSubmit = renderer.root.findAllByType('TextInput' as any);
      assert.equal(inputsAfterSubmit[0].props.value, 'First Bug'); // Reset to initialDraft.title
      assert.equal(inputsAfterSubmit[1].props.value, 'Steps to reproduce first bug');

      // Now change the title and description, simulate another submission
      await act(async () => {
        inputsAfterSubmit[0].props.onChangeText('Second Bug Report');
        inputsAfterSubmit[1].props.onChangeText('New issue encountered');
      });
      await flush();

      const updatedInputs = renderer.root.findAllByType('TextInput' as any);
      assert.equal(updatedInputs[0].props.value, 'Second Bug Report');

      await act(async () => {
        await submitBtn.props.onPress();
      });
      await flush();

      assert.equal(feedbackSubmits.length, 2);
      assert.equal(feedbackSubmits[1].title, 'Second Bug Report');
      assert.equal(feedbackSubmits[1].description, 'New issue encountered');
      assert.deepEqual(feedbackSubmits[1].attachments, []);
    } finally {
      restoreFetch();
      renderer.unmount();
    }
  }
);

test(
  'FeedbackComposer honors changed initialDraft when reopened (visible false -> true)',
  renderTestOptions,
  async () => {
    const restoreFetch = stubSubmitFetch([], []);
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_test_composer',
    });

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(CupThreadProvider, {
          client,
          userToken: 'usr_tok_1',
          children: React.createElement(FeedbackComposer, {
            visible: true,
            initialDraft: { title: 'Bug on Settings Screen' },
          }),
        })
      );
    });
    await flush();

    try {
      let inputs = renderer.root.findAllByType('TextInput' as any);
      assert.equal(inputs[0].props.value, 'Bug on Settings Screen');

      // Host closes composer
      await act(async () => {
        renderer.update(
          React.createElement(CupThreadProvider, {
            client,
            userToken: 'usr_tok_1',
            children: React.createElement(FeedbackComposer, {
              visible: false,
              initialDraft: { title: 'Bug on Settings Screen' },
            }),
          })
        );
      });
      await flush();

      // Host reopens composer with different initialDraft for Checkout Screen
      await act(async () => {
        renderer.update(
          React.createElement(CupThreadProvider, {
            client,
            userToken: 'usr_tok_1',
            children: React.createElement(FeedbackComposer, {
              visible: true,
              initialDraft: { title: 'Bug on Checkout Screen', description: 'Payment stuck' },
            }),
          })
        );
      });
      await flush();

      inputs = renderer.root.findAllByType('TextInput' as any);
      assert.equal(
        inputs[0].props.value,
        'Bug on Checkout Screen',
        'reopening must honor changed initialDraft'
      );
      assert.equal(inputs[1].props.value, 'Payment stuck');
    } finally {
      restoreFetch();
      renderer.unmount();
    }
  }
);

test(
  'FeedbackComposer manual close resets draft by default and preserves draft when preserveDraftOnClose is true',
  renderTestOptions,
  async () => {
    const restoreFetch = stubSubmitFetch([], []);
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_test_composer',
    });

    let closed = false;
    let renderer!: TestRenderer.ReactTestRenderer;

    // Part A: preserveDraftOnClose = false (default)
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(CupThreadProvider, {
          client,
          userToken: 'usr_tok_1',
          children: React.createElement(FeedbackComposer, {
            visible: true,
            onClose: () => {
              closed = true;
            },
          }),
        })
      );
    });
    await flush();

    try {
      let inputs = renderer.root.findAllByType('TextInput' as any);
      // User types draft
      await act(async () => {
        inputs[0].props.onChangeText('Unfinished bug draft');
      });
      await flush();

      inputs = renderer.root.findAllByType('TextInput' as any);
      assert.equal(inputs[0].props.value, 'Unfinished bug draft');

      // User clicks close "✕"
      const closeButtons = renderer.root.findAll(
        (node) =>
          (node.type as any) === 'TouchableOpacity' && typeof node.props?.onPress === 'function'
      );
      const closeBtn = closeButtons[0]; // header close button
      await act(async () => {
        closeBtn.props.onPress();
      });
      await flush();
      assert.equal(closed, true);

      // State is reset on close when preserveDraftOnClose is false
      inputs = renderer.root.findAllByType('TextInput' as any);
      assert.equal(
        inputs[0].props.value,
        '',
        'manual close without preserveDraftOnClose must reset text'
      );

      // Part B: preserveDraftOnClose = true
      await act(async () => {
        renderer.update(
          React.createElement(CupThreadProvider, {
            client,
            userToken: 'usr_tok_1',
            children: React.createElement(FeedbackComposer, {
              visible: true,
              preserveDraftOnClose: true,
            }),
          })
        );
      });
      await flush();

      inputs = renderer.root.findAllByType('TextInput' as any);
      await act(async () => {
        inputs[0].props.onChangeText('Draft that should be preserved');
      });
      await flush();

      // Close modal
      const modal = renderer.root.findByType('Modal' as any);
      await act(async () => {
        modal.props.onRequestClose();
      });
      await flush();

      // Draft is preserved
      inputs = renderer.root.findAllByType('TextInput' as any);
      assert.equal(
        inputs[0].props.value,
        'Draft that should be preserved',
        'manual close with preserveDraftOnClose=true must retain draft'
      );
    } finally {
      restoreFetch();
      renderer.unmount();
    }
  }
);

// ---------------------------------------------------------------------------
// FeatureRequestComposeSheet Component Lifecycle Tests
// ---------------------------------------------------------------------------

test(
  'FeatureRequestComposeSheet resets form state after successful submit',
  renderTestOptions,
  async () => {
    alertCalls.length = 0;
    const frSubmits: any[] = [];
    const restoreFetch = stubSubmitFetch([], frSubmits);

    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_test_fr_sheet',
    });

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(CupThreadProvider, {
          client,
          userToken: 'usr_tok_1',
          children: React.createElement(FeatureRequestComposeSheet, {
            visible: true,
            initialDraft: { title: 'Initial Idea', description: 'Detailed initial idea' },
          }),
        })
      );
    });
    await flush();

    try {
      const inputs = renderer.root.findAllByType('TextInput' as any);
      assert.equal(inputs[0].props.value, 'Initial Idea');
      assert.equal(inputs[1].props.value, 'Detailed initial idea');

      // Submit
      const submitButtons = renderer.root.findAll(
        (node) =>
          (node.type as any) === 'TouchableOpacity' && typeof node.props?.onPress === 'function'
      );
      const submitBtn = submitButtons[submitButtons.length - 1];
      await act(async () => {
        await submitBtn.props.onPress();
      });
      await flush();

      assert.equal(frSubmits.length, 1);
      assert.equal(frSubmits[0].title, 'Initial Idea');

      // Verify form reset after submit
      const inputsAfterSubmit = renderer.root.findAllByType('TextInput' as any);
      assert.equal(inputsAfterSubmit[0].props.value, 'Initial Idea');
      assert.equal(inputsAfterSubmit[1].props.value, 'Detailed initial idea');
    } finally {
      restoreFetch();
      renderer.unmount();
    }
  }
);
