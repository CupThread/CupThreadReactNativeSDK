import test, { type TestOptions } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import type {
  CommentDraft,
  FeatureRequestComment,
  FeatureRequestItem,
  ListFeatureRequestCommentsResult,
  VoteResult,
} from '../src/types';

// `FeatureRequestDetail` imports react-native, which cannot load under plain
// Node. Mock every symbol its render tree uses with lightweight stubs, then
// dynamically import the real modules so the mock is in place before
// evaluation. Module mocking needs Node >= 22.3 with
// --experimental-test-module-mocks; without it the render-level tests below
// are skipped.
const supportsModuleMocks = typeof (test as any).mock?.module === 'function';

const TouchableOpacityStub = (props: any) => props.children ?? null;
const TextStub = (props: any) => props.children ?? null;
const TextInputStub = () => null;
const ViewStub = (props: any) => {
  React.Children.forEach(props.children, (child) => {
    if (typeof child === 'string') {
      throw new Error(
        `Text strings must be rendered within a <Text> component. Found raw string: "${child}"`
      );
    }
  });
  return props.children ?? null;
};

if (supportsModuleMocks) {
  (test as any).mock.module('react-native', {
    namedExports: {
      useColorScheme: () => 'light',
      // Layout stubs must pass children through so nested pressables stay in
      // the rendered tree, but validate against raw string children as React Native does.
      View: ViewStub,
      Text: TextStub,
      TextInput: TextInputStub,
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
const { MarkdownText } = await import('../src/components/MarkdownText');
const { FeedbackClient } = await import('../src/client/FeedbackClient');
const { UserTokenStore } = await import('../src/client/UserTokenStore');
const { Badge } = await import('../src/components/Badge');

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
  postCalls: { featureRequestId: string; draft: CommentDraft }[] = [];
  deferredVotes = new Map<string, ReturnType<typeof createDeferred<VoteResult>>>();
  commentSources = new Map<string, FeatureRequestComment[]>();

  override async toggleVote(featureRequestId: string): Promise<VoteResult> {
    this.voteCalls.push(featureRequestId);
    const deferred = this.deferredVotes.get(featureRequestId);
    if (deferred) return deferred.promise;
    return { voted: true, voteCount: 42 };
  }

  override async listComments(featureRequestId: string): Promise<ListFeatureRequestCommentsResult> {
    this.commentCalls.push(featureRequestId);
    const comments = this.commentSources.get(featureRequestId) ?? [];
    return { comments, total: comments.length, hasMore: false, nextCursor: null };
  }

  override async postComment(
    featureRequestId: string,
    draft: CommentDraft
  ): Promise<FeatureRequestComment> {
    this.postCalls.push({ featureRequestId, draft });
    return {
      id: 'c_new',
      authorName: null,
      body: draft.body,
      createdAt: '2026-10-01T00:00:00.000Z',
    } as FeatureRequestComment;
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
  visible = true,
  locale?: string,
  sessionProvider?: () => string,
  configureClient?: (client: RecordingClient) => void
): Promise<DetailHarness> {
  // The provider's config fetch is the only call reaching global fetch; it
  // gets a rejection (non-fatal, falls back to system theme).
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('not found', { status: 404 })) as any;

  const client = new RecordingClient({
    baseUrl: 'https://api.cupthread.com',
    appKey: 'app_test_detail',
  });
  configureClient?.(client);
  const voteChangeCalls: FeatureRequestItem[] = [];

  const buildElement = (detailItem: FeatureRequestItem, detailVisible: boolean) =>
    React.createElement(CupThreadProvider, {
      client,
      userToken: 'usr_tok_test',
      locale,
      ...(sessionProvider ? { commentSessionProvider: sessionProvider } : {}),
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

/** Finds a pressable whose subtree renders exactly the given label text. */
function findButtonByText(
  root: TestRenderer.ReactTestRenderer['root'],
  label: string
): TestRenderer.ReactTestInstance | undefined {
  return root
    .findAllByType(TouchableOpacityStub as any)
    .find((button) =>
      button.findAllByType(TextStub as any).some((t) => t.props?.children === label)
    );
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
    const harness = await renderDetail(
      makeItem({ id: 'fr_A', voteCount: 5, hasVoted: false }),
      true
    );
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
        2,
        "A's late server truth must still reach the host list"
      );
      const reconciledA = harness.voteChangeCalls[1];
      assert.equal(reconciledA.id, 'fr_A');
      assert.equal(reconciledA.hasVoted, true);
      assert.equal(reconciledA.voteCount, 99, 'host must receive the server count for A');
    } finally {
      harness.restoreFetch();
      harness.renderer.unmount();
    }
  }
);

test(
  'late vote rejection for a previously displayed item rolls back the host list',
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
      assert.equal(harness.voteChangeCalls.length, 2, 'A rollback must reach the host list');
      const rolledBackA = harness.voteChangeCalls[1];
      assert.equal(rolledBackA.id, 'fr_A');
      assert.equal(rolledBackA.hasVoted, false);
      assert.equal(rolledBackA.voteCount, 5, 'host must restore the pre-vote count for A');
    } finally {
      harness.restoreFetch();
      harness.renderer.unmount();
    }
  }
);

test(
  'vote rollback reaches the host list after the detail unmounts',
  renderTestOptions,
  async () => {
    const deferredA = createDeferred<VoteResult>();
    const harness = await renderDetail(
      makeItem({ id: 'fr_A', voteCount: 5, hasVoted: false }),
      true
    );
    harness.client.deferredVotes.set('fr_A', deferredA);
    let unmounted = false;
    try {
      await act(async () => {
        harness.renderer.root.findByType(VoteButton).props.onPress();
      });
      await flush();
      assert.equal(harness.voteChangeCalls.length, 1, 'optimistic vote notifies the host');
      assert.equal(harness.voteChangeCalls[0].voteCount, 6);

      await act(async () => {
        harness.renderer.unmount();
      });
      unmounted = true;

      deferredA.reject(new Error('network gone'));
      await flush();

      assert.equal(
        harness.voteChangeCalls.length,
        2,
        'rollback must reach the host after the detail unmounts'
      );
      const rolledBack = harness.voteChangeCalls[1];
      assert.equal(rolledBack.id, 'fr_A');
      assert.equal(rolledBack.hasVoted, false);
      assert.equal(rolledBack.voteCount, 5);
    } finally {
      harness.restoreFetch();
      if (!unmounted) harness.renderer.unmount();
    }
  }
);

test(
  'server vote truth reaches the host list after the detail unmounts',
  renderTestOptions,
  async () => {
    const deferredA = createDeferred<VoteResult>();
    const harness = await renderDetail(
      makeItem({ id: 'fr_A', voteCount: 5, hasVoted: false }),
      true
    );
    harness.client.deferredVotes.set('fr_A', deferredA);
    let unmounted = false;
    try {
      await act(async () => {
        harness.renderer.root.findByType(VoteButton).props.onPress();
      });
      await flush();

      await act(async () => {
        harness.renderer.unmount();
      });
      unmounted = true;

      deferredA.resolve({ voted: true, voteCount: 99 });
      await flush();

      assert.equal(
        harness.voteChangeCalls.length,
        2,
        'server truth must reach the host after the detail unmounts'
      );
      const reconciled = harness.voteChangeCalls[1];
      assert.equal(reconciled.id, 'fr_A');
      assert.equal(reconciled.hasVoted, true);
      assert.equal(reconciled.voteCount, 99);
    } finally {
      harness.restoreFetch();
      if (!unmounted) harness.renderer.unmount();
    }
  }
);

test('detail renders calendar dates in the provider locale', renderTestOptions, async () => {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const createdAt = thirtyDaysAgo.toISOString();
  const item = makeItem({ id: 'fr_locale', createdAt, updatedAt: createdAt });
  const expected = thirtyDaysAgo.toLocaleDateString('de', {
    year: thirtyDaysAgo.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
    month: 'short',
    day: 'numeric',
  });

  const harness = await renderDetail(item, true, 'de');
  try {
    assert.ok(
      collectText(harness.renderer.root).includes(expected),
      `Expected "${expected}" in the rendered detail`
    );
  } finally {
    harness.restoreFetch();
    harness.renderer.unmount();
  }
});

test(
  'a reply armed in the comments section does not survive the documented item swap',
  renderTestOptions,
  async () => {
    const commentA: FeatureRequestComment = {
      id: 'c_a1',
      authorName: 'Alice',
      body: "Alice's comment on fr_A",
      createdAt: '2026-10-01T00:00:00.000Z',
    } as FeatureRequestComment;
    const commentB: FeatureRequestComment = {
      id: 'c_b1',
      authorName: 'Bob',
      body: "Bob's comment on fr_B",
      createdAt: '2026-10-02T00:00:00.000Z',
    } as FeatureRequestComment;

    const harness = await renderDetail(
      makeItem({ id: 'fr_A' }),
      true,
      undefined,
      () => 'clerk_jwt_live',
      (client) => {
        client.commentSources.set('fr_A', [commentA]);
        client.commentSources.set('fr_B', [commentB]);
      }
    );
    try {
      assert.ok(
        collectText(harness.renderer.root).includes("Alice's comment on fr_A"),
        "A's thread must render"
      );

      // Arm a reply on A's only comment.
      const replyButton = findButtonByText(harness.renderer.root, 'Reply');
      assert.ok(replyButton, 'reply affordance must render with a session source');
      await act(async () => {
        replyButton!.props.onPress();
      });
      assert.ok(
        collectText(harness.renderer.root).includes('Replying to @Alice'),
        'the reply bar must be armed before the swap'
      );

      // Documented keep-mounted swap to request B.
      await harness.update(makeItem({ id: 'fr_B' }), true);

      const text = collectText(harness.renderer.root);
      assert.ok(!text.includes('Replying to @Alice'), "A's reply bar must not survive the swap");
      assert.ok(!text.includes("Alice's comment on fr_A"), "A's comments must not render under B");
      assert.ok(text.includes("Bob's comment on fr_B"), "B's thread must render");

      // Posting after the swap must target B with no parent from A's thread.
      await act(async () => {
        harness.renderer.root.findByType(TextInputStub as any).props.onChangeText('Hello B');
      });
      const send = findButtonByText(harness.renderer.root, 'Post Comment');
      assert.ok(send, 'send button must exist');
      await act(async () => {
        send!.props.onPress();
      });
      await flush();

      assert.equal(harness.client.postCalls.length, 1);
      assert.equal(harness.client.postCalls[0].featureRequestId, 'fr_B');
      assert.equal(
        harness.client.postCalls[0].draft.parentId,
        undefined,
        "no parentId of A's comments may leak into the post against B"
      );
    } finally {
      harness.restoreFetch();
      harness.renderer.unmount();
    }
  }
);

test(
  'VoteButton in FeatureRequestDetail is disabled before token readiness and enables once ready (#202)',
  renderTestOptions,
  async () => {
    let resolveStorageToken!: (token: string | null) => void;
    const storagePromise = new Promise<string | null>((resolve) => {
      resolveStorageToken = resolve;
    });

    UserTokenStore.configure({
      getItem: () => storagePromise,
      setItem: async () => {},
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response('not found', { status: 404 })) as any;

    const client = new RecordingClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_test_detail',
    });

    const item = makeItem({ id: 'fr_readiness', voteCount: 5, hasVoted: false });

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(CupThreadProvider, {
          client,
          // userToken omitted so Provider defers to UserTokenStore.shared
          children: React.createElement(FeatureRequestDetail, {
            item,
            visible: true,
            onClose: () => {},
          }),
        })
      );
    });
    await flush();

    try {
      // 1. Before storage resolves, isTokenReady is false, VoteButton must be disabled
      const voteButtonBefore = renderer.root.findByType(VoteButton);
      assert.equal(voteButtonBefore.props.disabled, true);

      // Attempting to press while disabled should not trigger any client vote call
      await act(async () => {
        voteButtonBefore.props.onPress();
      });
      await flush();
      assert.equal(client.voteCalls.length, 0);

      // 2. Resolve storage token
      await act(async () => {
        resolveStorageToken('tok_async_resolved');
      });
      await flush();

      // 3. After token readiness resolves, VoteButton must be enabled
      const voteButtonAfter = renderer.root.findByType(VoteButton);
      assert.equal(voteButtonAfter.props.disabled, false);

      // Pressing now triggers client.toggleVote
      await act(async () => {
        voteButtonAfter.props.onPress();
      });
      await flush();
      assert.equal(client.voteCalls.length, 1);
      assert.equal(client.voteCalls[0], 'fr_readiness');
    } finally {
      globalThis.fetch = originalFetch;
      UserTokenStore.resetSharedForTests();
      renderer?.unmount();
    }
  }
);

