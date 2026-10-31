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

const { CupThreadProvider, useCupThreadCommentSession } =
  await import('../src/theme/CupThreadThemeProvider');
const { CommentsSection } = await import('../src/components/CommentsSection');
const { FeedbackClient } = await import('../src/client/FeedbackClient');
const { AuthenticationRequiredException } = await import('../src/client/FeedbackException');

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
  userToken: string;
  options: any;
}

class CommentsStubClient extends FeedbackClient {
  postCalls: PostCall[] = [];
  postBehavior: 'success' | 'unauthorized' = 'success';
  postedComment = makeComment('c_new', { authorName: null, body: 'Hello thread' });

  override async listComments(): Promise<ListFeatureRequestCommentsResult> {
    const comments = [makeComment('c_seed')];
    return { comments, total: comments.length, hasMore: false, nextCursor: null };
  }

  override async postComment(
    featureRequestId: string,
    draft: CommentDraft,
    userToken: string,
    options?: any
  ): Promise<FeatureRequestComment> {
    this.postCalls.push({ featureRequestId, draft, userToken, options });
    if (this.postBehavior === 'unauthorized') {
      throw new AuthenticationRequiredException();
    }
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

interface Harness {
  renderer: TestRenderer.ReactTestRenderer;
  client: CommentsStubClient;
  restoreFetch: () => void;
}

async function renderComments(
  sessionProvider?: () => string | null | undefined | Promise<string | null | undefined>
): Promise<Harness> {
  // The provider's config fetch is the only call reaching global fetch; it
  // gets a rejection (non-fatal, falls back to system theme).
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('not found', { status: 404 })) as any;

  const client = new CommentsStubClient({
    baseUrl: 'https://api.cupthread.com',
    appKey: 'app_comments_session_test',
  });

  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(CupThreadProvider, {
        client,
        userToken: 'usr_tok_test',
        ...(sessionProvider ? { commentSessionProvider: sessionProvider } : {}),
        children: React.createElement(CommentsSection, { featureRequestId: 'fr_1' }),
      })
    );
  });
  await flush();

  return {
    renderer,
    client,
    restoreFetch: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

test(
  'without a configured session source the composer is replaced by the sign-in notice',
  renderTestOptions,
  async () => {
    const harness = await renderComments(undefined);
    try {
      const text = collectText(harness.renderer.root);
      assert.ok(text.includes('Sign in to comment'), 'sign-in notice must replace the composer');
      assert.equal(
        harness.renderer.root.findAllByType(TextInputStub as any).length,
        0,
        'no comment input may render without a session source'
      );
      assert.ok(
        !findButtonByText(harness.renderer.root, 'Reply'),
        'reply affordances must be hidden without a session source'
      );
    } finally {
      harness.restoreFetch();
      harness.renderer.unmount();
    }
  }
);

test(
  'with a session source the composer renders and submits under the Clerk session credential',
  renderTestOptions,
  async () => {
    const harness = await renderComments(() => 'clerk_jwt_live');
    try {
      assert.ok(
        !collectText(harness.renderer.root).includes('Sign in to comment'),
        'composer must render while a session source is configured'
      );

      const input = harness.renderer.root.findByType(TextInputStub as any);
      await act(async () => {
        input.props.onChangeText('Hello thread');
      });

      const send = findButtonByText(harness.renderer.root, 'Post Comment');
      assert.ok(send, 'send button must exist');
      await act(async () => {
        send!.props.onPress();
      });
      await flush();

      assert.equal(harness.client.postCalls.length, 1);
      const call = harness.client.postCalls[0];
      assert.equal(call.featureRequestId, 'fr_1');
      // The draft carries no author attribution: the server resolves it from
      // the signed-in profile and strips client-sent values.
      assert.deepEqual(call.draft, {
        body: 'Hello thread',
        parentId: undefined,
        replyToClerkId: undefined,
        replyToAuthorName: undefined,
      });
      assert.equal(call.options?.sessionToken, 'clerk_jwt_live');

      // Success feedback: the new comment joins the thread and the input resets.
      assert.ok(collectText(harness.renderer.root).includes('Hello thread'));
      assert.equal(
        harness.renderer.root.findByType(TextInputStub as any).props.value,
        '',
        'input must clear after a successful post'
      );
    } finally {
      harness.restoreFetch();
      harness.renderer.unmount();
    }
  }
);

test(
  'a session that resolves to signed-out switches to the sign-in state and keeps the draft for retry',
  renderTestOptions,
  async () => {
    let sessionToken: string | null = null;
    const harness = await renderComments(() => sessionToken);
    try {
      const input = harness.renderer.root.findByType(TextInputStub as any);
      await act(async () => {
        input.props.onChangeText('Draft survived');
      });
      const send = findButtonByText(harness.renderer.root, 'Post Comment');
      await act(async () => {
        send!.props.onPress();
      });
      await flush();

      assert.equal(harness.client.postCalls.length, 0, 'no request may fire while signed out');
      assert.ok(
        collectText(harness.renderer.root).includes('Sign in to comment'),
        'sign-in notice must appear when the session resolves signed-out'
      );
      assert.ok(
        findButtonByText(harness.renderer.root, 'Retry'),
        'a recovery affordance must be offered'
      );

      // Host completes sign-in; the retry re-checks the same session source.
      sessionToken = 'clerk_jwt_after_signin';
      const retry = findButtonByText(harness.renderer.root, 'Retry');
      await act(async () => {
        retry!.props.onPress();
      });
      await flush();

      assert.ok(
        !collectText(harness.renderer.root).includes('Sign in to comment'),
        'composer must return once a session is available'
      );
      assert.equal(
        harness.renderer.root.findByType(TextInputStub as any).props.value,
        'Draft survived',
        'draft text must survive the sign-in round trip'
      );
    } finally {
      harness.restoreFetch();
      harness.renderer.unmount();
    }
  }
);

test(
  'a 401 authentication_required rejection switches to the sign-in state and keeps the draft',
  renderTestOptions,
  async () => {
    const harness = await renderComments(() => 'expired_jwt');
    try {
      harness.client.postBehavior = 'unauthorized';

      const input = harness.renderer.root.findByType(TextInputStub as any);
      await act(async () => {
        input.props.onChangeText('Please keep me');
      });
      const send = findButtonByText(harness.renderer.root, 'Post Comment');
      await act(async () => {
        send!.props.onPress();
      });
      await flush();

      assert.equal(harness.client.postCalls.length, 1);
      assert.ok(
        collectText(harness.renderer.root).includes('Sign in to comment'),
        'the generic post-failed loop must be replaced by the sign-in state'
      );
      assert.ok(
        !collectText(harness.renderer.root).includes('Failed to post comment'),
        'the generic failure copy must not render for auth rejections'
      );

      // A recovered session brings the composer back with the draft intact.
      harness.client.postBehavior = 'success';
      const retry = findButtonByText(harness.renderer.root, 'Retry');
      await act(async () => {
        retry!.props.onPress();
      });
      await flush();

      assert.equal(
        harness.renderer.root.findByType(TextInputStub as any).props.value,
        'Please keep me',
        'draft text must survive a 401 rejection'
      );
    } finally {
      harness.restoreFetch();
      harness.renderer.unmount();
    }
  }
);

test(
  'a host re-render with a fresh inline provider identity keeps the sign-in state and the provider reference',
  renderTestOptions,
  async () => {
    // The provider must wrap the host callback in a stable ref-backed function:
    // an inline arrow (new identity per host render) must neither reset the
    // sign-in state nor rebuild the context value between renders.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response('not found', { status: 404 })) as any;

    const client = new CommentsStubClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_comments_session_test',
    });
    const observedProviders: unknown[] = [];
    let sessionToken: string | null = null;
    let rerenderHost: (() => void) | null = null;

    function SessionProbe() {
      observedProviders.push(useCupThreadCommentSession());
      return null;
    }

    function Host() {
      const [, setTick] = React.useState(0);
      rerenderHost = () => setTick((n) => n + 1);
      // Inline arrow: a brand-new identity on every host render — exactly the
      // shape the README documents.
      return React.createElement(CupThreadProvider, {
        client,
        userToken: 'usr_tok_test',
        commentSessionProvider: () => sessionToken,
        children: [
          React.createElement(SessionProbe, { key: 'probe' }),
          React.createElement(CommentsSection, { key: 'section', featureRequestId: 'fr_1' }),
        ],
      });
    }

    let renderer!: TestRenderer.ReactTestRenderer;
    try {
      await act(async () => {
        renderer = TestRenderer.create(React.createElement(Host));
      });
      await flush();
      assert.ok(rerenderHost, 'host must expose a re-render trigger');

      const input = renderer.root.findByType(TextInputStub as any);
      await act(async () => {
        input.props.onChangeText('Still here');
      });
      const send = findButtonByText(renderer.root, 'Post Comment');
      await act(async () => {
        send!.props.onPress();
      });
      await flush();

      assert.ok(
        collectText(renderer.root).includes('Sign in to comment'),
        'sign-in state must be active before the host re-renders'
      );

      // Host re-renders with a fresh inline callback identity while still
      // signed out: the composer must stay hidden.
      await act(async () => {
        rerenderHost!();
      });
      await flush();

      assert.ok(
        collectText(renderer.root).includes('Sign in to comment'),
        'an unstable provider identity must not reset the sign-in state while signed out'
      );
      assert.ok(
        !findButtonByText(renderer.root, 'Post Comment'),
        'the composer must stay hidden after an unrelated host re-render'
      );

      // The exposed provider reference is stable across host re-renders.
      assert.ok(
        observedProviders.length >= 2,
        'the probe must have observed the context on every host render'
      );
      const providerRef = observedProviders[0];
      assert.ok(providerRef, 'a configured provider must be non-null');
      for (const observed of observedProviders.slice(1)) {
        assert.equal(observed, providerRef, 'the context provider reference must stay stable');
      }

      // Recovery stays with Retry, which now finds the signed-in session.
      sessionToken = 'clerk_jwt_after_signin';
      const retry = findButtonByText(renderer.root, 'Retry');
      await act(async () => {
        retry!.props.onPress();
      });
      await flush();

      assert.ok(
        !collectText(renderer.root).includes('Sign in to comment'),
        'composer must return once Retry finds a session'
      );
      assert.equal(
        renderer.root.findByType(TextInputStub as any).props.value,
        'Still here',
        'draft text must survive the re-render and sign-in round trip'
      );
    } finally {
      globalThis.fetch = originalFetch;
      renderer?.unmount();
    }
  }
);
