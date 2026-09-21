import test, { type TestOptions } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { FeedbackClient } from '../src/client/FeedbackClient';
import type { FeedbackAttachment, FeatureRequestItem } from '../src/types';

// Regression tests for issue #49: every icon-only touch target must announce
// itself to screen readers with a localized `accessibilityLabel` and
// `accessibilityRole="button"`, text-bearing touchables must expose a role,
// markdown links must expose `accessibilityRole="link"`, and every `<Modal>`
// must set `accessibilityViewIsModal` so focus cannot escape an open sheet.
//
// Components import react-native, which cannot load under plain Node. Mock
// every symbol they use with lightweight stubs that *record* accessibility
// props, then dynamically import the real modules so the mock is in place
// before evaluation. Module mocking needs Node >= 22.3 with
// --experimental-test-module-mocks; without it the render-level tests below
// are skipped.
const supportsModuleMocks = typeof (test as any).mock?.module === 'function';

interface CapturedPressable {
  props: Record<string, any>;
  text: string;
}

const pressables: CapturedPressable[] = [];
const modalProps: Record<string, any>[] = [];
const textProps: Record<string, any>[] = [];

/** Recursively collects the visible text inside a stubbed element tree. */
function collectText(node: any): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(collectText).join('');
  if (typeof node === 'object' && node.props) return collectText(node.props.children);
  return '';
}

const TouchableOpacityStub = (props: any) => {
  pressables.push({ props, text: collectText(props.children) });
  return props.children ?? null;
};

const ModalStub = (props: any) => {
  modalProps.push(props);
  return props.children ?? null;
};

const TextStub = (props: any) => {
  textProps.push(props);
  // Text must pass children through (unlike in other suites where Text is a
  // leaf): MarkdownText renders inline link elements as children of a
  // paragraph Text, and those children only enter the tree when the paragraph
  // returns them.
  return props.children ?? null;
};

if (supportsModuleMocks) {
  (test as any).mock.module('react-native', {
    namedExports: {
      useColorScheme: () => 'light',
      // Layout stubs pass children through so nested pressables stay in the
      // rendered tree.
      View: ({ children }: any) => children ?? null,
      Text: TextStub,
      TextInput: () => null,
      Image: () => null,
      TouchableOpacity: TouchableOpacityStub,
      ActivityIndicator: () => null,
      ScrollView: ({ children }: any) => children ?? null,
      Modal: ModalStub,
      SafeAreaView: ({ children }: any) => children ?? null,
      RefreshControl: () => null,
      FlatList: ({
        data,
        renderItem,
        keyExtractor,
        ListHeaderComponent,
        ListFooterComponent,
        ListEmptyComponent,
      }: any) => {
        const items = Array.isArray(data)
          ? data.map((item: any, index: number) =>
              React.createElement(
                React.Fragment,
                { key: keyExtractor ? keyExtractor(item, index) : String(index) },
                renderItem({ item, index, separators: {} })
              )
            )
          : [];
        return React.createElement(
          React.Fragment,
          null,
          ListHeaderComponent ? React.createElement(ListHeaderComponent) : null,
          ...items,
          ListFooterComponent ? React.createElement(ListFooterComponent) : null,
          ListEmptyComponent ? React.createElement(ListEmptyComponent) : null
        );
      },
      StyleSheet: { create: (styles: any) => styles, flatten: (s: any) => s },
      Alert: { alert: () => {} },
      Linking: { openURL: () => Promise.resolve() },
    },
  });
}

const { CupThreadProvider } = await import('../src/theme/CupThreadThemeProvider');
const { FeatureRequestsScreen } = await import('../src/components/FeatureRequestsScreen');
const { RoadmapBoardScreen } = await import('../src/components/RoadmapBoardScreen');
const { UserProfileScreen } = await import('../src/components/UserProfileScreen');
const { WhatsNewScreen } = await import('../src/components/WhatsNewScreen');
const { FeedbackComposer } = await import('../src/components/FeedbackComposer');
const { FeatureRequestComposeSheet } = await import('../src/components/FeatureRequestComposeSheet');
const { ChangelogOverlay } = await import('../src/components/ChangelogOverlay');
const { FeatureRequestDetail } = await import('../src/components/FeatureRequestDetail');
const { ErrorState } = await import('../src/components/ErrorState');
const { MarkdownText } = await import('../src/components/MarkdownText');

