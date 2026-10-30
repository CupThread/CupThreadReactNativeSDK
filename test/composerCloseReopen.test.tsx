import test, { type TestOptions } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { FeedbackClient } from '../src/client/FeedbackClient';
import type {
  FeedbackAttachment,
  FeedbackDraft,
  FeedbackSubmissionResult,
  FeatureRequestDraft,
  SubmitSuccessContext,
} from '../src/types';
import type { PickedAttachmentInput } from '../src/utils/attachments';

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

function makeAttachment(name: string): FeedbackAttachment {
  return {
    kind: 'image',
    uploadId: `upl_${name}`,
    key: `key-${name}`,
    url: `https://cdn.example.com/${name}.png`,
    filename: `${name}.png`,
    mimeType: 'image/png',
    size: 1024,
  };
}

function defer<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: any) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (err: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface FeedbackHarness {
  renderer: TestRenderer.ReactTestRenderer;
  submitCalls: FeedbackDraft[];
  findSubmitButton: () => TestRenderer.ReactTestInstance;
  findAddAttachmentButton: () => TestRenderer.ReactTestInstance | null;
  findRemoveAttachmentButtons: () => TestRenderer.ReactTestInstance[];
  findTextInputs: () => TestRenderer.ReactTestInstance[];
  setVisible: (visible: boolean) => void;
}

function createFeedbackHarness(options: {
  submitFactory: (callNumber: number) => Promise<FeedbackSubmissionResult>;
  initialDraft?: Partial<FeedbackDraft>;
  onPickAttachment?: () => Promise<PickedAttachmentInput>;
  onSubmitSuccess?: (result: FeedbackSubmissionResult, context: SubmitSuccessContext) => void;
  onClose?: () => void;
}): FeedbackHarness {
  const client = new FeedbackClient({
    baseUrl: 'https://api.cupthread.com',
    appKey: 'app_test_close_reopen',
  });

  const submitCalls: FeedbackDraft[] = [];
  client.submit = (async (draft: FeedbackDraft) => {
    submitCalls.push(draft);
    return options.submitFactory(submitCalls.length);
  }) as any;

  client.uploadAttachments = (async (batch: any[]) =>
    batch.map((entry, index) => makeAttachment(`picked-${index}`))) as any;

  const initialDraft: Partial<FeedbackDraft> = {
    title: 'Original Title',
    description: 'Original description of the problem',
    attachments: [makeAttachment('existing')],
    ...options.initialDraft,
  };

  let renderer!: TestRenderer.ReactTestRenderer;
  const buildElement = (visible: boolean) =>
    React.createElement(CupThreadProvider, {
      client,
      userToken: 'usr_tok_close_reopen',
      children: React.createElement(FeedbackComposer, {
        visible,
        isModal: false,
        initialDraft,
        onPickAttachment: options.onPickAttachment,
        onSubmitSuccess: options.onSubmitSuccess,
        onClose: options.onClose,
      }),
    });

  act(() => {
    renderer = TestRenderer.create(buildElement(true));
  });

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

  return {
    renderer,
    submitCalls,
    findSubmitButton,
    findAddAttachmentButton,
    findRemoveAttachmentButtons,
    findTextInputs: () => renderer.root.findAllByType('TextInput' as any),
    setVisible: (visible: boolean) => {
      act(() => {
        renderer.update(buildElement(visible));
      });
    },
  };
}

test(
  'FeedbackComposer: close/reopen during an in-flight submit restores a usable submit button that dispatches a second request',
  renderTestOptions,
  async () => {
    alertCalls.length = 0;
    const firstSubmit = defer<FeedbackSubmissionResult>();
    const successCalls: FeedbackSubmissionResult[] = [];
    const harness = createFeedbackHarness({
      submitFactory: (n) =>
        n === 1
          ? firstSubmit.promise
          : Promise.resolve({ submissionId: 'sub_2', forwardedToGithub: false }),
      onSubmitSuccess: (result) => successCalls.push(result),
    });
    await flush();

    try {
      // Start the first submit and leave it in flight.
      act(() => {
        void harness.findSubmitButton().props.onPress();
      });
      await flush(2);
      assert.equal(harness.submitCalls.length, 1, 'first submit dispatched');
      assert.equal(
        Boolean(harness.findSubmitButton().props.disabled),
        true,
        'submit button is busy while the request is in flight'
      );

      // Host closes and reopens the composer while the request is still hanging.
      harness.setVisible(false);
      await flush();
      harness.setVisible(true);
      await flush();

      assert.equal(
        Boolean(harness.findSubmitButton().props.disabled),
        false,
        'reopened form must render an enabled submit button'
      );

      // Tapping submit on the reopened form must dispatch a second request.
      act(() => {
        void harness.findSubmitButton().props.onPress();
      });
      await flush(2);
      assert.equal(
        harness.submitCalls.length,
        2,
        'reopened form must dispatch a new submission instead of swallowing the tap'
      );
      assert.equal(
        successCalls.length,
        1,
        'the reopened form submits on its own and reports success'
      );

      // The stale first submit settles while the second is in flight.
      firstSubmit.resolve({ submissionId: 'sub_1', forwardedToGithub: false });
      await flush();
      assert.equal(
        successCalls.length,
        2,
        'stale success still reaches the host alongside the newer one'
      );

      harness.renderer.unmount();
    } finally {
      firstSubmit.resolve({ submissionId: 'sub_1', forwardedToGithub: false });
    }
  }
);

test(
  'FeedbackComposer: a stale success settling after close/reopen keeps the re-typed draft and does not close the reopened form',
  renderTestOptions,
  async () => {
    alertCalls.length = 0;
    const firstSubmit = defer<FeedbackSubmissionResult>();
    let closeCalls = 0;
    const harness = createFeedbackHarness({
      // No onSubmitSuccess: the default Alert + close path runs on success.
      submitFactory: () => firstSubmit.promise,
      onClose: () => {
        closeCalls++;
      },
    });
    await flush();

    try {
      act(() => {
        void harness.findSubmitButton().props.onPress();
      });
      await flush(2);
      assert.equal(harness.submitCalls.length, 1);

      harness.setVisible(false);
      await flush();
      harness.setVisible(true);
      await flush();

      // The user re-engages and retypes a new report while the old request is
      // still in flight.
      const inputs = harness.findTextInputs();
      act(() => {
        inputs[0].props.onChangeText('Retyped After Reopen');
        inputs[1].props.onChangeText('Retyped body with enough characters');
      });
      await flush();

      // The stale submit succeeds now — it must not wipe the re-typed draft
      // and must not close the form the user just re-engaged.
      firstSubmit.resolve({ submissionId: 'sub_stale', forwardedToGithub: false });
      await flush();

      const inputsAfter = harness.findTextInputs();
      assert.equal(
        inputsAfter[0].props.value,
        'Retyped After Reopen',
        'stale success must not wipe the re-typed title'
      );
      assert.equal(
        inputsAfter[1].props.value,
        'Retyped body with enough characters',
        'stale success must not wipe the re-typed description'
      );
      assert.equal(closeCalls, 0, 'stale success must not close the reopened form');
      assert.equal(alertCalls.length, 1, 'success alert still informs the user');

      // The form remains interactive: submitting the re-typed draft works.
      act(() => {
        void harness.findSubmitButton().props.onPress();
      });
      await flush();
      assert.equal(harness.submitCalls.length, 2, 're-typed draft can be submitted');
      assert.equal(harness.submitCalls[1].title, 'Retyped After Reopen');

      harness.renderer.unmount();
    } finally {
      firstSubmit.resolve({ submissionId: 'sub_stale', forwardedToGithub: false });
    }
  }
);

test(
  'FeedbackComposer: after a mid-flight close/reopen, a synchronous double-tap still submits exactly once',
  renderTestOptions,
  async () => {
    alertCalls.length = 0;
    const firstSubmit = defer<FeedbackSubmissionResult>();
    const harness = createFeedbackHarness({
      submitFactory: (n) =>
        n === 1
          ? firstSubmit.promise
          : Promise.resolve({ submissionId: 'sub_reopened', forwardedToGithub: false }),
    });
    await flush();

    try {
      act(() => {
        void harness.findSubmitButton().props.onPress();
      });
      await flush(2);
      assert.equal(harness.submitCalls.length, 1);

      harness.setVisible(false);
      await flush();
      harness.setVisible(true);
      await flush();

      // The guard was released by the reopen reset; re-arming it must still
      // hold for two synchronous taps in the reopened session.
      act(() => {
        const onPress = harness.findSubmitButton().props.onPress;
        void onPress();
        void onPress();
      });
      await flush();
      assert.equal(
        harness.submitCalls.length,
        2,
        'double-tap on the reopened form must dispatch exactly one new request'
      );

      harness.renderer.unmount();
    } finally {
      firstSubmit.resolve({ submissionId: 'sub_1', forwardedToGithub: false });
    }
  }
);

test(
  'FeedbackComposer: attachment pick and removal work on the reopened form while the first submit is in flight',
  renderTestOptions,
  async () => {
    alertCalls.length = 0;
    const firstSubmit = defer<FeedbackSubmissionResult>();
    const harness = createFeedbackHarness({
      submitFactory: () => firstSubmit.promise,
      onPickAttachment: async () => makeAttachment('picked'),
    });
    await flush();

    try {
      act(() => {
        void harness.findSubmitButton().props.onPress();
      });
      await flush(2);

      // Guards still hold in the original session: pick is swallowed.
      const addBtnBefore = harness.findAddAttachmentButton();
      assert.ok(addBtnBefore);
      act(() => {
        void addBtnBefore.props.onPress();
      });
      await flush();
      assert.equal(
        harness.findRemoveAttachmentButtons().length,
        1,
        'pick stays blocked while the original session is submitting'
      );

      harness.setVisible(false);
      await flush();
      harness.setVisible(true);
      await flush();

      // The reopened form must allow picking and removing attachments even
      // though the first submit is still in flight.
      const addBtn = harness.findAddAttachmentButton();
      assert.ok(addBtn, 'add-attachment button renders on the reopened form');
      assert.equal(
        Boolean(addBtn.props.disabled),
        false,
        'add-attachment button must not look disabled on the reopened form'
      );
      act(() => {
        void addBtn.props.onPress();
      });
      await flush();
      assert.equal(
        harness.findRemoveAttachmentButtons().length,
        2,
        'pick goes through on the reopened form'
      );

      const removeButtons = harness.findRemoveAttachmentButtons();
      act(() => {
        void removeButtons[0].props.onPress();
      });
      await flush();
      assert.equal(
        harness.findRemoveAttachmentButtons().length,
        1,
        'removal works on the reopened form'
      );

      harness.renderer.unmount();
    } finally {
      firstSubmit.resolve({ submissionId: 'sub_1', forwardedToGithub: false });
    }
  }
);

test(
  'FeedbackComposer: a host that closes inside onSubmitSuccess is not closed by a stale success',
  renderTestOptions,
  async () => {
    alertCalls.length = 0;
    const firstSubmit = defer<FeedbackSubmissionResult>();
    const successContexts: boolean[] = [];
    let closeCalls = 0;
    const harness = createFeedbackHarness({
      submitFactory: (n) =>
        n === 1
          ? firstSubmit.promise
          : Promise.resolve({ submissionId: 'sub_2', forwardedToGithub: false }),
      // Mirror a typical host: close the composer only while the settled
      // submit still owns the visible form.
      onSubmitSuccess: (_result, { ownsForm }) => {
        successContexts.push(ownsForm);
        if (ownsForm) {
          closeCalls++;
        }
      },
    });
    await flush();

    try {
      act(() => {
        void harness.findSubmitButton().props.onPress();
      });
      await flush(2);
      assert.equal(harness.submitCalls.length, 1);

      harness.setVisible(false);
      await flush();
      harness.setVisible(true);
      await flush();

      // The stale submit settles in the reopened session: the host must learn
      // it no longer owns the form and must not dismiss it.
      firstSubmit.resolve({ submissionId: 'sub_stale', forwardedToGithub: false });
      await flush();

      assert.deepEqual(
        successContexts,
        [false],
        'stale success reports ownsForm: false to the host'
      );
      assert.equal(closeCalls, 0, 'the host must not close the reopened composer');

      // Submitting the reopened form reports ownership so the host can close.
      act(() => {
        void harness.findSubmitButton().props.onPress();
      });
      await flush(2);

      assert.deepEqual(
        successContexts,
        [false, true],
        'a success that owns the form reports ownsForm: true'
      );
      assert.equal(closeCalls, 1, 'the host closes on the owned success');

      harness.renderer.unmount();
    } finally {
      firstSubmit.resolve({ submissionId: 'sub_stale', forwardedToGithub: false });
    }
  }
);

interface SheetHarness {
  renderer: TestRenderer.ReactTestRenderer;
  submitCalls: FeatureRequestDraft[];
  findSubmitButton: () => TestRenderer.ReactTestInstance;
  findTextInputs: () => TestRenderer.ReactTestInstance[];
  setVisible: (visible: boolean) => void;
}

function createSheetHarness(options: {
  submitFactory: (callNumber: number) => Promise<any>;
  initialDraft?: Partial<FeatureRequestDraft>;
  onSubmitSuccess?: (result: any, context: SubmitSuccessContext) => void;
  onClose?: () => void;
}): SheetHarness {
  const client = new FeedbackClient({
    baseUrl: 'https://api.cupthread.com',
    appKey: 'app_test_close_reopen',
  });

  const submitCalls: FeatureRequestDraft[] = [];
  client.submitFeatureRequest = (async (draft: FeatureRequestDraft) => {
    submitCalls.push(draft);
    return options.submitFactory(submitCalls.length);
  }) as any;

  const initialDraft: Partial<FeatureRequestDraft> = {
    title: 'Original Proposal',
    description: 'Original proposal description',
    ...options.initialDraft,
  };

  let renderer!: TestRenderer.ReactTestRenderer;
  const buildElement = (visible: boolean) =>
    React.createElement(CupThreadProvider, {
      client,
      userToken: 'usr_tok_close_reopen',
      children: React.createElement(FeatureRequestComposeSheet, {
        visible,
        isModal: false,
        initialDraft,
        onSubmitSuccess: options.onSubmitSuccess,
        onClose: options.onClose,
      }),
    });

  act(() => {
    renderer = TestRenderer.create(buildElement(true));
  });

  const findSubmitButton = () => {
    const buttons = renderer.root.findAllByType(TouchableOpacityStub as any);
    const submitBtn = buttons.find((btn) => {
      const style = Array.isArray(btn.props.style) ? btn.props.style : [btn.props.style];
      return style.some((s: any) => s && s.paddingVertical === 14);
    });
    if (!submitBtn) {
      throw new Error('Submit button not found');
    }
    return submitBtn;
  };

  return {
    renderer,
    submitCalls,
    findSubmitButton,
    findTextInputs: () => renderer.root.findAllByType('TextInput' as any),
    setVisible: (visible: boolean) => {
      act(() => {
        renderer.update(buildElement(visible));
      });
    },
  };
}

test(
  'FeatureRequestComposeSheet: close/reopen during an in-flight submit restores a usable submit button and dispatches a second request',
  renderTestOptions,
  async () => {
    alertCalls.length = 0;
    const firstSubmit = defer<{ featureRequestId: string; pending: boolean }>();
    let successCalls = 0;
    const harness = createSheetHarness({
      submitFactory: (n) =>
        n === 1
          ? firstSubmit.promise
          : Promise.resolve({ featureRequestId: 'fr_2', pending: false }),
      onSubmitSuccess: () => {
        successCalls++;
      },
    });
    await flush();

    try {
      act(() => {
        void harness.findSubmitButton().props.onPress();
      });
      await flush(2);
      assert.equal(harness.submitCalls.length, 1);
      assert.equal(
        Boolean(harness.findSubmitButton().props.disabled),
        true,
        'submit button is busy while the request is in flight'
      );

      harness.setVisible(false);
      await flush();
      harness.setVisible(true);
      await flush();

      assert.equal(
        Boolean(harness.findSubmitButton().props.disabled),
        false,
        'reopened sheet must render an enabled submit button'
      );

      act(() => {
        void harness.findSubmitButton().props.onPress();
      });
      await flush(2);
      assert.equal(
        harness.submitCalls.length,
        2,
        'reopened sheet must dispatch a new submission instead of swallowing the tap'
      );
      assert.equal(successCalls, 1, 'the reopened sheet submits on its own and reports success');

      firstSubmit.resolve({ featureRequestId: 'fr_1', pending: false });
      await flush();
      assert.equal(successCalls, 2, 'stale success still reaches the host alongside the newer one');

      harness.renderer.unmount();
    } finally {
      firstSubmit.resolve({ featureRequestId: 'fr_1', pending: false });
    }
  }
);

test(
  'FeatureRequestComposeSheet: a stale success settling after close/reopen keeps the re-typed draft and does not close the reopened sheet',
  renderTestOptions,
  async () => {
    alertCalls.length = 0;
    const firstSubmit = defer<{ featureRequestId: string; pending: boolean }>();
    let closeCalls = 0;
    let successCalls = 0;
    const harness = createSheetHarness({
      submitFactory: () => firstSubmit.promise,
      onSubmitSuccess: () => {
        successCalls++;
      },
      onClose: () => {
        closeCalls++;
      },
    });
    await flush();

    try {
      act(() => {
        void harness.findSubmitButton().props.onPress();
      });
      await flush(2);
      assert.equal(harness.submitCalls.length, 1);

      harness.setVisible(false);
      await flush();
      harness.setVisible(true);
      await flush();

      const inputs = harness.findTextInputs();
      act(() => {
        inputs[0].props.onChangeText('Retyped Proposal');
        inputs[1].props.onChangeText('Retyped proposal body with enough characters');
      });
      await flush();

      firstSubmit.resolve({ featureRequestId: 'fr_stale', pending: false });
      await flush();

      const inputsAfter = harness.findTextInputs();
      assert.equal(
        inputsAfter[0].props.value,
        'Retyped Proposal',
        'stale success must not wipe the re-typed title'
      );
      assert.equal(
        inputsAfter[1].props.value,
        'Retyped proposal body with enough characters',
        'stale success must not wipe the re-typed description'
      );
      assert.equal(closeCalls, 0, 'stale success must not close the reopened sheet');
      assert.equal(successCalls, 1, 'onSubmitSuccess fires once for the settled submission');
      assert.equal(alertCalls.length, 1, 'success alert still informs the user');

      harness.renderer.unmount();
    } finally {
      firstSubmit.resolve({ featureRequestId: 'fr_stale', pending: false });
    }
  }
);

test(
  'FeatureRequestComposeSheet: a host that closes inside onSubmitSuccess is not closed by a stale success',
  renderTestOptions,
  async () => {
    alertCalls.length = 0;
    const firstSubmit = defer<{ featureRequestId: string; pending: boolean }>();
    const successContexts: boolean[] = [];
    let closeCalls = 0;
    const harness = createSheetHarness({
      submitFactory: (n) =>
        n === 1
          ? firstSubmit.promise
          : Promise.resolve({ featureRequestId: 'fr_2', pending: false }),
      // Mirror FeatureRequestsScreen: close the sheet on success, but only
      // while the settled submit still owns the visible form.
      onSubmitSuccess: (_result, { ownsForm }) => {
        successContexts.push(ownsForm);
        if (ownsForm) {
          closeCalls++;
        }
      },
    });
    await flush();

    try {
      act(() => {
        void harness.findSubmitButton().props.onPress();
      });
      await flush(2);
      assert.equal(harness.submitCalls.length, 1);

      harness.setVisible(false);
      await flush();
      harness.setVisible(true);
      await flush();

      firstSubmit.resolve({ featureRequestId: 'fr_stale', pending: false });
      await flush();

      assert.deepEqual(
        successContexts,
        [false],
        'stale success reports ownsForm: false to the host'
      );
      assert.equal(closeCalls, 0, 'the host must not close the reopened sheet');

      act(() => {
        void harness.findSubmitButton().props.onPress();
      });
      await flush(2);

      assert.deepEqual(
        successContexts,
        [false, true],
        'a success that owns the form reports ownsForm: true'
      );
      assert.equal(closeCalls, 1, 'the host closes on the owned success');

      harness.renderer.unmount();
    } finally {
      firstSubmit.resolve({ featureRequestId: 'fr_stale', pending: false });
    }
  }
);
