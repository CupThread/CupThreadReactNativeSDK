import test, { type TestOptions } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { FeedbackClient } from '../src/client/FeedbackClient';

const supportsModuleMocks = typeof (test as any).mock?.module === 'function';

const alertCalls: any[][] = [];

const TouchableOpacityStub = (props: any) =>
  React.createElement('TouchableOpacity', props, props.children ?? null);

if (supportsModuleMocks) {
  (test as any).mock.module('react-native', {
    namedExports: {
      useColorScheme: () => 'light',
      View: ({ children, ...rest }: any) => React.createElement('View', rest, children),
      Text: ({ children, ...rest }: any) => React.createElement('Text', rest, children),
      TextInput: (props: any) => React.createElement('TextInput', props, null),
      TouchableOpacity: TouchableOpacityStub,
      ActivityIndicator: (props: any) => React.createElement('ActivityIndicator', props, null),
      ScrollView: ({ children }: any) => children ?? null,
      Modal: ({ children }: any) => children ?? null,
      SafeAreaView: ({ children }: any) => children ?? null,
      StyleSheet: { create: (styles: any) => styles, flatten: (s: any) => s },
      Alert: { alert: (...args: any[]) => alertCalls.push(args) },
    },
  });
}

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

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

test(
  'FeedbackComposer: throwing onSubmitSuccess does not trigger submit failure path or show error banner (#196)',
  renderTestOptions,
  async () => {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_test_cb_safety',
    });

    client.fetchAppConfig = (async () => ({})) as any;
    let submitCalled = false;
    client.getConfig = (async () => ({ appKey: 'app_test_cb_safety' })) as any;
    client.submit = (async () => {
      submitCalled = true;
      return { submissionId: 'sub_test_196', forwardedToGithub: false };
    }) as any;

    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: any[]) => {
      warnings.push(args.map(String).join(' '));
    };

    const unhandledRejections: unknown[] = [];
    const onUnhandled = (err: unknown) => {
      unhandledRejections.push(err);
    };
    process.on('unhandledRejection', onUnhandled);

    try {
      let renderer!: TestRenderer.ReactTestRenderer;
      act(() => {
        renderer = TestRenderer.create(
          React.createElement(CupThreadProvider, {
            client,
            userToken: 'usr_test_cb_safety',
            children: React.createElement(FeedbackComposer, {
              visible: true,
              isModal: false,
              initialDraft: {
                title: 'Valid feedback title',
                description: 'Valid feedback description of sufficient length',
              },
              onSubmitSuccess: () => {
                throw new Error('Host router navigation crash');
              },
            }),
          })
        );
      });

      // Find submit button
      const buttons = renderer.root.findAllByType(TouchableOpacityStub as any);
      const submitBtn = buttons.find((btn) => {
        const style = Array.isArray(btn.props.style) ? btn.props.style : [btn.props.style];
        return style.some((s: any) => s && s.paddingVertical === 14);
      });
      assert.ok(submitBtn, 'submit button should be found');

      // Tap submit
      act(() => {
        submitBtn.props.onPress();
      });

      await flush();

      assert.equal(submitCalled, true, 'client.submit was called');

      // Verify no error message banner is rendered
      const texts = renderer.root.findAllByType('Text' as any);
      const errorText = texts.find((t) => {
        const str = String(t.props.children ?? '');
        return str.includes('Failed to submit') || str.includes('Please try again');
      });
      assert.equal(
        errorText,
        undefined,
        'error banner must not be rendered when onSubmitSuccess throws'
      );

      // Verify warning was logged to console.warn
      assert.ok(
        warnings.some((w) => w.includes('FeedbackComposer: onSubmitSuccess callback threw:')),
        'diagnostic warning must be emitted in dev'
      );

      // Verify no unhandled rejection leaked
      assert.equal(unhandledRejections.length, 0, 'no unhandled promise rejections');
    } finally {
      console.warn = origWarn;
      process.off('unhandledRejection', onUnhandled);
    }
  }
);

