import test, { type TestOptions } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { FeedbackClient } from '../src/client/FeedbackClient';
import type { FeedbackDraft, FeedbackSubmissionResult } from '../src/types';

// `FeedbackComposer` imports react-native, which cannot load under plain
// Node. Mock every symbol its render tree uses with lightweight stubs, then
// dynamically import the real modules so the mock is in place before
// evaluation. Module mocking needs Node >= 22.3 with
// --experimental-test-module-mocks; without it the render-level tests below
// are skipped.
const supportsModuleMocks = typeof (test as any).mock?.module === 'function';

const TouchableOpacityStub = (props: any) => props.children ?? null;
const TextInputStub = (props: any) => React.createElement('TextInput', props, null);

if (supportsModuleMocks) {
  (test as any).mock.module('react-native', {
    namedExports: {
      useColorScheme: () => 'light',
      // Layout stubs must pass children through so nested pressables stay in
      // the rendered tree.
      View: ({ children }: any) => children ?? null,
      // Text must stay a real element so tests can findAllByType('Text').
      Text: (props: any) => React.createElement('Text', props, props.children ?? null),
      TextInput: TextInputStub,
      TouchableOpacity: TouchableOpacityStub,
      ActivityIndicator: () => null,
      ScrollView: ({ children }: any) => children ?? null,
      Modal: ({ children }: any) => children ?? null,
      SafeAreaView: ({ children }: any) => children ?? null,
      Alert: { alert: () => {} },
      StyleSheet: { create: (styles: any) => styles, flatten: (s: any) => s },
    },
  });
}

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Guard the component imports with the mock-capability check: importing the
// real modules pulls in react-native, which cannot load under plain Node, so
// without the guard an unsupported Node would crash the file instead of
// skipping the render-level tests.
const { CupThreadProvider } = supportsModuleMocks
  ? await import('../src/theme/CupThreadThemeProvider')
  : ({} as any);
const { FeedbackComposer } = supportsModuleMocks
  ? await import('../src/components/FeedbackComposer')
  : ({} as any);

const renderTestOptions: TestOptions = supportsModuleMocks
  ? {}
  : {
      skip: 'node:test module mocking unavailable (needs Node >= 22.3 with --experimental-test-module-mocks)',
    };

/** The localized message the composer must show for a malformed address. */
const INVALID_EMAIL_MESSAGE = 'Please enter a valid email address.';

async function flush(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2));
    await act(async () => {});
  }
}

interface EmailHarness {
  renderer: TestRenderer.ReactTestRenderer;
  submitCalls: FeedbackDraft[];
  getEmailInput: () => TestRenderer.ReactTestInstance;
  getSubmitButton: () => TestRenderer.ReactTestInstance;
  renderedStrings: () => string[];
}

async function createHarness(): Promise<EmailHarness> {
  const client = new FeedbackClient({
    baseUrl: 'https://api.cupthread.com',
    appKey: 'app_test_reporter_email',
  });
  const submitCalls: FeedbackDraft[] = [];
  client.submit = (async (draft: FeedbackDraft) => {
    submitCalls.push(draft);
    return { submissionId: 'sub_email', forwardedToGithub: false } as FeedbackSubmissionResult;
  }) as any;

  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(CupThreadProvider, {
        client,
        userToken: 'usr_reporter_email',
        children: React.createElement(FeedbackComposer, {
          visible: true,
          isModal: false,
          initialDraft: {
            title: 'Reply loop broken',
            description: 'A malformed contact address must not submit.',
          },
        }),
      })
    );
  });
  await flush();

  // The email input is the only one with the email keyboard; the submit
  // button is identified by its style, same as in the composer race tests.
  const getEmailInput = () =>
    renderer.root
      .findAllByType(TextInputStub as any)
      .find((input) => input.props.keyboardType === 'email-address')!;
  const getSubmitButton = () =>
    renderer.root.findAllByType(TouchableOpacityStub as any).find((btn) => {
      const style = Array.isArray(btn.props.style) ? btn.props.style : [btn.props.style];
      return style.some((s: any) => s && s.marginTop === 22);
    })!;
  const renderedStrings = () =>
    renderer.root
      .findAllByType('Text' as any)
      .map((node) =>
        Array.isArray(node.props.children) ? node.props.children.join('') : node.props.children
      )
      .filter((value): value is string => typeof value === 'string');

  return { renderer, submitCalls, getEmailInput, getSubmitButton, renderedStrings };
}

test(
  'a malformed non-empty reporter email blocks the submit, shows the localized error, and keeps the draft',
  renderTestOptions,
  async () => {
    for (const malformed of [
      'john@gmail',
      'jane@@example.com',
      'a b@c.com',
      'jane@example.com,',
      'john@example..com',
    ]) {
      const harness = await createHarness();
      try {
        await act(async () => {
          harness.getEmailInput().props.onChangeText(malformed);
        });
        await act(async () => {
          harness.getSubmitButton().props.onPress();
        });
        await flush();

        assert.equal(
          harness.submitCalls.length,
          0,
          `"${malformed}" must never reach POST /api/v1/feedback`
        );
        assert.ok(
          harness.renderedStrings().some((text) => text.includes(INVALID_EMAIL_MESSAGE)),
          `"${malformed}" must surface the localized invalidEmail message`
        );
        assert.equal(
          harness.getEmailInput().props.value,
          malformed,
          'the malformed address must stay in the field so the user can fix it'
        );
      } finally {
        harness.renderer.unmount();
      }
    }
  }
);

test(
  'an empty reporter email still submits (the field is optional)',
  renderTestOptions,
  async () => {
    const harness = await createHarness();
    try {
      await act(async () => {
        harness.getSubmitButton().props.onPress();
      });
      await flush();

      assert.equal(harness.submitCalls.length, 1, 'an empty optional email must submit');
      assert.equal(
        harness.submitCalls[0].reporterEmail,
        undefined,
        'an empty email must be sent as absent, not as an empty string'
      );
    } finally {
      harness.renderer.unmount();
    }
  }
);

test('a well-formed reporter email submits exactly as before', renderTestOptions, async () => {
  const harness = await createHarness();
  try {
    await act(async () => {
      harness.getEmailInput().props.onChangeText('jane.doe@example.co.uk');
    });
    await act(async () => {
      harness.getSubmitButton().props.onPress();
    });
    await flush();

    assert.equal(harness.submitCalls.length, 1, 'a valid email must submit');
    assert.equal(
      harness.submitCalls[0].reporterEmail,
      'jane.doe@example.co.uk',
      'the trimmed, valid address must reach the wire verbatim'
    );
    assert.ok(
      !harness.renderedStrings().some((text) => text.includes(INVALID_EMAIL_MESSAGE)),
      'no validation error may render for a valid address'
    );
  } finally {
    harness.renderer.unmount();
  }
});
