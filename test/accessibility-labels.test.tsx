import test, { type TestOptions } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { createFlatListStub } from './helpers/virtualizedListStub';
import { FeedbackClient } from '../src/client/FeedbackClient';
import type { FeedbackAttachment, FeatureRequestItem } from '../src/types';
import type { PickedAttachmentInput } from '../src/utils/attachments';

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
const textInputProps: Record<string, any>[] = [];

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
      TextInput: (props: any) => {
        textInputProps.push(props);
        return null;
      },
      Image: () => null,
      TouchableOpacity: TouchableOpacityStub,
      ActivityIndicator: () => null,
      ScrollView: ({ children }: any) => children ?? null,
      Modal: ModalStub,
      SafeAreaView: ({ children }: any) => children ?? null,
      RefreshControl: () => null,
      FlatList: createFlatListStub(),
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
const { CommentsSection } = await import('../src/components/CommentsSection');
const { VoteButton } = await import('../src/components/VoteButton');
const { enStrings } = await import('../src/i18n');

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
        publicApps: [],
        recentComments: [],
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
  element: React.ReactElement,
  options?: { commentSessionProvider?: () => string }
): Promise<TestRenderer.ReactTestRenderer> {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      React.createElement(CupThreadProvider, {
        client: makeClient(),
        userToken: 'usr_tok_1',
        ...(options?.commentSessionProvider
          ? { commentSessionProvider: options.commentSessionProvider }
          : {}),
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
      assert.equal(subscribe.props.accessibilityLabel, 'Subscribe');
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

      const removeButtons = crossButtons.filter(
        (p) => p.props.accessibilityLabel && p.props.accessibilityLabel !== 'Close'
      );
      assert.ok(removeButtons.length > 0);
      for (const p of removeButtons) {
        assert.deepEqual(p.props.accessibilityState, { disabled: false });
      }

      const submit = findPressable('Submit Feedback');
      assert.equal(submit.props.accessibilityRole, 'button');
      assert.equal(submit.props.accessibilityLabel, 'Submit Feedback');
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
      assert.equal(submit.props.accessibilityLabel, 'Submit Proposal');
      assert.deepEqual(submit.props.accessibilityState, { disabled: false });
    } finally {
      restoreFetch();
      renderer?.unmount();
    }
  }
);

test(
  'FeedbackComposer & FeatureRequestComposeSheet: submit button reflects disabled accessibilityState when surface is disabled (#208)',
  renderTestOptions,
  async () => {
    pressables.length = 0;
    modalProps.length = 0;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      const target = url.toString();
      if (target.includes('/api/v1/public/config/')) {
        return jsonResponse({
          appKey: APP_KEY,
          name: 'A11y Test App',
          theme: {},
          sdk: {
            features: {
              feedback: false,
              featureRequests: false,
            },
          },
        });
      }
      if (target.includes('/api/v1/public/versions/')) {
        return jsonResponse({ versions: [] });
      }
      return jsonResponse({});
    }) as any;

    let composerRenderer!: TestRenderer.ReactTestRenderer;
    let sheetRenderer!: TestRenderer.ReactTestRenderer;

    try {
      // 1. FeedbackComposer with feedback surface disabled
      composerRenderer = await renderWithProvider(
        React.createElement(FeedbackComposer, {
          onClose: () => {},
          initialDraft: {
            title: 'Disabled feedback test',
            description: 'Feedback surface is turned off in appConfig',
          },
        })
      );
      await flush(10);

      const composerMatching = pressables.filter((p) => p.text.includes('Submit Feedback'));
      assert.ok(composerMatching.length > 0, 'FeedbackComposer submit button should render');
      const composerSubmit = composerMatching[composerMatching.length - 1];
      assert.equal(composerSubmit.props.accessibilityRole, 'button');
      assert.equal(composerSubmit.props.disabled, true);
      assert.deepEqual(composerSubmit.props.accessibilityState, { disabled: true });

      // 2. FeatureRequestComposeSheet with featureRequests surface disabled
      pressables.length = 0;
      sheetRenderer = await renderWithProvider(
        React.createElement(FeatureRequestComposeSheet, {
          onClose: () => {},
          initialDraft: {
            title: 'Disabled feature request test',
            description: 'Feature requests surface is turned off in appConfig',
          },
        })
      );
      await flush(10);

      const sheetMatching = pressables.filter((p) => p.text.includes('Submit'));
      assert.ok(sheetMatching.length > 0, 'FeatureRequestComposeSheet submit button should render');
      const sheetSubmit = sheetMatching[sheetMatching.length - 1];
      assert.equal(sheetSubmit.props.accessibilityRole, 'button');
      assert.equal(sheetSubmit.props.disabled, true);
      assert.deepEqual(sheetSubmit.props.accessibilityState, { disabled: true });
    } finally {
      globalThis.fetch = originalFetch;
      composerRenderer?.unmount();
      sheetRenderer?.unmount();
    }
  }
);

