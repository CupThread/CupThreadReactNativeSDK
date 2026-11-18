import test, { type TestOptions } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import type {
  CommentDraft,
  FeatureRequestComment,
  ListFeatureRequestCommentsResult,
} from '../src/types';

// `CommentsSection` imports react-native, which cannot load under plain Node.
// Mock every symbol its render tree uses with lightweight stubs, then
// dynamically import the real modules so the mock is in place before
// evaluation. Module mocking needs Node >= 22.3 with
// --experimental-test-module-mocks; without it the render-level tests below
// are skipped.
const supportsModuleMocks = typeof (test as any).mock?.module === 'function';

const TouchableOpacityStub = (props: any) => props.children ?? null;
const TextStub = (props: any) => props.children ?? null;
const TextInputStub = () => null;

if (supportsModuleMocks) {
  (test as any).mock.module('react-native', {
    namedExports: {
      useColorScheme: () => 'light',
      // Layout stubs must pass children through so nested pressables stay in
      // the rendered tree.
      View: ({ children }: any) => children ?? null,
      Text: TextStub,
      TextInput: TextInputStub,
      TouchableOpacity: TouchableOpacityStub,
      ActivityIndicator: () => null,
      Image: () => null,
      Linking: { openURL: async () => {}, canOpenURL: async () => true },
      StyleSheet: { create: (styles: any) => styles, flatten: (s: any) => s },
    },
  });
}

const { CupThreadProvider } = await import('../src/theme/CupThreadThemeProvider');
const { CommentsSection } = await import('../src/components/CommentsSection');
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

function makeComment(
  id: string,
  overrides: Partial<FeatureRequestComment> = {}
): FeatureRequestComment {
  return {
    id,
    authorName: 'Seeder',
    body: `Comment ${id}`,
    createdAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  } as FeatureRequestComment;
}

interface PostCall {
  featureRequestId: string;
  draft: CommentDraft;
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
 * Client stub serving per-request comment threads, with per-request
 * deferreds and failures so tests can hold a thread's fetch in flight across
 * a documented id swap.
 */
class SwapStubClient extends FeedbackClient {
  fetchCalls: string[] = [];
  postCalls: PostCall[] = [];
  commentSources = new Map<string, FeatureRequestComment[]>();
  paginatedSources = new Map<
    string,
    { base: FeatureRequestComment[]; more: FeatureRequestComment[]; cursor: string }
  >();
  deferredLoadMore?: ReturnType<typeof createDeferred<ListFeatureRequestCommentsResult>>;
  deferredFetches = new Map<
    string,
    ReturnType<typeof createDeferred<ListFeatureRequestCommentsResult>>
  >();
  deferredPosts = new Map<string, ReturnType<typeof createDeferred<FeatureRequestComment>>>();
  fetchFailures = new Set<string>();
  postedComment = makeComment('c_new', { authorName: null, body: 'Freshly posted' });
  override async listComments(
    featureRequestId: string,
    opts?: { cursor?: string | null }
  ): Promise<ListFeatureRequestCommentsResult> {
    this.fetchCalls.push(featureRequestId);
    const paginated = this.paginatedSources.get(featureRequestId);
    if (paginated) {
      if (!opts?.cursor) {
        return {
          comments: paginated.base,
          total: paginated.base.length + paginated.more.length,
          hasMore: true,
          nextCursor: paginated.cursor,
        };
      }
      if (opts.cursor === paginated.cursor && this.deferredLoadMore) {
        return this.deferredLoadMore.promise;
      }
      if (opts.cursor === paginated.cursor) {
        return {
          comments: paginated.more,
          total: paginated.base.length + paginated.more.length,
          hasMore: false,
          nextCursor: null,
        };
      }
    }

    const deferred = this.deferredFetches.get(featureRequestId);
    if (deferred) return deferred.promise;
    if (this.fetchFailures.has(featureRequestId)) throw new Error('network gone');
    const comments = this.commentSources.get(featureRequestId) ?? [];
    return { comments, total: comments.length, hasMore: false, nextCursor: null };
  }

