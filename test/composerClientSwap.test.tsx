import test, { type TestOptions } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { FeedbackClient } from '../src/client/FeedbackClient';
import { enStrings } from '../src/i18n';
import type {
  FeedbackAttachment,
  FeedbackDraft,
  FeedbackSubmissionResult,
  FeatureRequestDraft,
  FeatureRequestSubmissionResult,
  SubmitSuccessContext,
} from '../src/types';

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

function defer<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeAttachment(name: string, uploadId = `upl_${name}`): FeedbackAttachment {
  return {
    kind: 'image',
    uploadId,
    key: `key-${name}`,
    url: `https://cdn.example.com/${name}.png`,
    filename: `${name}.png`,
    mimeType: 'image/png',
    size: 1024,
  };
}

function collectText(renderer: TestRenderer.ReactTestRenderer): string[] {
  return renderer.root
    .findAll((node) => (node.type as any) === 'Text')
    .map((node) => {
      const children = node.props.children;
      if (Array.isArray(children)) return children.join('');
      return String(children ?? '');
    })
    .filter((text: string) => text.length > 0);
}

function findFeedbackAddAttachmentButton(renderer: TestRenderer.ReactTestRenderer) {
  const buttons = renderer.root.findAllByType(TouchableOpacityStub as any);
  return (
    buttons.find((btn) => {
      const style = Array.isArray(btn.props.style) ? btn.props.style : [btn.props.style];
      return style.some((s: any) => s && s.paddingHorizontal === 10 && s.paddingVertical === 4);
    }) ?? null
  );
}

function findFeedbackRemoveAttachmentButtons(renderer: TestRenderer.ReactTestRenderer) {
  const buttons = renderer.root.findAllByType(TouchableOpacityStub as any);
  return buttons.filter((btn) => {
    const style = Array.isArray(btn.props.style) ? btn.props.style : [btn.props.style];
    return style.some((s: any) => s && s.padding === 4);
  });
}

function findFeedbackSubmitButton(renderer: TestRenderer.ReactTestRenderer) {
  const buttons = renderer.root.findAllByType(TouchableOpacityStub as any);
  const submitBtn = buttons.find((btn) => {
    const style = Array.isArray(btn.props.style) ? btn.props.style : [btn.props.style];
    return style.some((s: any) => s && s.marginTop === 22);
  });
  if (!submitBtn) throw new Error('FeedbackComposer submit button not found');
  return submitBtn;
}

function findSheetSubmitButton(renderer: TestRenderer.ReactTestRenderer) {
  const buttons = renderer.root.findAllByType(TouchableOpacityStub as any);
  const submitBtn = buttons.find((btn) => {
    const style = Array.isArray(btn.props.style) ? btn.props.style : [btn.props.style];
    return style.some((s: any) => s && s.marginTop === 24);
  });
  if (!submitBtn) throw new Error('FeatureRequestComposeSheet submit button not found');
  return submitBtn;
}

function makeClient(appKey: string): FeedbackClient {
  const client = new FeedbackClient({
    baseUrl: 'https://api.cupthread.com',
    appKey,
  });
  client.fetchAppConfig = (async () => ({ appKey })) as any;
  return client;
}