test(
  'FeedbackComposer & FeatureRequestComposeSheet: submit button updates accessibilityLabel to Submitting... while in flight',
  renderTestOptions,
  async () => {
    pressables.length = 0;
    modalProps.length = 0;
    const originalFetch = globalThis.fetch;
    let resolveFeedback!: (res: Response) => void;
    let resolveFeatureRequest!: (res: Response) => void;

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
      if (target.includes('/api/v1/feedback')) {
        return new Promise<Response>((resolve) => {
          resolveFeedback = resolve;
        });
      }
      if (target.includes('/api/v1/feature-requests')) {
        return new Promise<Response>((resolve) => {
          resolveFeatureRequest = resolve;
        });
      }
      return jsonResponse({});
    }) as any;

    let composerRenderer!: TestRenderer.ReactTestRenderer;
    let sheetRenderer!: TestRenderer.ReactTestRenderer;
    try {
      // 1. FeedbackComposer in-flight submission
      composerRenderer = await renderWithProvider(
        React.createElement(FeedbackComposer, {
          isModal: false,
          initialDraft: {
            title: 'Crash on launch',
            description: 'The app crashes when launching on iPad',
          },
        })
      );

      const composerSubmit = findPressable('Submit Feedback');
      assert.equal(composerSubmit.props.accessibilityLabel, 'Submit Feedback');

      await act(async () => {
        composerSubmit.props.onPress();
      });
      await flush(2);

      // Submit is now in-flight, so child is ActivityIndicator (no text)
      // and accessibilityLabel must be 'Submitting...'
      const submittingButtons = pressables.filter(
        (p) => p.props.accessibilityLabel === 'Submitting...'
      );
      assert.ok(
        submittingButtons.length > 0,
        'FeedbackComposer submit button must have accessibilityLabel="Submitting..." during submission'
      );
      const latestComposerSubmitting = submittingButtons[submittingButtons.length - 1];
      assert.equal(latestComposerSubmitting.props.accessibilityRole, 'button');
      assert.equal(latestComposerSubmitting.text, '');
      assertIconOnlyPressablesAreLabeled('FeedbackComposer[submitting]');

      // Settle feedback submission
      await act(async () => {
        resolveFeedback(jsonResponse({ success: true }));
      });
      await flush(4);

      // 2. FeatureRequestComposeSheet in-flight submission
      pressables.length = 0;
      sheetRenderer = await renderWithProvider(
        React.createElement(FeatureRequestComposeSheet, {
          isModal: false,
          initialDraft: { title: 'Widget support', description: 'Add home screen widgets' },
        })
      );

      const sheetSubmit = pressables.find((p) => p.text.includes('Submit'));
      assert.ok(sheetSubmit, 'FeatureRequestComposeSheet submit button should render');
      assert.equal(sheetSubmit.props.accessibilityLabel, 'Submit Proposal');

      await act(async () => {
        sheetSubmit.props.onPress();
      });
      await flush(2);

      const sheetSubmittingButtons = pressables.filter(
        (p) => p.props.accessibilityLabel === 'Submitting...'
      );
      assert.ok(
        sheetSubmittingButtons.length > 0,
        'FeatureRequestComposeSheet submit button must have accessibilityLabel="Submitting..." during submission'
      );
      const latestSheetSubmitting = sheetSubmittingButtons[sheetSubmittingButtons.length - 1];
      assert.equal(latestSheetSubmitting.props.accessibilityRole, 'button');
      assert.equal(latestSheetSubmitting.text, '');
      assertIconOnlyPressablesAreLabeled('FeatureRequestComposeSheet[submitting]');

      // Settle feature request submission
      await act(async () => {
        resolveFeatureRequest(jsonResponse({ id: 'fr_new', title: 'Widget support' }));
      });
      await flush(4);
    } finally {
      globalThis.fetch = originalFetch;
      composerRenderer?.unmount();
      sheetRenderer?.unmount();
    }
  }
);