  override async postComment(
    featureRequestId: string,
    draft: CommentDraft
  ): Promise<FeatureRequestComment> {
    this.postCalls.push({ featureRequestId, draft });
    const deferred = this.deferredPosts.get(featureRequestId);
    if (deferred) return deferred.promise;
    return this.postedComment;
  }
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

interface SwapHarness {
  renderer: TestRenderer.ReactTestRenderer;
  client: SwapStubClient;
  restoreFetch: () => void;
  /** Re-renders the mounted section with a new featureRequestId. */
  swap: (featureRequestId: string) => Promise<void>;
}

async function renderSwapHarness(): Promise<SwapHarness> {
  // The provider's config fetch is the only call reaching global fetch; it
  // gets a rejection (non-fatal, falls back to system theme).
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('not found', { status: 404 })) as any;

  const client = new SwapStubClient({
    baseUrl: 'https://api.cupthread.com',
    appKey: 'app_comments_swap_test',
  });
  // Both threads are seeded up front; deferreds and failures registered by a
  // test take precedence inside listComments.
  client.commentSources.set('fr_A', [COMMENT_A]);
  client.commentSources.set('fr_B', [COMMENT_B]);

  const buildElement = (featureRequestId: string) =>
    React.createElement(CupThreadProvider, {
      client,
      userToken: 'usr_tok_test',
      commentSessionProvider: () => 'clerk_jwt_live',
      children: React.createElement(CommentsSection, { featureRequestId }),
    });

  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(buildElement('fr_A'));
  });
  await flush();

  return {
    renderer,
    client,
    restoreFetch: () => {
      globalThis.fetch = originalFetch;
    },
    swap: async (featureRequestId: string) => {
      await act(async () => {
        renderer.update(buildElement(featureRequestId));
      });
      await flush();
    },
  };
}

const COMMENT_A = makeComment('c_a', { authorName: 'Alice', body: 'Alpha thread comment' });
const COMMENT_B = makeComment('c_b', { authorName: 'Bob', body: 'Beta thread comment' });

test(
  'an armed reply, the draft, and the loaded thread reset when the host swaps the request id',
  renderTestOptions,
  async () => {
    const harness = await renderSwapHarness();
    try {
      assert.ok(
        collectText(harness.renderer.root).includes('Alpha thread comment'),
        'thread A comments must render'
      );

      // Arm a reply on A's only comment and type a draft for A.
      const replyButton = findButtonByText(harness.renderer.root, 'Reply');
      assert.ok(replyButton, 'reply affordance must render with a session source');
      await act(async () => {
        replyButton!.props.onPress();
      });
      await act(async () => {
        harness.renderer.root.findByType(TextInputStub as any).props.onChangeText('Draft for A');
      });
      assert.ok(
        collectText(harness.renderer.root).includes('Replying to @Alice'),
        'reply bar must be armed before the swap'
      );

      // Hold B's fetch in flight and swap the documented way.
      const deferredB = createDeferred<ListFeatureRequestCommentsResult>();
      harness.client.deferredFetches.set('fr_B', deferredB);
      await harness.swap('fr_B');

      let text = collectText(harness.renderer.root);
      assert.ok(!text.includes('Replying to @Alice'), "A's reply bar must not survive the swap");
      assert.equal(
        harness.renderer.root.findByType(TextInputStub as any).props.value,
        '',
        "A's draft must not survive the swap"
      );
      assert.ok(
        !text.includes('Alpha thread comment'),
        "A's comments must not render while B's fetch is in flight"
      );

      deferredB.resolve({ comments: [COMMENT_B], total: 1, hasMore: false, nextCursor: null });
      await flush();

      text = collectText(harness.renderer.root);
      assert.ok(text.includes('Beta thread comment'), "B's comments must render once loaded");
      assert.ok(!text.includes('Alpha thread comment'), "A's comments must stay gone");
      assert.ok(harness.client.fetchCalls.includes('fr_B'), 'the swap must refetch for B');
    } finally {
      harness.restoreFetch();
      harness.renderer.unmount();
    }
  }
);

