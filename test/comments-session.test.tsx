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
  postBehavior: 'success' | 'unauthorized' | 'error' = 'success';
  postError: Error | null = null;
  postedComment = makeComment('c_new', { authorName: null, body: 'Hello thread' });
  seedComments: FeatureRequestComment[] = [makeComment('c_seed')];

  override async listComments(): Promise<ListFeatureRequestCommentsResult> {
    const comments = this.seedComments;
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
    if (this.postBehavior === 'error') {
      throw this.postError ?? new Error('Post failed');
    }
    return { ...this.postedComment, id: `c_new_${this.postCalls.length}` };
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
  sessionProvider?: () => string | null | undefined | Promise<string | null | undefined>,
  initialComments?: FeatureRequestComment[],
  customStrings?: any
): Promise<Harness> {
  // The provider's config fetch is the only call reaching global fetch; it
  // gets a rejection (non-fatal, falls back to system theme).
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('not found', { status: 404 })) as any;

  const client = new CommentsStubClient({
    baseUrl: 'https://api.cupthread.com',
    appKey: 'app_comments_session_test',
  });
  if (initialComments) {
    client.seedComments = initialComments;
  }

  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(CupThreadProvider, {
        client,
        userToken: 'usr_tok_test',
        ...(sessionProvider ? { commentSessionProvider: sessionProvider } : {}),
        ...(customStrings ? { strings: customStrings } : {}),
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
      assert.equal(send.props.accessibilityRole, 'button');
      assert.equal(send.props.accessibilityLabel, 'Post Comment');
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

test(
  'a real client against the documented `{ comment }` wire envelope renders the posted comment immediately',
  renderTestOptions,
  async () => {
    // No client stubbing here: `globalThis.fetch` is mocked so the real
    // `postComment` response — the documented `FeatureRequestCommentCreated`
    // envelope — flows through the SDK exactly as the production API serves
    // it. Regression for #188: an unwrapped envelope appended to the thread
    // rendered a blank card (no id, author, body, or date).
    const originalFetch = globalThis.fetch;
    let renderer: TestRenderer.ReactTestRenderer | undefined;

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const target = url.toString();
      if (target.includes('/api/v1/public/config/')) {
        return new Response('not found', { status: 404 });
      }
      if (target.endsWith('/comments') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            comment: {
              id: 'c_wire',
              authorName: 'Alice Wire',
              body: 'Rendered from the envelope',
              createdAt: '2020-01-15T00:00:00.000Z',
            },
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (target.includes('/comments')) {
        return new Response(
          JSON.stringify({
            comments: [makeComment('c_seed')],
            total: 1,
            hasMore: false,
            nextCursor: null,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('not found', { status: 404 });
    }) as any;

    try {
      const client = new FeedbackClient({
        baseUrl: 'https://api.cupthread.com',
        appKey: 'app_wire_envelope_test',
      });

      await act(async () => {
        renderer = TestRenderer.create(
          React.createElement(CupThreadProvider, {
            client,
            userToken: 'usr_tok_test',
            commentSessionProvider: () => 'clerk_jwt_wire',
            children: React.createElement(CommentsSection, { featureRequestId: 'fr_wire' }),
          })
        );
      });
      await flush();

      const input = renderer!.root.findByType(TextInputStub as any);
      await act(async () => {
        input.props.onChangeText('Rendered from the envelope');
      });
      const send = findButtonByText(renderer!.root, 'Post Comment');
      assert.ok(send, 'send button must exist with a session source');
      await act(async () => {
        send!.props.onPress();
      });
      await flush();

      const text = collectText(renderer!.root);
      assert.ok(
        text.includes('Rendered from the envelope'),
        'the posted body must render immediately after the post resolves'
      );
      assert.ok(
        text.includes('Alice Wire'),
        'the posted author must render immediately (not the Anonymous fallback)'
      );
      assert.ok(
        text.includes('2020'),
        'the posted comment date must render immediately (calendar year of createdAt)'
      );
      assert.equal(
        renderer!.root.findByType(TextInputStub as any).props.value,
        '',
        'input must clear after a successful post'
      );
    } finally {
      globalThis.fetch = originalFetch;
      renderer?.unmount();
    }
  }
);

test(
  'CommentsSection: whitespace-only author and replyTo names render anonymous fallback and omit empty reply notice (#270)',
  renderTestOptions,
  async () => {
    const comments = [
      makeComment('c_ws', { authorName: '   \t  ', body: 'Whitespace author comment' }),
      makeComment('c_padded', {
        authorName: '  Alice Padded  ',
        replyToAuthorName: '   ',
        body: 'Comment with whitespace replyToAuthorName',
      }),
      makeComment('c_reply_valid', {
        authorName: 'Bob Normal',
        replyToAuthorName: '  Charlie Target  ',
        body: 'Comment with padded replyToAuthorName',
      }),
    ];

    const harness = await renderComments(() => 'clerk_jwt_test', comments);

    try {
      const text = collectText(harness.renderer.root);

      // 1. Whitespace author renders Anonymous fallback
      assert.ok(
        text.includes('Anonymous'),
        'comment with whitespace-only authorName must display Anonymous fallback'
      );

      // 2. Padded author name is trimmed
      assert.ok(
        text.includes('Alice Padded'),
        'comment with whitespace-padded authorName must display trimmed name'
      );
      assert.ok(
        !text.includes('  Alice Padded  '),
        'must not render untrimmed whitespace around authorName'
      );

      // 3. Whitespace replyToAuthorName does NOT render "Replying to" notice
      assert.ok(
        !text.includes('Replying to @   ') && !text.includes('Replying to @\n'),
        'whitespace-only replyToAuthorName must not render empty reply notice'
      );
      const replyNoticeCount = text.split('Replying to @').length - 1;
      assert.equal(
        replyNoticeCount,
        1,
        'only the single valid replyToAuthorName should produce a reply notice'
      );

      // 4. Padded replyToAuthorName is trimmed in reply notice
      assert.ok(
        text.includes('Replying to @Charlie Target'),
        'padded replyToAuthorName must render trimmed target name in reply notice'
      );

      // 5. Active reply bar displays Anonymous when replying to whitespace author
      const replyButtons = harness.renderer.root
        .findAllByType(TouchableOpacityStub as any)
        .filter((b) => b.findAllByType(TextStub as any).some((t) => t.props?.children === 'Reply'));
      assert.ok(replyButtons.length >= 2, 'must have reply buttons for comments');

      // Click reply on the first comment (which has authorName: '   \t  ')
      await act(async () => {
        replyButtons[0].props.onPress();
      });
      await flush();

      const textAfterReplyWs = collectText(harness.renderer.root);
      assert.ok(
        textAfterReplyWs.includes('Replying to @Anonymous'),
        'active reply bar must show Replying to @Anonymous when target author is whitespace-only'
      );

      // Submit reply to whitespace author and verify draft.replyToAuthorName is undefined
      const input = harness.renderer.root.findByType(TextInputStub as any);
      await act(async () => {
        input.props.onChangeText('Replying to ws author');
      });
      const postBtn = findButtonByText(harness.renderer.root, 'Post Comment');
      assert.ok(postBtn, 'post button must exist');
      await act(async () => {
        postBtn!.props.onPress();
      });
      await flush();

      assert.equal(harness.client.postCalls.length, 1);
      assert.equal(
        harness.client.postCalls[0].draft.replyToAuthorName,
        undefined,
        'draft.replyToAuthorName must be undefined when replying to whitespace author'
      );

      // 6. Click reply on the second comment (authorName: '  Alice Padded  ')
      await act(async () => {
        replyButtons[1].props.onPress();
      });
      await flush();

      const textAfterReplyPadded = collectText(harness.renderer.root);
      assert.ok(
        textAfterReplyPadded.includes('Replying to @Alice Padded'),
        'active reply bar must show trimmed author name when target author has whitespace padding'
      );

      // Submit reply to padded author and verify draft.replyToAuthorName is trimmed
      await act(async () => {
        input.props.onChangeText('Replying to padded author');
      });
      await act(async () => {
        postBtn!.props.onPress();
      });
      await flush();

      assert.equal(harness.client.postCalls.length, 2);
      assert.equal(
        harness.client.postCalls[1].draft.replyToAuthorName,
        'Alice Padded',
        'draft.replyToAuthorName must be trimmed string when replying to padded author'
      );
    } finally {
      harness.restoreFetch();
      harness.renderer.unmount();
    }
  }
);

// ---------------------------------------------------------------------------
// Issue #310 — CommentsSection input error guards against raw empty-string render
// ---------------------------------------------------------------------------

test(
  'CommentsSection: empty-string or whitespace input error does not crash View and renders valid errors trimmed (#310)',
  renderTestOptions,
  async () => {
    // 1. When post fails with an empty-string error message (postFailed = '')
    const harnessEmpty = await renderComments(() => 'jwt_session_empty_error', undefined, {
      comments: { postFailed: '' },
    });
    try {
      harnessEmpty.client.postBehavior = 'error';

      const input = harnessEmpty.renderer.root.findByType(TextInputStub as any);
      await act(async () => {
        input.props.onChangeText('A new test comment');
      });
      const postBtn = findButtonByText(harnessEmpty.renderer.root, 'Post Comment');
      assert.ok(postBtn, 'post button must exist');

      // Submitting with empty-string error message must not throw
      // "Text strings must be rendered within a <Text> component"
      await act(async () => {
        postBtn!.props.onPress();
      });
      await flush();

      // No raw string child rendered in View, and no error message rendered in text
      const hasInputErrorText = harnessEmpty.renderer.root
        .findAllByType(TextStub as any)
        .some((node: any) => {
          const stylesList = Array.isArray(node.props.style)
            ? node.props.style
            : [node.props.style];
          return stylesList.some((s: any) => s && s.marginBottom === 6);
        });
      assert.strictEqual(hasInputErrorText, false, 'no input error Text should be rendered');
    } finally {
      harnessEmpty.restoreFetch();
      harnessEmpty.renderer.unmount();
    }

    // 2. When post fails with a whitespace-only error message (postFailed = '   \t  ')
    const harnessWhitespace = await renderComments(() => 'jwt_session_ws_error', undefined, {
      comments: { postFailed: '   \t  ' },
    });
    try {
      harnessWhitespace.client.postBehavior = 'error';

      const input = harnessWhitespace.renderer.root.findByType(TextInputStub as any);
      await act(async () => {
        input.props.onChangeText('Another test comment');
      });
      const postBtn = findButtonByText(harnessWhitespace.renderer.root, 'Post Comment');
      assert.ok(postBtn, 'post button must exist');

      // Submitting must safely collapse whitespace-only error to null without throwing
      await act(async () => {
        postBtn!.props.onPress();
      });
      await flush();

      const hasInputErrorText = harnessWhitespace.renderer.root
        .findAllByType(TextStub as any)
        .some((node: any) => {
          const stylesList = Array.isArray(node.props.style)
            ? node.props.style
            : [node.props.style];
          return stylesList.some((s: any) => s && s.marginBottom === 6);
        });
      assert.strictEqual(
        hasInputErrorText,
        false,
        'no input error Text should be rendered for whitespace error'
      );
    } finally {
      harnessWhitespace.restoreFetch();
      harnessWhitespace.renderer.unmount();
    }

    // 3. When post fails with a padded non-empty error message, it renders trimmed
    const harnessPadded = await renderComments(() => 'jwt_session_padded_error', undefined, {
      comments: { postFailed: '   Server is busy right now   ' },
    });
    try {
      harnessPadded.client.postBehavior = 'error';

      const input = harnessPadded.renderer.root.findByType(TextInputStub as any);
      await act(async () => {
        input.props.onChangeText('Third test comment');
      });
      const postBtn = findButtonByText(harnessPadded.renderer.root, 'Post Comment');
      assert.ok(postBtn, 'post button must exist');

      await act(async () => {
        postBtn!.props.onPress();
      });
      await flush();

      const errorNode = harnessPadded.renderer.root
        .findAllByType(TextStub as any)
        .find((node: any) => {
          const stylesList = Array.isArray(node.props.style)
            ? node.props.style
            : [node.props.style];
          return stylesList.some((s: any) => s && s.marginBottom === 6);
        });
      assert.ok(errorNode, 'input error Text should be rendered');
      assert.strictEqual(errorNode.props.children, 'Server is busy right now');
    } finally {
      harnessPadded.restoreFetch();
      harnessPadded.renderer.unmount();
    }
  }
);

test(
  'CommentsSection: safely handles non-string truthy authorName and replyToAuthorName without throwing TypeError (#299)',
  renderTestOptions,
  async () => {
    const commentsWithMalformedFields: any[] = [
      makeComment('c_num_author', {
        authorName: 123 as any,
        body: 'Comment with number authorName',
      }),
      makeComment('c_bool_author', {
        authorName: true as any,
        body: 'Comment with boolean authorName',
      }),
      makeComment('c_obj_author', {
        authorName: {} as any,
        body: 'Comment with object authorName',
      }),
      makeComment('c_ws_author', {
        authorName: '   \t  ',
        body: 'Comment with whitespace-only authorName',
      }),
      makeComment('c_num_reply', {
        authorName: 'Alice',
        replyToAuthorName: 456 as any,
        body: 'Comment with number replyToAuthorName',
      }),
      makeComment('c_bool_reply', {
        authorName: 'Bob',
        replyToAuthorName: true as any,
        body: 'Comment with boolean replyToAuthorName',
      }),
      makeComment('c_obj_reply', {
        authorName: 'Charlie',
        replyToAuthorName: {} as any,
        body: 'Comment with object replyToAuthorName',
      }),
      makeComment('c_valid_reply', {
        authorName: 'Dave',
        replyToAuthorName: '   Eve   ',
        body: 'Comment with valid trimmed replyToAuthorName',
      }),
    ];

    const harness = await renderComments(() => 'jwt_session_valid', commentsWithMalformedFields);

    try {
      // 1. Rendering must succeed and not throw
      const text = collectText(harness.renderer.root);
      assert.ok(
        text.includes('Anonymous'),
        'fallback Anonymous must be rendered for non-string authorName'
      );
      assert.ok(text.includes('Eve'), 'replyingTo must render trimmed valid replyToAuthorName');
      assert.ok(
        !text.includes('Replying to [object Object]'),
        'must not render raw object in reply notice'
      );

      // 2. Clicking reply on a comment with non-string authorName sets replyTo safely
      const replyButtons = harness.renderer.root
        .findAllByType(TouchableOpacityStub as any)
        .filter((button) =>
          button.findAllByType(TextStub as any).some((t) => t.props?.children === 'Reply')
        );
      assert.ok(replyButtons.length > 0, 'reply buttons must be rendered');

      // Tap reply on c_num_author (first reply button)
      await act(async () => {
        replyButtons[0].props.onPress();
      });
      await flush();

      // Check replying bar text
      const replyingBarText = collectText(harness.renderer.root);
      assert.ok(
        replyingBarText.includes('Replying to @Anonymous'),
        'reply bar must display Replying to @Anonymous when target comment has non-string authorName'
      );

      // 3. Post a comment while replying to the non-string author comment
      const input = harness.renderer.root.findByType(TextInputStub as any);
      await act(async () => {
        input.props.onChangeText('Reply to number author');
      });
      const postBtn = findButtonByText(harness.renderer.root, 'Post Comment');
      assert.ok(postBtn, 'post button must exist');

      await act(async () => {
        postBtn!.props.onPress();
      });
      await flush();

      assert.strictEqual(harness.client.postCalls.length, 1);
      assert.strictEqual(
        harness.client.postCalls[0].draft.replyToAuthorName,
        undefined,
        'draft replyToAuthorName must safely resolve to undefined when target authorName is not a string'
      );
    } finally {
      harness.restoreFetch();
      harness.renderer.unmount();
    }
  }
);
