import test, { type TestOptions } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { FeedbackClient } from '../src/client/FeedbackClient';
import type { BoardColumn, FeatureRequestItem } from '../src/types';

// `RoadmapBoardScreen` imports react-native, which cannot load under plain
// Node. Mock every symbol the screen and its children use with lightweight
// stubs, then dynamically import the real modules so the mock is in place
// before evaluation. Module mocking needs Node >= 22.3 with
// --experimental-test-module-mocks; without it the render-level tests below
// are skipped.
const supportsModuleMocks = typeof (test as any).mock?.module === 'function';

// Text stubs accumulate every string ever rendered. `SafeAreaViewStub` bumps
// a generation counter once per commit so assertions can inspect only the
// final, settled render pass instead of transient loading states.
let renderGeneration = 0;
const renderedTexts: { gen: number; text: string }[] = [];

function finalPassTexts(): string[] {
  const gen = renderedTexts.reduce((max, t) => Math.max(max, t.gen), 0);
  return renderedTexts.filter((t) => t.gen === gen).map((t) => t.text);
}

const TextStub = (props: any) => {
  const value = Array.isArray(props.children)
    ? props.children.map((c: any) => String(c)).join('')
    : props.children == null
      ? ''
      : String(props.children);
  renderedTexts.push({ gen: renderGeneration, text: value });
  return null;
};

const SafeAreaViewStub = ({ children }: any) => {
  renderGeneration += 1;
  return children ?? null;
};

const flatListProps: any[] = [];
const FlatListStub = (props: any) => {
  flatListProps.push(props);
  const { data, renderItem, keyExtractor } = props;
  return (
    <>
      {(data ?? []).map((item: any, index: number) => (
        <React.Fragment key={keyExtractor ? keyExtractor(item, index) : index}>
          {renderItem({ item, index })}
        </React.Fragment>
      ))}
    </>
  );
};

const TouchableOpacityStub = (props: any) => props.children ?? null;

if (supportsModuleMocks) {
  (test as any).mock.module('react-native', {
    namedExports: {
      useColorScheme: () => 'light',
      // Layout stubs must pass children through so nested pressables stay in
      // the rendered tree.
      View: ({ children }: any) => children ?? null,
      Text: TextStub,
      TextInput: () => null,
      TouchableOpacity: TouchableOpacityStub,
      ActivityIndicator: () => null,
      FlatList: FlatListStub,
      ScrollView: ({ children }: any) => children ?? null,
      Modal: ({ children }: any) => children ?? null,
      RefreshControl: () => null,
      SafeAreaView: SafeAreaViewStub,
      Image: () => null,
      Linking: { openURL: () => Promise.resolve() },
      Platform: { OS: 'ios', select: (options: any) => options.ios ?? options.default },
      StyleSheet: { create: (styles: any) => styles, flatten: (s: any) => s },
    },
  });
}

const { CupThreadProvider } = await import('../src/theme/CupThreadThemeProvider');
const { RoadmapBoardScreen } = await import('../src/components/RoadmapBoardScreen');
const { VoteButton } = await import('../src/components/VoteButton');
const { UserTokenStore } = await import('../src/client/UserTokenStore');

const renderTestOptions: TestOptions = supportsModuleMocks
  ? {}
  : {
      skip: 'node:test module mocking unavailable (needs Node >= 22.3 with --experimental-test-module-mocks)',
    };

/** Let pending microtasks and pending act-batched state updates settle. */
async function flush(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2));
    await act(async () => {});
  }
}

function makeColumn(id: string, name: string): BoardColumn {
  return {
    id,
    appId: 'app_test_tabs',
    name,
    slug: id,
    position: 0,
    isVisible: true,
    isSystem: false,
    kind: 'normal',
    createdAt: '2026-01-01T00:00:00Z',
  } as BoardColumn;
}

function makeRequest(id: string, columnId: string): FeatureRequestItem {
  return {
    id,
    appId: 'app_test_tabs',
    title: `Request ${id}`,
    description: 'A request body',
    status: '',
    voteCount: 0,
    hasVoted: false,
    isOwnRequest: false,
    createdAt: '2026-01-01T00:00:00Z',
    columnId,
  } as FeatureRequestItem;
}

/**
 * Fetch stub: config fetch 404s (non-fatal), columns resolve to two visible
 * columns, and the feature-request list serves one page of `loadedCount`
 * items — all in the first column — with a server `total` that may exceed
 * the loaded page.
 */