test(
  'FeedbackComposer: swapping client clears uploaded attachments, draft fields, errorMessage, and attachmentNotice (including with preserveDraftOnClose)',
  renderTestOptions,
  async () => {
    alertCalls.length = 0;
    const clientA = makeClient('app_swap_att_a');
    const clientB = makeClient('app_swap_att_b');

    const submitCallsA: FeedbackDraft[] = [];
    const submitCallsB: FeedbackDraft[] = [];

    clientA.uploadAttachments = (async () => [
      makeAttachment('app-a-shot', 'upl_app_a_only'),
    ]) as any;
    clientA.submit = (async (draft: FeedbackDraft) => {
      submitCallsA.push(draft);
      return { submissionId: 'sub_a', forwardedToGithub: false };
    }) as any;

    clientB.submit = (async (draft: FeedbackDraft) => {
      submitCallsB.push(draft);
      return { submissionId: 'sub_b', forwardedToGithub: false };
    }) as any;

    let renderer!: TestRenderer.ReactTestRenderer;
    const renderTree = (client: FeedbackClient, visible: boolean, preserveDraftOnClose = true) =>
      React.createElement(CupThreadProvider, {
        client,
        userToken: 'usr_swap_att',
        children: React.createElement(FeedbackComposer, {
          visible,
          isModal: false,
          preserveDraftOnClose,
          onPickAttachment: async () => ({
            file: { uri: 'file:///tmp/app-a-shot.png', size: 1024 },
            filename: 'app-a-shot.png',
            mimeType: 'image/png',
            size: 1024,
          }),
        }),
      });

    act(() => {
      renderer = TestRenderer.create(renderTree(clientA, true, true));
    });
    await flush();

    try {
      // Upload attachment on clientA, edit text, and trigger a validation error.
      const addBtn = findFeedbackAddAttachmentButton(renderer);
      assert.ok(addBtn);
      await act(async () => {
        await addBtn.props.onPress();
      });
      await flush();

      assert.equal(findFeedbackRemoveAttachmentButtons(renderer).length, 1);

      const inputsA = renderer.root.findAllByType('TextInput' as any);
      act(() => {
        inputsA[0].props.onChangeText('A'); // triggers min-length error on submit
        inputsA[1].props.onChangeText('App A description');
      });
      await act(async () => {
        await findFeedbackSubmitButton(renderer).props.onPress();
      });
      await flush();
      assert.ok(
        collectText(renderer).some((t) => t.toLowerCase().includes('at least 3')),
        'validation error renders on clientA before swap'
      );

      // Swap to clientB while visible: attachments, draft text, and errorMessage must clear.
      act(() => {
        renderer.update(renderTree(clientB, true, true));
      });
      await flush();

      assert.equal(
        findFeedbackRemoveAttachmentButtons(renderer).length,
        0,
        'clientA attachments must be cleared on swap to clientB'
      );
      const inputsB = renderer.root.findAllByType('TextInput' as any);
      assert.equal(inputsB[0].props.value, '');
      assert.equal(inputsB[1].props.value, '');
      assert.equal(
        collectText(renderer).some((t) => t.toLowerCase().includes('at least 3')),
        false,
        'clientA errorMessage must clear on swap'
      );

      // Fill and submit on clientB: attachments must be empty (no clientA uploadId).
      act(() => {
        inputsB[0].props.onChangeText('App B report');
        inputsB[1].props.onChangeText('App B detailed issue description');
      });
      await act(async () => {
        await findFeedbackSubmitButton(renderer).props.onPress();
      });
      await flush();

      assert.equal(submitCallsA.length, 0);
      assert.equal(submitCallsB.length, 1);
      assert.deepEqual(
        submitCallsB[0].attachments,
        [],
        'clientB submission must not carry clientA attachment uploadIds'
      );

      // Now upload on clientB, close with preserveDraftOnClose={true}, swap back to clientA while hidden, then reopen.
      clientB.uploadAttachments = (async () => [
        makeAttachment('app-b-shot', 'upl_app_b_only'),
      ]) as any;
      const addBtnB = findFeedbackAddAttachmentButton(renderer);
      assert.ok(addBtnB);
      await act(async () => {
        await addBtnB.props.onPress();
      });
      await flush();
      assert.equal(findFeedbackRemoveAttachmentButtons(renderer).length, 1);

      const inputsB2 = renderer.root.findAllByType('TextInput' as any);
      act(() => {
        inputsB2[0].props.onChangeText('Preserved App B Draft');
      });
      act(() => {
        renderer.update(renderTree(clientB, false, true));
      });
      await flush();

      // Swap to clientA while hidden, then reopen.
      act(() => {
        renderer.update(renderTree(clientA, false, true));
      });
      await flush();
      act(() => {
        renderer.update(renderTree(clientA, true, true));
      });
      await flush();

      assert.equal(
        findFeedbackRemoveAttachmentButtons(renderer).length,
        0,
        'hidden client swap with preserveDraftOnClose=true must clear previous client attachments'
      );
      const inputsAReopened = renderer.root.findAllByType('TextInput' as any);
      assert.equal(
        inputsAReopened[0].props.value,
        '',
        'hidden client swap with preserveDraftOnClose=true must reset previous client draft'
      );

      // Verify a failed upload's attachmentNotice on clientA also clears when swapping to clientB.
      clientA.uploadAttachments = (async () => {
        throw new Error('clientA upload quota exceeded');
      }) as any;
      await act(async () => {
        await findFeedbackAddAttachmentButton(renderer)!.props.onPress();
      });
      await flush();
      assert.ok(
        collectText(renderer).some((t) => t.includes(enStrings.feedbackComposer.uploadFailed)),
        'attachmentNotice must render on clientA after upload failure'
      );
      act(() => {
        renderer.update(renderTree(clientB, true, true));
      });
      await flush();
      assert.equal(
        collectText(renderer).some((t) => t.includes(enStrings.feedbackComposer.uploadFailed)),
        false,
        'attachmentNotice from clientA must clear on swap to clientB'
      );
    } finally {
      renderer.unmount();
    }
  }
);