const renderTestOptions: TestOptions = supportsModuleMocks
  ? {}
  : {
      skip: 'node:test module mocking unavailable (needs Node >= 22.3 with --experimental-test-module-mocks)',
    };

const APP_KEY = 'app_a11y';

/** Let pending microtasks and pending act-batched state updates settle. */
async function flush(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2));
    await act(async () => {});
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Fetch stub covering every endpoint the rendered screens hit. Unknown routes
 * return 200 with an empty JSON object so optional fetches never throw.
 */
function stubFetch(): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    const target = url.toString();
    if (target.includes('/api/v1/public/config/')) {
      return jsonResponse({
        appKey: APP_KEY,
        name: 'A11y Test App',
        theme: {},
        sdk: { features: { changelog: true } },
      });
    }
    if (target.includes('/api/v1/public/versions/')) {
      return jsonResponse({
        versions: [
          { id: 'ver_1', appId: 'app_1', label: '1.0.0', position: 0 },
          { id: 'ver_2', appId: 'app_1', label: '1.1.0', position: 1 },
        ],
      });
    }
    if (target.includes('/api/v1/public/columns/')) {
      return jsonResponse({
        columns: [
          {
            id: 'col_progress',
            appId: APP_KEY,
            name: 'In Progress',
            slug: 'in-progress',
            position: 0,
            isVisible: true,
          },
        ],
      });
    }
    if (target.includes('/changelog')) {
      return jsonResponse({
        entries: [
          {
            id: 'chg_1',
            title: 'Release 1.0.0',
            body: 'Initial release notes',
            publishedAt: '2026-09-01T00:00:00.000Z',
            versionLabel: '1.0.0',
          },
        ],
      });
    }
    if (target.includes('/api/v1/users/')) {
      return jsonResponse({
        profile: {
          displayName: 'Lex',
          websiteUrl: 'https://example.com',
        },
        apps: [],
        recentComments: [],
        hideComments: true,
      });
    }
    if (/\/comments/.test(target)) {
      return jsonResponse({
        comments: [
          {
            id: 'cmt_1',
            featureRequestId: 'fr_1',
            authorName: 'DevTeam',
            body: 'We started working on this.',
            createdAt: '2026-08-20T09:00:00.000Z',
            isHidden: false,
          },
        ],
      });
    }
    if (target.includes('/api/v1/feature-requests')) {
      return jsonResponse({ requests: [], total: 0 });
    }
    return jsonResponse({});
  }) as any;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

function makeClient(): FeedbackClient {
  return new FeedbackClient({ baseUrl: 'https://api.cupthread.com', appKey: APP_KEY });
}

async function renderWithProvider(
  element: React.ReactElement
): Promise<TestRenderer.ReactTestRenderer> {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(CupThreadProvider, {
        client: makeClient(),
        userToken: 'usr_tok_1',
        children: element,
      })
    );
  });
  await flush();
  return renderer;
}

/**
 * The invariant from issue #49: any pressable whose visible text is a bare
 * navigation glyph (or nothing at all) must expose a button role and a
 * non-empty localized label.
 */
function assertIconOnlyPressablesAreLabeled(screen: string): void {
  for (const p of pressables) {
    if (p.text === '←' || p.text === '✕' || p.text === '') {
      assert.equal(
        p.props.accessibilityRole,
        'button',
        `[${screen}] icon-only pressable (text: "${p.text}") must expose accessibilityRole="button"`
      );
      assert.ok(
        typeof p.props.accessibilityLabel === 'string' && p.props.accessibilityLabel.length > 0,
        `[${screen}] icon-only pressable (text: "${p.text}") must expose a non-empty accessibilityLabel`
      );
    }
  }
}

function findPressable(text: string): CapturedPressable {
  const p = pressables.find((cand) => cand.text === text);
  assert.ok(p, `expected a pressable with visible text "${text}"`);
  return p;
}

function assertModalIsAccessible(screen: string): void {
  assert.ok(modalProps.length > 0, `[${screen}] expected a rendered <Modal>`);
  for (const modal of modalProps) {
    assert.equal(
      modal.accessibilityViewIsModal,
      true,
      `[${screen}] <Modal> must set accessibilityViewIsModal so screen-reader focus cannot escape`
    );
  }
}

