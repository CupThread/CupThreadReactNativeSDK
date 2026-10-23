import test, { type TestOptions } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { FeedbackClient } from '../src/client/FeedbackClient';
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
const { formatFileSize } = await import('../src/utils/formatters');

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

function makeAppConfig(maxAttachmentBytes: number): PublicAppConfig {
  return {
    appId: 'app_test',
    appKey: 'app_test_attachment_size',
    slug: 'test-app',
    name: 'Test App',
    iconUrl: null,
    allowPublic: true,
    allowedPlatforms: ['ios', 'android'],
    maxAttachmentBytes,
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
}

function nodeText(node: any): string {
  const children = node.props?.children;
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) {
    return children.filter((child: unknown) => typeof child === 'string').join('');
  }
  return '';
}

function findAddAttachmentButton(renderer: TestRenderer.ReactTestRenderer) {
  const label = enStrings.feedbackComposer.addAttachment;
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

test(
  'FeedbackComposer rejects an oversized pick before any upload or network call',
  renderTestOptions,
  async () => {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_test_attachment_size',
    });
    const config = makeAppConfig(10);
    client.fetchAppConfig = async () => config;

    let uploadCalls = 0;
    let batchCalls = 0;
    client.uploadAttachment = (async () => {
      uploadCalls += 1;
      throw new Error('oversized picks must never upload');
    }) as any;
    client.uploadAttachments = (async () => {
      batchCalls += 1;
      throw new Error('oversized picks must never upload');
    }) as any;

    const originalFetch = globalThis.fetch;
    let networkCalls = 0;
    globalThis.fetch = (async () => {
      networkCalls += 1;
      return new Response('{}', { status: 200 });
    }) as any;

    let pickCalls = 0;
    let renderer!: TestRenderer.ReactTestRenderer;
    try {
      await act(async () => {
        renderer = TestRenderer.create(
          <CupThreadProvider client={client} userToken="usr_test">
            <FeedbackComposer
              onPickAttachment={async () => {
                pickCalls += 1;
                return {
                  file: { uri: 'file:///tmp/huge.png' },
                  filename: 'huge.png',
                  mimeType: 'image/png',
                  size: 100,
                };
              }}
            />
          </CupThreadProvider>
        );
      });
      await flush();

      const addButton = findAddAttachmentButton(renderer);
      assert.ok(addButton, 'expected an add-attachment button');

      await act(async () => {
        await addButton.props.onPress();
      });
      await flush();

      const expected = enStrings.feedbackComposer.attachmentTooLarge(formatFileSize(10));
      assert.ok(
        collectText(renderer).includes(expected),
        `expected the localized limit message, got: ${JSON.stringify(collectText(renderer))}`
      );
      assert.equal(pickCalls, 1);
      assert.equal(uploadCalls, 0, 'no single-item upload for an oversized pick');
      assert.equal(batchCalls, 0, 'no upload session for an oversized pick');
      assert.equal(networkCalls, 0, 'no network traffic for an oversized pick');
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
);

test(
  'FeedbackComposer uploads a pick within appConfig.maxAttachmentBytes',
  renderTestOptions,
  async () => {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_test_attachment_size',
    });
    const config = makeAppConfig(1024);
    client.fetchAppConfig = async () => config;

    const uploadedSizes: Array<number | undefined> = [];
    client.uploadAttachments = (async (batch: any[]) => {
      uploadedSizes.push(batch[0]?.size);
      return [
        {
          kind: 'image',
          key: 'upload-key',
          filename: 'small.png',
          mimeType: 'image/png',
        },
      ];
    }) as any;

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <CupThreadProvider client={client} userToken="usr_test">
          <FeedbackComposer
            onPickAttachment={async () => ({
              file: { uri: 'file:///tmp/small.png' },
              filename: 'small.png',
              mimeType: 'image/png',
              size: 100,
            })}
          />
        </CupThreadProvider>
      );
    });
    await flush();

    const addButton = findAddAttachmentButton(renderer);
    assert.ok(addButton, 'expected an add-attachment button');

    await act(async () => {
      await addButton.props.onPress();
    });
    await flush();

    assert.deepEqual(uploadedSizes, [100], 'the accepted pick reaches the upload seam');
    assert.ok(
      collectText(renderer).every((text) => !text.includes('too large')),
      'no size warning is shown for an accepted pick'
    );
  }
);
