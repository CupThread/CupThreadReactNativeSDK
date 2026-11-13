import test, { type TestOptions } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { FeedbackClient } from '../src/client/FeedbackClient';
import type { AppVersion, FeatureRequestItem } from '../src/types';

const supportsModuleMocks = typeof (test as any).mock?.module === 'function';

if (supportsModuleMocks) {
  (test as any).mock.module('react-native', {
    namedExports: {
      useColorScheme: () => 'light',
      View: ({ children }: any) => children ?? null,
      Text: ({ children }: any) => children ?? null,
      TextInput: () => null,
      Image: () => null,
      Pressable: ({ children }: any) => children ?? null,
      TouchableOpacity: (props: any) => props.children ?? null,
      ActivityIndicator: () => null,
      ScrollView: ({ children }: any) => children ?? null,
      FlatList: ({ data, renderItem }: any) =>
        Array.isArray(data) && renderItem
          ? data.map((item: any, idx: number) => (
              <React.Fragment key={item?.id ?? idx}>
                {renderItem({ item, index: idx })}
              </React.Fragment>
            ))
          : null,
      RefreshControl: () => null,
      Modal: ({ children }: any) => children ?? null,
      SafeAreaView: ({ children }: any) => children ?? null,
      StyleSheet: { create: (styles: any) => styles, flatten: (s: any) => s },
      Alert: { alert: () => {} },
      Linking: { openURL: async () => true, canOpenURL: async () => true },
      Platform: { OS: 'ios', select: (obj: any) => obj.ios ?? obj.default },
    },
  });
}

const { CupThreadProvider } = await import('../src/theme/CupThreadThemeProvider');
const { FeatureRequestsScreen } = await import('../src/components/FeatureRequestsScreen');
const { ErrorState } = await import('../src/components/ErrorState');
const { enStrings } = await import('../src/i18n');

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const renderTestOptions: TestOptions = supportsModuleMocks
  ? {}
  : {
      skip: 'node:test module mocking unavailable (needs Node >= 22.3 with --experimental-test-module-mocks)',
    };

async function flush(times = 10): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    await act(async () => {});
  }
}

async function waitDebounce(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 300));
  await act(async () => {});
}

function makeMockVersion(id: string, label: string): AppVersion {
  return {
    id,
    appId: 'app_test',
    label,
    released: true,
    position: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

function makeMockItem(id: string, title: string): FeatureRequestItem {
  return {
    id,
    appId: 'app_test',
    title,
    description: 'Description',
    voteCount: 1,
    hasVoted: false,
    isOwnRequest: false,
    approved: true,
    status: 'open',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
  };
}

function findPressableWithLabel(root: TestRenderer.ReactTestRenderer['root'], label: string) {
  return root
    .findAll((node) => node.props?.accessibilityRole === 'button')
    .find((node) => node.findAllByProps({ children: label }).length > 0);
}

class ReconcileVersionsClient extends FeedbackClient {
  versions: AppVersion[];
  failFetch = false;
  requestVersionIds: Array<string | undefined | null> = [];

  constructor(versions: AppVersion[]) {
    super({ baseUrl: 'https://api.cupthread.com', appKey: 'app_test_versions' });
    this.versions = versions;
  }

  override async fetchVersions() {
    if (this.failFetch) throw new Error('network');
    return this.versions;
  }

  override async fetchFeatureRequests(opts?: { versionId?: string | null }) {
    this.requestVersionIds.push(opts?.versionId ?? null);
    return { requests: [makeMockItem('fr_1', 'Item')], total: 1 };
  }
}

test(
  'FeatureRequestsScreen clears a stale version filter when the version list no longer contains it (#446)',
  renderTestOptions,
  async () => {
    const clientA = new ReconcileVersionsClient([makeMockVersion('v1', '1.0.0')]);
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <CupThreadProvider client={clientA} userToken="usr_test">
          <FeatureRequestsScreen />
        </CupThreadProvider>
      );
    });
    await flush();
    await waitDebounce();

    const v1Chip = findPressableWithLabel(renderer.root, '1.0.0');
    assert.ok(v1Chip);
    await act(async () => {
      v1Chip!.props.onPress();
    });
    await flush();
    await waitDebounce();
    assert.equal(clientA.requestVersionIds.at(-1), 'v1');

    const clientB = new ReconcileVersionsClient([makeMockVersion('v2', '2.0.0')]);
    clientB.requestVersionIds = clientA.requestVersionIds;
    await act(async () => {
      renderer.update(
        <CupThreadProvider client={clientB} userToken="usr_test">
          <FeatureRequestsScreen />
        </CupThreadProvider>
      );
    });
    await flush();
    await waitDebounce();

    try {
      assert.equal(clientB.requestVersionIds.at(-1), null);
      assert.ok(findPressableWithLabel(renderer.root, enStrings.featureRequests.allVersions));
    } finally {
      renderer.unmount();
    }
  }
);

test(
  'FeatureRequestsScreen keeps version chips visible when versions refetch fails (#446)',
  renderTestOptions,
  async () => {
    const initialClient = new ReconcileVersionsClient([makeMockVersion('v1', '1.0.0')]);
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <CupThreadProvider client={initialClient} userToken="usr_test">
          <FeatureRequestsScreen />
        </CupThreadProvider>
      );
    });
    await flush();

    const failingClient = new ReconcileVersionsClient([makeMockVersion('v1', '1.0.0')]);
    failingClient.failFetch = true;
    await act(async () => {
      renderer.update(
        <CupThreadProvider client={failingClient} userToken="usr_test">
          <FeatureRequestsScreen />
        </CupThreadProvider>
      );
    });
    await flush();

    const compactErrors = renderer.root
      .findAllByType(ErrorState)
      .filter((node) => node.props.compact);
    assert.equal(compactErrors.length, 1);
    assert.ok(findPressableWithLabel(renderer.root, '1.0.0'), 'chip row should stay visible');
    renderer.unmount();
  }
);
