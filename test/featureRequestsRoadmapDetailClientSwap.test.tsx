import test, { type TestOptions } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { createFlatListStub } from './helpers/virtualizedListStub';
import type { FeedbackClient } from '../src/client/FeedbackClient';
import type {
  AppVersion,
  BoardColumn,
  FeatureRequestComment,
  FeatureRequestItem,
  ListFeatureRequestCommentsResult,
  ListFeatureRequestsResult,
} from '../src/types';

const testGlobal = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean };
testGlobal.IS_REACT_ACT_ENVIRONMENT = true;

const supportsModuleMocks = typeof (test as any).mock?.module === 'function';

function collectTexts(node: any): string[] {
  const out: string[] = [];
  const walk = (n: any) => {
    if (n === null || n === undefined || typeof n === 'boolean') return;
    if (typeof n === 'string' || typeof n === 'number') {
      out.push(String(n));
      return;
    }
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    if (typeof n === 'object') {
      if (Array.isArray(n.children)) {
        n.children.forEach(walk);
      } else if (n.props) {
        walk(n.props.children);
      }
    }
  };
  walk(node);
  return out;
}

const ViewStub = (props: any) => props.children ?? null;
const TextStub = (props: any) => props.children ?? null;
const TextInputStub = (_props: any) => null;
const TouchableOpacityStub = (props: any) => props.children ?? null;
const ModalStub = (props: any) => (props.visible === false ? null : (props.children ?? null));
const ScrollViewStub = (props: any) => props.children ?? null;
const SafeAreaViewStub = (props: any) => props.children ?? null;

if (supportsModuleMocks) {
  (test as any).mock.module('react-native', {
    namedExports: {
      useColorScheme: () => 'light',
      View: ViewStub,
      Text: TextStub,
      TextInput: TextInputStub,
      TouchableOpacity: TouchableOpacityStub,
      ActivityIndicator: () => null,
      ScrollView: ScrollViewStub,
      FlatList: createFlatListStub(),
      Modal: ModalStub,
      SafeAreaView: SafeAreaViewStub,
      Image: () => null,
      Linking: { openURL: async () => {}, canOpenURL: async () => true },
      StyleSheet: { create: (styles: any) => styles, flatten: (s: any) => s },
      Alert: { alert: () => {} },
      KeyboardAvoidingView: ({ children }: any) => children ?? null,
      Platform: { OS: 'ios', select: (obj: any) => obj.ios ?? obj.default },
      RefreshControl: () => null,
    },
  });
}

type SdkModules = {
  CupThreadProvider: (typeof import('../src/theme/CupThreadThemeProvider'))['CupThreadProvider'];
  FeatureRequestsScreen: (typeof import('../src/components/FeatureRequestsScreen'))['FeatureRequestsScreen'];
  RoadmapBoardScreen: (typeof import('../src/components/RoadmapBoardScreen'))['RoadmapBoardScreen'];
  FeatureRequestDetail: (typeof import('../src/components/FeatureRequestDetail'))['FeatureRequestDetail'];
  FeatureRequestComposeSheet: (typeof import('../src/components/FeatureRequestComposeSheet'))['FeatureRequestComposeSheet'];
  VoteButton: (typeof import('../src/components/VoteButton'))['VoteButton'];
};

// Do not import components that load React Native when module mocks are
// unavailable: the tests below are skipped in that mode, but an import here
// would fail before node:test can register the skips.
const sdkModules = supportsModuleMocks
  ? ({
      CupThreadProvider: (await import('../src/theme/CupThreadThemeProvider')).CupThreadProvider,
      FeatureRequestsScreen: (await import('../src/components/FeatureRequestsScreen'))
        .FeatureRequestsScreen,
      RoadmapBoardScreen: (await import('../src/components/RoadmapBoardScreen')).RoadmapBoardScreen,
      FeatureRequestDetail: (await import('../src/components/FeatureRequestDetail'))
        .FeatureRequestDetail,
      FeatureRequestComposeSheet: (await import('../src/components/FeatureRequestComposeSheet'))
        .FeatureRequestComposeSheet,
      VoteButton: (await import('../src/components/VoteButton')).VoteButton,
    } satisfies SdkModules)
  : ({} as SdkModules);