test(
  'FeedbackComposer: throwing onClose does not trigger submit failure path or show error banner (#196)',
  renderTestOptions,
  async () => {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_test_cb_safety',
    });

    client.fetchAppConfig = (async () => ({})) as any;
    let submitCalled = false;
    client.getConfig = (async () => ({ appKey: 'app_test_cb_safety' })) as any;
    client.submit = (async () => {
      submitCalled = true;
      return { submissionId: 'sub_test_196_close', forwardedToGithub: false };
    }) as any;

    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: any[]) => {
      warnings.push(args.map(String).join(' '));
    };

    const unhandledRejections: unknown[] = [];
    const onUnhandled = (err: unknown) => {
      unhandledRejections.push(err);
    };
    process.on('unhandledRejection', onUnhandled);

    try {
      let renderer!: TestRenderer.ReactTestRenderer;
      act(() => {
        renderer = TestRenderer.create(
          React.createElement(CupThreadProvider, {
            client,
            userToken: 'usr_test_cb_safety',
            children: React.createElement(FeedbackComposer, {
              visible: true,
              isModal: false,
              initialDraft: {
                title: 'Valid feedback title',
                description: 'Valid feedback description of sufficient length',
              },
              onClose: () => {
                throw new Error('Host onClose exploded');
              },
            }),
          })
        );
      });

      const buttons = renderer.root.findAllByType(TouchableOpacityStub as any);
      const submitBtn = buttons.find((btn) => {
        const style = Array.isArray(btn.props.style) ? btn.props.style : [btn.props.style];
        return style.some((s: any) => s && s.paddingVertical === 14);
      });
      assert.ok(submitBtn, 'submit button should be found');

      act(() => {
        submitBtn.props.onPress();
      });

      await flush();

      assert.equal(submitCalled, true, 'client.submit was called');

      const texts = renderer.root.findAllByType('Text' as any);
      const errorText = texts.find((t) => {
        const str = String(t.props.children ?? '');
        return str.includes('Failed to submit') || str.includes('Please try again');
      });
      assert.equal(errorText, undefined, 'error banner must not be rendered when onClose throws');

      assert.ok(
        warnings.some((w) => w.includes('FeedbackComposer: onClose callback threw:')),
        'diagnostic warning must be emitted in dev'
      );

      assert.equal(unhandledRejections.length, 0, 'no unhandled promise rejections');
    } finally {
      console.warn = origWarn;
      process.off('unhandledRejection', onUnhandled);
    }
  }
);

test(
  'FeatureRequestComposeSheet: throwing onSubmitSuccess does not trigger submit failure path or show error banner (#196)',
  renderTestOptions,
  async () => {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_test_cb_safety',
    });

    client.fetchAppConfig = (async () => ({})) as any;
    let submitCalled = false;
    client.getConfig = (async () => ({ appKey: 'app_test_cb_safety' })) as any;
    client.submitFeatureRequest = (async () => {
      submitCalled = true;
      return {
        id: 'fr_test_196',
        title: 'Feature Proposal',
        description: 'Detailed proposal description',
        voteCount: 1,
        hasVoted: true,
        status: 'open',
        authorName: 'Tester',
        createdAt: new Date().toISOString(),
        pending: false,
      };
    }) as any;

    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: any[]) => {
      warnings.push(args.map(String).join(' '));
    };

    const unhandledRejections: unknown[] = [];
    const onUnhandled = (err: unknown) => {
      unhandledRejections.push(err);
    };
    process.on('unhandledRejection', onUnhandled);

    try {
      let renderer!: TestRenderer.ReactTestRenderer;
      act(() => {
        renderer = TestRenderer.create(
          React.createElement(CupThreadProvider, {
            client,
            userToken: 'usr_test_cb_safety',
            children: React.createElement(FeatureRequestComposeSheet, {
              visible: true,
              isModal: false,
              initialDraft: {
                title: 'Valid proposal title',
                description: 'Valid proposal description of sufficient length',
              },
              showSuccessFeedback: false,
              onSubmitSuccess: () => {
                throw new Error('Host navigation crash in feature request compose');
              },
            }),
          })
        );
      });

      const buttons = renderer.root.findAllByType(TouchableOpacityStub as any);
      const submitBtn = buttons.find((btn) => {
        const style = Array.isArray(btn.props.style) ? btn.props.style : [btn.props.style];
        return style.some((s: any) => s && s.paddingVertical === 14);
      });
      assert.ok(submitBtn, 'submit button should be found');

      act(() => {
        submitBtn.props.onPress();
      });

      await flush();

      assert.equal(submitCalled, true, 'client.submitFeatureRequest was called');

      const texts = renderer.root.findAllByType('Text' as any);
      const errorText = texts.find((t) => {
        const str = String(t.props.children ?? '');
        return str.includes('Failed to submit') || str.includes('Please try again');
      });
      assert.equal(
        errorText,
        undefined,
        'error banner must not be rendered when onSubmitSuccess throws'
      );

      assert.ok(
        warnings.some((w) =>
          w.includes('FeatureRequestComposeSheet: onSubmitSuccess callback threw:')
        ),
        'diagnostic warning must be emitted in dev'
      );

      assert.equal(unhandledRejections.length, 0, 'no unhandled promise rejections');
    } finally {
      console.warn = origWarn;
      process.off('unhandledRejection', onUnhandled);
    }
  }
);