test(
  'FeedbackComposer: swapping client aborts in-flight attachment upload, unlocks new client, and discards late results/errors',
  renderTestOptions,
  async () => {
    const clientA = makeClient('app_swap_upload_a');
    const clientB = makeClient('app_swap_upload_b');

    const uploadA = defer<FeedbackAttachment[]>();
    const uploadB = defer<FeedbackAttachment[]>();
    const signalsA: Array<AbortSignal | undefined> = [];

    clientA.uploadAttachments = (async (_batch: any[], shared?: any) => {
      signalsA.push(shared?.signal);
      return uploadA.promise;
    }) as any;

    clientB.uploadAttachments = (async () => uploadB.promise) as any;

    let renderer!: TestRenderer.ReactTestRenderer;
    const renderTree = (client: FeedbackClient) =>
      React.createElement(CupThreadProvider, {
        client,
        userToken: 'usr_swap_upload',
        children: React.createElement(FeedbackComposer, {
          visible: true,
          isModal: false,
          initialDraft: { title: 'Upload Swap', description: 'Testing upload isolation' },
          onPickAttachment: async () => ({
            file: { uri: 'file:///tmp/shot.png', size: 256 },
            filename: 'shot.png',
            mimeType: 'image/png',
            size: 256,
          }),
        }),
      });

    act(() => {
      renderer = TestRenderer.create(renderTree(clientA));
    });
    await flush();

    try {
      const addBtnA = findFeedbackAddAttachmentButton(renderer);
      assert.ok(addBtnA);
      act(() => {
        void addBtnA.props.onPress();
      });
      await flush(2);

      assert.equal(signalsA.length, 1);
      assert.equal(signalsA[0]?.aborted, false);
      assert.equal(Boolean(findFeedbackAddAttachmentButton(renderer)?.props.disabled), true);
      assert.equal(Boolean(findFeedbackSubmitButton(renderer).props.disabled), true);

      // Swap to clientB while clientA's upload is still pending.
      act(() => {
        renderer.update(renderTree(clientB));
      });
      await flush();

      assert.equal(signalsA[0]?.aborted, true, 'swapping client must abort clientA upload signal');
      assert.equal(
        Boolean(findFeedbackAddAttachmentButton(renderer)?.props.disabled),
        false,
        'clientB add-attachment button must be enabled immediately after swap'
      );
      assert.equal(
        Boolean(findFeedbackSubmitButton(renderer).props.disabled),
        false,
        'clientB submit button must be enabled immediately after swap'
      );

      // Start an independent upload on clientB.
      const addBtnB = findFeedbackAddAttachmentButton(renderer);
      assert.ok(addBtnB);
      act(() => {
        void addBtnB.props.onPress();
      });
      await flush(2);
      assert.equal(Boolean(findFeedbackSubmitButton(renderer).props.disabled), true);

      // Late resolution from clientA must not append clientA's attachment or unlock clientB's spinner.
      uploadA.resolve([makeAttachment('late-a', 'upl_late_a')]);
      await flush();

      assert.equal(
        findFeedbackRemoveAttachmentButtons(renderer).length,
        0,
        'clientA late upload must not append into clientB attachments'
      );
      assert.equal(
        Boolean(findFeedbackSubmitButton(renderer).props.disabled),
        true,
        'clientA late upload settlement must not clear clientB upload busy state'
      );

      // Finish clientB upload cleanly.
      uploadB.resolve([makeAttachment('fresh-b', 'upl_fresh_b')]);
      await flush();

      assert.equal(findFeedbackRemoveAttachmentButtons(renderer).length, 1);
      assert.equal(Boolean(findFeedbackSubmitButton(renderer).props.disabled), false);

      // Also verify a non-abort late rejection from clientA cannot surface attachmentNotice on clientB.
      const uploadA2 = defer<FeedbackAttachment[]>();
      const clientA2 = makeClient('app_swap_upload_a2');
      clientA2.uploadAttachments = (async () => uploadA2.promise) as any;

      act(() => {
        renderer.update(renderTree(clientA2));
      });
      await flush();

      act(() => {
        void findFeedbackAddAttachmentButton(renderer)!.props.onPress();
      });
      await flush(2);

      act(() => {
        renderer.update(renderTree(clientB));
      });
      await flush();

      uploadA2.reject(new Error('clientA storage failure'));
      await flush();

      assert.equal(
        collectText(renderer).some((t) => t.includes(enStrings.feedbackComposer.uploadFailed)),
        false,
        'clientA upload error must not leak attachmentNotice onto clientB'
      );
    } finally {
      uploadA.resolve([]);
      uploadB.resolve([]);
      renderer.unmount();
    }
  }
);