test(
  'a reply armed on the previous thread posts no parentId against the new thread',
  renderTestOptions,
  async () => {
    const harness = await renderSwapHarness();
    try {
      const replyButton = findButtonByText(harness.renderer.root, 'Reply');
      assert.ok(replyButton);
      await act(async () => {
        replyButton!.props.onPress();
      });
      assert.ok(collectText(harness.renderer.root).includes('Replying to @Alice'));

      await harness.swap('fr_B');
      assert.ok(
        !collectText(harness.renderer.root).includes('Replying to @Alice'),
        'the reply bar must be disarmed after the swap'
      );

      const input = harness.renderer.root.findByType(TextInputStub as any);
      await act(async () => {
        input.props.onChangeText('Hello thread B');
      });
      const send = findButtonByText(harness.renderer.root, 'Post Comment');
      assert.ok(send, 'send button must exist');
      await act(async () => {
        send!.props.onPress();
      });
      await flush();

      assert.equal(harness.client.postCalls.length, 1);
      const call = harness.client.postCalls[0];
      assert.equal(call.featureRequestId, 'fr_B', 'the post must target the displayed thread');
      assert.equal(
        call.draft.parentId,
        undefined,
        "no parentId of the previous thread's comments may leak into the post"
      );
      assert.equal(call.draft.body, 'Hello thread B');
    } finally {
      harness.restoreFetch();
      harness.renderer.unmount();
    }
  }
);

test(
  'a failed fetch for the new request shows the error state instead of the previous thread',
  renderTestOptions,
  async () => {
    const harness = await renderSwapHarness();
    try {
      assert.ok(collectText(harness.renderer.root).includes('Alpha thread comment'));

      harness.client.fetchFailures.add('fr_B');
      await harness.swap('fr_B');
      await flush();

      const text = collectText(harness.renderer.root);
      assert.ok(!text.includes('Alpha thread comment'), "A's comments must not linger under B");
      assert.ok(
        findButtonByText(harness.renderer.root, 'Retry'),
        'the error state with a retry affordance must render when the new fetch fails'
      );
    } finally {
      harness.restoreFetch();
      harness.renderer.unmount();
    }
  }
);

test(
  'a post into the new thread during its in-flight fetch does not splice the previous thread in',
  renderTestOptions,
  async () => {
    const harness = await renderSwapHarness();
    try {
      // Swap while B's fetch is deferred, then post into B immediately.
      const deferredB = createDeferred<ListFeatureRequestCommentsResult>();
      harness.client.deferredFetches.set('fr_B', deferredB);
      await harness.swap('fr_B');

      harness.client.postedComment = makeComment('c_new_b', {
        authorName: null,
        body: 'First into B',
      });
      const input = harness.renderer.root.findByType(TextInputStub as any);
      await act(async () => {
        input.props.onChangeText('First into B');
      });
      const send = findButtonByText(harness.renderer.root, 'Post Comment');
      await act(async () => {
        send!.props.onPress();
      });
      await flush();

      // The optimistic post must not drag A's still-clearable list along.
      let text = collectText(harness.renderer.root);
      assert.ok(!text.includes('Alpha thread comment'), "A's comments must not appear in B");

      // B's fetch resolves after the local post: the merge must combine only
      // B's server truth with B's local post.
      deferredB.resolve({ comments: [COMMENT_B], total: 1, hasMore: false, nextCursor: null });
      await flush();

      text = collectText(harness.renderer.root);
      assert.ok(text.includes('Beta thread comment'), "B's seeded comment must render");
      assert.ok(text.includes('First into B'), "B's locally posted comment must render");
      assert.ok(
        !text.includes('Alpha thread comment'),
        "A's comments must never appear in B's thread after the merge"
      );
      assert.ok(
        collectText(harness.renderer.root).includes('Comments (2)'),
        'the merged thread must count exactly the two B comments'
      );
    } finally {
      harness.restoreFetch();
      harness.renderer.unmount();
    }
  }
);

