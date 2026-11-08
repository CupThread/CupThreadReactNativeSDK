import test, { type TestOptions } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { FeedbackClient } from '../src/client/FeedbackClient';
import { formatVersionLabel } from '../src/utils/formatters';
import { createFlatListStub } from './helpers/virtualizedListStub';
import type { FeatureRequestItem, ChangelogEntry, BoardColumn } from '../src/types';

// ---------------------------------------------------------------------------
// Issue #289 — formatVersionLabel helper & version badge normalization
// ---------------------------------------------------------------------------

const supportsModuleMocks = typeof (test as any).mock?.module === 'function';

const ViewStub = (props: any) => React.createElement('View', props, props.children ?? null);
const TextStub = (props: any) => React.createElement('Text', props, props.children ?? null);
const TouchableOpacityStub = (props: any) =>
  React.createElement('TouchableOpacity', props, props.children ?? null);
const ScrollViewStub = (props: any) =>
  React.createElement('ScrollView', props, props.children ?? null);
const ModalStub = (props: any) => (props.visible ? (props.children ?? null) : null);
const SafeAreaViewStub = (props: any) =>
  React.createElement('SafeAreaView', props, props.children ?? null);

if (supportsModuleMocks) {
  (test as any).mock.module('react-native', {
    namedExports: {
      useColorScheme: () => 'light',
      View: ViewStub,
      Text: TextStub,
      TextInput: () => null,
      TouchableOpacity: TouchableOpacityStub,
      ActivityIndicator: () => null,
      ScrollView: ScrollViewStub,
      FlatList: createFlatListStub(),
      Modal: ModalStub,
      SafeAreaView: SafeAreaViewStub,
      Image: () => null,
      RefreshControl: () => null,
      StyleSheet: { create: (styles: any) => styles, flatten: (s: any) => s },
      Linking: { openURL: async () => {}, canOpenURL: async () => true },
      Alert: { alert: () => {} },
    },
  });
}

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const { Badge } = await import('../src/components/Badge');
const { CupThreadProvider } = await import('../src/theme/CupThreadThemeProvider');
const { ChangelogOverlay } = await import('../src/components/ChangelogOverlay');
const { FeatureRequestDetail } = await import('../src/components/FeatureRequestDetail');
const { FeatureRequestsScreen } = await import('../src/components/FeatureRequestsScreen');
const { RoadmapBoardScreen } = await import('../src/components/RoadmapBoardScreen');
const { WhatsNewScreen } = await import('../src/components/WhatsNewScreen');

const renderTestOptions: TestOptions = supportsModuleMocks
  ? {}
  : {
      skip: 'node:test module mocking unavailable (needs Node >= 22.3 with --experimental-test-module-mocks)',
    };

async function flush(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 3));
    await act(async () => {});
  }
}

async function waitForCondition(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitForCondition timed out after ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
    await act(async () => {});
  }
}

function makeClient(appKey = 'app_version_label_test'): FeedbackClient {
  const client = new FeedbackClient({
    baseUrl: 'https://api.cupthread.com',
    appKey,
  });
  client.fetchAppConfig = (async () => ({
    appKey,
    sdk: {
      features: {
        feedback: true,
        featureRequests: true,
        roadmap: true,
        changelog: true,
      },
      changelogOverlay: { entryCount: 5 },
    },
  })) as any;
  client.fetchVersions = (async () => []) as any;
  client.fetchColumns = (async () => []) as any;
  return client;
}

// ---------------------------------------------------------------------------
// Unit tests for formatVersionLabel
// ---------------------------------------------------------------------------

test('formatVersionLabel: returns null for null, undefined, empty, or whitespace-only inputs (#289)', () => {
  assert.equal(formatVersionLabel(null), null);
  assert.equal(formatVersionLabel(undefined), null);
  assert.equal(formatVersionLabel(''), null);
  assert.equal(formatVersionLabel('   '), null);
  assert.equal(formatVersionLabel('\t\r\n '), null);
  assert.equal(formatVersionLabel(123 as any), null);
  assert.equal(formatVersionLabel({} as any), null);
});

test('formatVersionLabel: returns null for solitary "v" or "V" strings (#289)', () => {
  assert.equal(formatVersionLabel('v'), null);
  assert.equal(formatVersionLabel('V'), null);
  assert.equal(formatVersionLabel('  v  '), null);
  assert.equal(formatVersionLabel('  V  '), null);
  assert.equal(formatVersionLabel('vv'), null);
});