function stubBoardFetch(loadedCount: number, total: number): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    const target = url.toString();
    if (target.includes('/api/v1/public/columns/')) {
      return new Response(
        JSON.stringify({
          columns: [makeColumn('col_a', 'Planned'), makeColumn('col_b', 'Shipped')],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (target.includes('/api/v1/feature-requests')) {
      const requests = Array.from({ length: loadedCount }, (_, i) =>
        makeRequest(`fr_${i}`, 'col_a')
      );
      return new Response(JSON.stringify({ requests, total }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  }) as any;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

async function renderBoard(): Promise<TestRenderer.ReactTestRenderer> {
  const client = new FeedbackClient({
    baseUrl: 'https://api.cupthread.com',
    appKey: 'app_test_tabs',
  });
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(CupThreadProvider, {
        client,
        userToken: 'usr_tok_test',
        children: React.createElement(RoadmapBoardScreen),
      })
    );
  });
  await flush();
  return renderer;
}

test(
  'roadmap tab badges show lower-bound counts with + while more pages exist',
  renderTestOptions,
  async () => {
    renderedTexts.length = 0;
    const restoreFetch = stubBoardFetch(100, 250);
    let renderer!: TestRenderer.ReactTestRenderer;
    try {
      renderer = await renderBoard();
      const finalTexts = finalPassTexts();
      // 100 of 250 loaded, every loaded item in "Planned": the exact-looking
      // "Shipped (0)" and truncated "Planned (100)" must never render.
      assert.ok(
        finalTexts.some((t) => t === 'Planned (100+)'),
        `expected a "Planned (100+)" tab, got: ${JSON.stringify(finalTexts)}`
      );
      assert.ok(
        finalTexts.some((t) => t === 'Shipped (0+)'),
        `expected a "Shipped (0+)" tab, got: ${JSON.stringify(finalTexts)}`
      );
      assert.ok(
        !finalTexts.some((t) => /\(\d+\)$/.test(t)),
        'no tab badge may assert an exact count while hasMore is true'
      );
    } finally {
      restoreFetch();
      renderer?.unmount();
    }
  }
);

test(
  'roadmap tab badges show exact counts once all pages are loaded',
  renderTestOptions,
  async () => {
    renderedTexts.length = 0;
    const restoreFetch = stubBoardFetch(100, 100);
    let renderer!: TestRenderer.ReactTestRenderer;
    try {
      renderer = await renderBoard();
      const finalTexts = finalPassTexts();
      assert.ok(
        finalTexts.some((t) => t === 'Planned (100)'),
        `expected an exact "Planned (100)" tab, got: ${JSON.stringify(finalTexts)}`
      );
      assert.ok(
        finalTexts.some((t) => t === 'Shipped (0)'),
        `expected an exact "Shipped (0)" tab once fully loaded, got: ${JSON.stringify(finalTexts)}`
      );
    } finally {
      restoreFetch();
      renderer?.unmount();
    }
  }
);

function getColumnTabs(renderer: TestRenderer.ReactTestRenderer): TestRenderer.ReactTestInstance[] {
  return renderer.root.findAll(
    (node: any) =>
      node.type === TouchableOpacityStub &&
      node.props?.accessibilityRole === 'button' &&
      node.props?.accessibilityState &&
      typeof node.props.accessibilityState.selected === 'boolean'
  );
}

function getTabLabel(tabNode: TestRenderer.ReactTestInstance): string {
  const textNodes = tabNode.findAllByType(TextStub as any);
  return textNodes.map((n: any) => String(n.props?.children ?? '')).join('');
}

test(
  'RoadmapBoardScreen: resets selectedColumnId to first visible column when orphan requests disappear after Other was selected (#239)',
  renderTestOptions,
  async () => {
    renderedTexts.length = 0;
    flatListProps.length = 0;
    let currentRequests: FeatureRequestItem[] = [
      makeRequest('fr_planned', 'col_a'),
      makeRequest('fr_orphan', 'unknown_col'),
    ];

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      const target = url.toString();
      if (target.includes('/api/v1/public/columns/')) {
        return new Response(
          JSON.stringify({
            columns: [makeColumn('col_a', 'Planned'), makeColumn('col_b', 'Shipped')],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (target.includes('/api/v1/feature-requests')) {
        return new Response(
          JSON.stringify({ requests: currentRequests, total: currentRequests.length }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('not found', { status: 404 });
    }) as any;

    let renderer!: TestRenderer.ReactTestRenderer;
    try {
      renderer = await renderBoard();

      // Initial state: Planned, Shipped, Other tabs exist.
      const initialTabs = getColumnTabs(renderer);
      assert.equal(initialTabs.length, 3, 'Planned, Shipped, and Other tabs must be present');
      const otherTab = initialTabs.find((t) => getTabLabel(t).startsWith('Other'));
      assert.ok(otherTab, 'Other tab must be present when orphan requests exist');
      assert.equal(otherTab.props.accessibilityState.selected, false);

      const plannedTab = initialTabs.find((t) => getTabLabel(t).startsWith('Planned'));
      assert.ok(plannedTab);
      assert.equal(plannedTab.props.accessibilityState.selected, true);

      // User selects the "Other" tab.
      await act(async () => {
        otherTab.props.onPress();
      });
      await flush();

      // Verify "Other" tab is now selected.
      const selectedTabs = getColumnTabs(renderer);
      const activeOtherTab = selectedTabs.find((t) => getTabLabel(t).startsWith('Other'));
      assert.ok(activeOtherTab);
      assert.equal(activeOtherTab.props.accessibilityState.selected, true);

      // Orphan requests disappear (e.g. reassigned to Planned col_a).
      currentRequests = [makeRequest('fr_planned', 'col_a'), makeRequest('fr_orphan', 'col_a')];

      // Trigger refresh via board's RefreshControl.
      const boardList = flatListProps.find((p) => p.refreshControl != null);
      assert.ok(boardList?.refreshControl, 'rendered board FlatList must provide a refreshControl');
      await act(async () => {
        await boardList.refreshControl.props.onRefresh();
      });
      await flush();

      // After refresh: Other tab is gone, selected tab resets to first visible column ("Planned").
      const settledTabs = getColumnTabs(renderer);
      assert.equal(
        settledTabs.some((t) => getTabLabel(t).startsWith('Other')),
        false,
        'Other tab must not be present when orphan requests are 0'
      );
      const settledPlannedTab = settledTabs.find((t) => getTabLabel(t).startsWith('Planned'));
      assert.ok(settledPlannedTab, 'Planned tab must exist');
      assert.equal(
        settledPlannedTab.props.accessibilityState.selected,
        true,
        'Planned tab must be automatically selected when Other disappears'
      );

      // Verify that requests belonging to Planned are displayed rather than an empty list.
      const finalTexts = finalPassTexts();
      assert.ok(
        finalTexts.includes('Request fr_planned'),
        'board must display Planned items instead of a blank screen'
      );
      assert.ok(
        finalTexts.includes('Request fr_orphan'),
        'reassigned orphan item must display under Planned'
      );
    } finally {
      globalThis.fetch = originalFetch;
      renderer?.unmount();
    }
  }
);

test(
  'VoteButton in RoadmapBoardScreen reflects token readiness state (#202)',
  renderTestOptions,
  async () => {
    const columns: BoardColumn[] = [makeColumn('col_1', 'In Progress')];
    const requests: FeatureRequestItem[] = [makeRequest('fr_board_readiness', 'col_1')];

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any) => {
      const url = String(input);
      if (url.includes('/public/config/')) {
        return new Response(
          JSON.stringify({
            appKey: 'app_test_roadmap',
            sdk: { features: { roadmap: true } },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }
      if (url.includes('/public/columns/')) {
        return new Response(JSON.stringify({ columns }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/feature-requests')) {
        return new Response(JSON.stringify({ requests, total: requests.length }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('{}', { status: 200 });
    }) as any;

    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_test_roadmap',
    });

    let renderer: TestRenderer.ReactTestRenderer | undefined;
    await act(async () => {
      renderer = TestRenderer.create(
        <CupThreadProvider client={client} userToken="tok_board_initial">
          <RoadmapBoardScreen />
        </CupThreadProvider>
      );
    });
    await flush();

    try {
      const voteButtonReady = renderer!.root.findAllByType(VoteButton as any)[0];
      assert.ok(voteButtonReady, 'VoteButton must exist on the board card');
      assert.equal(
        voteButtonReady.props.disabled,
        false,
        'VoteButton must be enabled when token is ready'
      );

      // Transition token to pending storage read
      let resolvePendingRead!: (val: string | null) => void;
      const pendingPromise = new Promise<string | null>((res) => {
        resolvePendingRead = res;
      });
      UserTokenStore.configure({
        getItem: () => pendingPromise,
        setItem: async () => {},
      });

      await act(async () => {
        renderer!.update(
          <CupThreadProvider client={client} userToken="   ">
            <RoadmapBoardScreen />
          </CupThreadProvider>
        );
      });
      await flush();

      const voteButtonUnready = renderer!.root.findAllByType(VoteButton as any)[0];
      assert.equal(
        voteButtonUnready.props.disabled,
        true,
        'VoteButton must be disabled when token is unready'
      );

      // Resolve pending storage read
      await act(async () => {
        resolvePendingRead('tok_board_resumed');
      });
      await flush();

      const voteButtonResumed = renderer!.root.findAllByType(VoteButton as any)[0];
      assert.equal(
        voteButtonResumed.props.disabled,
        false,
        'VoteButton must be re-enabled after token readiness resolves'
      );
    } finally {
      globalThis.fetch = originalFetch;
      UserTokenStore.resetSharedForTests();
      renderer?.unmount();
    }
  }
);