test(
  'a post from the previous thread that settles after the swap leaves the new thread untouched',
  renderTestOptions,
  async () => {
    const harness = await renderSwapHarness();
    try {
      assert.ok(collectText(harness.renderer.root).includes('Alpha thread comment'));

      // Hold A's post in flight and submit a draft on A.
      const deferredPostA = createDeferred<FeatureRequestComment>();
      harness.client.deferredPosts.set('fr_A', deferredPostA);
      const inputA = harness.renderer.root.findByType(TextInputStub as any);
      await act(async () => {
        inputA.props.onChangeText('Draft for A');
      });
      const sendA = findButtonByText(harness.renderer.root, 'Post Comment');
      await act(async () => {
        sendA!.props.onPress();
      });
      await flush();

      assert.equal(harness.client.postCalls.length, 1);
      assert.equal(
        harness.client.postCalls[0].featureRequestId,
        'fr_A',
        'the in-flight post must belong to the previous thread'
      );

      // Swap to B while A's post is still pending; B loads its own thread.
      await harness.swap('fr_B');
      assert.ok(collectText(harness.renderer.root).includes('Beta thread comment'));

      // The user has already started composing on B when A's post settles.
      const inputB = harness.renderer.root.findByType(TextInputStub as any);
      await act(async () => {
        inputB.props.onChangeText('Draft for B');
      });

      deferredPostA.resolve(makeComment('c_late_a', { authorName: 'Alice', body: 'Late A post' }));
      await flush();

      const text = collectText(harness.renderer.root);
      assert.ok(
        !text.includes('Late A post'),
        'a settled post from the previous thread must not render in the new thread'
      );
      assert.equal(
        harness.renderer.root.findByType(TextInputStub as any).props.value,
        'Draft for B',
        "the settled post must not clear the new thread's draft"
      );
      assert.ok(
        !text.includes('Alpha thread comment'),
        "the previous thread's comments must stay gone"
      );
    } finally {
      harness.restoreFetch();
      harness.renderer.unmount();
    }
  }
);

test(
  'a host re-render with the same id keeps the draft and the loaded thread',
  renderTestOptions,
  async () => {
    const harness = await renderSwapHarness();
    try {
      const input = harness.renderer.root.findByType(TextInputStub as any);
      await act(async () => {
        input.props.onChangeText('Draft for the current thread');
      });

      // Hosts commonly re-render with the same id (fresh data for the same
      // request); that must not wipe the composer or the list.
      await harness.swap('fr_A');

      assert.equal(
        harness.renderer.root.findByType(TextInputStub as any).props.value,
        'Draft for the current thread',
        'a same-id re-render must keep the draft'
      );
      assert.ok(
        collectText(harness.renderer.root).includes('Alpha thread comment'),
        'a same-id re-render must keep the loaded thread'
      );
      assert.deepEqual(harness.client.fetchCalls, ['fr_A'], 'a same-id re-render must not refetch');
    } finally {
      harness.restoreFetch();
      harness.renderer.unmount();
    }
  }
);

const { enStrings } = await import('../src/i18n');