test(
  'FeedbackComposer: swapping client while onPickAttachment is pending prevents dispatching upload on stale client',
  renderTestOptions,
  async () => {
    const clientA = makeClient('app_swap_picker_a');
    const clientB = makeClient('app_swap_picker_b');
    let uploadCallsA = 0;
    clientA.uploadAttachments = (async () => {
      uploadCallsA += 1;
      return [makeAttachment('should-not-upload')];
    }) as any;

    const pickerDeferred = defer<any>();
    let renderer!: TestRenderer.ReactTestRenderer;
    const renderTree = (client: FeedbackClient) =>
      React.createElement(CupThreadProvider, {
        client,
        userToken: 'usr_swap_picker',
        children: React.createElement(FeedbackComposer, {
          visible: true,
          isModal: false,
          initialDraft: { title: 'Picker Swap', description: 'Testing picker cancellation' },
          onPickAttachment: () => pickerDeferred.promise,
        }),
      });

    act(() => {
      renderer = TestRenderer.create(renderTree(clientA));
    });
    await flush();

    try {
      act(() => {
        void findFeedbackAddAttachmentButton(renderer)!.props.onPress();
      });
      await flush(2);
      assert.equal(Boolean(findFeedbackAddAttachmentButton(renderer)?.props.disabled), true);

      act(() => {
        renderer.update(renderTree(clientB));
      });
      await flush();
      assert.equal(Boolean(findFeedbackAddAttachmentButton(renderer)?.props.disabled), false);

      pickerDeferred.resolve({
        file: { uri: 'file:///tmp/late.png', size: 128 },
        filename: 'late.png',
        mimeType: 'image/png',
        size: 128,
      });
      await flush();

      assert.equal(uploadCallsA, 0, 'stale clientA upload must not fire after swap');
      assert.equal(findFeedbackRemoveAttachmentButtons(renderer).length, 0);
    } finally {
      pickerDeferred.resolve(null);
      renderer.unmount();
    }
  }
);