test(
  'FeatureRequestDetail: empty or whitespace-only description does not render descCard (#251)',
  renderTestOptions,
  async () => {
    const isDescCard = (node: any) =>
      Array.isArray(node.props?.style) &&
      node.props.style.some(
        (s: any) => s?.padding === 14 && s?.borderRadius === 10 && s?.marginBottom === 12
      );

    // 1. Whitespace-only description
    const whitespaceItem = makeItem({ id: 'fr_ws', description: '   \n  \t  ' });
    const harness = await renderDetail(whitespaceItem, true);

    try {
      const descCardsWs = harness.renderer.root.findAll(isDescCard);
      assert.equal(
        descCardsWs.length,
        0,
        'must not render descCard when description is whitespace-only'
      );
      assert.equal(
        harness.renderer.root.findAllByType(MarkdownText).length,
        0,
        'must not render MarkdownText when description is whitespace-only'
      );

      // 2. Empty string description
      await harness.update(makeItem({ id: 'fr_empty', description: '' }), true);
      const descCardsEmpty = harness.renderer.root.findAll(isDescCard);
      assert.equal(
        descCardsEmpty.length,
        0,
        'must not render descCard when description is empty string'
      );
      assert.equal(
        harness.renderer.root.findAllByType(MarkdownText).length,
        0,
        'must not render MarkdownText when description is empty string'
      );

      // 3. Undefined description
      await harness.update(makeItem({ id: 'fr_undef', description: undefined as any }), true);
      const descCardsUndef = harness.renderer.root.findAll(isDescCard);
      assert.equal(
        descCardsUndef.length,
        0,
        'must not render descCard when description is undefined'
      );
      assert.equal(
        harness.renderer.root.findAllByType(MarkdownText).length,
        0,
        'must not render MarkdownText when description is undefined'
      );

      // 4. Non-empty description renders descCard and MarkdownText
      await harness.update(
        makeItem({ id: 'fr_valid', description: 'This is a valid feature description' }),
        true
      );
      const descCardsValid = harness.renderer.root.findAll(isDescCard);
      assert.equal(
        descCardsValid.length,
        1,
        'must render descCard when description contains non-whitespace text'
      );
      const markdownNodes = harness.renderer.root.findAllByType(MarkdownText);
      assert.equal(markdownNodes.length, 1);
      assert.equal(markdownNodes[0].props.content, 'This is a valid feature description');
      assert.ok(collectText(harness.renderer.root).includes('This is a valid feature description'));
    } finally {
      harness.restoreFetch();
      harness.renderer.unmount();
    }
  }
);

