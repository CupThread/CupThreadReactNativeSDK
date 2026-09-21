import test, { type TestOptions } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { FeedbackClient } from '../src/client/FeedbackClient';
import type { FeatureRequestItem } from '../src/types';
import { enStrings as strings } from '../src/i18n';

// `FeatureRequestsScreen` / `RoadmapBoardScreen` import react-native, which
// cannot load under plain Node. Mock every symbol the screen tree uses with
// lightweight stubs, then dynamically import the real modules so the mock is
// in place before evaluation. Module mocking needs Node >= 22.3 with
// --experimental-test-module-mocks; without it the render-level tests below
// are skipped.
const supportsModuleMocks = typeof (test as any).mock?.module === 'function';

const touchableOpacityProps: any[] = [];
const flatListProps: any[] = [];

const TouchableOpacityStub = (props: any) => {
  touchableOpacityProps.push(props);
  return props.children ?? null;
};

const TextStub = (props: any) => props.children ?? null;

// Renders the item rows and the footer inline so text/pressable assertions
// see the real screen output; captures props so tests can drive RefreshControl.
const FlatListStub = (props: any) => {
  flatListProps.push(props);
  return React.createElement(
    React.Fragment,
    null,
    ...(props.data ?? []).map((item: any, index: number) => props.renderItem({ item, index })),
    props.ListFooterComponent ?? null
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
      TouchableOpacity: TouchableOpacityStub,
      ActivityIndicator: () => null,
      ScrollView: ({ children }: any) => children ?? null,
      Modal: ({ children }: any) => children ?? null,
      SafeAreaView: ({ children }: any) => children ?? null,
      FlatList: FlatListStub,
      RefreshControl: () => null,
      Image: () => null,
      Linking: { openURL: () => Promise.resolve() },
      StyleSheet: { create: (styles: any) => styles, flatten: (s: any) => s },
      Alert: { alert: () => {} },
    },
  });
}

const { CupThreadProvider } = await import('../src/theme/CupThreadThemeProvider');
const { FeatureRequestsScreen } = await import('../src/components/FeatureRequestsScreen');
const { RoadmapBoardScreen } = await import('../src/components/RoadmapBoardScreen');

const renderTestOptions: TestOptions = supportsModuleMocks
  ? {}
  : {
      skip: 'node:test module mocking unavailable (needs Node >= 22.3 with --experimental-test-module-mocks)',
    };

function makeItem(id: string, title: string): FeatureRequestItem {
  return {
    id,
    appId: 'app_test',
    title,
    description: `Description for ${title}`,
    voteCount: 1,
    hasVoted: false,
    isOwnRequest: false,
    status: 'planned',
    columnId: 'col_planned',
    columnName: 'Planned',
    columnColor: '#3b82f6',
    approved: true,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
  };
}

interface FetchRoute {
  status: number;
  body?: unknown;
}

const ok = (body: unknown): FetchRoute => ({ status: 200, body });
const fail = (): FetchRoute => ({ status: 500, body: 'server error' });

/**
 * Fetch stub shared by the tests. Route objects are mutable so a test can
 * flip the network from success to failure (or back) between interactions.
 * The config endpoint always 404s (that failure is caught silently by the
 * provider); versions succeeds with an empty list so the screen's own
 * versions-error retry state stays out of the way.
 */
function installFetch(routes: {
  page0: FetchRoute;
  loadMore: FetchRoute;
  columns: FetchRoute;
}): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const target = url.toString();
    const respond = (route: FetchRoute) =>
      new Response(typeof route.body === 'string' ? route.body : JSON.stringify(route.body ?? {}), {
        status: route.status,
        headers: { 'Content-Type': 'application/json' },
      });
    if (target.includes('/api/v1/public/config/')) {
      return new Response('not found', { status: 404 });
    }
    if (target.includes('/api/v1/public/columns/')) {
      return respond(routes.columns);
    }
    if (target.includes('/api/v1/public/versions/')) {
      // Succeed with an empty list: these tests exercise page-0/loadMore
      // failures, and the screen now surfaces versions failures with their
      // own retry ErrorState (which would pollute the error-text checks).
      return respond(ok({ versions: [] }));
    }
    if (target.includes('/api/v1/feature-requests') && (init?.method ?? 'GET') === 'GET') {
      const query = target.split('?')[1] ?? '';
      const offset = Number(new URLSearchParams(query).get('offset') ?? '0');
      return respond(offset > 0 ? routes.loadMore : routes.page0);
    }
    return new Response('not found', { status: 404 });
  }) as any;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

/** All string content currently rendered through the Text stub. */
function collectTexts(root: TestRenderer.ReactTestRenderer['root']): string[] {
  const out: string[] = [];
  root.findAll((node: any) => {
    if (node.type === TextStub && typeof node.props?.children === 'string') {
      out.push(node.props.children);
    }
    return false;
  });
  return out;
}