test('formatVersionLabel: normalizes versions without leading "v" (#289)', () => {
  assert.equal(formatVersionLabel('1.2.0'), 'v1.2.0');
  assert.equal(formatVersionLabel('0.1.0'), 'v0.1.0');
  assert.equal(formatVersionLabel('2024.11'), 'v2024.11');
  assert.equal(formatVersionLabel('2.0.0-rc.1'), 'v2.0.0-rc.1');
});

test('formatVersionLabel: strips existing "v" / "V" prefix to prevent duplicate "vv" (#289)', () => {
  assert.equal(formatVersionLabel('v1.2.0'), 'v1.2.0');
  assert.equal(formatVersionLabel('V1.2.0'), 'v1.2.0');
  assert.equal(formatVersionLabel('vv2.0.0'), 'v2.0.0');
  assert.equal(formatVersionLabel('v 2.0.0'), 'v2.0.0');
  assert.equal(formatVersionLabel('  v1.0.4  '), 'v1.0.4');
  assert.equal(formatVersionLabel('  V3.5.1  '), 'v3.5.1');
});

// ---------------------------------------------------------------------------
// Component integration tests
// ---------------------------------------------------------------------------

function findOutlineBadges(renderer: TestRenderer.ReactTestRenderer): string[] {
  return renderer.root
    .findAllByType(Badge)
    .filter((b) => b.props.variant === 'outline')
    .map((b) => b.props.label);
}

test(
  'ChangelogOverlay: omits badge on whitespace versionLabel and formats "v2.0.0" correctly (#289)',
  renderTestOptions,
  async () => {
    const client = makeClient('app_ch_overlay_test');
    client.listChangelog = (async () => ({
      entries: [
        {
          id: 'ch-1',
          title: 'Release One',
          body: 'Note 1',
          versionLabel: '   ',
          publishedAt: new Date().toISOString(),
        },
        {
          id: 'ch-2',
          title: 'Release Two',
          body: 'Note 2',
          versionLabel: 'v2.0.0',
          publishedAt: new Date().toISOString(),
        },
      ] as ChangelogEntry[],
      hasMore: false,
    })) as any;

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <CupThreadProvider client={client}>
          <ChangelogOverlay visible={true} onlyIfUnseen={false} onClose={() => {}} />
        </CupThreadProvider>
      );
    });

    await flush(8);

    const outlineBadges = findOutlineBadges(renderer);
    assert.deepEqual(
      outlineBadges,
      ['v2.0.0'],
      'whitespace versionLabel should be omitted; "v2.0.0" must not produce "vv2.0.0"'
    );

    renderer.unmount();
  }
);

test(
  'FeatureRequestDetail: omits badge on whitespace versionLabel and formats "v2.0.0" correctly (#289)',
  renderTestOptions,
  async () => {
    const client = makeClient('app_detail_test');

    const itemWhitespace: FeatureRequestItem = {
      id: 'fr-ws',
      appId: 'app_detail_test',
      title: 'Request with whitespace version',
      description: 'Desc',
      status: 'planned',
      voteCount: 1,
      hasVoted: false,
      isOwnRequest: false,
      approved: true,
      commentCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      versionLabel: '   ',
    };

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <CupThreadProvider client={client}>
          <FeatureRequestDetail visible={true} item={itemWhitespace} onClose={() => {}} />
        </CupThreadProvider>
      );
    });

    await flush(4);
    assert.deepEqual(
      findOutlineBadges(renderer),
      [],
      'whitespace-only versionLabel must not render a badge'
    );
    renderer.unmount();

    const itemV2: FeatureRequestItem = {
      ...itemWhitespace,
      id: 'fr-v2',
      versionLabel: 'v2.0.0',
    };

    await act(async () => {
      renderer = TestRenderer.create(
        <CupThreadProvider client={client}>
          <FeatureRequestDetail visible={true} item={itemV2} onClose={() => {}} />
        </CupThreadProvider>
      );
    });

    await flush(4);
    assert.deepEqual(
      findOutlineBadges(renderer),
      ['v2.0.0'],
      'versionLabel "v2.0.0" must render "v2.0.0" rather than "vv2.0.0"'
    );
    renderer.unmount();
  }
);

