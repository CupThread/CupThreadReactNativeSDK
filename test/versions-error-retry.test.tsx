import test, { type TestOptions } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { FeedbackClient } from '../src/client/FeedbackClient';
import type { AppVersion, FeatureRequestItem } from '../src/types';

const supportsModuleMocks = typeof (test as any).mock?.module === 'function';

const touchableOpacityProps: any[] = [];
const TouchableOpacityStub = (props: any) => {
  touchableOpacityProps.push(props);
  return props.children ?? null;
};

if (supportsModuleMocks) {
  (test as any).mock.module('react-native', {
    namedExports: {
      useColorScheme: () => 'light',
      View: ({ children }: any) => children ?? null,
      Text: ({ children }: any) => children ?? null,
      TextInput: () => null,
      Image: () => null,
      Pressable: ({ children }: any) => children ?? null,
      TouchableOpacity: TouchableOpacityStub,
      ActivityIndicator: () => null,
      ScrollView: ({ children }: any) => children ?? null,
      FlatList: ({ data, renderItem, ListFooterComponent, refreshControl }: any) => {
        return (
          <>
            {refreshControl ?? null}
            {Array.isArray(data) && renderItem
              ? data.map((item: any, idx: number) => (
                  <React.Fragment key={item?.id ?? idx}>
                    {renderItem({ item, index: idx })}
                  </React.Fragment>
                ))
              : null}
            {ListFooterComponent ?? null}
          </>
        );
      },
      RefreshControl: (props: any) => props.children ?? null,
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
    description: 'Description for request',
    voteCount: 3,
    hasVoted: false,
    isOwnRequest: false,
    approved: true,
    status: 'open',
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
  };
}

test(
  'FeatureRequestsScreen surfaces compact ErrorState when fetchVersions fails, keeping request list functional',
  renderTestOptions,
  async () => {
    let fetchVersionsCalls = 0;
    let shouldFailVersions = true;

    const mockClient = {
      config: { appKey: 'app_test_versions' },
      fetchConfig: async () => ({}),
      fetchVersions: async (_opts?: any) => {
        fetchVersionsCalls++;
        if (shouldFailVersions) {
          throw new Error('500 Internal Server Error');
        }
        return [makeMockVersion('v1', '1.0.0'), makeMockVersion('v2', '2.0.0')];
      },
      fetchFeatureRequests: async (_opts?: any) => {
        return {
          requests: [makeMockItem('fr_1', 'Dark mode support')],
          total: 1,
        };
      },
    } as unknown as FeedbackClient;

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <CupThreadProvider client={mockClient} userToken="user_test_token">
          <FeatureRequestsScreen />
        </CupThreadProvider>
      );
    });
    await flush();

    try {
      assert.equal(fetchVersionsCalls, 1, 'fetchVersions should be called once on mount');

      // ErrorState should be present in the version filter area
      const errorStates = renderer.root.findAllByType(ErrorState);
      assert.equal(errorStates.length, 1, 'compact ErrorState must be rendered for versions error');
      assert.equal(errorStates[0].props.compact, true, 'ErrorState must use compact variant');
      assert.equal(
        errorStates[0].props.message,
        enStrings.common.error,
        'ErrorState should display common.error message'
      );
      assert.equal(
        errorStates[0].props.retryLabel,
        enStrings.common.retry,
        'ErrorState should display common.retry label'
      );

      // Now tap retry after the error condition resolves
      shouldFailVersions = false;
      await act(async () => {
        await errorStates[0].props.onRetry();
      });
      await flush();

      assert.equal(fetchVersionsCalls, 2, 'fetchVersions must be re-invoked on retry');

      // ErrorState should be removed and chips should be rendered
      const errorStatesAfterRetry = renderer.root.findAllByType(ErrorState);
      assert.equal(
        errorStatesAfterRetry.length,
        0,
        'ErrorState must disappear once versions succeed'
      );
    } finally {
      renderer.unmount();
    }
  }
);

test(
  'FeatureRequestsScreen empty versions array ([]) renders neither chips nor error',
  renderTestOptions,
  async () => {
    const mockClient = {
      config: { appKey: 'app_test_versions' },
      fetchConfig: async () => ({}),
      fetchVersions: async () => [],
      fetchFeatureRequests: async () => ({
        requests: [makeMockItem('fr_1', 'Item')],
        total: 1,
      }),
    } as unknown as FeedbackClient;

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <CupThreadProvider client={mockClient} userToken="user_test_token">
          <FeatureRequestsScreen />
        </CupThreadProvider>
      );
    });
    await flush();

    try {
      const errorStates = renderer.root.findAllByType(ErrorState);
      assert.equal(errorStates.length, 0, 'No error state should be shown for empty versions');
    } finally {
      renderer.unmount();
    }
  }
);