/** Finds the pressable whose single Text child renders exactly `label`. */
function findPressable(root: TestRenderer.ReactTestRenderer['root'], label: string): any {
  const matches = root.findAll((node: any) => {
    if (node.type !== TouchableOpacityStub || typeof node.props?.onPress !== 'function') {
      return false;
    }
    const kids = Array.isArray(node.props.children) ? node.props.children : [node.props.children];
    return kids.some((k: any) => React.isValidElement(k) && (k.props as any)?.children === label);
  });
  return matches[matches.length - 1] ?? null;
}

async function settle(ms = 60): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
  await act(async () => {});
}

/** Polls until `predicate` matches some rendered text (debounced loads take ~250ms). */
async function waitForText(
  renderer: TestRenderer.ReactTestRenderer,
  predicate: (text: string) => boolean,
  timeoutMs = 4000
): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (collectTexts(renderer.root).some(predicate)) return;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitForText timed out after ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
    await act(async () => {});
  }
}

async function pullToRefresh(): Promise<void> {
  const list = flatListProps[flatListProps.length - 1];
  assert.ok(list?.refreshControl, 'rendered list must expose a RefreshControl');
  await act(async () => {
    await list.refreshControl.props.onRefresh();
  });
  await settle();
}

async function pressButton(renderer: TestRenderer.ReactTestRenderer, label: string): Promise<void> {
  const button = findPressable(renderer.root, label);
  assert.ok(button, `expected a pressable labeled "${label}"`);
  await act(async () => {
    await button.props.onPress();
  });
  await settle();
}

interface ScreenHarness {
  renderer: TestRenderer.ReactTestRenderer;
  restoreFetch: () => void;
}

async function renderScreen(
  screen: 'requests' | 'roadmap',
  routes: ReturnType<typeof makeRoutes>
): Promise<ScreenHarness> {
  const client = new FeedbackClient({
    baseUrl: 'https://api.cupthread.com',
    appKey: 'app_test_errors',
  });
  const restoreFetch = installFetch(routes);
  const element =
    screen === 'requests'
      ? React.createElement(FeatureRequestsScreen)
      : React.createElement(RoadmapBoardScreen);
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(CupThreadProvider, {
        client,
        userToken: 'usr_tok_test',
        children: element,
      })
    );
  });
  return { renderer, restoreFetch };
}

function makeRoutes() {
  return {
    page0: ok({
      requests: [makeItem('fr_a', 'Request A'), makeItem('fr_b', 'Request B')],
      total: 2,
    }),
    loadMore: ok({ requests: [], total: 2 }),
    columns: ok([]),
  };
}

test(
  'FeatureRequestsScreen shows an inline retry banner when refresh fails with items on screen',
  renderTestOptions,
  async () => {
    touchableOpacityProps.length = 0;
    flatListProps.length = 0;
    const routes = makeRoutes();
    const harness = await renderScreen('requests', routes);
    try {
      await waitForText(harness.renderer, (t) => t === 'Request A');
      assert.equal(
        collectTexts(harness.renderer.root).includes(strings.common.error),
        false,
        'no error banner while every load succeeds'
      );

      routes.page0 = fail();
      await pullToRefresh();

      let texts = collectTexts(harness.renderer.root);
      assert.ok(
        texts.includes(strings.common.error),
        'refresh failure must surface the error text'
      );
      assert.ok(texts.includes(strings.common.retry), 'refresh failure must offer a retry');
      assert.ok(texts.includes('Request A'), 'stale items must stay visible under the banner');

      routes.page0 = ok({
        requests: [makeItem('fr_a2', 'Request A2'), makeItem('fr_b2', 'Request B2')],
        total: 2,
      });
      await pressButton(harness.renderer, strings.common.retry);

      texts = collectTexts(harness.renderer.root);
      assert.equal(texts.includes(strings.common.error), false, 'banner must clear after retry');
      assert.ok(texts.includes('Request A2'), 'successful retry must show the fresh list');
    } finally {
      harness.restoreFetch();
      harness.renderer.unmount();
    }
  }
);

test(
  'FeatureRequestsScreen renders a footer retry affordance when loadMore fails',
  renderTestOptions,
  async () => {
    touchableOpacityProps.length = 0;
    flatListProps.length = 0;
    const routes = makeRoutes();
    routes.page0 = ok({
      requests: [makeItem('fr_a', 'Request A'), makeItem('fr_b', 'Request B')],
      total: 4,
    });
    routes.loadMore = fail();
    const harness = await renderScreen('requests', routes);
    try {
      await waitForText(harness.renderer, (t) => t === 'Request A');
      const texts = collectTexts(harness.renderer.root);
      assert.ok(
        texts.includes(strings.roadmap.showingCount(2, 4)),
        'truncated list must show the Showing X of Y affordance'
      );

      await pressButton(harness.renderer, strings.roadmap.loadMore);

      let failureTexts = collectTexts(harness.renderer.root);
      assert.ok(
        failureTexts.includes(strings.common.error),
        'loadMore failure must surface the error text in the footer'
      );
      assert.ok(
        failureTexts.includes('Request A'),
        'loaded items must stay visible after a loadMore failure'
      );

      routes.loadMore = ok({ requests: [makeItem('fr_c', 'Request C')], total: 4 });
      await pressButton(harness.renderer, strings.common.retry);

      failureTexts = collectTexts(harness.renderer.root);
      assert.ok(failureTexts.includes('Request C'), 'successful retry must append the next page');
      assert.equal(failureTexts.includes(strings.common.error), false, 'footer error must clear');
      // The short page clamps total to the loaded count, so the list is no
      // longer truncated and the footer affordance disappears entirely.
      assert.equal(
        failureTexts.includes(strings.roadmap.showingCount(2, 4)),
        false,
        'stale truncated-list affordance must be gone'
      );
    } finally {
      harness.restoreFetch();
      harness.renderer.unmount();
    }
  }
);

