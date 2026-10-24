import test, { type TestOptions } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { FeedbackClient } from '../src/client/FeedbackClient';
import type { FeatureRequestItem, VoteResult } from '../src/types';

// `FeatureRequestsScreen` and its detail view import react-native, which
// cannot load under plain Node. Mock every symbol the screen tree uses with
// lightweight stubs, then dynamically import the real modules so the mock is
// in place before evaluation. Module mocking needs Node >= 22.3 with
// --experimental-test-module-mocks; without it the render-level test below is
// skipped.
const supportsModuleMocks = typeof (test as any).mock?.module === 'function';

const flatListProps: any[] = [];

const TouchableOpacityStub = (props: any) => props.children ?? null;
const TextStub = (props: any) => props.children ?? null;

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

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const renderTestOptions: TestOptions = supportsModuleMocks
  ? {}
  : {
      skip: 'node:test module mocking unavailable (needs Node >= 22.3 with --experimental-test-module-mocks)',
    };

function makeItem(
  overrides: Partial<FeatureRequestItem> & { id: string; title: string }
): FeatureRequestItem {
  return {
    appId: 'app_test_vote_sync',
    description: `Description for ${overrides.title}`,
    status: 'planned',
    approved: true,
    voteCount: 1,
    hasVoted: false,
    isOwnRequest: false,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

interface FetchRoute {
  status: number;
  body?: unknown;
}

const ok = (body: unknown): FetchRoute => ({ status: 200, body });

/**
 * Fetch stub for the screen's page-0 and columns calls. The config endpoint
 * always 404s (the provider falls back silently) and versions succeeds with an
 * empty list, keeping the versions chip row out of the tree.
 */
function installFetch(routes: { page0: FetchRoute }): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
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
      return respond(ok([]));
    }
    if (target.includes('/api/v1/public/versions/')) {
      return respond(ok({ versions: [] }));
    }
    if (target.includes('/api/v1/feature-requests')) {
      return respond(routes.page0);
    }
    return new Response('not found', { status: 404 });
  }) as any;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

async function settle(ms = 60): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
  await act(async () => {});
}

async function waitForText(
  renderer: TestRenderer.ReactTestRenderer,
  predicate: (text: string) => boolean,
  timeoutMs = 4000
): Promise<void> {
  const start = Date.now();
  for (;;) {
    const match = renderer.root
      .findAllByType(TextStub as any)
      .some(
        (node: any) => typeof node.props?.children === 'string' && predicate(node.props.children)
      );
    if (match) return;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitForText timed out after ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
    await act(async () => {});
  }
}

function findCard(renderer: TestRenderer.ReactTestRenderer, title: string): any {
  const cards = renderer.root.findAll(
    (node: any) =>
      node.type === TouchableOpacityStub &&
      typeof node.props?.onPress === 'function' &&
      node.findAllByType(TextStub as any).some((text: any) => text.props?.children === title)
  );
  return cards[cards.length - 1] ?? null;
}

async function pullToRefresh(): Promise<void> {
  const list = flatListProps[flatListProps.length - 1];
  assert.ok(list?.refreshControl, 'rendered list must expose a RefreshControl');
  await act(async () => {
    await list.refreshControl.props.onRefresh();
  });
  await settle();
}

test(
  'late vote settlement merges vote fields into a row refreshed while the detail was open',
  renderTestOptions,
  async () => {
    // Imported here rather than at module scope so a run without module
    // mocking (where this test is skipped) never evaluates react-native.
    const { CupThreadProvider } = await import('../src/theme/CupThreadThemeProvider');
    const { FeatureRequestsScreen } = await import('../src/components/FeatureRequestsScreen');
    const { VoteButton } = await import('../src/components/VoteButton');

    flatListProps.length = 0;
    const routes = {
      page0: ok({
        requests: [makeItem({ id: 'fr_a', title: 'Original title', voteCount: 1 })],
        total: 1,
      }),
    };

    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_test_vote_sync',
    });
    let resolveVote!: (result: VoteResult) => void;
    client.toggleVote = () =>
      new Promise<VoteResult>((resolve) => {
        resolveVote = resolve;
      });

    const restoreFetch = installFetch(routes);
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(CupThreadProvider, {
          client,
          userToken: 'usr_tok_test',
          children: React.createElement(FeatureRequestsScreen),
        })
      );
    });

    try {
      await waitForText(renderer, (text) => text === 'Original title');

      const card = findCard(renderer, 'Original title');
      assert.ok(card, 'the loaded row must open the detail view');
      await act(async () => {
        card.props.onPress();
      });
      await settle();

      const voteButtons = renderer.root.findAllByType(VoteButton as any);
      assert.ok(voteButtons.length >= 2, 'both the row and the detail must render a vote button');
      // The detail is rendered after the list, so its button is last.
      const detailVoteButton = voteButtons[voteButtons.length - 1];
      await act(async () => {
        detailVoteButton.props.onPress();
      });
      await settle();

      // Host refresh while the detail stays open: same id, newer non-vote
      // fields and a vote state that already matches the optimistic one.
      routes.page0 = ok({
        requests: [
          makeItem({
            id: 'fr_a',
            title: 'Refreshed title',
            description: 'Refreshed description',
            voteCount: 11,
            hasVoted: true,
            updatedAt: '2026-08-02T00:00:00.000Z',
          }),
        ],
        total: 1,
      });
      await pullToRefresh();
      assert.equal(
        flatListProps[flatListProps.length - 1].data[0].title,
        'Refreshed title',
        'refresh must replace the row with the newer server data'
      );

      await act(async () => {
        resolveVote({ voted: true, voteCount: 12 });
      });
      await settle();

      const row = flatListProps[flatListProps.length - 1].data[0];
      assert.equal(
        row.title,
        'Refreshed title',
        'a late vote settlement must not replace newer non-vote fields'
      );
      assert.equal(row.description, 'Refreshed description');
      assert.equal(row.hasVoted, true);
      assert.equal(row.voteCount, 12, 'the server vote count must land on the host row');
    } finally {
      restoreFetch();
      renderer.unmount();
    }
  }
);