test(
  'FeatureRequestDetail: whitespace-only requesterName falls back to Anonymous and trims padded names (#270)',
  renderTestOptions,
  async () => {
    // 1. Whitespace-only requesterName falls back to Anonymous
    const wsItem = makeItem({ id: 'fr_ws_req', requesterName: '   \t  ' });
    const harness = await renderDetail(wsItem, true);

    try {
      const textWs = collectText(harness.renderer.root);
      assert.ok(
        textWs.includes('Anonymous'),
        'must display Anonymous fallback when requesterName is whitespace-only'
      );

      // 2. Whitespace-padded requesterName is trimmed
      await harness.update(
        makeItem({ id: 'fr_padded_req', requesterName: '  Taylor Swift  ' }),
        true
      );
      const textPadded = collectText(harness.renderer.root);
      assert.ok(
        textPadded.includes('Taylor Swift'),
        'must display trimmed name when requesterName contains surrounding whitespace'
      );
      assert.ok(
        !textPadded.includes('  Taylor Swift  '),
        'must not display leading/trailing whitespace in requester name'
      );

      // 3. Null or undefined requesterName falls back to Anonymous
      await harness.update(makeItem({ id: 'fr_null_req', requesterName: null as any }), true);
      const textNull = collectText(harness.renderer.root);
      assert.ok(
        textNull.includes('Anonymous'),
        'must display Anonymous fallback when requesterName is null'
      );
    } finally {
      harness.restoreFetch();
      harness.renderer.unmount();
    }
  }
);