test(
  'FeatureRequestsScreen keeps the full-screen ErrorState for a failed load on an empty list',
  renderTestOptions,
  async () => {
    touchableOpacityProps.length = 0;
    flatListProps.length = 0;
    const routes = makeRoutes();
    routes.page0 = fail();
    const harness = await renderScreen('requests', routes);
    try {
      await waitForText(harness.renderer, (t) => t === strings.common.retry);
      assert.deepEqual(flatListProps, [], 'empty list + failure must not render the list');
      let texts = collectTexts(harness.renderer.root);
      assert.ok(texts.includes(strings.common.error), 'ErrorState must show the failure message');

      routes.page0 = ok({
        requests: [makeItem('fr_a', 'Request A'), makeItem('fr_b', 'Request B')],
        total: 2,
      });
      await pressButton(harness.renderer, strings.common.retry);

      texts = collectTexts(harness.renderer.root);
      assert.ok(texts.includes('Request A'), 'retry from the empty-list ErrorState must load');
    } finally {
      harness.restoreFetch();
      harness.renderer.unmount();
    }
  }
);

test(
  'RoadmapBoardScreen shows an inline retry banner when refresh fails with requests on the board',
  renderTestOptions,
  async () => {
    touchableOpacityProps.length = 0;
    flatListProps.length = 0;
    const routes = makeRoutes();
    const harness = await renderScreen('roadmap', routes);
    try {
      await waitForText(harness.renderer, (t) => t === 'Request A');
      assert.equal(
        collectTexts(harness.renderer.root).includes(strings.common.error),
        false,
        'no error banner while every load succeeds'
      );

      routes.page0 = fail();
      await pullToRefresh();

      let texts = collectTexts(harness.renderer.root);
      assert.ok(
        texts.includes(strings.common.error),
        'refresh failure must surface the error text'
      );
      assert.ok(texts.includes(strings.common.retry), 'refresh failure must offer a retry');
      assert.ok(texts.includes('Request A'), 'loaded requests must stay visible under the banner');

      routes.page0 = ok({ requests: [makeItem('fr_c', 'Request C')], total: 1 });
      await pressButton(harness.renderer, strings.common.retry);

      texts = collectTexts(harness.renderer.root);
      assert.equal(texts.includes(strings.common.error), false, 'banner must clear after retry');
      assert.ok(texts.includes('Request C'), 'successful retry must show the fresh board');
    } finally {
      harness.restoreFetch();
      harness.renderer.unmount();
    }
  }
);

test(
  'RoadmapBoardScreen marks the loadMore footer as failed and retries on tap',
  renderTestOptions,
  async () => {
    touchableOpacityProps.length = 0;
    flatListProps.length = 0;
    const routes = makeRoutes();
    routes.page0 = ok({
      requests: [makeItem('fr_a', 'Request A'), makeItem('fr_b', 'Request B')],
      total: 4,
    });
    routes.loadMore = fail();
    const harness = await renderScreen('roadmap', routes);
    try {
      await waitForText(harness.renderer, (t) => t === 'Request A');
      assert.ok(
        collectTexts(harness.renderer.root).includes(strings.roadmap.showingCount(2, 4)),
        'truncated board must show the Showing X of Y affordance'
      );

      await pressButton(harness.renderer, strings.roadmap.loadMore);

      let texts = collectTexts(harness.renderer.root);
      assert.ok(
        texts.includes(strings.common.error),
        'loadMore failure must surface the error text in the footer'
      );
      assert.ok(texts.includes('Request A'), 'loaded requests must stay visible');

      routes.loadMore = ok({ requests: [makeItem('fr_c', 'Request C')], total: 4 });
      await pressButton(harness.renderer, strings.common.retry);

      texts = collectTexts(harness.renderer.root);
      assert.ok(texts.includes('Request C'), 'successful retry must append the next page');
      assert.equal(texts.includes(strings.common.error), false, 'footer error must clear');
      // The short page clamps total to the loaded count, so the list is no
      // longer truncated and the footer affordance disappears entirely.
      assert.equal(
        texts.includes(strings.roadmap.showingCount(2, 4)),
        false,
        'stale truncated-list affordance must be gone'
      );
    } finally {
      harness.restoreFetch();
      harness.renderer.unmount();
    }
  }
);