test(
  'FeedbackComposer: attachment pick and remove buttons reflect accessibilityState.disabled during submission and upload (#258)',
  renderTestOptions,
  async () => {
    pressables.length = 0;
    modalProps.length = 0;
    const originalFetch = globalThis.fetch;
    let resolveFeedback!: (res: Response) => void;

    globalThis.fetch = (async (url: string | URL | Request) => {
      const target = url.toString();
      if (target.includes('/api/v1/public/config/')) {
        return jsonResponse({
          appKey: APP_KEY,
          name: 'A11y Test App',
          sdk: { features: { feedback: true } },
        });
      }
      if (target.includes('/api/v1/feedback')) {
        return new Promise<Response>((resolve) => {
          resolveFeedback = resolve;
        });
      }
      return jsonResponse({});
    }) as any;

    let resolvePick: (
      value: PickedAttachmentInput | PickedAttachmentInput[] | null | undefined
    ) => void = () => {};
    let renderer!: TestRenderer.ReactTestRenderer;
    try {
      renderer = await renderWithProvider(
        React.createElement(FeedbackComposer, {
          isModal: false,
          initialDraft: {
            title: 'Bug report',
            description: 'Something crashed',
            attachments: ATTACHMENTS,
          },
          onPickAttachment: () =>
            new Promise<PickedAttachmentInput | PickedAttachmentInput[] | null | undefined>(
              (resolve) => {
                resolvePick = resolve;
              }
            ),
        })
      );

      // 1. Idle state:
      // Add attachment button is enabled
      const idleAddBtn = pressables.find(
        (p) => p.text === `+ ${enStrings.feedbackComposer.addAttachment}`
      );
      assert.ok(idleAddBtn, 'Add attachment button must be rendered');
      assert.deepEqual(idleAddBtn.props.accessibilityState, { disabled: false });

      // Remove attachment buttons are enabled
      const idleRemoveBtns = pressables.filter(
        (p) =>
          p.text === '✕' &&
          p.props.accessibilityLabel &&
          p.props.accessibilityLabel.startsWith(enStrings.feedbackComposer.removeAttachment)
      );
      assert.ok(idleRemoveBtns.length > 0, 'Remove buttons rendered in idle state');
      for (const btn of idleRemoveBtns) {
        assert.deepEqual(btn.props.accessibilityState, { disabled: false });
      }

      // 2. In-flight upload state:
      await act(async () => {
        idleAddBtn.props.onPress();
      });
      await flush(2);

      const uploadingAddBtns = pressables.filter(
        (p) => p.text === enStrings.feedbackComposer.uploadingAttachment
      );
      assert.ok(uploadingAddBtns.length > 0, 'Uploading button must be rendered');
      const latestUploadingAddBtn = uploadingAddBtns[uploadingAddBtns.length - 1];
      assert.deepEqual(latestUploadingAddBtn.props.accessibilityState, { disabled: true });

      // Settle upload (return null so no new file is added)
      await act(async () => {
        resolvePick(null);
      });
      await flush(2);

      // 3. In-flight submission state:
      const submitBtn = findPressable(enStrings.feedbackComposer.submitButton);
      assert.ok(submitBtn, 'Submit button must be rendered');

      await act(async () => {
        submitBtn.props.onPress();
      });
      await flush(2);

      // Add attachment button disabled during submission
      const submittingAddBtns = pressables.filter(
        (p) => p.text === `+ ${enStrings.feedbackComposer.addAttachment}`
      );
      assert.ok(submittingAddBtns.length > 0, 'Add attachment button rendered during submit');
      const latestSubmittingAddBtn = submittingAddBtns[submittingAddBtns.length - 1];
      assert.deepEqual(latestSubmittingAddBtn.props.accessibilityState, { disabled: true });

      // Remove attachment buttons disabled during submission
      const submittingRemoveBtns = pressables.filter(
        (p) =>
          p.text === '✕' &&
          p.props.accessibilityLabel &&
          p.props.accessibilityLabel.startsWith(enStrings.feedbackComposer.removeAttachment)
      );
      const latestNamedRemove = submittingRemoveBtns
        .filter(
          (p) =>
            p.props.accessibilityLabel ===
            `${enStrings.feedbackComposer.removeAttachment}: screenshot.png`
        )
        .pop();
      const latestUnnamedRemove = submittingRemoveBtns
        .filter((p) => p.props.accessibilityLabel === enStrings.feedbackComposer.removeAttachment)
        .pop();
      assert.ok(latestNamedRemove, 'Named remove button rendered during submit');
      assert.deepEqual(latestNamedRemove.props.accessibilityState, { disabled: true });
      assert.ok(latestUnnamedRemove, 'Unnamed remove button rendered during submit');
      assert.deepEqual(latestUnnamedRemove.props.accessibilityState, { disabled: true });

      // Settle feedback submission
      await act(async () => {
        resolveFeedback(jsonResponse({ success: true }));
      });
      await flush(4);
    } finally {
      globalThis.fetch = originalFetch;
      renderer?.unmount();
    }
  }
);

