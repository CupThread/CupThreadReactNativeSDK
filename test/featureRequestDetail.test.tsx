import test, { type TestOptions } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import type { FeatureRequestComment, FeatureRequestItem, VoteResult } from '../src/types';

// `FeatureRequestDetail` imports react-native, which cannot load under plain
// Node. Mock every symbol its render tree uses with lightweight stubs, then
// dynamically import the real modules so the mock is in place before
// evaluation. Module mocking needs Node >= 22.3 with
// --experimental-test-module-mocks; without it the render-level tests below
// are skipped.
const supportsModuleMocks = typeof (test as any).mock?.module === 'function';

const TouchableOpacityStub = (props: any) => props.children ?? null;
const TextStub = (props: any) => props.children ?? null;

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
      Image: () => null,
      Linking: { openURL: async () => {}, canOpenURL: async () => true },
      StyleSheet: { create: (styles: any) => styles, flatten: (s: any) => s },
      Alert: { alert: () => {} },
    },
  });
}

const { CupThreadProvider } = await import('../src/theme/CupThreadThemeProvider');
const { FeatureRequestDetail } = await import('../src/components/FeatureRequestDetail');
const { VoteButton } = await import('../src/components/VoteButton');
const { FeedbackClient } = await import('../src/client/FeedbackClient');

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

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Client stub: vote toggles and comment fetches are recorded and served
 * locally, so no network is involved. Per-item deferreds let tests hold a
 * vote request in flight and settle it later.
 */
class RecordingClient extends FeedbackClient {
  voteCalls: string[] = [];
  commentCalls: string[] = [];
  deferredVotes = new Map<string, ReturnType<typeof createDeferred<VoteResult>>>();

  override async toggleVote(featureRequestId: string): Promise<VoteResult> {
    this.voteCalls.push(featureRequestId);
    const deferred = this.deferredVotes.get(featureRequestId);
    if (deferred) return deferred.promise;
    return { voted: true, voteCount: 42 };
  }

  override async fetchComments(featureRequestId: string): Promise<FeatureRequestComment[]> {
    this.commentCalls.push(featureRequestId);
    return [];
  }
}

function makeItem(overrides: Partial<FeatureRequestItem> & { id: string }): FeatureRequestItem {
  return {
    appId: 'app_test_detail',
    title: `Request ${overrides.id}`,
    description: `Description for ${overrides.id}`,
    status: 'open',
    approved: true,
    voteCount: 5,
    hasVoted: false,
    isOwnRequest: false,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Concatenates every text leaf in the rendered tree. */
function collectText(node: TestRenderer.ReactTestInstance): string {
  let out = '';
  for (const child of node.children) {
    if (typeof child === 'string') out += child;
    else out += collectText(child);
  }
  return out;
}

interface DetailHarness {
  renderer: TestRenderer.ReactTestRenderer;
  client: RecordingClient;
  voteChangeCalls: FeatureRequestItem[];
  restoreFetch: () => void;
  update: (item: FeatureRequestItem, visible?: boolean) => Promise<void>;
}

async function renderDetail(
  item: FeatureRequestItem,
  visible = true
): Promise<DetailHarness> {
  // The provider's config fetch is the only call reaching global fetch; it
  // gets a rejection (non-fatal, falls back to system theme).
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('not found', { status: 404 })) as any;

  const client = new RecordingClient({ baseUrl: 'https://api.cupthread.com', appKey: 'app_test_detail' });
  const voteChangeCalls: FeatureRequestItem[] = [];

  const buildElement = (detailItem: FeatureRequestItem, detailVisible: boolean) =>
    React.createElement(CupThreadProvider, {
      client,
      userToken: 'usr_tok_test',
      children: React.createElement(FeatureRequestDetail, {
        item: detailItem,
        visible: detailVisible,
        onClose: () => {},
        onVoteChange: (updated: FeatureRequestItem) => voteChangeCalls.push(updated),
      }),
    });

  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(buildElement(item, visible));
  });
  await flush();

  return {
    renderer,
    client,
    voteChangeCalls,
    restoreFetch: () => {
      globalThis.fetch = originalFetch;
    },
    update: async (nextItem: FeatureRequestItem, nextVisible = true) => {
      await act(async () => {
        renderer.update(buildElement(nextItem, nextVisible));
      });
      await flush();
    },
  };
}

function getVoteButtonProps(harness: DetailHarness): { voteCount: number; hasVoted: boolean } {
  const node = harness.renderer.root.findByType(VoteButton);
  return { voteCount: node.props.voteCount, hasVoted: node.props.hasVoted };
}

