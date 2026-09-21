import test, { type TestOptions } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { FeedbackClient } from '../src/client/FeedbackClient';
import type { FeatureRequestItem } from '../src/types';

const supportsModuleMocks = typeof (test as any).mock?.module === 'function';

const ActivityIndicatorStub = (props: any) => React.createElement('ActivityIndicator', props);
const TextInputStub = (props: any) => React.createElement('TextInput', props);
const FlatListStub = ({ data, renderItem, ListFooterComponent, ...props }: any) =>
  React.createElement(
    'FlatList',
    { ...props, itemCount: data?.length },
    data?.map((item: any, i: number) =>
      React.createElement(
        'ItemWrapper',
        { key: item.id || i },
        renderItem ? renderItem({ item, index: i }) : null
      )
    ),
    ListFooterComponent ? React.createElement('Footer', null, ListFooterComponent) : null
  );

if (supportsModuleMocks) {
  (test as any).mock.module('react-native', {
    namedExports: {
      useColorScheme: () => 'light',
      View: ({ children, testID, ...props }: any) =>
        React.createElement('View', { testID, ...props }, children),
      Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
      TextInput: TextInputStub,
      Image: (props: any) => React.createElement('Image', props),
      TouchableOpacity: ({ children, ...props }: any) =>
        React.createElement('TouchableOpacity', props, children),
      ActivityIndicator: ActivityIndicatorStub,
      FlatList: FlatListStub,
      RefreshControl: (props: any) => React.createElement('RefreshControl', props),
      ScrollView: ({ children }: any) => React.createElement('ScrollView', null, children),
      Modal: ({ children }: any) => React.createElement('Modal', null, children),
      SafeAreaView: ({ children, ...props }: any) =>
        React.createElement('SafeAreaView', props, children),
      StyleSheet: { create: (s: any) => s, flatten: (s: any) => s },
      Linking: { openURL: () => Promise.resolve(), canOpenURL: () => Promise.resolve(true) },
      Alert: { alert: () => {} },
    },
  });
}

const { CupThreadProvider } = await import('../src/theme/CupThreadThemeProvider');
const { FeatureRequestsScreen } = await import('../src/components/FeatureRequestsScreen');

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const renderTestOptions: TestOptions = supportsModuleMocks
  ? {}
  : {
      skip: 'node:test module mocking unavailable (needs Node >= 22.3 with --experimental-test-module-mocks)',
    };

async function flush(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 4));
    await act(async () => {});
  }
}

function makeMockItem(id: string, overrides?: Partial<FeatureRequestItem>): FeatureRequestItem {
  return {
    id,
    appId: 'app_test',
    title: `Feature ${id}`,
    description: `Description ${id}`,
    voteCount: 5,
    hasVoted: false,
    isOwnRequest: false,
    status: 'planned',
    columnId: 'col_1',
    columnName: 'Planned',
    columnColor: '#3b82f6',
    approved: true,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
    ...overrides,
  };
}

test(
  'FeatureRequestsScreen: renders full-screen ActivityIndicator when isLoading is true and items are empty',
  renderTestOptions,
  async () => {
    let releaseFetch!: (value: any) => void;
    const fetchPromise = new Promise((resolve) => {
      releaseFetch = resolve;
    });

    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_test',
    });

    client.fetchFeatureRequests = (() => fetchPromise) as any;
    client.fetchVersions = (async () => []) as any;

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <CupThreadProvider client={client} userToken="tok">
          <FeatureRequestsScreen />
        </CupThreadProvider>
      );
    });

    // Wait for the 250ms debounce to dispatch initial request
    await new Promise((r) => setTimeout(r, 270));
    await act(async () => {});

    // Should render ActivityIndicator because items is empty and initial load is in flight
    const indicators = renderer.root.findAllByType(ActivityIndicatorStub);
    assert.ok(indicators.length > 0, 'Must render ActivityIndicator while initial load is pending');

    const flatLists = renderer.root.findAllByType(FlatListStub);
    assert.equal(
      flatLists.length,
      0,
      'FlatList must not be mounted when items are empty and loading'
    );

    await act(async () => {
      releaseFetch({ requests: [makeMockItem('fr_1')], total: 1 });
    });
    await flush();

    renderer.unmount();
  }
);

test(
  'FeatureRequestsScreen: keeps FlatList mounted with existing items when a reload or search is in flight',
  renderTestOptions,
  async () => {
    let resolveSecondFetch!: (val: any) => void;
    let callCount = 0;

    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_test',
    });

    const secondFetchPromise = new Promise((resolve) => {
      resolveSecondFetch = resolve;
    });

    client.fetchFeatureRequests = ((_opts: any) => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          requests: [makeMockItem('fr_initial_item')],
          total: 1,
        });
      }
      return secondFetchPromise;
    }) as any;

    client.fetchVersions = (async () => []) as any;

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <CupThreadProvider client={client} userToken="tok">
          <FeatureRequestsScreen />
        </CupThreadProvider>
      );
    });

    // Wait for initial load (250ms debounce + dispatch) to complete
    await new Promise((r) => setTimeout(r, 280));
    await flush();

    // Initial item is visible in FlatList
    let flatLists = renderer.root.findAllByType(FlatListStub);
    assert.equal(flatLists.length, 1);
    assert.equal(flatLists[0].props.data.length, 1);

    // Now trigger search by changing search bar text input
    const searchInput = renderer.root.findAllByType(TextInputStub)[0];
    await act(async () => {
      searchInput.props.onChangeText('search query');
    });

    // Wait for debounce (250ms) to fire and dispatch the second fetch
    await new Promise((r) => setTimeout(r, 270));
    await act(async () => {});

    assert.equal(callCount, 2, 'Search fetch must have been dispatched');

    // While second fetch is still in flight, FlatList MUST STAY MOUNTED!
    flatLists = renderer.root.findAllByType(FlatListStub);
    assert.equal(flatLists.length, 1, 'FlatList must stay mounted with prior items during reload');
    assert.equal(flatLists[0].props.data.length, 1, 'Prior items remain visible during reload');

    // No center full-screen loading spinner
    const centerLoadings = renderer.root.findAll(
      (node) => (node.type as any) === 'View' && node.props?.style?.justifyContent === 'center'
    );
    const hasCenterSpinner = centerLoadings.some(
      (node) => node.findAllByType(ActivityIndicatorStub).length > 0
    );
    assert.equal(hasCenterSpinner, false, 'Must not unmount list for full-screen spinner');

    // Resolve the search fetch
    await act(async () => {
      resolveSecondFetch({
        requests: [makeMockItem('fr_search_result')],
        total: 1,
      });
    });
    await flush();

    // After resolve, items are updated
    flatLists = renderer.root.findAllByType(FlatListStub);
    assert.equal(flatLists.length, 1);
    assert.equal(flatLists[0].props.data.length, 1);
    assert.equal(flatLists[0].props.data[0].id, 'fr_search_result');

    renderer.unmount();
  }
);