test(
  'FeedbackComposer: in-flight handleSubmit isolates draft, busy lock, errorMessage, Alert, onClose, and onSubmitSuccess across client swaps and A-B-A',
  renderTestOptions,
  async () => {
    alertCalls.length = 0;
    const clientA = makeClient('app_swap_submit_a');
    const clientB = makeClient('app_swap_submit_b');

    const submitA = defer<FeedbackSubmissionResult>();
    const submitB = defer<FeedbackSubmissionResult>();
    const submitCallsA: FeedbackDraft[] = [];
    const submitCallsB: FeedbackDraft[] = [];

    clientA.submit = (async (draft: FeedbackDraft) => {
      submitCallsA.push(draft);
      return submitA.promise;
    }) as any;
    clientB.submit = (async (draft: FeedbackDraft) => {
      submitCallsB.push(draft);
      return submitB.promise;
    }) as any;

    let closeCalls = 0;
    const successCalls: Array<{ id: string; context: SubmitSuccessContext }> = [];

    let renderer!: TestRenderer.ReactTestRenderer;
    const renderTree = (
      client: FeedbackClient,
      withCallback = true,
      initialDraft: Partial<FeedbackDraft> = {
        title: 'Default Title',
        description: 'Default detailed description',
      }
    ) =>
      React.createElement(CupThreadProvider, {
        client,
        userToken: 'usr_swap_submit',
        children: React.createElement(FeedbackComposer, {
          visible: true,
          isModal: false,
          initialDraft,
          onClose: () => {
            closeCalls += 1;
          },
          onSubmitSuccess: withCallback
            ? (result, context) => {
                successCalls.push({ id: result.submissionId, context });
              }
            : undefined,
        }),
      });

    act(() => {
      renderer = TestRenderer.create(renderTree(clientA, true));
    });
    await flush();

    try {
      // 1. Start submit on clientA.
      act(() => {
        void findFeedbackSubmitButton(renderer).props.onPress();
      });
      await flush(2);
      assert.equal(submitCallsA.length, 1);
      assert.equal(Boolean(findFeedbackSubmitButton(renderer).props.disabled), true);

      // 2. Swap to clientB: clientB must unlock immediately and allow typing & submitting.
      act(() => {
        renderer.update(renderTree(clientB, true));
      });
      await flush();
      assert.equal(
        Boolean(findFeedbackSubmitButton(renderer).props.disabled),
        false,
        'clientB submit button must be enabled immediately after swap'
      );

      const inputsB = renderer.root.findAllByType('TextInput' as any);
      act(() => {
        inputsB[0].props.onChangeText('Client B Typed Draft');
        inputsB[1].props.onChangeText('Client B typed description text');
      });
      await flush();

      // Start submit on clientB as well (stays pending).
      act(() => {
        void findFeedbackSubmitButton(renderer).props.onPress();
      });
      await flush(2);
      assert.equal(submitCallsB.length, 1);
      assert.equal(Boolean(findFeedbackSubmitButton(renderer).props.disabled), true);

      // 3. Resolve clientA's stale submit: must NOT wipe clientB's draft, clear clientB's busy state,
      // call onClose, fire Alert, or report ownsForm: true.
      submitA.resolve({ submissionId: 'sub_stale_a', forwardedToGithub: false });
      await flush();

      assert.equal(
        renderer.root.findAllByType('TextInput' as any)[0].props.value,
        'Client B Typed Draft',
        'clientA settlement must not wipe clientB typed draft'
      );
      assert.equal(
        Boolean(findFeedbackSubmitButton(renderer).props.disabled),
        true,
        'clientA settlement must not release clientB in-flight submit lock'
      );
      assert.equal(closeCalls, 0);
      assert.equal(alertCalls.length, 0);
      assert.equal(
        successCalls.some((c) => c.id === 'sub_stale_a' && c.context.ownsForm),
        false,
        'clientA stale submit must never report ownsForm: true on clientB'
      );
      assert.equal(successCalls.length, 0);

      // Finish clientB's submit: must report ownsForm: true.
      submitB.resolve({ submissionId: 'sub_valid_b', forwardedToGithub: false });
      await flush();
      assert.equal(successCalls.length, 1);
      assert.deepEqual(successCalls[0], { id: 'sub_valid_b', context: { ownsForm: true } });
      assert.equal(Boolean(findFeedbackSubmitButton(renderer).props.disabled), false);

      // 4. Test default Alert/onClose path + rejection path + A-B-A swap.
      const submitA2 = defer<FeedbackSubmissionResult>();
      const submitA3 = defer<FeedbackSubmissionResult>();
      let aCount = 0;
      clientA.submit = (async () => {
        aCount += 1;
        return aCount === 1 ? submitA2.promise : submitA3.promise;
      }) as any;

      act(() => {
        renderer.update(renderTree(clientA, false));
      });
      await flush();

      // Start submitA2, swap A -> B -> A, type new draft, and settle submitA2.
      act(() => {
        void findFeedbackSubmitButton(renderer).props.onPress();
      });
      await flush(2);

      act(() => {
        renderer.update(renderTree(clientB, false));
      });
      await flush();
      act(() => {
        renderer.update(renderTree(clientA, false));
      });
      await flush();

      act(() => {
        renderer.root.findAllByType('TextInput' as any)[0].props.onChangeText('Post ABA Draft');
      });
      await flush();

      submitA2.resolve({ submissionId: 'sub_aba_stale', forwardedToGithub: false });
      await flush();

      assert.equal(
        renderer.root.findAllByType('TextInput' as any)[0].props.value,
        'Post ABA Draft',
        'A-B-A stale settlement must not wipe post-swap draft'
      );
      assert.equal(alertCalls.length, 0, 'A-B-A stale settlement must not fire Alert.alert');
      assert.equal(closeCalls, 0, 'A-B-A stale settlement must not call onClose');

      // 5. Rejecting stale clientA submit after swapping to clientB must not render errorMessage on clientB.
      act(() => {
        void findFeedbackSubmitButton(renderer).props.onPress();
      });
      await flush(2);
      act(() => {
        renderer.update(renderTree(clientB, false));
      });
      await flush();

      submitA3.reject(new Error('clientA boom failure'));
      await flush();

      assert.equal(
        collectText(renderer).some((t) => t.includes(enStrings.feedbackComposer.submitFailed)),
        false,
        'clientA rejection must not render errorMessage on clientB'
      );
      assert.equal(alertCalls.length, 0);
      assert.equal(closeCalls, 0);
    } finally {
      submitA.resolve({ submissionId: 'cleanup', forwardedToGithub: false });
      submitB.resolve({ submissionId: 'cleanup', forwardedToGithub: false });
      renderer.unmount();
    }
  }
);