// ---------------------------------------------------------------------------
// Issue #309 — FeatureRequestDetail: raw empty-string render in item.columnName
// ---------------------------------------------------------------------------

test(
  'FeatureRequestDetail: empty-string or whitespace-only columnName does not crash View and renders valid columnName trimmed (#309)',
  renderTestOptions,
  async () => {
    // 1. When item has columnName: "" (empty string), it must not crash View with raw string
    const emptyColItem = makeItem({ id: 'fr_empty_col', columnName: '' });
    const harness = await renderDetail(emptyColItem, true);

    try {
      const badges = harness.renderer.root.findAllByType(Badge);
      assert.equal(
        badges.length,
        0,
        'must not render Badge component when columnName is an empty string'
      );

      // 2. When item has columnName: null, it safely renders null
      await harness.update(makeItem({ id: 'fr_null_col', columnName: null }), true);
      assert.equal(
        harness.renderer.root.findAllByType(Badge).length,
        0,
        'must not render Badge component when columnName is null'
      );

      // 3. When item has whitespace-only columnName: "   \t  ", it safely renders null
      await harness.update(makeItem({ id: 'fr_ws_col', columnName: '   \t  ' }), true);
      const wsBadges = harness.renderer.root.findAllByType(Badge);
      assert.equal(
        wsBadges.length,
        0,
        'must not render Badge component when columnName is whitespace-only'
      );

      // 4. When item has valid columnName: "  In Progress  ", it renders Badge with trimmed label
      await harness.update(
        makeItem({
          id: 'fr_valid_col',
          columnName: '  In Progress  ',
          columnColor: '#3b82f6',
        }),
        true
      );
      const validBadges = harness.renderer.root.findAllByType(Badge);
      assert.equal(validBadges.length, 1, 'must render Badge for valid columnName');
      assert.equal(validBadges[0].props.label, 'In Progress');
      assert.equal(validBadges[0].props.color, '#3b82f6');
    } finally {
      harness.restoreFetch();
      harness.renderer.unmount();
    }
  }
);

