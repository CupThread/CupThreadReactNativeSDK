import test, { type TestOptions } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { FeedbackClient } from '../src/client/FeedbackClient';
import type { FeatureRequestItem } from '../src/types';

// FeatureRequestsScreen imports react-native, which cannot load in plain Node.
// Mock required primitives with lightweight stubs before dynamic imports.
const supportsModuleMocks = typeof (test as any).mock?.module === 'function';

const ViewStub = (props: any) => React.createElement('View', props, props.children ?? null);
const TextStub = (props: any) => React.createElement('Text', props, props.children ?? null);
const TouchableOpacityStub = (props: any) =>
  React.createElement('TouchableOpacity', props, props.children ?? null);
const SafeAreaViewStub = (props: any) =>
  React.createElement('SafeAreaView', props, props.children ?? null);
const ScrollViewStub = (props: any) =>
  React.createElement('ScrollView', props, props.children ?? null);

const FlatListStub = (props: any) => {
  const { data, renderItem, keyExtractor } = props;
  return React.createElement(
    'FlatList',
    props,
    (data ?? []).map((item: any, index: number) =>
      React.createElement(
        React.Fragment,
        { key: keyExtractor ? keyExtractor(item, index) : index },
        renderItem ? renderItem({ item, index }) : null
      )
    )
  );
};

if (supportsModuleMocks) {
  (test as any).mock.module('react-native', {
    namedExports: {
      useColorScheme: () => 'light',
      View: ViewStub,
      Text: TextStub,
      TextInput: (props: any) => React.createElement('TextInput', props),
      TouchableOpacity: TouchableOpacityStub,
      ActivityIndicator: () => null,
      FlatList: FlatListStub,
      ScrollView: ScrollViewStub,
      Modal: ({ children }: any) => children ?? null,
      RefreshControl: () => null,
      SafeAreaView: SafeAreaViewStub,
      Image: () => null,
      Linking: { openURL: () => Promise.resolve(), canOpenURL: () => Promise.resolve(true) },
      Platform: { OS: 'ios', select: (opts: any) => opts.ios ?? opts.default },
      StyleSheet: { create: (s: any) => s, flatten: (s: any) => s },
      Alert: { alert: () => {} },
    },
  });
}

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const { CupThreadProvider } = await import('../src/theme/CupThreadThemeProvider');
const { FeatureRequestsScreen } = await import('../src/components/FeatureRequestsScreen');

const renderTestOptions: TestOptions = supportsModuleMocks
  ? {}
  : {
      skip: 'node:test module mocking unavailable (needs Node >= 22.3 with --experimental-test-module-mocks)',
    };

async function waitForCondition(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitForCondition timed out after ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
    await act(async () => {});
  }
}