test(
  'FeatureRequestComposeSheet: throwing onClose does not trigger submit failure path or show error banner (#196)',
  renderTestOptions,
  async () => {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_test_cb_safety',
    });

    client.fetchAppConfig = (async () => ({})) as any;
    let submitCalled = false;
    client.getConfig = (async () => ({ appKey: 'app_test_cb_safety' })) as any;
    client.submitFeatureRequest = (async () => {
      submitCalled = true;
      return {
        id: 'fr_test_196_close',
        title: 'Feature Proposal',
        description: 'Detailed proposal description',
        voteCount: 1,
        hasVoted: true,
        status: 'open',
        authorName: 'Tester',
        createdAt: new Date().toISOString(),
        pending: false,
      };
    }) as any;

    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: any[]) => {
      warnings.push(args.map(String).join(' '));
    };

    const unhandledRejections: unknown[] = [];
    const onUnhandled = (err: unknown) => {
      unhandledRejections.push(err);
    };
    process.on('unhandledRejection', onUnhandled);

    try {
      let renderer!: TestRenderer.ReactTestRenderer;
      act(() => {
        renderer = TestRenderer.create(
          React.createElement(CupThreadProvider, {
            client,
            userToken: 'usr_test_cb_safety',
            children: React.createElement(FeatureRequestComposeSheet, {
              visible: true,
              isModal: false,
              initialDraft: {
                title: 'Valid proposal title',
                description: 'Valid proposal description of sufficient length',
              },
              showSuccessFeedback: false,
              onClose: () => {
                throw new Error('Host onClose exploded');
              },
            }),
          })
        );
      });

      const buttons = renderer.root.findAllByType(TouchableOpacityStub as any);
      const submitBtn = buttons.find((btn) => {
        const style = Array.isArray(btn.props.style) ? btn.props.style : [btn.props.style];
        return style.some((s: any) => s && s.paddingVertical === 14);
      });
      assert.ok(submitBtn, 'submit button should be found');

      act(() => {
        submitBtn.props.onPress();
      });

      await flush();

      assert.equal(submitCalled, true, 'client.submitFeatureRequest was called');

      const texts = renderer.root.findAllByType('Text' as any);
      const errorText = texts.find((t) => {
        const str = String(t.props.children ?? '');
        return str.includes('Failed to submit') || str.includes('Please try again');
      });
      assert.equal(errorText, undefined, 'error banner must not be rendered when onClose throws');

      assert.ok(
        warnings.some((w) => w.includes('FeatureRequestComposeSheet: onClose callback threw:')),
        'diagnostic warning must be emitted in dev'
      );

      assert.equal(unhandledRejections.length, 0, 'no unhandled promise rejections');
    } finally {
      console.warn = origWarn;
      process.off('unhandledRejection', onUnhandled);
    }
  }
);