test(
  'a client swap on the same request id invalidates stale load-more results (#451)',
  renderTestOptions,
  async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response('not found', { status: 404 })) as any;

    const clientA = new SwapStubClient({
      baseUrl: 'https://api.cupthread.com/a',
      appKey: 'app_comments_a',
    });
    clientA.paginatedSources.set('fr_A', {
      base: [makeComment('c_a1', { body: 'Client A base' })],
      more: [makeComment('c_a2', { body: 'Client A more' })],
      cursor: 'cursor_a',
    });

    const clientB = new SwapStubClient({
      baseUrl: 'https://api.cupthread.com/b',
      appKey: 'app_comments_b',
    });
    clientB.paginatedSources.set('fr_A', {
      base: [makeComment('c_b1', { body: 'Client B base' })],
      more: [makeComment('c_b2', { body: 'Client B more' })],
      cursor: 'cursor_b',
    });

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        React.createElement(CupThreadProvider, {
          client: clientA,
          userToken: 'usr_tok_test',
          commentSessionProvider: () => 'clerk_jwt_live',
          children: React.createElement(CommentsSection, { featureRequestId: 'fr_A' }),
        })
      );
    });
    await flush(20);
    try {
      assert.deepEqual(clientA.fetchCalls, ['fr_A'], 'client A should fetch first comments page');
      assert.ok(
        collectText(renderer.root).includes('Client A base'),
        'client A first page should load'
      );
      const loadMoreButton = findButtonByText(renderer.root, enStrings.comments.loadMore);
      assert.ok(loadMoreButton, 'load more affordance should render for client A');

      const pendingLoadMore = createDeferred<ListFeatureRequestCommentsResult>();
      clientA.deferredLoadMore = pendingLoadMore;
      await act(() => {
        void loadMoreButton!.props.onPress();
      });

      await act(async () => {
        renderer.update(
          React.createElement(CupThreadProvider, {
            client: clientB,
            userToken: 'usr_tok_test',
            commentSessionProvider: () => 'clerk_jwt_live',
            children: React.createElement(CommentsSection, { featureRequestId: 'fr_A' }),
          })
        );
      });
      await flush(12);
      assert.ok(
        collectText(renderer.root).includes('Client B base'),
        'client B first page must render after swap'
      );

      pendingLoadMore.resolve({
        comments: [makeComment('c_a2', { body: 'Client A more' })],
        total: 2,
        hasMore: false,
        nextCursor: null,
      });
      await flush(12);

      const text = collectText(renderer.root);
      assert.ok(
        !text.includes('Client A more'),
        'late client A load-more must not merge after client swap'
      );
      assert.ok(text.includes('Client B base'), 'client B page must remain after stale settlement');
      assert.equal(clientB.fetchCalls.filter((id) => id === 'fr_A').length, 1);

      const loadMoreAfterSwap = findButtonByText(renderer.root, enStrings.comments.loadMore);
      assert.ok(loadMoreAfterSwap, 'client B pagination cursor should remain available');
      const pendingB = createDeferred<ListFeatureRequestCommentsResult>();
      clientB.deferredLoadMore = pendingB;
      await act(() => {
        void loadMoreAfterSwap!.props.onPress();
      });
      assert.equal(clientB.fetchCalls.filter((id) => id === 'fr_A').length, 2);
      pendingB.resolve({
        comments: [makeComment('c_b2', { body: 'Client B more' })],
        total: 2,
        hasMore: false,
        nextCursor: null,
      });
      await flush(8);
      assert.ok(collectText(renderer.root).includes('Client B more'));
    } finally {
      globalThis.fetch = originalFetch;
      renderer.unmount();
    }
  }
);

async function renderClientSwapHarness(
  sessionProvider: () => string | Promise<string> = () => 'jwt'
) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('not found', { status: 404 })) as any;

  const clientA = new SwapStubClient({
    baseUrl: 'https://api.cupthread.com/a',
    appKey: 'app_comments_client_a',
  });
  const clientB = new SwapStubClient({
    baseUrl: 'https://api.cupthread.com/b',
    appKey: 'app_comments_client_b',
  });
  const aComment = makeComment('c_swap_a', { authorName: 'Alice', body: 'Client A comment' });
  const bComment = makeComment('c_swap_b', { authorName: 'Bob', body: 'Client B comment' });
  clientA.commentSources.set('fr_A', [aComment]);
  clientB.commentSources.set('fr_A', [bComment]);

  const buildElement = (
    client: SwapStubClient,
    provider: () => string | Promise<string> = sessionProvider
  ) =>
    React.createElement(CupThreadProvider, {
      client,
      userToken: 'usr_tok_test',
      commentSessionProvider: provider,
      children: React.createElement(CommentsSection, { featureRequestId: 'fr_A' }),
    });

  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(buildElement(clientA));
  });
  await flush();

  return {
    renderer,
    clientA,
    clientB,
    aComment,
    bComment,
    buildElement,
    restoreFetch: () => {
      globalThis.fetch = originalFetch;
    },
    swapTo: async (client: SwapStubClient, provider?: () => string | Promise<string>) => {
      await act(async () => {
        renderer.update(buildElement(client, provider));
      });
      await flush();
    },
  };
}