test(
  'FeedbackComposer: immediate client swap before resolveEffectiveUserToken finishes does not dispatch clientA.submit',
  renderTestOptions,
  async () => {
    const clientA = makeClient('app_swap_token_a');
    const clientB = makeClient('app_swap_token_b');
    let callsA = 0;
    clientA.submit = (async () => {
      callsA += 1;
      return { submissionId: 'sub_never', forwardedToGithub: false };
    }) as any;

    let renderer!: TestRenderer.ReactTestRenderer;
    const renderTree = (client: FeedbackClient) =>
      React.createElement(CupThreadProvider, {
        client,
        userToken: 'usr_immediate_swap',
        children: React.createElement(FeedbackComposer, {
          visible: true,
          isModal: false,
          initialDraft: { title: 'Fast swap', description: 'Swap before async microtask settles' },
        }),
      });

    act(() => {
      renderer = TestRenderer.create(renderTree(clientA));
    });
    await flush();

    try {
      // Tap submit, then swap client before the async resolveEffectiveUserToken microtask settles.
      act(() => {
        void findFeedbackSubmitButton(renderer).props.onPress();
        renderer.update(renderTree(clientB));
      });
      await flush();

      assert.equal(callsA, 0, 'clientA.submit must not be dispatched when client swapped first');
      assert.equal(Boolean(findFeedbackSubmitButton(renderer).props.disabled), false);
    } finally {
      renderer.unmount();
    }
  }
);