test(
  'WhatsNewScreen: subscribe button updates accessibilityLabel to Subscribing... while in flight',
  renderTestOptions,
  async () => {
    pressables.length = 0;
    modalProps.length = 0;
    textInputProps.length = 0;
    const originalFetch = globalThis.fetch;
    let resolveSubscribe!: (res: Response) => void;

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
      if (target.includes('/changelog/subscribe')) {
        return new Promise<Response>((resolve) => {
          resolveSubscribe = resolve;
        });
      }
      return jsonResponse({});
    }) as any;

    let renderer!: TestRenderer.ReactTestRenderer;
    try {
      renderer = await renderWithProvider(
        React.createElement(WhatsNewScreen, { onBack: () => {} })
      );
      await flush(4);

      const emailInput = textInputProps.find((p) => p.keyboardType === 'email-address');
      assert.ok(emailInput, 'email TextInput should be rendered');

      await act(async () => {
        emailInput.onChangeText('alex@example.com');
      });
      await flush(2);

      const subscribeButtons = pressables.filter((p) => p.text === 'Subscribe');
      const subscribeButton = subscribeButtons[subscribeButtons.length - 1];
      assert.ok(subscribeButton, 'subscribe button should be rendered');
      assert.equal(subscribeButton.props.accessibilityLabel, 'Subscribe');

      await act(async () => {
        subscribeButton.props.onPress();
      });
      await flush(2);

      const subscribingButtons = pressables.filter(
        (p) => p.props.accessibilityLabel === 'Subscribing...'
      );
      assert.ok(
        subscribingButtons.length > 0,
        'WhatsNewScreen subscribe button must have accessibilityLabel="Subscribing..." during subscription'
      );
      const latestSubscribing = subscribingButtons[subscribingButtons.length - 1];
      assert.equal(latestSubscribing.props.accessibilityRole, 'button');
      assert.equal(latestSubscribing.text, '');
      assert.deepEqual(latestSubscribing.props.accessibilityState, { disabled: true });
      assertIconOnlyPressablesAreLabeled('WhatsNewScreen[subscribing]');

      await act(async () => {
        resolveSubscribe(jsonResponse({ success: true }));
      });
      await flush(4);
    } finally {
      globalThis.fetch = originalFetch;
      renderer?.unmount();
    }
  }
);