test(
  'a client swap on the same request id clears the armed reply, draft, and post error (#465)',
  renderTestOptions,
  async () => {
    const harness = await renderClientSwapHarness();
    try {
      const replyButton = findButtonByText(harness.renderer.root, enStrings.comments.replyButton);
      assert.ok(replyButton, 'reply affordance must render on client A');
      await act(async () => {
        replyButton!.props.onPress();
      });
      const inputA = harness.renderer.root.findByType(TextInputStub as any);
      await act(async () => {
        inputA.props.onChangeText('Draft for A');
      });
      assert.ok(
        collectText(harness.renderer.root).includes(
          enStrings.comments.replyingTo(harness.aComment.authorName!)
        ),
        'reply bar must be armed before the swap'
      );

      // Fail a post on A so the error banner is visible before the swap.
      harness.clientA.postComment = async () => {
        throw new Error('client A rejected the comment');
      };
      const sendA = findButtonByText(harness.renderer.root, enStrings.comments.postButton);
      assert.ok(sendA);
      await act(async () => {
        sendA!.props.onPress();
      });
      await flush();
      assert.ok(
        collectText(harness.renderer.root).includes(enStrings.comments.postFailed),
        'client A post error must render before the swap'
      );

      await harness.swapTo(harness.clientB);
      const text = collectText(harness.renderer.root);
      assert.ok(text.includes('Client B comment'), 'client B thread must load');
      assert.ok(
        !text.includes(enStrings.comments.replyingTo(harness.aComment.authorName!)),
        'client A reply must not survive the swap'
      );
      assert.ok(!text.includes(enStrings.comments.postFailed), 'client A error must be cleared');
      assert.equal(
        harness.renderer.root.findByType(TextInputStub as any).props.value,
        '',
        'client A draft must be cleared'
      );
    } finally {
      harness.restoreFetch();
      harness.renderer.unmount();
    }
  }
);

test(
  'a client swap clears the sign-in gate when the replacement client has a session (#465)',
  renderTestOptions,
  async () => {
    const harness = await renderClientSwapHarness(() => '');
    try {
      const inputA = harness.renderer.root.findByType(TextInputStub as any);
      await act(async () => {
        inputA.props.onChangeText('Draft needing sign-in');
      });
      const sendA = findButtonByText(harness.renderer.root, enStrings.comments.postButton);
      assert.ok(sendA);
      await act(async () => {
        sendA!.props.onPress();
      });
      await flush();
      assert.ok(
        collectText(harness.renderer.root).includes(enStrings.comments.signInToComment),
        'sign-in gate must be visible before the swap'
      );

      await harness.swapTo(harness.clientB, () => 'jwt');
      assert.ok(
        findButtonByText(harness.renderer.root, enStrings.comments.postButton),
        'client B composer must be interactive with its own session'
      );
      assert.ok(
        !collectText(harness.renderer.root).includes(enStrings.comments.signInToComment),
        "client A's sign-in gate must not survive the swap"
      );
    } finally {
      harness.restoreFetch();
      harness.renderer.unmount();
    }
  }
);