test(
  'FeatureRequestComposeSheet: client swaps clear drafts/errors and isolate in-flight submit across swaps and A-B-A',
  renderTestOptions,
  async () => {
    alertCalls.length = 0;
    const clientA = makeClient('app_fr_swap_a');
    const clientB = makeClient('app_fr_swap_b');

    const submitA = defer<FeatureRequestSubmissionResult>();
    const submitB = defer<FeatureRequestSubmissionResult>();
    const rejectA = defer<FeatureRequestSubmissionResult>();
    let aCalls = 0;
    const bCalls: FeatureRequestDraft[] = [];

    clientA.submitFeatureRequest = (async () => {
      aCalls += 1;
      if (aCalls === 1) return submitA.promise;
      return rejectA.promise;
    }) as any;
    clientB.submitFeatureRequest = (async (draft: FeatureRequestDraft) => {
      bCalls.push(draft);
      return submitB.promise;
    }) as any;

    let closeCalls = 0;
    const successCalls: Array<{ id: string; context: SubmitSuccessContext }> = [];

    let renderer!: TestRenderer.ReactTestRenderer;
    const renderTree = (
      client: FeedbackClient,
      visible: boolean,
      withCallback = true,
      preserveDraftOnClose = true
    ) =>
      React.createElement(CupThreadProvider, {
        client,
        userToken: 'usr_fr_swap',
        children: React.createElement(FeatureRequestComposeSheet, {
          visible,
          isModal: false,
          preserveDraftOnClose,
          initialDraft: { title: 'Default FR', description: 'Default FR details' },
          onClose: () => {
            closeCalls += 1;
          },
          onSubmitSuccess: withCallback
            ? (result, context) => {
                successCalls.push({ id: result.featureRequestId, context });
              }
            : undefined,
        }),
      });

    act(() => {
      renderer = TestRenderer.create(renderTree(clientA, true, true));
    });
    await flush();

    try {
      // Trigger validation error on clientA, then swap to clientB: error and typed draft must clear.
      act(() => {
        renderer.root.findAllByType('TextInput' as any)[0].props.onChangeText('No');
      });
      await act(async () => {
        await findSheetSubmitButton(renderer).props.onPress();
      });
      await flush();
      assert.ok(collectText(renderer).some((t) => t.toLowerCase().includes('at least 3')));

      act(() => {
        renderer.update(renderTree(clientB, true, true));
      });
      await flush();
      assert.equal(renderer.root.findAllByType('TextInput' as any)[0].props.value, 'Default FR');
      assert.equal(
        collectText(renderer).some((t) => t.toLowerCase().includes('at least 3')),
        false
      );

      // Swap back to clientA, start submitA, then swap to clientB.
      act(() => {
        renderer.update(renderTree(clientA, true, true));
      });
      await flush();
      act(() => {
        void findSheetSubmitButton(renderer).props.onPress();
      });
      await flush(2);
      assert.equal(aCalls, 1);
      assert.equal(Boolean(findSheetSubmitButton(renderer).props.disabled), true);

      act(() => {
        renderer.update(renderTree(clientB, true, true));
      });
      await flush();
      assert.equal(
        Boolean(findSheetSubmitButton(renderer).props.disabled),
        false,
        'clientB submit button must be enabled immediately after swap'
      );

      // Type clientB draft and start submitB.
      act(() => {
        renderer.root.findAllByType('TextInput' as any)[0].props.onChangeText('Client B FR');
      });
      act(() => {
        void findSheetSubmitButton(renderer).props.onPress();
      });
      await flush(2);
      assert.equal(bCalls.length, 1);
      assert.equal(Boolean(findSheetSubmitButton(renderer).props.disabled), true);

      // Resolve stale submitA: must not wipe draft, unlock clientB, fire Alert, call onClose, or report ownsForm: true.
      submitA.resolve({
        featureRequestId: 'fr_stale_a',
        pending: false,
      });
      await flush();

      assert.equal(renderer.root.findAllByType('TextInput' as any)[0].props.value, 'Client B FR');
      assert.equal(Boolean(findSheetSubmitButton(renderer).props.disabled), true);
      assert.equal(alertCalls.length, 0);
      assert.equal(closeCalls, 0);
      assert.equal(successCalls.length, 0);

      // Resolve valid submitB.
      submitB.resolve({
        featureRequestId: 'fr_valid_b',
        pending: false,
      });
      await flush();
      assert.equal(successCalls.length, 1);
      assert.deepEqual(successCalls[0], { id: 'fr_valid_b', context: { ownsForm: true } });
      assert.equal(alertCalls.length, 1);
      alertCalls.length = 0;

      // Test stale clientA rejection + preserveDraftOnClose=true hidden client swap.
      act(() => {
        renderer.update(renderTree(clientA, true, false));
      });
      await flush();
      act(() => {
        void findSheetSubmitButton(renderer).props.onPress();
      });
      await flush(2);

      act(() => {
        renderer.update(renderTree(clientB, true, false));
      });
      await flush();
      act(() => {
        renderer.root.findAllByType('TextInput' as any)[0].props.onChangeText('Preserved B FR');
      });

      rejectA.reject(new Error('clientA FR explosion'));
      await flush();
      assert.equal(
        collectText(renderer).some((t) => t.includes(enStrings.featureRequestCompose.submitFailed)),
        false,
        'clientA error must not render on clientB'
      );

      // Close while preserving draft on clientB, swap to clientA while hidden, reopen: draft must reset.
      act(() => {
        renderer.update(renderTree(clientB, false, false, true));
      });
      await flush();
      act(() => {
        renderer.update(renderTree(clientA, false, false, true));
      });
      await flush();
      act(() => {
        renderer.update(renderTree(clientA, true, false, true));
      });
      await flush();
      assert.equal(renderer.root.findAllByType('TextInput' as any)[0].props.value, 'Default FR');

      // A -> B -> A swap while submit is in flight on clientA: stale settlement must not wipe post-ABA draft or alert.
      const submitA_ABA = defer<FeatureRequestSubmissionResult>();
      clientA.submitFeatureRequest = (async () => submitA_ABA.promise) as any;
      act(() => {
        void findSheetSubmitButton(renderer).props.onPress();
      });
      await flush(2);
      act(() => {
        renderer.update(renderTree(clientB, true, false, true));
      });
      await flush();
      act(() => {
        renderer.update(renderTree(clientA, true, false, true));
      });
      await flush();
      act(() => {
        renderer.root.findAllByType('TextInput' as any)[0].props.onChangeText('Post ABA FR Draft');
      });
      await flush();
      submitA_ABA.resolve({
        featureRequestId: 'fr_aba_stale',
        pending: false,
      });
      await flush();
      assert.equal(
        renderer.root.findAllByType('TextInput' as any)[0].props.value,
        'Post ABA FR Draft'
      );
      assert.equal(alertCalls.length, 0);
      assert.equal(closeCalls, 0);

      // Immediate swap before resolveEffectiveUserToken finishes must not dispatch clientA.submitFeatureRequest.
      let immediateDispatches = 0;
      clientA.submitFeatureRequest = (async () => {
        immediateDispatches += 1;
        return submitA_ABA.promise;
      }) as any;
      act(() => {
        void findSheetSubmitButton(renderer).props.onPress();
        renderer.update(renderTree(clientB, true, false, true));
      });
      await flush();
      assert.equal(immediateDispatches, 0);
    } finally {
      renderer.unmount();
    }
  }
);