const ITEM: FeatureRequestItem = {
  id: 'fr_1',
  title: 'Widget support',
  description: 'Add home screen widgets',
  voteCount: 3,
  hasVoted: false,
  isOwnRequest: false,
  createdAt: '2026-08-01T00:00:00.000Z',
} as FeatureRequestItem;

const ATTACHMENTS: FeedbackAttachment[] = [
  {
    kind: 'image',
    key: 'key-shot',
    url: 'https://cdn.example.com/shot.png',
    filename: 'screenshot.png',
    mimeType: 'image/png',
  },
  {
    kind: 'r2',
    key: 'key-log',
    url: 'https://cdn.example.com/log.txt',
    filename: '',
    mimeType: 'text/plain',
  },
];

test(
  'FeatureRequestsScreen: back button, compose button, and version chips expose roles/labels',
  renderTestOptions,
  async () => {
    pressables.length = 0;
    modalProps.length = 0;
    const restoreFetch = stubFetch();
    let renderer!: TestRenderer.ReactTestRenderer;
    try {
      renderer = await renderWithProvider(
        React.createElement(FeatureRequestsScreen, { onBack: () => {} })
      );
      assertIconOnlyPressablesAreLabeled('FeatureRequestsScreen');

      const back = findPressable('←');
      assert.equal(back.props.accessibilityLabel, 'Back');
      assert.equal(back.props.accessibilityRole, 'button');

      const compose = findPressable('+ New');
      assert.equal(compose.props.accessibilityRole, 'button');

      const chip = pressables.find((p) => p.text === '1.0.0');
      assert.ok(chip, 'version chip should render for fetched versions');
      assert.equal(chip.props.accessibilityRole, 'button');
    } finally {
      restoreFetch();
      renderer?.unmount();
    }
  }
);

test(
  'RoadmapBoardScreen: back button and column tabs expose roles/labels',
  renderTestOptions,
  async () => {
    pressables.length = 0;
    modalProps.length = 0;
    const restoreFetch = stubFetch();
    let renderer!: TestRenderer.ReactTestRenderer;
    try {
      renderer = await renderWithProvider(
        React.createElement(RoadmapBoardScreen, { onBack: () => {} })
      );
      assertIconOnlyPressablesAreLabeled('RoadmapBoardScreen');

      const back = findPressable('←');
      assert.equal(back.props.accessibilityLabel, 'Back');
      assert.equal(back.props.accessibilityRole, 'button');

      const tab = findPressable('In Progress (0)');
      assert.equal(tab.props.accessibilityRole, 'button');
      // The first captured render still has no auto-selected column; the
      // selection effect lands on the latest capture.
      const selectedTab = pressables
        .filter((p) => p.text === 'In Progress (0)')
        .pop() as CapturedPressable;
      assert.deepEqual(selectedTab.props.accessibilityState, { selected: true });
    } finally {
      restoreFetch();
      renderer?.unmount();
    }
  }
);

test(
  'UserProfileScreen: back button is labeled and the website link exposes a link role',
  renderTestOptions,
  async () => {
    pressables.length = 0;
    modalProps.length = 0;
    const restoreFetch = stubFetch();
    let renderer!: TestRenderer.ReactTestRenderer;
    try {
      renderer = await renderWithProvider(
        React.createElement(UserProfileScreen, { userId: 'usr_1', onBack: () => {} })
      );
      assertIconOnlyPressablesAreLabeled('UserProfileScreen');

      const back = findPressable('←');
      assert.equal(back.props.accessibilityLabel, 'Back');
      assert.equal(back.props.accessibilityRole, 'button');

      const website = findPressable('https://example.com');
      assert.equal(website.props.accessibilityRole, 'link');
    } finally {
      restoreFetch();
      renderer?.unmount();
    }
  }
);

test(
  'WhatsNewScreen: back button and subscribe button expose roles and disabled state',
  renderTestOptions,
  async () => {
    pressables.length = 0;
    modalProps.length = 0;
    const restoreFetch = stubFetch();
    let renderer!: TestRenderer.ReactTestRenderer;
    try {
      renderer = await renderWithProvider(
        React.createElement(WhatsNewScreen, { onBack: () => {} })
      );
      assertIconOnlyPressablesAreLabeled('WhatsNewScreen');

      const back = findPressable('←');
      assert.equal(back.props.accessibilityLabel, 'Back');
      assert.equal(back.props.accessibilityRole, 'button');

      const subscribe = findPressable('Subscribe');
      assert.equal(subscribe.props.accessibilityRole, 'button');
      assert.deepEqual(subscribe.props.accessibilityState, { disabled: false });
    } finally {
      restoreFetch();
      renderer?.unmount();
    }
  }
);

