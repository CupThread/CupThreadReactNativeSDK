import test, { type TestOptions } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { FeedbackClient } from '../src/client/FeedbackClient';
import type { FeedbackAttachment, FeedbackDraft, FeedbackSubmissionResult } from '../src/types';

const supportsModuleMocks = typeof (test as any).mock?.module === 'function';

const alertCalls: any[][] = [];

const TouchableOpacityStub = (props: any) => {
  return React.createElement('TouchableOpacity', props, props.children ?? null);
};

const TextInputStub = (props: any) => {
  return React.createElement('TextInput', props, null);
};

const ViewStub = (props: any) => {
  return React.createElement('View', props, props.children ?? null);
};

const TextStub = (props: any) => {
  return React.createElement('Text', props, props.children ?? null);
};

if (supportsModuleMocks) {
  (test as any).mock.module('react-native', {
    namedExports: {
      useColorScheme: () => 'light',
      View: ViewStub,
      Text: TextStub,
      TextInput: TextInputStub,
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

function makeAttachment(name: string): FeedbackAttachment {
  return {
    kind: 'image',
    key: `key-${name}`,
    url: `https://cdn.example.com/${name}.png`,
    filename: `${name}.png`,
    mimeType: 'image/png',
    size: 1024,
  };
}

interface ComposerHarness {
  renderer: TestRenderer.ReactTestRenderer;
  client: FeedbackClient;
  submitCalls: FeedbackDraft[];
  uploadCalls: any[];
  findAddAttachmentButton: () => TestRenderer.ReactTestInstance | null;
  findRemoveAttachmentButtons: () => TestRenderer.ReactTestInstance[];
  findSubmitButton: () => TestRenderer.ReactTestInstance;
}

function createHarness(options: {
  initialDraft?: Partial<FeedbackDraft>;
  onPickAttachment?: () => Promise<any>;
  submitPromiseFactory?: (draft: FeedbackDraft) => Promise<FeedbackSubmissionResult>;
  uploadPromiseFactory?: (opts: any) => Promise<FeedbackAttachment>;
  onSubmitSuccess?: (result: any) => void;
  onClose?: () => void;
}): ComposerHarness {
  const client = new FeedbackClient({
    baseUrl: 'https://api.cupthread.com',
    appKey: 'app_test_composer_race',
  });

  const submitCalls: FeedbackDraft[] = [];
  const uploadCalls: any[] = [];

  client.submit = (async (draft: FeedbackDraft) => {
    submitCalls.push(draft);
    if (options.submitPromiseFactory) {
      return options.submitPromiseFactory(draft);
    }
    return { submissionId: 'sub_123', forwardedToGithub: false };
  }) as any;

  client.uploadAttachment = (async (uploadOptions: any) => {
    uploadCalls.push(uploadOptions);
    if (options.uploadPromiseFactory) {
      return options.uploadPromiseFactory(uploadOptions);
    }
    return makeAttachment('uploaded-file');
  }) as any;

  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      React.createElement(CupThreadProvider, {
        client,
        userToken: 'usr_test_race',
        children: React.createElement(FeedbackComposer, {
          visible: true,
          initialDraft: {
            title: 'Sample Issue',
            description: 'Something is broken and needs attention',
            ...options.initialDraft,
          },
          onPickAttachment: options.onPickAttachment,
          onSubmitSuccess: options.onSubmitSuccess,
          onClose: options.onClose,
          isModal: false,
        }),
      })
    );
  });

  const findAddAttachmentButton = () => {
    const buttons = renderer.root.findAllByType(TouchableOpacityStub as any);
    for (const btn of buttons) {
      const style = Array.isArray(btn.props.style) ? btn.props.style : [btn.props.style];
      if (style.some((s: any) => s && s.paddingHorizontal === 10 && s.paddingVertical === 4)) {
        return btn;
      }
    }
    return null;
  };

  const findRemoveAttachmentButtons = () => {
    const buttons = renderer.root.findAllByType(TouchableOpacityStub as any);
    return buttons.filter((btn) => {
      const style = Array.isArray(btn.props.style) ? btn.props.style : [btn.props.style];
      return style.some((s: any) => s && s.padding === 4);
    });
  };

  const findSubmitButton = () => {
    const buttons = renderer.root.findAllByType(TouchableOpacityStub as any);
    const submitBtn = buttons.find((btn) => {
      const style = Array.isArray(btn.props.style) ? btn.props.style : [btn.props.style];
      return style.some((s: any) => s && s.marginTop === 22);
    });
    if (!submitBtn) {
      throw new Error('Submit button not found');
    }
    return submitBtn;
  };

  return {
    renderer,
    client,
    submitCalls,
    uploadCalls,
    findAddAttachmentButton,
    findRemoveAttachmentButtons,
    findSubmitButton,
  };
}

test(
  'idle state: add-attachment and submit buttons are enabled when idle',
  renderTestOptions,
  async () => {
    const harness = createHarness({
      onPickAttachment: async () => makeAttachment('picked'),
    });
    await flush();

    const addBtn = harness.findAddAttachmentButton();
    assert.ok(addBtn, 'add attachment button must render');
    assert.equal(Boolean(addBtn.props.disabled), false, 'add attachment button should be enabled');

    const submitBtn = harness.findSubmitButton();
    assert.equal(Boolean(submitBtn.props.disabled), false, 'submit button should be enabled');

    harness.renderer.unmount();
  }
);

test(
  'in-flight submit: add-attachment button and remove buttons are disabled while submit request is in flight',
  renderTestOptions,
  async () => {
    let resolveSubmit!: (val: FeedbackSubmissionResult) => void;
    const submitDeferred = new Promise<FeedbackSubmissionResult>((resolve) => {
      resolveSubmit = resolve;
    });

    const harness = createHarness({
      initialDraft: {
        attachments: [makeAttachment('existing')],
      },
      onPickAttachment: async () => makeAttachment('new-file'),
      submitPromiseFactory: () => submitDeferred,
    });
    await flush();

    const submitBtn = harness.findSubmitButton();
    const addBtn = harness.findAddAttachmentButton();
    const removeBtns = harness.findRemoveAttachmentButtons();

    assert.ok(addBtn);
    assert.equal(Boolean(addBtn.props.disabled), false);
    assert.equal(removeBtns.length, 1);
    assert.equal(Boolean(removeBtns[0].props.disabled), false);

    // Tap submit -> submission becomes in flight
    let submitPromise!: Promise<any>;
    act(() => {
      submitPromise = submitBtn.props.onPress();
    });
    await flush(2);

    // Check during in-flight submit:
    assert.equal(
      Boolean(addBtn.props.disabled),
      true,
      'add-attachment button must be disabled during isSubmitting'
    );
    assert.equal(
      Boolean(removeBtns[0].props.disabled),
      true,
      'remove attachment button must be disabled during isSubmitting'
    );
    assert.equal(
      Boolean(submitBtn.props.disabled),
      true,
      'submit button must be disabled during isSubmitting'
    );

    // Resolve submit
    await act(async () => {
      resolveSubmit({ submissionId: 'sub_done', forwardedToGithub: false });
      await submitPromise;
    });
    await flush();

    harness.renderer.unmount();
  }
);

test(
  'calling handlePickAttachment during in-flight submit drops the action and performs no uploads',
  renderTestOptions,
  async () => {
    let resolveSubmit!: (val: FeedbackSubmissionResult) => void;
    const submitDeferred = new Promise<FeedbackSubmissionResult>((resolve) => {
      resolveSubmit = resolve;
    });

    let pickCallCount = 0;
    const harness = createHarness({
      onPickAttachment: async () => {
        pickCallCount++;
        return makeAttachment('raced-file');
      },
      submitPromiseFactory: () => submitDeferred,
    });
    await flush();

    const submitBtn = harness.findSubmitButton();
    const addBtn = harness.findAddAttachmentButton();
    assert.ok(addBtn);

    // Start submit
    let submitPromise!: Promise<any>;
    act(() => {
      submitPromise = submitBtn.props.onPress();
    });
    await flush(2);

    // Attempt to invoke add attachment handler during in-flight submit
    await act(async () => {
      await addBtn.props.onPress();
    });

    assert.equal(pickCallCount, 0, 'picker callback must not be invoked during submit');
    assert.equal(harness.uploadCalls.length, 0, 'no uploads must be triggered during submit');

    // Clean up deferred
    await act(async () => {
      resolveSubmit({ submissionId: 'sub_1', forwardedToGithub: false });
      await submitPromise;
    });
    await flush();

    harness.renderer.unmount();
  }
);

test(
  'calling handleRemoveAttachment during in-flight submit does not remove attachment',
  renderTestOptions,
  async () => {
    let resolveSubmit!: (val: FeedbackSubmissionResult) => void;
    const submitDeferred = new Promise<FeedbackSubmissionResult>((resolve) => {
      resolveSubmit = resolve;
    });

    const harness = createHarness({
      initialDraft: {
        attachments: [makeAttachment('keep-me')],
      },
      submitPromiseFactory: () => submitDeferred,
    });
    await flush();

    const submitBtn = harness.findSubmitButton();
    const removeBtns = harness.findRemoveAttachmentButtons();
    assert.equal(removeBtns.length, 1);

    // Start submit
    let submitPromise!: Promise<any>;
    act(() => {
      submitPromise = submitBtn.props.onPress();
    });
    await flush(2);

    // Attempt to invoke remove attachment while submit is in flight
    await act(async () => {
      await removeBtns[0].props.onPress();
    });

    // Attachment must still be rendered
    const removeBtnsAfter = harness.findRemoveAttachmentButtons();
    assert.equal(removeBtnsAfter.length, 1, 'attachment must not be removed during submit');

    await act(async () => {
      resolveSubmit({ submissionId: 'sub_2', forwardedToGithub: false });
      await submitPromise;
    });
    await flush();

    harness.renderer.unmount();
  }
);

test(
  'regression: submit button stays disabled while attachment upload is in flight',
  renderTestOptions,
  async () => {
    let resolveUpload!: (val: FeedbackAttachment) => void;
    const uploadDeferred = new Promise<FeedbackAttachment>((resolve) => {
      resolveUpload = resolve;
    });

    const harness = createHarness({
      onPickAttachment: async () => ({
        file: { uri: 'file:///tmp/pic.png' },
        filename: 'pic.png',
        mimeType: 'image/png',
      }),
      uploadPromiseFactory: () => uploadDeferred,
    });
    await flush();

    const addBtn = harness.findAddAttachmentButton();
    const submitBtn = harness.findSubmitButton();
    assert.ok(addBtn);

    // Tap add attachment -> triggers upload
    act(() => {
      addBtn.props.onPress();
    });
    await flush(2);

    // While upload is in flight:
    assert.equal(
      Boolean(submitBtn.props.disabled),
      true,
      'submit button must be disabled while upload is in flight'
    );

    // Tapping submit should be ignored
    await act(async () => {
      await submitBtn.props.onPress();
    });
    assert.equal(harness.submitCalls.length, 0, 'submit must not fire while upload is in flight');

    // Resolve upload
    await act(async () => {
      resolveUpload(makeAttachment('pic'));
    });
    await flush();

    // Now upload finished -> submit re-enabled
    assert.equal(Boolean(submitBtn.props.disabled), false, 'submit button re-enables after upload');

    harness.renderer.unmount();
  }
);

test(
  'wire-level invariant: payload captured at submit-tap cannot be mutated mid-submit',
  renderTestOptions,
  async () => {
    let resolveSubmit!: (val: FeedbackSubmissionResult) => void;
    const submitDeferred = new Promise<FeedbackSubmissionResult>((resolve) => {
      resolveSubmit = resolve;
    });

    const initialAttachment = makeAttachment('initial-shot');
    const harness = createHarness({
      initialDraft: {
        attachments: [initialAttachment],
      },
      onPickAttachment: async () => makeAttachment('late-attachment'),
      submitPromiseFactory: () => submitDeferred,
    });
    await flush();

    const submitBtn = harness.findSubmitButton();
    const addBtn = harness.findAddAttachmentButton();
    const removeBtns = harness.findRemoveAttachmentButtons();

    // Tap submit
    let submitPromise!: Promise<any>;
    act(() => {
      submitPromise = submitBtn.props.onPress();
    });
    await flush(2);

    // Try both adding and removing
    await act(async () => {
      if (addBtn) await addBtn.props.onPress();
      if (removeBtns[0]) await removeBtns[0].props.onPress();
    });

    assert.equal(harness.submitCalls.length, 1);
    assert.deepEqual(
      harness.submitCalls[0].attachments,
      [initialAttachment],
      'captured attachments must match initial state and not be mutated mid-submit'
    );

    await act(async () => {
      resolveSubmit({ submissionId: 'sub_3', forwardedToGithub: false });
      await submitPromise;
    });
    await flush();

    harness.renderer.unmount();
  }
);

test(
  'submit failure: resets isSubmitting and re-enables add-attachment and submit buttons',
  renderTestOptions,
  async () => {
    let rejectSubmit!: (err: Error) => void;
    const submitDeferred = new Promise<FeedbackSubmissionResult>((_, reject) => {
      rejectSubmit = reject;
    });

    const harness = createHarness({
      onPickAttachment: async () => makeAttachment('file'),
      submitPromiseFactory: () => submitDeferred,
    });
    await flush();

    const submitBtn = harness.findSubmitButton();
    const addBtn = harness.findAddAttachmentButton();
    assert.ok(addBtn);

    // Tap submit
    let submitPromise!: Promise<any>;
    act(() => {
      submitPromise = submitBtn.props.onPress();
    });
    await flush(2);

    assert.equal(Boolean(addBtn.props.disabled), true);
    assert.equal(Boolean(submitBtn.props.disabled), true);

    // Reject submit
    await act(async () => {
      rejectSubmit(new Error('Network offline'));
      try {
        await submitPromise;
      } catch {
        // Expected rejection
      }
    });
    await flush();

    // Buttons should re-enable
    assert.equal(
      Boolean(addBtn.props.disabled),
      false,
      'add-attachment button re-enables after failed submit'
    );
    assert.equal(
      Boolean(submitBtn.props.disabled),
      false,
      'submit button re-enables after failed submit'
    );

    harness.renderer.unmount();
  }
);