function makeRequest(id: string, title: string, description?: any): FeatureRequestItem {
  return {
    id,
    appId: 'app_test_fr_desc',
    title,
    description,
    status: 'planned',
    voteCount: 1,
    hasVoted: false,
    isOwnRequest: false,
    approved: true,
    commentCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function makeClient(appKey = 'app_fr_desc_test'): FeedbackClient {
  const client = new FeedbackClient({
    baseUrl: 'https://api.cupthread.com',
    appKey,
  });
  client.fetchAppConfig = (async () => ({
    appKey,
    sdk: {
      features: {
        feedback: true,
        featureRequests: true,
        roadmap: true,
        changelog: true,
      },
      changelogOverlay: { entryCount: 5 },
    },
  })) as any;
  client.fetchVersions = (async () => []) as any;
  client.fetchColumns = (async () => []) as any;
  return client;
}

test(
  'FeatureRequestsScreen: safely guards item.description against empty, whitespace, and non-string types (#323)',
  renderTestOptions,
  async () => {
    const items: any[] = [
      makeRequest('fr_valid', 'Valid Request', '  Valid request description  '),
      makeRequest('fr_empty', 'Empty Desc Request', ''),
      makeRequest('fr_whitespace', 'Whitespace Desc Request', '   \t  \n  '),
      makeRequest('fr_undefined', 'Undefined Desc Request', undefined),
      makeRequest('fr_null', 'Null Desc Request', null),
      makeRequest('fr_object', 'Object Desc Request', { complex: 'object' }),
      makeRequest('fr_bool', 'Boolean Desc Request', true),
      makeRequest('fr_number', 'Number Desc Request', 12345),
    ];

    const client = makeClient('app_test_fr_desc');
    client.fetchFeatureRequests = (async () => ({
      requests: items,
      total: items.length,
      hasMore: false,
    })) as any;

    let renderer: TestRenderer.ReactTestRenderer | undefined;
    try {
      await act(async () => {
        renderer = TestRenderer.create(
          <CupThreadProvider client={client} userToken="tok_ready">
            <FeatureRequestsScreen />
          </CupThreadProvider>
        );
      });

      const isCard = (node: any) =>
        node.type === 'TouchableOpacity' &&
        Array.isArray(node.props?.style) &&
        node.props.style[0]?.borderRadius === 12 &&
        node.props.style[0]?.marginBottom === 12;

      // Wait until the items are loaded and FlatList cards are rendered
      await waitForCondition(() => {
        const cards = renderer!.root.findAll(isCard);
        return cards.length === items.length;
      });

      // 1. Exactly one description node with numberOfLines={2} should be rendered across all cards
      const descNodes = renderer!.root.findAll(
        (node: any) => node.type === 'Text' && node.props?.numberOfLines === 2
      );
      assert.equal(
        descNodes.length,
        1,
        'only valid non-empty string description should render numberOfLines={2} text'
      );
      assert.equal(
        descNodes[0].props.children,
        'Valid request description',
        'rendered description must be trimmed'
      );

      // 2. Inspect each card's TouchableOpacity subtree directly
      const cards = renderer!.root.findAll(isCard);

      assert.equal(cards.length, items.length, 'all request cards should be rendered');

      // The valid request card (first card) must contain the trimmed description
      const validCardTexts = cards[0]
        .findAll((t: any) => t.type === 'Text')
        .map((t: any) => t.props.children);
      assert.ok(
        validCardTexts.includes('Valid request description'),
        'valid card must include trimmed description'
      );

      // Cards with invalid or empty descriptions must NOT contain any description text
      for (let i = 1; i < cards.length; i++) {
        const cardTexts = cards[i]
          .findAll((t: any) => t.type === 'Text')
          .map((t: any) => t.props.children);

        // Verify no description text node exists in invalid cards
        assert.ok(
          !cardTexts.includes(''),
          `card ${items[i].id} should not contain empty string text node`
        );
        assert.ok(
          !cardTexts.some(
            (c: any) =>
              typeof c === 'object' ||
              c === true ||
              c === 12345 ||
              (typeof c === 'string' && c.trim() === '')
          ),
          `card ${items[i].id} should not render invalid description child`
        );
      }
    } finally {
      renderer?.unmount();
    }
  }
);

test(
  'FeatureRequestsScreen: safely guards item.title against empty, whitespace, and non-string types (#329)',
  renderTestOptions,
  async () => {
    const items: any[] = [
      {
        ...makeRequest('fr_valid_title', 'Valid Title'),
        title: '  Valid Request Title  ',
      },
      {
        ...makeRequest('fr_empty_title', 'Empty Title'),
        title: '',
      },
      {
        ...makeRequest('fr_whitespace_title', 'Whitespace Title'),
        title: '   \t  \n  ',
      },
      {
        ...makeRequest('fr_undefined_title', 'Undefined Title'),
        title: undefined,
      },
      {
        ...makeRequest('fr_null_title', 'Null Title'),
        title: null,
      },
      {
        ...makeRequest('fr_object_title', 'Object Title'),
        title: { complex: 'object' },
      },
      {
        ...makeRequest('fr_bool_title', 'Boolean Title'),
        title: true,
      },
      {
        ...makeRequest('fr_number_title', 'Number Title'),
        title: 12345,
      },
    ];

    const client = makeClient('app_test_fr_title');
    client.fetchFeatureRequests = (async () => ({
      requests: items,
      total: items.length,
      hasMore: false,
    })) as any;

    let renderer: TestRenderer.ReactTestRenderer | undefined;
    try {
      await act(async () => {
        renderer = TestRenderer.create(
          <CupThreadProvider client={client} userToken="tok_ready">
            <FeatureRequestsScreen />
          </CupThreadProvider>
        );
      });

      const isCard = (node: any) =>
        node.type === 'TouchableOpacity' &&
        Array.isArray(node.props?.style) &&
        node.props.style[0]?.borderRadius === 12 &&
        node.props.style[0]?.marginBottom === 12;

      await waitForCondition(() => {
        const cards = renderer!.root.findAll(isCard);
        return cards.length === items.length;
      });

      const cards = renderer!.root.findAll(isCard);
      assert.equal(cards.length, items.length, 'all request cards should be rendered');

      const isCardTitle = (node: any) => {
        if (node.type !== 'Text') return false;
        const style = node.props?.style;
        if (!style) return false;
        const array = Array.isArray(style) ? style : [style];
        return array.some(
          (s: any) => s?.fontSize === 16 && s?.fontWeight === '600' && s?.lineHeight === 22
        );
      };

      const titleNodes = cards.map((card: any) => card.find(isCardTitle));
      assert.equal(
        titleNodes.length,
        items.length,
        'every request card must render a title Text component'
      );

      assert.equal(titleNodes[0].props.children, 'Valid Request Title');
      assert.equal(titleNodes[1].props.children, '');
      assert.equal(titleNodes[2].props.children, '');
      assert.equal(titleNodes[3].props.children, '');
      assert.equal(titleNodes[4].props.children, '');
      assert.equal(titleNodes[5].props.children, '');
      assert.equal(titleNodes[6].props.children, '');
      assert.equal(titleNodes[7].props.children, '');

      for (const node of titleNodes) {
        assert.equal(typeof node.props.children, 'string');
      }
    } finally {
      renderer?.unmount();
    }
  }
);

test(
  'FeatureRequestsScreen: does not render badgeRow when all badges are absent (#336)',
  renderTestOptions,
  async () => {
    const items: FeatureRequestItem[] = [
      {
        ...makeRequest('fr_no_badges', 'Request Without Badges'),
        columnName: null,
        versionLabel: null,
      },
      {
        ...makeRequest('fr_with_column', 'Request With Column'),
        columnName: 'In Progress',
        columnColor: '#3b82f6',
        versionLabel: null,
      },
      {
        ...makeRequest('fr_with_version', 'Request With Version'),
        columnName: null,
        versionLabel: '2.0.0',
      },
      {
        ...makeRequest('fr_with_both', 'Request With Both'),
        columnName: 'Completed',
        versionLabel: '3.0.0',
      },
      {
        ...makeRequest('fr_whitespace_col', 'Request With Whitespace Column'),
        columnName: '   \t  ',
        versionLabel: null,
      },
    ];

    const client = makeClient('app_test_fr_badges');
    client.fetchFeatureRequests = (async () => ({
      requests: items,
      total: items.length,
      hasMore: false,
    })) as any;

    let renderer: TestRenderer.ReactTestRenderer | undefined;
    try {
      await act(async () => {
        renderer = TestRenderer.create(
          <CupThreadProvider client={client} userToken="tok_ready">
            <FeatureRequestsScreen />
          </CupThreadProvider>
        );
      });

      const isCard = (node: any) =>
        node.type === 'TouchableOpacity' &&
        Array.isArray(node.props?.style) &&
        node.props.style[0]?.borderRadius === 12 &&
        node.props.style[0]?.marginBottom === 12;

      await waitForCondition(() => {
        const cards = renderer!.root.findAll(isCard);
        return cards.length === items.length;
      });

      const cards = renderer!.root.findAll(isCard);
      assert.equal(cards.length, items.length);

      const isBadgeRow = (node: any) => {
        if (node.type !== 'View') return false;
        const style = node.props?.style;
        if (!style) return false;
        const array = Array.isArray(style) ? style : [style];
        return array.some((s: any) => s?.marginTop === 2 && s?.flexDirection === 'row');
      };

      // Item 0: no badges -> badgeRow must NOT be rendered
      assert.equal(
        cards[0].findAll(isBadgeRow).length,
        0,
        'badgeRow must not be rendered when both badges are absent'
      );

      // Item 1: with column -> badgeRow must be rendered
      assert.equal(
        cards[1].findAll(isBadgeRow).length,
        1,
        'badgeRow must be rendered when column is present'
      );

      // Item 2: with version -> badgeRow must be rendered
      assert.equal(
        cards[2].findAll(isBadgeRow).length,
        1,
        'badgeRow must be rendered when versionLabel is present'
      );

      // Item 3: with both -> badgeRow must be rendered
      assert.equal(
        cards[3].findAll(isBadgeRow).length,
        1,
        'badgeRow must be rendered when both badges are present'
      );

      // Item 4: with whitespace column -> badgeRow must NOT be rendered
      assert.equal(
        cards[4].findAll(isBadgeRow).length,
        0,
        'badgeRow must not be rendered when column is whitespace and version is absent'
      );
    } finally {
      renderer?.unmount();
    }
  }
);