test(
  'CommentsSection: post button updates accessibilityLabel to Posting... while in flight',
  renderTestOptions,
  async () => {
    pressables.length = 0;
    modalProps.length = 0;
    textInputProps.length = 0;
    const originalFetch = globalThis.fetch;
    let resolvePostComment!: (res: Response) => void;

    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const target = url.toString();
      const method = init?.method?.toUpperCase() ?? 'GET';
      if (target.includes('/api/v1/public/config/')) {
        return jsonResponse({
          appKey: APP_KEY,
          name: 'A11y Test App',
          theme: {},
          sdk: { features: { changelog: true } },
        });
      }
      if (target.includes('/comments') && method === 'POST') {
        return new Promise<Response>((resolve) => {
          resolvePostComment = resolve;
        });
      }
      if (target.includes('/comments')) {
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
          total: 1,
          hasMore: false,
          nextCursor: null,
        });
      }
      return jsonResponse({});
    }) as any;

    let renderer!: TestRenderer.ReactTestRenderer;
    try {
      renderer = await renderWithProvider(
        React.createElement(CommentsSection, { featureRequestId: 'fr_1' }),
        { commentSessionProvider: () => 'session_tok_live' }
      );

      // In idle state before typing:
      const idlePostButton = findPressable('Post Comment');
      assert.equal(idlePostButton.props.accessibilityRole, 'button');
      assert.equal(idlePostButton.props.accessibilityLabel, 'Post Comment');
      assert.deepEqual(idlePostButton.props.accessibilityState, { disabled: true });

      // Type into comment input:
      const input = textInputProps[textInputProps.length - 1];
      assert.ok(input, 'CommentsSection should render a TextInput for the draft');
      await act(async () => {
        input.onChangeText('A new accessible comment');
      });
      await flush(2);

      const activePostButtons = pressables.filter((p) => p.text === 'Post Comment');
      assert.ok(activePostButtons.length > 0, 'Post Comment button should exist');
      const activePostButton = activePostButtons[activePostButtons.length - 1];
      assert.deepEqual(activePostButton.props.accessibilityState, { disabled: false });

      // Trigger post submission:
      await act(async () => {
        activePostButton.props.onPress();
      });
      await flush(2);

      // Submit is now in-flight: child is ActivityIndicator (text: ""),
      // and accessibilityLabel must be 'Posting...'
      const postingButtons = pressables.filter((p) => p.props.accessibilityLabel === 'Posting...');
      assert.ok(
        postingButtons.length > 0,
        'CommentsSection post button must have accessibilityLabel="Posting..." during submission'
      );
      const latestPostingButton = postingButtons[postingButtons.length - 1];
      assert.equal(latestPostingButton.props.accessibilityRole, 'button');
      assert.equal(latestPostingButton.text, '');
      assert.deepEqual(latestPostingButton.props.accessibilityState, { disabled: true });
      assertIconOnlyPressablesAreLabeled('CommentsSection[posting]');

      // Settle comment post:
      await act(async () => {
        resolvePostComment(
          jsonResponse({
            id: 'cmt_new',
            featureRequestId: 'fr_1',
            authorName: 'User',
            body: 'A new accessible comment',
            createdAt: '2026-08-20T09:05:00.000Z',
          })
        );
      });
      await flush(4);
    } finally {
      globalThis.fetch = originalFetch;
      renderer?.unmount();
    }
  }
);