test(
  'FeatureRequestsScreen abort on unmount stays silent without leaking error',
  renderTestOptions,
  async () => {
    let aborted = false;
    const mockClient = {
      config: { appKey: 'app_test_versions' },
      fetchConfig: async () => ({}),
      fetchVersions: ({ signal }: any = {}) => {
        return new Promise((resolve, reject) => {
          signal?.addEventListener('abort', () => {
            aborted = true;
            const err = new Error('AbortError');
            err.name = 'AbortError';
            reject(err);
          });
        });
      },
      fetchFeatureRequests: async () => ({ requests: [], total: 0 }),
    } as unknown as FeedbackClient;

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <CupThreadProvider client={mockClient} userToken="user_test_token">
          <FeatureRequestsScreen />
        </CupThreadProvider>
      );
    });

    // Unmount while fetchVersions is pending
    await act(async () => {
      renderer.unmount();
    });
    await flush();

    assert.equal(aborted, true, 'signal must receive abort on unmount');
  }
);

test(
  'FeatureRequestsScreen pull-to-refresh retries versions fetch when versionsError is present',
  renderTestOptions,
  async () => {
    let versionsCallCount = 0;
    let requestsCallCount = 0;

    const mockClient = {
      config: { appKey: 'app_test_versions' },
      fetchConfig: async () => ({}),
      fetchVersions: async () => {
        versionsCallCount++;
        throw new Error('503 Service Unavailable');
      },
      fetchFeatureRequests: async () => {
        requestsCallCount++;
        return { requests: [makeMockItem('fr_1', 'Item')], total: 1 };
      },
    } as unknown as FeedbackClient;

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <CupThreadProvider client={mockClient} userToken="user_test_token">
          <FeatureRequestsScreen />
        </CupThreadProvider>
      );
    });
    await flush();
    await waitDebounce();

    try {
      assert.equal(versionsCallCount, 1);
      assert.equal(requestsCallCount, 1);

      // Find the RefreshControl and invoke onRefresh
      const { RefreshControl } = await import('react-native');
      const refreshControl = renderer.root.findByType(RefreshControl as any);
      assert.ok(refreshControl, 'RefreshControl should exist');

      await act(async () => {
        await refreshControl.props.onRefresh();
      });
      await flush();

      assert.equal(versionsCallCount, 2, 'pull-to-refresh must retry versions when in error');
      assert.equal(requestsCallCount, 2, 'pull-to-refresh must refresh request list');
    } finally {
      renderer.unmount();
    }
  }
);

test(
  'FeatureRequestsScreen empty-list error retry reloads both requests and versions',
  renderTestOptions,
  async () => {
    let versionsCalls = 0;
    let requestsCalls = 0;

    const mockClient = {
      config: { appKey: 'app_test_versions' },
      fetchConfig: async () => ({}),
      fetchVersions: async () => {
        versionsCalls++;
        throw new Error('500 Server Error');
      },
      fetchFeatureRequests: async () => {
        requestsCalls++;
        throw new Error('500 Server Error');
      },
    } as unknown as FeedbackClient;

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <CupThreadProvider client={mockClient} userToken="user_test_token">
          <FeatureRequestsScreen />
        </CupThreadProvider>
      );
    });
    await flush();
    await waitDebounce();

    try {
      assert.equal(versionsCalls, 1);
      assert.equal(requestsCalls, 1);

      // There should be two ErrorStates: one compact for versions, one full-page for list
      const errorStates = renderer.root.findAllByType(ErrorState);
      assert.equal(
        errorStates.length,
        2,
        'Both versions and list errors should display ErrorState'
      );

      const mainListErrorState = errorStates.find((es) => !es.props.compact);
      assert.ok(mainListErrorState, 'Full-screen ErrorState for list must be present');

      await act(async () => {
        await mainListErrorState.props.onRetry();
      });
      await flush();

      assert.equal(versionsCalls, 2, 'Main list retry should also retry failed versions');
      assert.equal(requestsCalls, 2, 'Main list retry should retry failed requests');
    } finally {
      renderer.unmount();
    }
  }
);