test(
  'FeedbackComposer: close and remove-attachment buttons are labeled, submit exposes role/state, modal is contained',
  renderTestOptions,
  async () => {
    pressables.length = 0;
    modalProps.length = 0;
    const restoreFetch = stubFetch();
    let renderer!: TestRenderer.ReactTestRenderer;
    try {
      renderer = await renderWithProvider(
        React.createElement(FeedbackComposer, {
          onClose: () => {},
          initialDraft: {
            title: 'Crash on launch',
            description: 'The app crashes when launching on iPad',
            attachments: ATTACHMENTS,
          },
        })
      );
      assertIconOnlyPressablesAreLabeled('FeedbackComposer');
      assertModalIsAccessible('FeedbackComposer');

      // Three distinct ✕ pressables render: the header close plus one remove
      // button per attachment row (stub captures repeat across re-renders, so
      // assert on the label set rather than the capture count). Remove buttons
      // must be disambiguated per row — the named attachment includes its
      // filename, the unnamed one falls back to the bare localized label.
      const crossButtons = pressables.filter((p) => p.text === '✕');
      const crossLabels = new Set(crossButtons.map((p) => p.props.accessibilityLabel));
      assert.deepEqual([...crossLabels].sort(), ['Close', 'Remove', 'Remove: screenshot.png']);
      for (const p of crossButtons) {
        assert.equal(p.props.accessibilityRole, 'button');
      }

      const submit = findPressable('Submit Feedback');
      assert.equal(submit.props.accessibilityRole, 'button');
      assert.deepEqual(submit.props.accessibilityState, { disabled: false });
    } finally {
      restoreFetch();
      renderer?.unmount();
    }
  }
);

test(
  'FeatureRequestComposeSheet: close button is labeled, submit exposes role/state, modal is contained',
  renderTestOptions,
  async () => {
    pressables.length = 0;
    modalProps.length = 0;
    const restoreFetch = stubFetch();
    let renderer!: TestRenderer.ReactTestRenderer;
    try {
      renderer = await renderWithProvider(
        React.createElement(FeatureRequestComposeSheet, {
          onClose: () => {},
          initialDraft: { title: 'Widget support', description: 'Add home screen widgets' },
        })
      );
      assertIconOnlyPressablesAreLabeled('FeatureRequestComposeSheet');
      assertModalIsAccessible('FeatureRequestComposeSheet');

      const close = findPressable('✕');
      assert.equal(close.props.accessibilityLabel, 'Close');
      assert.equal(close.props.accessibilityRole, 'button');

      const submit = pressables.find((p) => p.text.includes('Submit'));
      assert.ok(submit, 'submit button should render');
      assert.equal(submit.props.accessibilityRole, 'button');
    } finally {
      restoreFetch();
      renderer?.unmount();
    }
  }
);

test(
  'ChangelogOverlay: close button is labeled, continue button has a role, modal is contained',
  renderTestOptions,
  async () => {
    pressables.length = 0;
    modalProps.length = 0;
    const restoreFetch = stubFetch();
    let renderer!: TestRenderer.ReactTestRenderer;
    try {
      renderer = await renderWithProvider(
        React.createElement(ChangelogOverlay, { visible: true, onClose: () => {} })
      );
      assertIconOnlyPressablesAreLabeled('ChangelogOverlay');
      assertModalIsAccessible('ChangelogOverlay');

      const close = findPressable('✕');
      assert.equal(close.props.accessibilityLabel, 'Close');
      assert.equal(close.props.accessibilityRole, 'button');

      const textButtons = pressables.filter(
        (p) => p.text.length > 0 && p.text !== '✕' && p.props.accessibilityRole !== undefined
      );
      assert.ok(
        textButtons.some((p) => p.props.accessibilityRole === 'button'),
        'the primary continue button must expose accessibilityRole="button"'
      );
    } finally {
      restoreFetch();
      renderer?.unmount();
    }
  }
);