test(
  'RoadmapBoardScreen: empty-column load-more button updates accessibilityLabel to Loading more... while in flight',
  renderTestOptions,
  async () => {
    pressables.length = 0;
    modalProps.length = 0;
    const originalFetch = globalThis.fetch;
    let resolveLoadMore!: (res: Response) => void;

    let requestsCallCount = 0;
    globalThis.fetch = (async (url: string | URL | Request) => {
      const target = url.toString();
      if (target.includes('/api/v1/public/config/')) {
        return jsonResponse({
          appKey: APP_KEY,
          name: 'A11y Test App',
          theme: {},
          sdk: { features: { roadmap: true } },
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
            {
              id: 'col_other',
              appId: APP_KEY,
              name: 'Other',
              slug: 'other',
              position: 1,
              isVisible: true,
            },
          ],
        });
      }
      if (target.includes('/api/v1/feature-requests')) {
        requestsCallCount += 1;
        if (requestsCallCount === 1) {
          // Initial load: 1 item belonging to col_other, total is 10, so hasMore is true
          return jsonResponse({
            requests: [
              {
                id: 'fr_1',
                appId: APP_KEY,
                columnId: 'col_other',
                title: 'Item in other column',
                body: 'Details',
                status: 'published',
                upvotesCount: 0,
                commentsCount: 0,
                hasVoted: false,
                createdAt: '2026-08-01T00:00:00.000Z',
              },
            ],
            total: 10,
          });
        }
        // Second call from loadMore(): keep pending until released
        return new Promise<Response>((resolve) => {
          resolveLoadMore = resolve;
        });
      }
      return jsonResponse({});
    }) as any;

    let renderer!: TestRenderer.ReactTestRenderer;
    try {
      renderer = await renderWithProvider(
        React.createElement(RoadmapBoardScreen, { onBack: () => {} })
      );
      await flush(4);

      // In idle state, In Progress column is selected and has 0 items, hasMore is true.
      // The empty-column load-more button must have accessibilityRole, accessibilityLabel, and disabled: false.
      const idleLoadMoreButtons = pressables.filter((p) => p.text === 'Load more');
      assert.ok(
        idleLoadMoreButtons.length > 0,
        'RoadmapBoardScreen empty column should render "Load more" button'
      );
      const idleButton = idleLoadMoreButtons[idleLoadMoreButtons.length - 1];
      assert.equal(idleButton.props.accessibilityRole, 'button');
      assert.equal(idleButton.props.accessibilityLabel, 'Load more');
      assert.deepEqual(idleButton.props.accessibilityState, { disabled: false });

      // Trigger loadMore by pressing the button:
      await act(async () => {
        idleButton.props.onPress();
      });
      await flush(2);

      // In-flight state: child text is replaced by ActivityIndicator (p.text === ''),
      // accessibilityLabel must be 'Loading more...', accessibilityState.disabled must be true
      const loadingButtons = pressables.filter(
        (p) => p.props.accessibilityLabel === 'Loading more...'
      );
      assert.ok(
        loadingButtons.length > 0,
        'RoadmapBoardScreen empty-column button must have accessibilityLabel="Loading more..." during loading'
      );
      const latestLoadingButton = loadingButtons[loadingButtons.length - 1];
      assert.equal(latestLoadingButton.props.accessibilityRole, 'button');
      assert.equal(latestLoadingButton.text, '');
      assert.deepEqual(latestLoadingButton.props.accessibilityState, { disabled: true });
      assertIconOnlyPressablesAreLabeled('RoadmapBoardScreen[empty-column-loading]');

      // Settle loadMore:
      await act(async () => {
        resolveLoadMore(
          jsonResponse({
            requests: [
              {
                id: 'fr_2',
                appId: APP_KEY,
                columnId: 'col_progress',
                title: 'Item in progress',
                body: 'Details',
                status: 'published',
                upvotesCount: 0,
                commentsCount: 0,
                hasVoted: false,
                createdAt: '2026-08-01T00:00:00.000Z',
              },
            ],
            total: 10,
          })
        );
      });
      await flush(4);
    } finally {
      globalThis.fetch = originalFetch;
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
        }),
        // The reply control renders only when a comment session source is
        // configured; supply one so its accessibility contract is exercised.
        { commentSessionProvider: () => 'clerk_jwt_a11y' }
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