test(
  'FeedbackComposer & FeatureRequestComposeSheet: unmounting while submit is in flight suppresses Alert, onClose, and onSubmitSuccess',
  renderTestOptions,
  async () => {
    alertCalls.length = 0;
    const client = makeClient('app_unmount_submit');
    const feedbackSubmit = defer<FeedbackSubmissionResult>();
    const frSubmit = defer<FeatureRequestSubmissionResult>();

    client.submit = (async () => feedbackSubmit.promise) as any;
    client.submitFeatureRequest = (async () => frSubmit.promise) as any;

    let closeCalls = 0;
    let successCalls = 0;

    let feedbackRenderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      feedbackRenderer = TestRenderer.create(
        React.createElement(CupThreadProvider, {
          client,
          userToken: 'usr_unmount',
          children: React.createElement(FeedbackComposer, {
            visible: true,
            isModal: false,
            initialDraft: { title: 'Unmount bug', description: 'Unmounting before settle' },
            onClose: () => {
              closeCalls += 1;
            },
          }),
        })
      );
    });
    await flush();

    act(() => {
      void findFeedbackSubmitButton(feedbackRenderer).props.onPress();
    });
    await flush(2);
    feedbackRenderer.unmount();
    feedbackSubmit.resolve({ submissionId: 'sub_unmount', forwardedToGithub: false });
    await flush();

    let sheetRenderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      sheetRenderer = TestRenderer.create(
        React.createElement(CupThreadProvider, {
          client,
          userToken: 'usr_unmount',
          children: React.createElement(FeatureRequestComposeSheet, {
            visible: true,
            isModal: false,
            initialDraft: { title: 'Unmount FR', description: 'Unmounting before settle' },
            onClose: () => {
              closeCalls += 1;
            },
            onSubmitSuccess: () => {
              successCalls += 1;
            },
          }),
        })
      );
    });
    await flush();

    act(() => {
      void findSheetSubmitButton(sheetRenderer).props.onPress();
    });
    await flush(2);
    sheetRenderer.unmount();
    frSubmit.resolve({
      featureRequestId: 'fr_unmount',
      pending: false,
    });
    await flush();

    assert.equal(alertCalls.length, 0, 'unmounted composers must not fire Alert.alert');
    assert.equal(closeCalls, 0, 'unmounted composers must not fire onClose');
    assert.equal(successCalls, 0, 'unmounted composers must not fire onSubmitSuccess');
  }
);