test(
  'FeatureRequestDetail: safely handles non-string truthy requesterName, description, and title without throwing TypeError (#299)',
  renderTestOptions,
  async () => {
    // 1. requesterName as number 123, description as number 12345, title as object
    const malformedItem1 = makeItem({
      id: 'fr_malformed_1',
      title: { invalid: true } as any,
      requesterName: 123 as any,
      description: 12345 as any,
    });
    const harness1 = await renderDetail(malformedItem1, true);

    try {
      const text1 = collectText(harness1.renderer.root);
      assert.ok(
        text1.includes('Anonymous'),
        'fallback Anonymous must be rendered for non-string requesterName'
      );
      const markdownNodes1 = harness1.renderer.root.findAllByType(MarkdownText);
      assert.equal(
        markdownNodes1.length,
        0,
        'MarkdownText must not render when description is a non-string'
      );

      // 2. requesterName as boolean true, description as boolean true, title as boolean true
      const malformedItem2 = makeItem({
        id: 'fr_malformed_2',
        title: true as any,
        requesterName: true as any,
        description: true as any,
      });
      await harness1.update(malformedItem2, true);
      const text2 = collectText(harness1.renderer.root);
      assert.ok(
        text2.includes('Anonymous'),
        'fallback Anonymous must be rendered for boolean requesterName'
      );
      assert.equal(harness1.renderer.root.findAllByType(MarkdownText).length, 0);

      // 3. requesterName as object {}, description as object {}
      const malformedItem3 = makeItem({
        id: 'fr_malformed_3',
        requesterName: {} as any,
        description: {} as any,
      });
      await harness1.update(malformedItem3, true);
      const text3 = collectText(harness1.renderer.root);
      assert.ok(
        text3.includes('Anonymous'),
        'fallback Anonymous must be rendered for object requesterName'
      );
      assert.equal(harness1.renderer.root.findAllByType(MarkdownText).length, 0);

      // 4. requesterName as whitespace-only, description as whitespace-only
      const malformedItem4 = makeItem({
        id: 'fr_malformed_4',
        requesterName: '   \t  ',
        description: '   \n  ',
      });
      await harness1.update(malformedItem4, true);
      const text4 = collectText(harness1.renderer.root);
      assert.ok(
        text4.includes('Anonymous'),
        'fallback Anonymous must be rendered for whitespace requesterName'
      );
      assert.equal(harness1.renderer.root.findAllByType(MarkdownText).length, 0);

      // 5. Valid requesterName, description, and title
      const validItem = makeItem({
        id: 'fr_valid',
        title: 'Valid Feature Title',
        requesterName: '   Sarah Connor   ',
        description: '   Protect John Connor   ',
      });
      await harness1.update(validItem, true);
      const text5 = collectText(harness1.renderer.root);
      assert.ok(text5.includes('Valid Feature Title'), 'valid title must be rendered');
      assert.ok(text5.includes('Sarah Connor'), 'trimmed requesterName must be rendered');
      const markdownNodes5 = harness1.renderer.root.findAllByType(MarkdownText);
      assert.equal(markdownNodes5.length, 1, 'MarkdownText must be rendered for valid description');
    } finally {
      harness1.restoreFetch();
      harness1.renderer.unmount();
    }
  }
);