test(
  'WhatsNewScreen: omits badge on whitespace versionLabel and formats "v2.0.0" correctly (#289)',
  renderTestOptions,
  async () => {
    const client = makeClient('app_whatsnew_test');
    client.listChangelog = (async () => ({
      entries: [
        {
          id: 'wn-ws',
          title: 'Whitespace Version',
          body: 'Content',
          versionLabel: '   ',
          publishedAt: new Date().toISOString(),
        },
        {
          id: 'wn-v2',
          title: 'V2 Release',
          body: 'Content',
          versionLabel: 'v2.0.0',
          publishedAt: new Date().toISOString(),
        },
      ] as ChangelogEntry[],
      hasMore: false,
    })) as any;

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <CupThreadProvider client={client}>
          <WhatsNewScreen />
        </CupThreadProvider>
      );
    });

    await flush(8);

    const outlineBadges = findOutlineBadges(renderer);
    assert.deepEqual(
      outlineBadges,
      ['v2.0.0'],
      'WhatsNewScreen must omit whitespace badge and render "v2.0.0" without duplicate "vv"'
    );

    renderer.unmount();
  }
);

test(
  'FeatureRequestsScreen: omits badge on whitespace versionLabel and formats "v2.0.0" correctly (#289)',
  renderTestOptions,
  async () => {
    const client = makeClient('app_fr_screen_test');
    client.fetchFeatureRequests = (async () => ({
      requests: [
        {
          id: 'fr-ws',
          title: 'Whitespace version request',
          description: 'Desc',
          status: 'planned',
          voteCount: 3,
          hasVoted: false,
          commentCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          versionLabel: '   ',
        },
        {
          id: 'fr-v2',
          title: 'V2 request',
          description: 'Desc',
          status: 'planned',
          voteCount: 5,
          hasVoted: false,
          commentCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          versionLabel: 'v2.0.0',
        },
      ] as FeatureRequestItem[],
      hasMore: false,
    })) as any;

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <CupThreadProvider client={client} userToken="usr_tok_test">
          <FeatureRequestsScreen />
        </CupThreadProvider>
      );
    });

    await waitForCondition(() => findOutlineBadges(renderer).length > 0);

    const outlineBadges = findOutlineBadges(renderer);
    assert.deepEqual(
      outlineBadges,
      ['v2.0.0'],
      'FeatureRequestsScreen must omit whitespace badge and render "v2.0.0" without duplicate "vv"'
    );

    renderer.unmount();
  }
);

test(
  'RoadmapBoardScreen: omits badge on whitespace versionLabel and formats "v2.0.0" correctly (#289)',
  renderTestOptions,
  async () => {
    const client = makeClient('app_roadmap_test');
    client.fetchColumns = (async (): Promise<BoardColumn[]> => [
      {
        id: 'col-planned',
        appId: 'app_roadmap_test',
        name: 'Planned',
        slug: 'planned',
        position: 0,
        isVisible: true,
        isSystem: false,
        kind: 'normal',
        color: '#3b82f6',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]) as any;

    client.fetchFeatureRequests = (async () => ({
      requests: [
        {
          id: 'fr-ws',
          title: 'Whitespace item',
          description: 'Desc',
          status: 'planned',
          columnId: 'col-planned',
          voteCount: 2,
          hasVoted: false,
          commentCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          versionLabel: '   ',
        },
        {
          id: 'fr-v2',
          title: 'V2 item',
          description: 'Desc',
          status: 'planned',
          columnId: 'col-planned',
          voteCount: 4,
          hasVoted: false,
          commentCount: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          versionLabel: 'v2.0.0',
        },
      ] as FeatureRequestItem[],
      hasMore: false,
    })) as any;

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <CupThreadProvider client={client} userToken="usr_tok_test">
          <RoadmapBoardScreen />
        </CupThreadProvider>
      );
    });

    await waitForCondition(() => findOutlineBadges(renderer).length > 0);

    const outlineBadges = findOutlineBadges(renderer);
    assert.deepEqual(
      outlineBadges,
      ['v2.0.0'],
      'RoadmapBoardScreen must omit whitespace badge and render "v2.0.0" without duplicate "vv"'
    );

    renderer.unmount();
  }
);