test(
  'mounted detail switches to a newly passed item: content, comments thread, and vote state follow',
  renderTestOptions,
  async () => {
    const itemA = makeItem({ id: 'fr_A', voteCount: 5, hasVoted: false });
    const itemB = makeItem({ id: 'fr_B', voteCount: 2, hasVoted: true });

    const harness = await renderDetail(itemA, true);
    try {
      assert.equal(harness.client.commentCalls[0], 'fr_A');
      assert.ok(collectText(harness.renderer.root).includes('Request fr_A'));

      // Documented keep-mounted pattern: close (component stays mounted),
      // open another request on the same instance.
      await harness.update(itemB, false);
      await harness.update(itemB, true);

      const text = collectText(harness.renderer.root);
      assert.ok(text.includes('Request fr_B'), 'must render the newly passed item');
      assert.ok(!text.includes('Request fr_A'), 'must not render the previous item');
      assert.ok(harness.client.commentCalls.includes('fr_B'), 'comments must target the new item');
      assert.deepEqual(getVoteButtonProps(harness), { voteCount: 2, hasVoted: true });
    } finally {
      harness.restoreFetch();
      harness.renderer.unmount();
    }
  }
);

test(
  'vote press after an item switch toggles the newly displayed request',
  renderTestOptions,
  async () => {
    const harness = await renderDetail(makeItem({ id: 'fr_A' }), true);
    try {
      await harness.update(makeItem({ id: 'fr_B', voteCount: 2 }), true);

      await act(async () => {
        harness.renderer.root.findByType(VoteButton).props.onPress();
      });
      await flush();

      assert.deepEqual(harness.client.voteCalls, ['fr_B'], 'vote must target the displayed item');
      assert.equal(harness.voteChangeCalls[0]?.id, 'fr_B');
    } finally {
      harness.restoreFetch();
      harness.renderer.unmount();
    }
  }
);

test(
  'same-id prop refresh keeps current state and does not clobber settled vote results',
  renderTestOptions,
  async () => {
    const harness = await renderDetail(makeItem({ id: 'fr_A', voteCount: 5, hasVoted: false }), true);
    try {
      await act(async () => {
        harness.renderer.root.findByType(VoteButton).props.onPress();
      });
      await flush();
      assert.deepEqual(getVoteButtonProps(harness), { voteCount: 42, hasVoted: true });

      // Host data still holds the stale pre-vote object for the same id.
      await harness.update(makeItem({ id: 'fr_A', voteCount: 5, hasVoted: false }), true);

      assert.deepEqual(
        getVoteButtonProps(harness),
        { voteCount: 42, hasVoted: true },
        'same-id prop refresh must keep the settled vote state'
      );
    } finally {
      harness.restoreFetch();
      harness.renderer.unmount();
    }
  }
);

test(
  'late vote success for a previously displayed item must not mutate the newly shown one',
  renderTestOptions,
  async () => {
    const deferredA = createDeferred<VoteResult>();
    const harness = await renderDetail(makeItem({ id: 'fr_A', voteCount: 5 }), true);
    harness.client.deferredVotes.set('fr_A', deferredA);
    try {
      await act(async () => {
        harness.renderer.root.findByType(VoteButton).props.onPress();
      });
      await flush();
      assert.equal(harness.voteChangeCalls.length, 1, 'optimistic A vote notifies the host once');
      assert.equal(harness.voteChangeCalls[0].id, 'fr_A');

      await harness.update(makeItem({ id: 'fr_B', voteCount: 2, hasVoted: false }), true);

      deferredA.resolve({ voted: true, voteCount: 99 });
      await flush();

      assert.deepEqual(
        getVoteButtonProps(harness),
        { voteCount: 2, hasVoted: false },
        "A's late server truth must not land on B"
      );
      assert.equal(
        harness.voteChangeCalls.length,
        1,
        "A's late response must not notify the host again"
      );
    } finally {
      harness.restoreFetch();
      harness.renderer.unmount();
    }
  }
);

test(
  'late vote rejection for a previously displayed item must not roll back the newly shown one',
  renderTestOptions,
  async () => {
    const deferredA = createDeferred<VoteResult>();
    const harness = await renderDetail(makeItem({ id: 'fr_A', voteCount: 5 }), true);
    harness.client.deferredVotes.set('fr_A', deferredA);
    try {
      await act(async () => {
        harness.renderer.root.findByType(VoteButton).props.onPress();
      });
      await flush();

      await harness.update(makeItem({ id: 'fr_B', voteCount: 2, hasVoted: false }), true);

      deferredA.reject(new Error('network gone'));
      await flush();

      assert.deepEqual(
        getVoteButtonProps(harness),
        { voteCount: 2, hasVoted: false },
        "A's late rollback must not clobber B's vote fields"
      );
      assert.deepEqual(harness.client.voteCalls, ['fr_A']);
    } finally {
      harness.restoreFetch();
      harness.renderer.unmount();
    }
  }
);