test(
  'a late client A post cannot lock, clear, or pollute client B after a swap (#465)',
  renderTestOptions,
  async () => {
    const harness = await renderClientSwapHarness();
    try {
      const deferredA = createDeferred<FeatureRequestComment>();
      harness.clientA.deferredPosts.set('fr_A', deferredA);
      const inputA = harness.renderer.root.findByType(TextInputStub as any);
      await act(async () => {
        inputA.props.onChangeText('Post from A');
      });
      const sendA = findButtonByText(harness.renderer.root, enStrings.comments.postButton);
      assert.ok(sendA);
      await act(async () => {
        sendA!.props.onPress();
      });
      await flush();
      assert.equal(harness.clientA.postCalls.length, 1);

      // Client B is interactive immediately while A's post is still pending.
      await harness.swapTo(harness.clientB);
      assert.ok(
        findButtonByText(harness.renderer.root, enStrings.comments.postButton),
        'client B send button must not inherit client A submit lock'
      );
      assert.ok(collectText(harness.renderer.root).includes('Client B comment'));

      // Client B starts its own post. A's late settlement must not clear it.
      const deferredB = createDeferred<FeatureRequestComment>();
      harness.clientB.deferredPosts.set('fr_A', deferredB);
      const inputB = harness.renderer.root.findByType(TextInputStub as any);
      await act(async () => {
        inputB.props.onChangeText('Draft for B');
      });
      const sendB = findButtonByText(harness.renderer.root, enStrings.comments.postButton);
      assert.ok(sendB);
      await act(async () => {
        sendB!.props.onPress();
      });
      await flush();

      deferredA.resolve(makeComment('c_late_a', { authorName: 'Alice', body: 'Late A post' }));
      await flush();
      let text = collectText(harness.renderer.root);
      assert.ok(!text.includes('Late A post'), 'client A post must not enter client B thread');
      assert.equal(
        harness.renderer.root.findByType(TextInputStub as any).props.value,
        'Draft for B',
        'client A post must not clear client B draft'
      );
      const postingButton = harness.renderer.root
        .findAllByType(TouchableOpacityStub as any)
        .find((button) => button.props.accessibilityLabel === enStrings.comments.postingButton);
      assert.ok(postingButton, 'client B submit lock must remain until its own post settles');

      deferredB.resolve(makeComment('c_late_b', { authorName: 'Bob', body: 'Fresh B post' }));
      await flush();
      text = collectText(harness.renderer.root);
      assert.ok(text.includes('Fresh B post'), 'client B post must render once it settles');
      assert.equal(
        harness.renderer.root.findByType(TextInputStub as any).props.value,
        '',
        'client B draft must clear after its own successful post'
      );
    } finally {
      harness.restoreFetch();
      harness.renderer.unmount();
    }
  }
);

test(
  'a rejected client A post after the swap does not surface an error on client B (#465)',
  renderTestOptions,
  async () => {
    const harness = await renderClientSwapHarness();
    try {
      const deferredA = createDeferred<FeatureRequestComment>();
      harness.clientA.deferredPosts.set('fr_A', deferredA);
      const inputA = harness.renderer.root.findByType(TextInputStub as any);
      await act(async () => {
        inputA.props.onChangeText('Doomed A post');
      });
      const sendA = findButtonByText(harness.renderer.root, enStrings.comments.postButton);
      await act(async () => {
        sendA!.props.onPress();
      });
      await flush();

      await harness.swapTo(harness.clientB);
      const inputB = harness.renderer.root.findByType(TextInputStub as any);
      await act(async () => {
        inputB.props.onChangeText('Keep this B draft');
      });

      deferredA.reject(new Error('client A failed'));
      await flush();
      const text = collectText(harness.renderer.root);
      assert.ok(!text.includes(enStrings.comments.postFailed), 'client B must not show A error');
      assert.ok(!text.includes(enStrings.comments.signInToComment), 'client B must stay signed in');
      assert.equal(
        harness.renderer.root.findByType(TextInputStub as any).props.value,
        'Keep this B draft',
        'client B draft must survive A rejection'
      );
    } finally {
      harness.restoreFetch();
      harness.renderer.unmount();
    }
  }
);