test(
  'VoteButton: exposes accessibilityRole="button" and accessibilityState with disabled and selected states (#224)',
  renderTestOptions,
  async () => {
    pressables.length = 0;
    const restoreFetch = stubFetch();
    let renderer!: TestRenderer.ReactTestRenderer;

    try {
      // 1. Idle unvoted: disabled: false, selected: false
      renderer = await renderWithProvider(
        React.createElement(VoteButton, {
          voteCount: 5,
          hasVoted: false,
          disabled: false,
          onPress: () => {},
        })
      );
      assert.ok(pressables.length > 0);
      const btn1 = pressables[pressables.length - 1];
      assert.equal(btn1.props.accessibilityRole, 'button');
      assert.deepEqual(btn1.props.accessibilityState, {
        disabled: false,
        selected: false,
      });
      assert.equal(btn1.props.accessibilityLabel, 'Upvote');
      renderer.unmount();

      // 2. Disabled unvoted (e.g. submitting or unready): disabled: true, selected: false
      pressables.length = 0;
      renderer = await renderWithProvider(
        React.createElement(VoteButton, {
          voteCount: 5,
          hasVoted: false,
          disabled: true,
          onPress: () => {},
        })
      );
      assert.ok(pressables.length > 0);
      const btn2 = pressables[pressables.length - 1];
      assert.deepEqual(btn2.props.accessibilityState, {
        disabled: true,
        selected: false,
      });
      renderer.unmount();

      // 3. Upvoted (hasVoted = true): disabled: false, selected: true
      pressables.length = 0;
      renderer = await renderWithProvider(
        React.createElement(VoteButton, {
          voteCount: 6,
          hasVoted: true,
          disabled: false,
          onPress: () => {},
        })
      );
      assert.ok(pressables.length > 0);
      const btn3 = pressables[pressables.length - 1];
      assert.deepEqual(btn3.props.accessibilityState, {
        disabled: false,
        selected: true,
      });
      assert.equal(btn3.props.accessibilityLabel, 'Upvoted');
      renderer.unmount();

      // 4. Disabled and upvoted (e.g. own request that was voted): disabled: true, selected: true
      pressables.length = 0;
      renderer = await renderWithProvider(
        React.createElement(VoteButton, {
          voteCount: 6,
          hasVoted: true,
          disabled: true,
          onPress: () => {},
        })
      );
      assert.ok(pressables.length > 0);
      const btn4 = pressables[pressables.length - 1];
      assert.deepEqual(btn4.props.accessibilityState, {
        disabled: true,
        selected: true,
      });
      renderer.unmount();
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
    assert.ok(
      typeof strings.changelog.subscribeButton === 'string' &&
        strings.changelog.subscribeButton.length > 0,
      `[${locale}] changelog.subscribeButton must be a non-empty string`
    );
    assert.ok(
      typeof strings.changelog.subscribing === 'string' && strings.changelog.subscribing.length > 0,
      `[${locale}] changelog.subscribing must be a non-empty string`
    );
    assert.ok(
      typeof strings.comments.postButton === 'string' && strings.comments.postButton.length > 0,
      `[${locale}] comments.postButton must be a non-empty string`
    );
    assert.ok(
      typeof strings.comments.postingButton === 'string' &&
        strings.comments.postingButton.length > 0,
      `[${locale}] comments.postingButton must be a non-empty string`
    );
    assert.ok(
      typeof strings.roadmap.loadMore === 'string' && strings.roadmap.loadMore.length > 0,
      `[${locale}] roadmap.loadMore must be a non-empty string`
    );
    assert.ok(
      typeof strings.roadmap.loadingMore === 'string' && strings.roadmap.loadingMore.length > 0,
      `[${locale}] roadmap.loadingMore must be a non-empty string`
    );
    assert.ok(
      typeof strings.common.loadingMore === 'string' && strings.common.loadingMore.length > 0,
      `[${locale}] common.loadingMore must be a non-empty string`
    );
  }
});

test(
  'FeedbackComposer, FeatureRequestComposeSheet & FeatureRequestsScreen: every TextInput exposes a localized accessibilityLabel (#286)',
  renderTestOptions,
  async () => {
    const restoreFetch = stubFetch();
    let renderer!: TestRenderer.ReactTestRenderer;

    const cases: Array<{
      name: string;
      element: React.ReactElement;
      expected: string[];
    }> = [
      {
        name: 'FeedbackComposer',
        element: React.createElement(FeedbackComposer, { onClose: () => {} }),
        expected: [
          enStrings.feedbackComposer.titleLabel,
          enStrings.feedbackComposer.detailsLabel,
          enStrings.feedbackComposer.nameLabel,
          enStrings.feedbackComposer.emailLabel,
        ],
      },
      {
        name: 'FeatureRequestComposeSheet',
        element: React.createElement(FeatureRequestComposeSheet, { onClose: () => {} }),
        expected: [
          enStrings.featureRequestCompose.titleLabel,
          enStrings.featureRequestCompose.descriptionLabel,
          enStrings.featureRequestCompose.nameLabel,
        ],
      },
      {
        name: 'FeatureRequestsScreen',
        element: React.createElement(FeatureRequestsScreen, { onBack: () => {} }),
        expected: [enStrings.featureRequests.searchPlaceholder],
      },
    ];

    try {
      for (const { name, element, expected } of cases) {
        textInputProps.length = 0;
        renderer = await renderWithProvider(element);
        const labels = new Set(textInputProps.map((p) => p.accessibilityLabel));
        for (const label of expected) {
          assert.ok(labels.has(label), `${name}: missing TextInput accessibilityLabel "${label}"`);
        }
        assert.ok(
          textInputProps.every((p) => typeof p.accessibilityLabel === 'string'),
          `${name}: every TextInput must have an accessibilityLabel`
        );
        renderer.unmount();
      }
    } finally {
      restoreFetch();
      renderer?.unmount();
    }
  }
);

