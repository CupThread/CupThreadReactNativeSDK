import test, { type TestOptions } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { FeedbackClient } from '../src/client/FeedbackClient';
import { UploadRejectedException } from '../src/client/FeedbackException';
import type { PublicAppConfig } from '../src/types';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const supportsModuleMocks = typeof (test as any).mock?.module === 'function';

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
      Alert: { alert: () => {} },
      Platform: { OS: 'ios' },
    },
  });
}

const { CupThreadProvider } = await import('../src/theme/CupThreadThemeProvider');
const { FeedbackComposer } = await import('../src/components/FeedbackComposer');
const { enStrings } = await import('../src/i18n/en');

const renderTestOptions: TestOptions = supportsModuleMocks
  ? {}
  : {
      skip: 'node:test module mocking unavailable (needs Node >= 22.3 with --experimental-test-module-mocks)',
    };

async function flush(times = 10): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2));
    await act(async () => {});
  }
}

function makeAppConfig(): PublicAppConfig {
  return {
    appId: 'app_test',
    appKey: 'app_test_upload_chunking',
    workspaceSlug: 'test-workspace',
    slug: 'test-app',
    name: 'Test App',
    iconUrl: null,
    allowPublic: true,
    hideSiteBranding: false,
    allowedPlatforms: ['ios', 'android'],
    maxAttachmentBytes: 1024 * 1024,
    allowAnonymousRoadmap: true,
    allowAnonymousVote: true,
    allowAnonymousFeedback: true,
    allowAnonymousChangelog: true,
    requireAnonymousVoteTurnstile: false,
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
}

function nodeText(node: any): string {
  const children = node.props?.children;
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) {
    return children.filter((child: unknown) => typeof child === 'string').join('');
  }
  return '';
}

function findButtonByText(renderer: TestRenderer.ReactTestRenderer, label: string) {
  return renderer.root.findAll(
    (node) =>
      (node.type as any) === 'TouchableOpacity' &&
      typeof node.props?.onPress === 'function' &&
      node.findAll((child) => (child.type as any) === 'Text' && nodeText(child).includes(label))
        .length > 0
  )[0];
}

function collectText(renderer: TestRenderer.ReactTestRenderer): string[] {
  return renderer.root
    .findAll((node) => (node.type as any) === 'Text')
    .map((node) => nodeText(node))
    .filter((text) => text.length > 0);
}

function makePick(filenames: string[]) {
  return filenames.map((filename) => ({
    file: { uri: `file:///tmp/${filename}` },
    filename,
    mimeType: 'image/png',
    size: 100,
  }));
}

test(
  'FeedbackComposer uploads a 10-file pick as two sessions (8 + 2) without losing any file',
  renderTestOptions,
  async () => {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_test_upload_chunking',
    });
    client.fetchAppConfig = async () => makeAppConfig();

    const batchCalls: number[] = [];
    client.uploadAttachments = (async (batch: any[]) => {
      batchCalls.push(batch.length);
      return batch.map((option: any, index: number) => ({
        kind: 'image',
        key: `upload-key-${batchCalls.length}-${index}`,
        filename: option.filename,
        mimeType: option.mimeType,
      }));
    }) as any;
    client.uploadAttachment = (async () => {
      throw new Error('a chunked pick must never reach the single-item seam');
    }) as any;

    const filenames = Array.from({ length: 10 }, (_, index) => `shot-${index}.png`);
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <CupThreadProvider client={client} userToken="usr_test">
          <FeedbackComposer onPickAttachment={async () => makePick(filenames)} />
        </CupThreadProvider>
      );
    });
    await flush();

    await act(async () => {
      await findButtonByText(renderer, enStrings.feedbackComposer.addAttachment).props.onPress();
    });
    await flush();

    assert.deepEqual(
      batchCalls,
      [8, 2],
      'the pick is split into one 8-file and one 2-file session'
    );
    const text = collectText(renderer);
    for (const filename of filenames) {
      assert.ok(
        text.some((line) => line.includes(filename)),
        `expected the committed attachment ${filename} to render`
      );
    }
    assert.ok(
      text.every((line) => !line.includes('failed')),
      `no failure notice is shown, got: ${JSON.stringify(text)}`
    );
  }
);

test(
  'FeedbackComposer keeps the valid siblings when the session rejects one file of the pick',
  renderTestOptions,
  async () => {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_test_upload_chunking',
    });
    client.fetchAppConfig = async () => makeAppConfig();

    const sessionRejection = new UploadRejectedException(
      400,
      'executable_extension_prohibited',
      JSON.stringify({ error: 'bad type', code: 'executable_extension_prohibited' })
    );
    client.uploadAttachments = (async () => {
      throw sessionRejection;
    }) as any;
    client.uploadAttachment = (async (option: any) => {
      if (option.filename === 'malware.exe') {
        throw sessionRejection;
      }
      return {
        kind: 'image',
        key: `upload-key-${option.filename}`,
        filename: option.filename,
        mimeType: option.mimeType,
      };
    }) as any;

    const filenames = ['shot-1.png', 'shot-2.png', 'malware.exe', 'shot-3.png', 'shot-4.png'];
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <CupThreadProvider client={client} userToken="usr_test">
          <FeedbackComposer onPickAttachment={async () => makePick(filenames)} />
        </CupThreadProvider>
      );
    });
    await flush();

    await act(async () => {
      await findButtonByText(renderer, enStrings.feedbackComposer.addAttachment).props.onPress();
    });
    await flush();

    const text = collectText(renderer);
    const committed = filenames.filter((filename) => filename !== 'malware.exe');
    for (const filename of committed) {
      assert.ok(
        text.some((line) => line.includes(filename)),
        `expected the valid sibling ${filename} to survive the poisoned pick`
      );
    }
    assert.ok(
      text.every((line) => !line.includes('malware.exe')),
      'the rejected file must not be committed'
    );
    assert.ok(
      text.includes(enStrings.feedbackComposer.uploadUnsupportedType),
      `expected the actionable unsupported-type notice, got: ${JSON.stringify(text)}`
    );
    assert.ok(
      text.every((line) => !line.includes(enStrings.feedbackComposer.someUploadsFailed(4))),
      'the aggregate count notice must not blame every file'
    );
  }
);
