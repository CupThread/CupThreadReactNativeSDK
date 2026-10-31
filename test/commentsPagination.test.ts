import test, { type TestOptions } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { FeedbackClient, MAX_COMMENTS_PAGES } from '../src/client/FeedbackClient';
import type { FeatureRequestComment, ListFeatureRequestCommentsResult } from '../src/types';
import { enStrings as strings } from '../src/i18n';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeComment(
  id: string,
  overrides: Partial<FeatureRequestComment> = {}
): FeatureRequestComment {
  return {
    id,
    featureRequestId: 'fr_1',
    authorName: 'Seeder',
    body: `Comment ${id}`,
    createdAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  } as FeatureRequestComment;
}

interface RecordedRequest {
  url: string;
  cursor: string | null;
  limit: string | null;
}

/**
 * Installs a fetch stub serving comment pages from a map keyed by the
 * incoming `cursor` query parameter (null for the first page) and records
 * every comments request. Extra routes let tests co-host unrelated endpoints.
 */
function installCommentsFetch(
  pages: Map<string | null, { status: number; body?: unknown }>,
  extraRoutes?: (target: string) => Response | undefined
): { requests: RecordedRequest[]; restore: () => void } {
  const originalFetch = globalThis.fetch;
  const requests: RecordedRequest[] = [];

  globalThis.fetch = (async (url: string | URL | Request) => {
    const target = url.toString();
    if (target.includes('/comments')) {
      const query = new URLSearchParams(target.split('?')[1] ?? '');
      const cursor = query.get('cursor');
      requests.push({ url: target, cursor, limit: query.get('limit') });
      const route = pages.get(cursor);
      if (!route) {
        return new Response('not found', { status: 404 });
      }
      return new Response(
        typeof route.body === 'string' ? route.body : JSON.stringify(route.body ?? {}),
        { status: route.status, headers: { 'Content-Type': 'application/json' } }
      );
    }
    const extra = extraRoutes?.(target);
    if (extra) return extra;
    return new Response('not found', { status: 404 });
  }) as any;

  return {
    requests,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

function makeClient(): FeedbackClient {
  return new FeedbackClient({
    baseUrl: 'https://api.cupthread.com',
    appKey: 'app_comments_pagination_test',
  });
}

// ---------------------------------------------------------------------------
// Client: listComments
// ---------------------------------------------------------------------------

test('listComments requests the server-default page and normalizes a legacy response', async () => {
  const c1 = makeComment('c1');
  const c2 = makeComment('c2');
  // Legacy servers predate pagination: no total / hasMore / nextCursor at all.
  const pages = new Map([[null, { status: 200, body: { comments: [c1, c2] } }]]);
  const fetchMock = installCommentsFetch(pages);

  try {
    const result = await makeClient().listComments('fr_1');
    assert.deepEqual(
      result,
      {
        comments: [c1, c2],
        total: 2,
        hasMore: false,
        nextCursor: null,
      } satisfies ListFeatureRequestCommentsResult,
      'legacy responses must resolve to a single exhausted page, total falling back to the page length'
    );
    assert.equal(fetchMock.requests.length, 1);
    assert.equal(fetchMock.requests[0].limit, '200', 'default page size is the server maximum');
    assert.equal(fetchMock.requests[0].cursor, null, 'the first page must carry no cursor');
  } finally {
    fetchMock.restore();
  }
});

test('listComments preserves the spec fields the published comment schema serves', async () => {
  // appId / updatedAt are optional but real in the published response schema
  // (issue #176): the fetch passthrough must keep them on the surfaced record.
  const edited = makeComment('c1', {
    appId: 'app_comments_pagination_test',
    updatedAt: '2026-10-02T08:30:00.000Z',
  });
  const pages = new Map([[null, { status: 200, body: { comments: [edited] } }]]);
  const fetchMock = installCommentsFetch(pages);

  try {
    const result = await makeClient().listComments('fr_1');
    assert.deepEqual(
      result.comments,
      [edited],
      'appId and updatedAt must survive the fetch passthrough unchanged'
    );
  } finally {
    fetchMock.restore();
  }
});

test('listComments forwards limit and cursor and clamps out-of-range limits', async () => {
  for (const { options, expectedLimit } of [
    { options: { limit: 20, cursor: 'cur-9' }, expectedLimit: '20' },
    { options: { limit: 1 }, expectedLimit: '1' },
    { options: { limit: 0 }, expectedLimit: '1' },
    { options: { limit: -5 }, expectedLimit: '1' },
    { options: { limit: 500 }, expectedLimit: '200' },
  ]) {
    const cursor = (options as any).cursor ?? null;
    const pages = new Map<string | null, { status: number; body?: unknown }>([
      [cursor, { status: 200, body: { comments: [] } }],
    ]);
    const fetchMock = installCommentsFetch(pages);
    try {
      await makeClient().listComments('fr_1', options as any);
      assert.equal(fetchMock.requests.length, 1);
      assert.equal(fetchMock.requests[0].limit, expectedLimit);
      assert.equal(fetchMock.requests[0].cursor, cursor, 'cursor must travel as a query parameter');
    } finally {
      fetchMock.restore();
    }
  }
});

test('listComments normalizes a malformed pagination payload', async () => {
  const pages = new Map([
    [
      null,
      {
        status: 200,
        body: { comments: [makeComment('c1')], total: '12', hasMore: 'yes', nextCursor: 42 },
      },
    ],
  ]);
  const fetchMock = installCommentsFetch(pages);
  try {
    const result = await makeClient().listComments('fr_1');
    assert.equal(result.total, 1, 'non-numeric total must fall back to the page length');
    assert.equal(result.hasMore, false, 'non-boolean hasMore must not be trusted');
    assert.equal(result.nextCursor, null, 'non-string nextCursor must not be trusted');
  } finally {
    fetchMock.restore();
  }
});

// ---------------------------------------------------------------------------
// Client: fetchComments auto-pagination (deprecated wrapper)
// ---------------------------------------------------------------------------

test('fetchComments follows nextCursor across pages and returns the full thread', async () => {
  const oldest = makeComment('c1');
  const mid = makeComment('c2');
  const newer = makeComment('c3');
  const pages = new Map<string | null, { status: number; body?: unknown }>([
    [
      null,
      {
        status: 200,
        body: { comments: [oldest, mid], total: 3, hasMore: true, nextCursor: 'cur-2' },
      },
    ],
    [
      'cur-2',
      {
        status: 200,
        body: { comments: [newer], total: 3, hasMore: false, nextCursor: null },
      },
    ],
  ]);
  const fetchMock = installCommentsFetch(pages);

  try {
    const comments = await makeClient().fetchComments('fr_1');
    assert.deepEqual(
      comments.map((c) => c.id),
      ['c1', 'c2', 'c3'],
      'the deprecated wrapper must walk every page instead of silently truncating'
    );
    assert.equal(fetchMock.requests.length, 2);
    assert.equal(fetchMock.requests[0].cursor, null);
    assert.equal(fetchMock.requests[1].cursor, 'cur-2', 'second page must carry the first cursor');
  } finally {
    fetchMock.restore();
  }
});

test('fetchComments makes a single request when the server reports no more pages', async () => {
  const pages = new Map<string | null, { status: number; body?: unknown }>([
    [null, { status: 200, body: { comments: [makeComment('c1')] } }],
  ]);
  const fetchMock = installCommentsFetch(pages);
  try {
    const comments = await makeClient().fetchComments('fr_1');
    assert.equal(comments.length, 1);
    assert.equal(fetchMock.requests.length, 1, 'no cursor follow-up without hasMore');
  } finally {
    fetchMock.restore();
  }
});

test('fetchComments caps runaway pagination instead of looping forever', async () => {
  const pages = new Map<string | null, { status: number; body?: unknown }>();
  pages.set(null, { status: 200, body: { comments: [], hasMore: true, nextCursor: 'cur-1' } });
  for (let i = 1; i <= MAX_COMMENTS_PAGES + 5; i++) {
    pages.set(`cur-${i}`, {
      status: 200,
      body: { comments: [], hasMore: true, nextCursor: `cur-${i + 1}` },
    });
  }
  const fetchMock = installCommentsFetch(pages);
  try {
    const comments = await makeClient().fetchComments('fr_1');
    assert.equal(comments.length, 0);
    assert.equal(
      fetchMock.requests.length,
      MAX_COMMENTS_PAGES,
      'pagination must stop at the defensive page cap'
    );
  } finally {
    fetchMock.restore();
  }
});

test('fetchComments rejects a server that echoes the cursor back while claiming more pages', async () => {
  // A `hasMore` page handing back the cursor it just received would replay
  // this page until the defensive cap, duplicating every comment it holds.
  const pages = new Map<string | null, { status: number; body?: unknown }>([
    [
      null,
      {
        status: 200,
        body: { comments: [makeComment('c1')], total: 5, hasMore: true, nextCursor: 'cur-1' },
      },
    ],
    [
      'cur-1',
      {
        status: 200,
        body: { comments: [makeComment('c1')], total: 5, hasMore: true, nextCursor: 'cur-1' },
      },
    ],
  ]);
  const fetchMock = installCommentsFetch(pages);
  try {
    await assert.rejects(
      () => makeClient().fetchComments('fr_1'),
      (err: any) => {
        assert.equal(err.name, 'InvalidResponseException');
        assert.match(err.message, /unchanged cursor/);
        return true;
      }
    );
    assert.equal(
      fetchMock.requests.length,
      2,
      'the walk must stop at the echoed cursor instead of replaying it to the page cap'
    );
  } finally {
    fetchMock.restore();
  }
});

test('fetchComments stops safely when a page reports hasMore without a nextCursor', async () => {
  const pages = new Map<string | null, { status: number; body?: unknown }>([
    [
      null,
      {
        status: 200,
        body: { comments: [makeComment('c1')], total: 1, hasMore: true, nextCursor: null },
      },
    ],
    ['cur-2', { status: 500, body: 'should never be requested' }],
  ]);
  const fetchMock = installCommentsFetch(pages);
  try {
    const comments = await makeClient().fetchComments('fr_1');
    assert.deepEqual(
      comments.map((c) => c.id),
      ['c1'],
      'a hasMore page without a usable cursor must end the walk, not hang'
    );
    assert.equal(fetchMock.requests.length, 1);
  } finally {
    fetchMock.restore();
  }
});

// ---------------------------------------------------------------------------
// UI: CommentsSection load-more (needs react-native module mocks)
// ---------------------------------------------------------------------------

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

const renderTestOptions: TestOptions = supportsModuleMocks
  ? {}
  : {
      skip: 'node:test module mocking unavailable (needs Node >= 22.3 with --experimental-test-module-mocks)',
    };

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

interface UiHarness {
  renderer: TestRenderer.ReactTestRenderer;
  requests: RecordedRequest[];
  setPages: (pages: Map<string | null, { status: number; body?: unknown }>) => void;
  unmount: () => void;
  restore: () => void;
}

/**
 * Renders a CommentsSection backed by global-fetch comment pages. The route
 * map stays mutable so tests can flip a later page's response mid-test.
 */
async function renderSection(
  initialPages: Map<string | null, { status: number; body?: unknown }>
): Promise<UiHarness> {
  const originalFetch = globalThis.fetch;
  const requests: RecordedRequest[] = [];
  let pages = initialPages;

  globalThis.fetch = (async (url: string | URL | Request) => {
    const target = url.toString();
    if (target.includes('/comments')) {
      const query = new URLSearchParams(target.split('?')[1] ?? '');
      const cursor = query.get('cursor');
      requests.push({ url: target, cursor, limit: query.get('limit') });
      const route = pages.get(cursor);
      if (!route) {
        return new Response('not found', { status: 404 });
      }
      return new Response(
        typeof route.body === 'string' ? route.body : JSON.stringify(route.body ?? {}),
        { status: route.status, headers: { 'Content-Type': 'application/json' } }
      );
    }
    // The provider's config fetch is the only other call; it may 404.
    return new Response('not found', { status: 404 });
  }) as any;

  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(CupThreadProvider, {
        client: makeClient(),
        children: React.createElement(CommentsSection, { featureRequestId: 'fr_1' }),
      })
    );
  });
  await settle();

  return {
    renderer,
    requests,
    setPages: (next) => {
      pages = next;
    },
    unmount: () => renderer.unmount(),
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

test(
  'CommentsSection appends the next page behind the load-more button and dedupes by id',
  renderTestOptions,
  async () => {
    const pages = new Map<string | null, { status: number; body?: unknown }>([
      [
        null,
        {
          status: 200,
          body: {
            comments: [makeComment('c1'), makeComment('c2')],
            total: 3,
            hasMore: true,
            nextCursor: 'cur-2',
          },
        },
      ],
      [
        'cur-2',
        {
          status: 200,
          body: {
            // c2 repeats so deduplication is exercised.
            comments: [makeComment('c2'), makeComment('c3')],
            total: 3,
            hasMore: false,
            nextCursor: null,
          },
        },
      ],
    ]);
    const harness = await renderSection(pages);

    try {
      await waitForText(harness.renderer, (t) => t === 'Comment c1');
      assert.ok(
        collectTexts(harness.renderer.root).includes('Comments (3)'),
        'heading must show the server total while pages are still loading'
      );
      await waitForText(harness.renderer, (t) => t === strings.comments.loadMore);

      const button = findPressable(harness.renderer.root, strings.comments.loadMore);
      assert.ok(button, 'load-more affordance must be pressable while hasMore');
      await act(async () => {
        button.props.onPress();
      });
      await settle();

      await waitForText(harness.renderer, (t) => t === 'Comment c3');
      const text = collectTexts(harness.renderer.root);
      assert.equal(
        text.filter((t) => t === 'Comment c2').length,
        1,
        'a comment served on both pages must render exactly once'
      );
      assert.equal(
        text.includes(strings.comments.loadMore),
        false,
        'footer must disappear once the server reports no more pages'
      );
      assert.equal(
        text.includes('Comments (3)'),
        true,
        'heading must keep showing the server total after the walk ends'
      );
      assert.equal(harness.requests.length, 2);
      assert.equal(harness.requests[1].cursor, 'cur-2');
      assert.equal(harness.requests[1].limit, '200');
      harness.unmount();
    } finally {
      harness.restore();
    }
  }
);

test(
  'CommentsSection omits the load-more affordance when a page has no cursor to follow',
  renderTestOptions,
  async () => {
    const pages = new Map<string | null, { status: number; body?: unknown }>([
      [
        null,
        {
          status: 200,
          body: {
            comments: [makeComment('c1')],
            total: 1,
            hasMore: true,
            nextCursor: null,
          },
        },
      ],
      ['cur-2', { status: 500, body: 'must never be requested' }],
    ]);
    const harness = await renderSection(pages);

    try {
      await waitForText(harness.renderer, (t) => t === 'Comment c1');
      await settle();
      assert.equal(
        collectTexts(harness.renderer.root).includes(strings.comments.loadMore),
        false,
        'a cursorless page must not offer a load-more affordance'
      );
      assert.equal(harness.requests.length, 1);
      harness.unmount();
    } finally {
      harness.restore();
    }
  }
);

test(
  'CommentsSection keeps loaded comments and offers a retry after a failed load-more',
  renderTestOptions,
  async () => {
    const pages = new Map<string | null, { status: number; body?: unknown }>([
      [
        null,
        {
          status: 200,
          body: {
            comments: [makeComment('c1')],
            total: 2,
            hasMore: true,
            nextCursor: 'cur-2',
          },
        },
      ],
      // A malformed cursor must surface as a retryable error state (400).
      ['cur-2', { status: 400, body: { error: 'Invalid cursor parameter' } }],
    ]);
    const harness = await renderSection(pages);

    try {
      await waitForText(harness.renderer, (t) => t === 'Comment c1');
      const button = findPressable(harness.renderer.root, strings.comments.loadMore);
      assert.ok(button);
      await act(async () => {
        button.props.onPress();
      });
      await settle();

      let text = collectTexts(harness.renderer.root);
      assert.ok(
        text.includes('Comment c1'),
        'already-loaded comments must stay visible after a load-more failure'
      );
      await waitForText(harness.renderer, (t) => t === strings.common.retry);
      assert.equal(
        text.includes(strings.comments.loadMore),
        false,
        'the footer must switch to retry after a failure'
      );

      // Flip the network to success and retry via the same affordance.
      pages.set('cur-2', {
        status: 200,
        body: {
          comments: [makeComment('c2')],
          total: 2,
          hasMore: false,
          nextCursor: null,
        },
      });
      const retry = findPressable(harness.renderer.root, strings.common.retry);
      assert.ok(retry, 'the failed footer must remain pressable for retry');
      await act(async () => {
        retry.props.onPress();
      });
      await settle();

      await waitForText(harness.renderer, (t) => t === 'Comment c2');
      text = collectTexts(harness.renderer.root);
      assert.equal(
        text.includes(strings.common.retry),
        false,
        'retry affordance must disappear once the page loads'
      );
      harness.unmount();
    } finally {
      harness.restore();
    }
  }
);

test(
  'CommentsSection heading prefers the server total over the loaded count',
  renderTestOptions,
  async () => {
    const pages = new Map<string | null, { status: number; body?: unknown }>([
      [
        null,
        {
          status: 200,
          body: {
            comments: [makeComment('c1')],
            total: 250,
            hasMore: true,
            nextCursor: 'cur-2',
          },
        },
      ],
      [
        'cur-2',
        {
          status: 200,
          body: {
            comments: [makeComment('c2')],
            total: 250,
            hasMore: true,
            nextCursor: 'cur-3',
          },
        },
      ],
      [
        'cur-3',
        {
          status: 200,
          body: {
            comments: [makeComment('c3')],
            total: 250,
            hasMore: false,
            nextCursor: null,
          },
        },
      ],
    ]);
    const harness = await renderSection(pages);

    try {
      await waitForText(harness.renderer, (t) => t === 'Comment c1');
      assert.ok(
        collectTexts(harness.renderer.root).includes('Comments (250)'),
        'a truncated thread must not present itself as complete'
      );

      const button = findPressable(harness.renderer.root, strings.comments.loadMore);
      await act(async () => {
        button.props.onPress();
      });
      await settle();
      await waitForText(harness.renderer, (t) => t === 'Comment c2');
      assert.ok(
        collectTexts(harness.renderer.root).includes('Comments (250)'),
        'heading must keep the server total while more pages remain'
      );

      const button2 = findPressable(harness.renderer.root, strings.comments.loadMore);
      await act(async () => {
        button2.props.onPress();
      });
      await settle();
      await waitForText(harness.renderer, (t) => t === 'Comment c3');
      assert.ok(
        collectTexts(harness.renderer.root).includes('Comments (250)'),
        'fully loaded thread must agree with the server total'
      );
      assert.equal(collectTexts(harness.renderer.root).includes(strings.comments.loadMore), false);
      assert.equal(harness.requests.length, 3);
      harness.unmount();
    } finally {
      harness.restore();
    }
  }
);

test(
  'a comment posted before the first page resolves keeps the load-more affordance',
  renderTestOptions,
  async () => {
    // Regression: the optimistic seed for a post that lands ahead of the
    // first page carries `hasMore: false` / `nextCursor: null`. That seed is
    // not a walk position, so the late first page's own cursor must win —
    // otherwise the load-more control never appears and the thread stays
    // silently truncated at one page.
    const originalFetch = globalThis.fetch;
    const requests: RecordedRequest[] = [];
    let releaseFirstPage: () => void = () => {};
    const firstPageGate = new Promise<void>((resolve) => {
      releaseFirstPage = resolve;
    });

    globalThis.fetch = (async (url: string | URL | Request, init?: { method?: string }) => {
      const target = url.toString();
      if (target.includes('/comments')) {
        if (init?.method && init.method !== 'GET') {
          // postComment: the write route shares the path with the read route.
          return new Response(JSON.stringify(makeComment('c_posted', { body: 'First!' })), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const query = new URLSearchParams(target.split('?')[1] ?? '');
        const cursor = query.get('cursor');
        requests.push({ url: target, cursor, limit: query.get('limit') });
        if (cursor === null) {
          await firstPageGate;
          return new Response(
            JSON.stringify({
              comments: [makeComment('c1')],
              total: 2,
              hasMore: true,
              nextCursor: 'cur-2',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        return new Response(
          JSON.stringify({
            comments: [makeComment('c2')],
            total: 2,
            hasMore: false,
            nextCursor: null,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      // The provider's config fetch is the only other call; it may 404.
      return new Response('not found', { status: 404 });
    }) as any;

    let renderer!: TestRenderer.ReactTestRenderer;
    try {
      await act(async () => {
        renderer = TestRenderer.create(
          React.createElement(CupThreadProvider, {
            client: makeClient(),
            userToken: 'usr_tok_test',
            commentSessionProvider: async () => 'clerk_jwt_live',
            children: React.createElement(CommentsSection, { featureRequestId: 'fr_1' }),
          })
        );
      });
      await settle();

      // The first page is still gated: post a comment into the empty thread.
      const input = renderer.root.findByType(TextInputStub as any);
      await act(async () => {
        input.props.onChangeText('First!');
      });
      const send = findPressable(renderer.root, strings.comments.postButton);
      assert.ok(send, 'composer must be pressable while the first page is pending');
      await act(async () => {
        send.props.onPress();
      });
      await settle();

      // The list body stays behind the loading state until the first page
      // lands, but the optimistic seed must already drive the heading total.
      assert.ok(
        collectTexts(renderer.root).includes('Comments (1)'),
        'the posted comment must be seeded into the page state while the first page is pending'
      );
      assert.equal(
        requests.some((r) => r.cursor === 'cur-2'),
        false,
        'no follow-up page may be requested before the first page resolves'
      );

      // Now let the real first page land behind the seed.
      releaseFirstPage();
      await waitForText(renderer, (t) => t === 'Comment c1');
      assert.ok(
        collectTexts(renderer.root).includes('First!'),
        'the locally posted comment must survive the merge with the late first page'
      );

      const button = findPressable(renderer.root, strings.comments.loadMore);
      assert.ok(
        button,
        'the late first page must restore the load-more affordance the seed could not know about'
      );
      await act(async () => {
        button.props.onPress();
      });
      await settle();
      await waitForText(renderer, (t) => t === 'Comment c2');

      const text = collectTexts(renderer.root);
      assert.equal(
        text.includes(strings.comments.loadMore),
        false,
        'footer must disappear once the walked thread is complete'
      );
      assert.ok(text.includes('First!'), 'the locally posted comment must survive the merge');
      renderer.unmount();
    } finally {
      releaseFirstPage();
      globalThis.fetch = originalFetch;
    }
  }
);