test(
  'FeatureRequestDetail: back button is labeled, reply button has a role, modal is contained',
  renderTestOptions,
  async () => {
    pressables.length = 0;
    modalProps.length = 0;
    const restoreFetch = stubFetch();
    let renderer!: TestRenderer.ReactTestRenderer;
    try {
      renderer = await renderWithProvider(
        React.createElement(FeatureRequestDetail, {
          item: ITEM,
          visible: true,
          onClose: () => {},
        })
      );
      assertIconOnlyPressablesAreLabeled('FeatureRequestDetail');
      assertModalIsAccessible('FeatureRequestDetail');

      // The detail back control renders "← Back": the arrow must not leak
      // into the announcement, so the label is the bare localized "Back".
      const back = pressables.find((p) => p.text === '← Back');
      assert.ok(back, 'detail back button should render');
      assert.equal(back.props.accessibilityLabel, 'Back');
      assert.equal(back.props.accessibilityRole, 'button');

      const reply = findPressable('Reply');
      assert.equal(reply.props.accessibilityRole, 'button');
    } finally {
      restoreFetch();
      renderer?.unmount();
    }
  }
);

test(
  'ErrorState: retry button exposes a button role and reflects the retrying state',
  renderTestOptions,
  async () => {
    pressables.length = 0;
    const restoreFetch = stubFetch();
    let renderer!: TestRenderer.ReactTestRenderer;
    try {
      renderer = await renderWithProvider(
        React.createElement(ErrorState, {
          message: 'Something went wrong',
          retryLabel: 'Retry',
          onRetry: () => {},
        })
      );
      const retry = findPressable('Retry');
      assert.equal(retry.props.accessibilityRole, 'button');
      assert.deepEqual(retry.props.accessibilityState, { disabled: false });
    } finally {
      restoreFetch();
      renderer?.unmount();
    }

    pressables.length = 0;
    try {
      renderer = await renderWithProvider(
        React.createElement(ErrorState, {
          message: 'Something went wrong',
          retryLabel: 'Retry',
          onRetry: () => {},
          isRetrying: true,
        })
      );
      const retry = findPressable('Retry');
      assert.deepEqual(retry.props.accessibilityState, { disabled: true });
    } finally {
      restoreFetch();
      renderer?.unmount();
    }
  }
);

test('MarkdownText: pressable links expose a link role, inert links stay unroled', async () => {
  textProps.length = 0;
  const restoreFetch = stubFetch();
  let renderer!: TestRenderer.ReactTestRenderer;
  try {
    renderer = TestRenderer.create(
      React.createElement(MarkdownText, {
        content: 'See [Docs](https://cupthread.com) or [bad](javascript:alert(1))',
      })
    );
    await flush();

    const link = textProps.find((t) => t.children === 'Docs');
    assert.ok(link, 'link text should render');
    assert.equal(link.accessibilityRole, 'link');

    const inert = textProps.find((t) => t.children === 'bad');
    assert.ok(inert, 'unsafe link text should render as inert text');
    assert.equal(inert.accessibilityRole, undefined);
    assert.equal(inert.onPress, undefined);
  } finally {
    restoreFetch();
    renderer.unmount();
  }
});

test('all locale dictionaries provide non-empty a11y label strings', async () => {
  const {
    enStrings,
    deStrings,
    esStrings,
    frStrings,
    itStrings,
    jaStrings,
    koStrings,
    noStrings,
    plStrings,
    ptStrings,
    trStrings,
    viStrings,
    zhHansStrings,
    zhHantStrings,
  } = await import('../src/i18n');

  const dictionaries: Record<string, any> = {
    en: enStrings,
    de: deStrings,
    es: esStrings,
    fr: frStrings,
    it: itStrings,
    ja: jaStrings,
    ko: koStrings,
    no: noStrings,
    pl: plStrings,
    pt: ptStrings,
    tr: trStrings,
    vi: viStrings,
    'zh-Hans': zhHansStrings,
    'zh-Hant': zhHantStrings,
  };

  for (const [locale, strings] of Object.entries(dictionaries)) {
    assert.ok(
      typeof strings.common.back === 'string' && strings.common.back.length > 0,
      `[${locale}] common.back must be a non-empty string`
    );
    assert.ok(
      typeof strings.common.close === 'string' && strings.common.close.length > 0,
      `[${locale}] common.close must be a non-empty string`
    );
    assert.ok(
      typeof strings.feedbackComposer.removeAttachment === 'string' &&
        strings.feedbackComposer.removeAttachment.length > 0,
      `[${locale}] feedbackComposer.removeAttachment must be a non-empty string`
    );
  }
});