test(
  'FeatureRequestDetail: author row hides separator bullet dot and date text when createdAt is missing, empty, or invalid (#324)',
  renderTestOptions,
  async () => {
    // 1. Item with empty string createdAt
    const harness = await renderDetail(
      makeItem({
        id: 'fr_created_at_empty',
        requesterName: 'Alice',
        createdAt: '',
      })
    );

    try {
      const textEmpty = collectText(harness.renderer.root);
      assert.ok(textEmpty.includes('Alice'), 'requesterName Alice must be rendered');
      assert.ok(
        !textEmpty.includes('•'),
        'bullet dot must not be rendered when createdAt is empty string'
      );

      // 2. Item with undefined createdAt
      await harness.update(
        makeItem({
          id: 'fr_created_at_undefined',
          requesterName: 'Bob',
          createdAt: undefined as any,
        }),
        true
      );
      const textUndefined = collectText(harness.renderer.root);
      assert.ok(textUndefined.includes('Bob'), 'requesterName Bob must be rendered');
      assert.ok(
        !textUndefined.includes('•'),
        'bullet dot must not be rendered when createdAt is undefined'
      );

      // 3. Item with null createdAt
      await harness.update(
        makeItem({
          id: 'fr_created_at_null',
          requesterName: 'Charlie',
          createdAt: null as any,
        }),
        true
      );
      const textNull = collectText(harness.renderer.root);
      assert.ok(textNull.includes('Charlie'), 'requesterName Charlie must be rendered');
      assert.ok(!textNull.includes('•'), 'bullet dot must not be rendered when createdAt is null');

      // 4. Item with whitespace-only createdAt
      await harness.update(
        makeItem({
          id: 'fr_created_at_ws',
          requesterName: 'Dave',
          createdAt: '   \t  \n  ',
        }),
        true
      );
      const textWs = collectText(harness.renderer.root);
      assert.ok(textWs.includes('Dave'), 'requesterName Dave must be rendered');
      assert.ok(
        !textWs.includes('•'),
        'bullet dot must not be rendered when createdAt is whitespace-only'
      );

      // 5. Item with non-string createdAt
      await harness.update(
        makeItem({
          id: 'fr_created_at_non_string',
          requesterName: 'Eve',
          createdAt: 123456 as any,
        }),
        true
      );
      const textNonString = collectText(harness.renderer.root);
      assert.ok(textNonString.includes('Eve'), 'requesterName Eve must be rendered');
      assert.ok(
        !textNonString.includes('•'),
        'bullet dot must not be rendered when createdAt is non-string'
      );

      // 6. Item with valid createdAt ISO timestamp
      await harness.update(
        makeItem({
          id: 'fr_created_at_valid',
          requesterName: 'Grace',
          createdAt: '2026-08-10T14:00:00.000Z',
        }),
        true
      );
      const textValid = collectText(harness.renderer.root);
      assert.ok(textValid.includes('Grace'), 'requesterName Grace must be rendered');
      assert.ok(textValid.includes('•'), 'bullet dot must be rendered when createdAt is valid');
      assert.ok(
        textValid.includes('Aug 10'),
        'formatted date must be rendered when createdAt is valid'
      );
    } finally {
      harness.restoreFetch();
      harness.renderer.unmount();
    }
  }
);