const {
  CupThreadProvider,
  FeatureRequestsScreen,
  RoadmapBoardScreen,
  FeatureRequestDetail,
  FeatureRequestComposeSheet,
  VoteButton,
} = sdkModules;

const screenTestOptions: TestOptions = supportsModuleMocks
  ? {}
  : { skip: 'Requires Node >= 22.3 with --experimental-test-module-mocks' };

async function settle(rounds = 8, sleepMs = 4): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((resolve) => setTimeout(resolve, sleepMs));
    await act(async () => {});
  }
}

function makeItem(
  id: string,
  title: string,
  overrides: Partial<FeatureRequestItem> = {}
): FeatureRequestItem {
  return {
    id,
    appId: 'app_test',
    title,
    description: `${title} description`,
    status: 'open',
    approved: true,
    voteCount: 1,
    hasVoted: false,
    isOwnRequest: false,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeComment(id: string, body: string): FeatureRequestComment {
  return {
    id,
    featureRequestId: 'req-1',
    parentId: null,
    authorName: 'Tester',
    authorAvatarUrl: null,
    body,
    createdAt: '2026-11-02T00:00:00.000Z',
  };
}

function makeBaseConfig(overrides: Record<string, unknown> = {}) {
  return {
    appName: 'Test App',
    surfaces: { featureRequests: true, roadmap: true, feedback: true, changelog: true },
    ...overrides,
  };
}

test(
  'FeatureRequestsScreen resets detail modal, compose sheet, searchQuery, and versionId on client swap (#470)',
  screenTestOptions,
  async () => {
    const versionA: AppVersion = {
      id: 'ver_a',
      appId: 'app_a',
      label: 'v1.0.0',
      position: 0,
      released: true,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    };
    const itemA = makeItem('req_a1', 'Client A Feature', {
      versionId: 'ver_a',
      versionLabel: '1.0.0',
    });
    const itemB = makeItem('req_b1', 'Client B Feature');

    const clientAFetchCalls: Array<{ versionId?: string; query?: string }> = [];
    const clientBFetchCalls: Array<{ versionId?: string; query?: string }> = [];
    const clientBCommentCalls: string[] = [];

    const clientA = {
      fetchAppConfig: async () => makeBaseConfig(),
      fetchVersions: async () => [versionA],
      fetchFeatureRequests: async (opts?: {
        versionId?: string;
        query?: string;
      }): Promise<ListFeatureRequestsResult> => {
        clientAFetchCalls.push({ versionId: opts?.versionId, query: opts?.query });
        return {
          requests: [itemA],
          total: 1,
          hasMore: false,
        };
      },
      listComments: async (): Promise<ListFeatureRequestCommentsResult> => ({
        comments: [],
        total: 0,
        hasMore: false,
        nextCursor: null,
      }),
    } as unknown as FeedbackClient;

    const clientB = {
      fetchAppConfig: async () => makeBaseConfig(),
      fetchVersions: async () => [versionA],
      fetchFeatureRequests: async (opts?: {
        versionId?: string;
        query?: string;
      }): Promise<ListFeatureRequestsResult> => {
        clientBFetchCalls.push({ versionId: opts?.versionId, query: opts?.query });
        return {
          requests: [itemB],
          total: 1,
          hasMore: false,
        };
      },
      listComments: async (featureRequestId: string): Promise<ListFeatureRequestCommentsResult> => {
        clientBCommentCalls.push(featureRequestId);
        return { comments: [], total: 0, hasMore: false, nextCursor: null };
      },
    } as unknown as FeedbackClient;

    const renderer = TestRenderer.create(
      React.createElement(CupThreadProvider, {
        client: clientA,
        userToken: 'tok_a',
        children: React.createElement(FeatureRequestsScreen),
      })
    );
    await settle();

    // Select version chip `ver_a`
    const versionChip = renderer.root
      .findAllByType(TouchableOpacityStub)
      .find((node) => collectTexts(node).join('').includes('v1.0.0'));
    assert.ok(versionChip, 'expected version chip v1.0.0 on clientA');
    await act(async () => {
      versionChip.props.onPress();
    });
    await settle();

    // Type a search query
    const searchInput = renderer.root.findByType(TextInputStub);
    await act(async () => {
      searchInput.props.onChangeText('alpha-filter');
    });
    await settle(6, 50);
    assert.ok(
      clientAFetchCalls.some((call) => call.versionId === 'ver_a' && call.query === 'alpha-filter'),
      'clientA must receive the active version and query before the swap'
    );

    // Open FeatureRequestDetail for itemA
    const cardButton = renderer.root
      .findAllByType(TouchableOpacityStub)
      .find((node) => collectTexts(node).join('').includes('Client A Feature'));
    assert.ok(
      cardButton,
      `expected Client A Feature card; got: ${collectTexts(renderer.root).join(' | ')}`
    );
    await act(async () => {
      cardButton.props.onPress();
    });
    await settle();
    assert.equal(renderer.root.findAllByType(FeatureRequestDetail).length, 1);

    // Also open FeatureRequestComposeSheet
    const composeBtn = renderer.root
      .findAllByType(TouchableOpacityStub)
      .find((node) => collectTexts(node).join('').includes('+ New'));
    assert.ok(composeBtn, 'expected compose button');
    await act(async () => {
      composeBtn.props.onPress();
    });
    await settle();
    assert.equal(renderer.root.findByType(FeatureRequestComposeSheet).props.visible, true);

    // Swap provider client from clientA to clientB
    await act(async () => {
      renderer.update(
        React.createElement(CupThreadProvider, {
          client: clientB,
          userToken: 'tok_b',
          children: React.createElement(FeatureRequestsScreen),
        })
      );
    });
    await settle(6, 50);

    // Detail modal must be dismissed, compose sheet must be hidden, search input cleared
    assert.equal(
      renderer.root.findAllByType(FeatureRequestDetail).length,
      0,
      'FeatureRequestDetail must unmount on client swap'
    );
    assert.equal(
      renderer.root.findByType(FeatureRequestComposeSheet).props.visible,
      false,
      'FeatureRequestComposeSheet must close on client swap'
    );
    const updatedSearchInput = renderer.root.findByType(TextInputStub);
    assert.equal(updatedSearchInput.props.value, '', 'searchQuery must reset on client swap');

    // clientB must never be called with clientA's versionId or searchQuery
    assert.ok(clientBFetchCalls.length >= 1, 'expected clientB.fetchFeatureRequests to be called');
    for (const call of clientBFetchCalls) {
      assert.notEqual(call.versionId, 'ver_a', 'clientB must never receive clientA versionId');
      assert.notEqual(call.query, 'alpha-filter', 'clientB must never receive clientA searchQuery');
    }
    assert.deepEqual(
      clientBCommentCalls,
      [],
      'clientB.listComments must not be called for clientA selectedItem'
    );
    assert.ok(collectTexts(renderer.root).includes('Client B Feature'));

    renderer.unmount();
  }
);

test(
  'RoadmapBoardScreen resets detail modal and selectedColumnId on client swap (#470)',
  screenTestOptions,
  async () => {
    const makeCol = (id: string, name: string, position: number): BoardColumn => ({
      id,
      appId: 'app_test',
      name,
      slug: id,
      position,
      isVisible: true,
      isSystem: false,
      kind: 'normal',
      color: '#111111',
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
    });
    const colA1 = makeCol('col_a1', 'Planned', 0);
    const colA2 = makeCol('col_a2', 'In Progress', 1);
    const colB1 = makeCol('col_b1', 'Backlog', 0);

    const itemA = makeItem('req_road_a', 'Roadmap Item A', {
      columnId: 'col_a2',
      columnName: 'In Progress',
    });
    const itemB = makeItem('req_road_b', 'Roadmap Item B', {
      columnId: 'col_b1',
      columnName: 'Backlog',
    });

    const clientBCommentCalls: string[] = [];

    const clientA = {
      fetchAppConfig: async () => makeBaseConfig(),
      fetchColumns: async () => [colA1, colA2],
      fetchFeatureRequests: async (): Promise<ListFeatureRequestsResult> => ({
        requests: [itemA],
        total: 1,
        hasMore: false,
      }),
      listComments: async (): Promise<ListFeatureRequestCommentsResult> => ({
        comments: [],
        total: 0,
        hasMore: false,
        nextCursor: null,
      }),
    } as unknown as FeedbackClient;

    const clientB = {
      fetchAppConfig: async () => makeBaseConfig(),
      fetchColumns: async () => [colB1],
      fetchFeatureRequests: async (): Promise<ListFeatureRequestsResult> => ({
        requests: [itemB],
        total: 1,
        hasMore: false,
      }),
      listComments: async (featureRequestId: string): Promise<ListFeatureRequestCommentsResult> => {
        clientBCommentCalls.push(featureRequestId);
        return { comments: [], total: 0, hasMore: false, nextCursor: null };
      },
    } as unknown as FeedbackClient;

    const renderer = TestRenderer.create(
      React.createElement(CupThreadProvider, {
        client: clientA,
        userToken: 'tok_a',
        children: React.createElement(RoadmapBoardScreen),
      })
    );
    await settle();

    // Switch to second column colA2 ("In Progress")
    const col2Tab = renderer.root
      .findAllByType(TouchableOpacityStub)
      .find((node) => collectTexts(node).join('').includes('In Progress'));
    assert.ok(col2Tab, 'expected In Progress tab on clientA');
    await act(async () => {
      col2Tab.props.onPress();
    });
    await settle();

    // Open FeatureRequestDetail for itemA
    const cardButton = renderer.root
      .findAllByType(TouchableOpacityStub)
      .find((node) => collectTexts(node).join('').includes('Roadmap Item A'));
    assert.ok(cardButton, 'expected Roadmap Item A card');
    await act(async () => {
      cardButton.props.onPress();
    });
    await settle();
    assert.equal(renderer.root.findAllByType(FeatureRequestDetail).length, 1);

    // Swap provider client from clientA to clientB
    await act(async () => {
      renderer.update(
        React.createElement(CupThreadProvider, {
          client: clientB,
          userToken: 'tok_b',
          children: React.createElement(RoadmapBoardScreen),
        })
      );
    });
    await settle();

    assert.equal(
      renderer.root.findAllByType(FeatureRequestDetail).length,
      0,
      'FeatureRequestDetail must unmount on client swap'
    );
    assert.deepEqual(
      clientBCommentCalls,
      [],
      'clientB.listComments must not be called for clientA selectedItem'
    );
    const texts = collectTexts(renderer.root);
    assert.ok(texts.includes('Backlog'), 'clientB column should render');
    assert.ok(texts.includes('Roadmap Item B'), 'clientB item should render');

    renderer.unmount();
  }
);

test(
  'FeatureRequestDetail direct-mount client swap updates same-id item, clears vote errors, and remounts CommentsSection (#470)',
  screenTestOptions,
  async () => {
    const itemA = makeItem('req-1', 'Client A Title', {
      description: 'Client A Desc',
      voteCount: 3,
      hasVoted: false,
    });
    const itemB = makeItem('req-1', 'Client B Title', {
      description: 'Client B Desc',
      voteCount: 9,
      hasVoted: true,
    });

    const clientAListCalls: string[] = [];
    const clientBListCalls: string[] = [];

    const clientA = {
      castVote: async () => {
        throw new Error('clientA vote failed');
      },
      removeVote: async () => {
        throw new Error('clientA vote failed');
      },
      listComments: async (id: string): Promise<ListFeatureRequestCommentsResult> => {
        clientAListCalls.push(id);
        return {
          comments: [makeComment('c_a1', 'Comment from Client A')],
          total: 1,
          hasMore: false,
          nextCursor: null,
        };
      },
    } as unknown as FeedbackClient;

    const clientB = {
      listComments: async (id: string): Promise<ListFeatureRequestCommentsResult> => {
        clientBListCalls.push(id);
        return {
          comments: [makeComment('c_b1', 'Comment from Client B')],
          total: 1,
          hasMore: false,
          nextCursor: null,
        };
      },
    } as unknown as FeedbackClient;

    const commentSessionProvider = async () => 'comment-token';
    const detailElement = (item: FeatureRequestItem) =>
      React.createElement(FeatureRequestDetail, {
        item,
        visible: true,
        onClose: () => {},
      });
    const providerElement = (client: FeedbackClient, item: FeatureRequestItem) =>
      React.createElement(CupThreadProvider, {
        client,
        userToken: client === clientA ? 'tok_a' : 'tok_b',
        commentSessionProvider,
        children: detailElement(item),
      });
    const composerInput = () =>
      renderer.root.findAllByType(TextInputStub).find((node) => node.props.multiline === true);

    const renderer = TestRenderer.create(providerElement(clientA, itemA));
    await settle();

    // Trigger a vote error on clientA
    const voteBtn = renderer.root.findByType(VoteButton);
    await act(async () => {
      voteBtn.props.onPress();
    });
    await settle();

    let texts = collectTexts(renderer.root);
    assert.ok(texts.includes('Client A Title'));
    assert.ok(texts.includes('Comment from Client A'));
    assert.equal(Boolean(renderer.root.findByType(VoteButton).props.error), true);
    assert.deepEqual(clientAListCalls, ['req-1']);

    // Leave a composer draft before swapping clients: the draft must not leak
    // into the replacement client's thread.
    const draftInputA = composerInput();
    assert.ok(draftInputA, 'expected clientA comment composer');
    await act(async () => {
      draftInputA.props.onChangeText('draft from client A');
    });
    await settle();
    assert.equal(composerInput()?.props.value, 'draft from client A');

    // First commit: only the client changes. The replacement item arrives a
    // commit later, so a same-id item from clientB must still be adopted.
    await act(async () => {
      renderer.update(providerElement(clientB, itemA));
    });
    await settle();

    texts = collectTexts(renderer.root);
    assert.ok(texts.includes('Comment from Client B'), 'comments must follow the client swap');
    assert.equal(texts.includes('Comment from Client A'), false, 'must not leak clientA comments');
    assert.deepEqual(clientBListCalls, ['req-1']);
    assert.equal(composerInput()?.props.value, '', 'composer draft must not survive a client swap');
    assert.equal(
      Boolean(renderer.root.findByType(VoteButton).props.error),
      false,
      'prior clientA vote error must be cleared on client swap'
    );

    // Second commit: clientB's item finally arrives with the same id.
    await act(async () => {
      renderer.update(providerElement(clientB, itemB));
    });
    await settle();

    texts = collectTexts(renderer.root);
    assert.ok(texts.includes('Client B Title'), 'same-id item from clientB must be adopted');
    assert.equal(texts.includes('Client A Title'), false, 'must not retain itemA title');
    assert.equal(renderer.root.findByType(VoteButton).props.voteCount, 9);
    assert.equal(renderer.root.findByType(VoteButton).props.hasVoted, true);
    assert.deepEqual(clientBListCalls, ['req-1'], 'same-id refresh must not remount the thread');

    renderer.unmount();
  }
);