test(
  'WhatsNewScreen & CommentsSection: TextInputs expose a localized accessibilityLabel (#294)',
  renderTestOptions,
  async () => {
    const restoreFetch = stubFetch();
    let renderer!: TestRenderer.ReactTestRenderer;

    const cases: Array<{ name: string; element: React.ReactElement; expected: string }> = [
      {
        name: 'WhatsNewScreen',
        element: React.createElement(WhatsNewScreen, { onBack: () => {} }),
        expected: enStrings.changelog.emailPlaceholder,
      },
      {
        name: 'CommentsSection',
        element: React.createElement(CommentsSection, { featureRequestId: 'fr_1' }),
        expected: enStrings.comments.inputPlaceholder,
      },
    ];

    try {
      for (const { name, element, expected } of cases) {
        textInputProps.length = 0;
        renderer = await renderWithProvider(element, {
          commentSessionProvider: () => 'session_tok_live',
        });
        assert.ok(textInputProps.length > 0, `${name}: expected a TextInput to render`);
        assert.ok(
          textInputProps.every((p) => p.accessibilityLabel === expected),
          `${name}: every TextInput must have accessibilityLabel "${expected}"`
        );
        renderer.unmount();
      }
    } finally {
      restoreFetch();
      renderer?.unmount();
    }
  }
);

test(
  'FeatureRequestsScreen & RoadmapBoardScreen: request cards expose button role and title label (#283)',
  renderTestOptions,
  async () => {
    const restoreStub = stubFetch();
    const stubbedFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const target = url.toString();
      if (target.includes('/api/v1/feature-requests') && !/\/comments/.test(target)) {
        return jsonResponse({
          requests: [
            {
              id: 'fr_1',
              appId: APP_KEY,
              columnId: 'col_progress',
              title: '  Widget support  ',
              body: 'Details',
              status: 'published',
              upvotesCount: 3,
              commentsCount: 0,
              hasVoted: false,
              createdAt: '2026-08-01T00:00:00.000Z',
            },
          ],
          total: 1,
        });
      }
      return stubbedFetch(url as any, init);
    }) as any;
    let renderer!: TestRenderer.ReactTestRenderer;

    const screens: Array<{ name: string; element: React.ReactElement }> = [
      {
        name: 'FeatureRequestsScreen',
        element: React.createElement(FeatureRequestsScreen, { onBack: () => {} }),
      },
      {
        name: 'RoadmapBoardScreen',
        element: React.createElement(RoadmapBoardScreen, { onBack: () => {} }),
      },
    ];

    try {
      for (const { name, element } of screens) {
        pressables.length = 0;
        renderer = await renderWithProvider(element);
        // FeatureRequestsScreen debounces its first page-0 load (250ms).
        await new Promise((resolve) => setTimeout(resolve, 350));
        await flush(4);
        const card = pressables.find((p) => p.props.accessibilityLabel === 'Widget support');
        assert.ok(
          card,
          `${name}: request card must expose accessibilityLabel equal to the trimmed title`
        );
        assert.equal(
          card.props.accessibilityRole,
          'button',
          `${name}: request card must be a button`
        );
        renderer.unmount();
      }
    } finally {
      restoreStub();
      renderer?.unmount();
    }
  }
);
