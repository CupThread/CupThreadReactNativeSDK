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

const FlatListStub = (props: any) => {
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

if (supportsModuleMocks) {
  (test as any).mock.module('react-native', {
    namedExports: {
      useColorScheme: () => 'light',
      // Layout stubs must pass children through so nested pressables stay in
      // the rendered tree.
      View: ({ children }: any) => children ?? null,
      Text: TextStub,
      TextInput: () => null,
      TouchableOpacity: ({ children }: any) => children ?? null,
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
