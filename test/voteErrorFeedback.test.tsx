import test, { type TestOptions } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { createFlatListStub } from './helpers/virtualizedListStub';
import { FeedbackClient } from '../src/client/FeedbackClient';
import type { FeatureRequestItem } from '../src/types';

const supportsModuleMocks = typeof (test as any).mock?.module === 'function';

const TouchableOpacityStub = (props: any) => {
  return React.createElement('TouchableOpacity', props, props.children ?? null);
};

const TextInputStub = (props: any) => {
  return React.createElement('TextInput', props, null);
};

const ViewStub = (props: any) => {
  return React.createElement('View', props, props.children ?? null);
};

const TextStub = (props: any) => {
  return React.createElement('Text', props, props.children ?? null);
};

const FlatListStub = createFlatListStub();

if (supportsModuleMocks) {
  (test as any).mock.module('react-native', {
    namedExports: {
      useColorScheme: () => 'light',
      View: ViewStub,
      Text: TextStub,
      TextInput: TextInputStub,
      TouchableOpacity: TouchableOpacityStub,
      FlatList: FlatListStub,
      ActivityIndicator: (props: any) => React.createElement('ActivityIndicator', props, null),
      Image: (props: any) => React.createElement('Image', props, null),
      RefreshControl: (props: any) => React.createElement('RefreshControl', props, null),
      ScrollView: ({ children }: any) => React.createElement('ScrollView', null, children),
      Modal: ({ children }: any) => React.createElement('Modal', null, children),
      SafeAreaView: ({ children }: any) => React.createElement('SafeAreaView', null, children),
      StyleSheet: { create: (styles: any) => styles, flatten: (s: any) => s },
      Alert: { alert: () => {} },
      Linking: { openURL: async () => {}, canOpenURL: async () => true },
    },
  });
}

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const { useToggleVote } = await import('../src/hooks/useToggleVote');
const { VoteButton } = await import('../src/components/VoteButton');
const { FeatureRequestDetail } = await import('../src/components/FeatureRequestDetail');
const { CupThreadProvider } = await import('../src/theme/CupThreadThemeProvider');

const renderTestOptions: TestOptions = supportsModuleMocks
  ? {}
  : {
      skip: 'node:test module mocking unavailable (needs Node >= 22.3 with --experimental-test-module-mocks)',
    };

async function flush(times = 10, waitMs = 35): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    await act(async () => {});
  }
}

function makeItem(overrides: Partial<FeatureRequestItem> = {}): FeatureRequestItem {
  return {
    id: 'fr_1',
    appId: 'app_1',
    title: 'Dark mode support',
    description: 'Please add a dark theme option',
    status: 'open',
    approved: true,
    voteCount: 10,
    hasVoted: false,
    isOwnRequest: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

// Minimal hook probe runner
function renderTestHook<T>(hookFn: () => T) {
  const states: any[] = [];
  const listeners: (() => void)[] = [];
  let index = 0;

  const dispatcher = {
    useRef<V>(initial: V) {
      const idx = index++;
      if (!(idx in states)) {
        states[idx] = { current: initial };
      }
      return states[idx];
    },
    useState<V>(initial: V | (() => V)) {
      const idx = index++;
      if (!(idx in states)) {
        states[idx] = typeof initial === 'function' ? (initial as () => V)() : initial;
      }
      const setter = (val: V | ((prev: V) => V)) => {
        states[idx] = typeof val === 'function' ? (val as (prev: V) => V)(states[idx]) : val;
        listeners.forEach((l) => l());
      };
      return [states[idx], setter];
    },
    useCallback<F extends (...args: any[]) => any>(fn: F) {
      return fn;
    },
  };

  let currentResult: T;
  function render() {
    index = 0;
    const reactInternals = (React as any).__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
    const prev = reactInternals.ReactCurrentDispatcher.current;
    reactInternals.ReactCurrentDispatcher.current = dispatcher;
    try {
      currentResult = hookFn();
    } finally {
      reactInternals.ReactCurrentDispatcher.current = prev;
    }
  }

  listeners.push(render);
  render();

  return {
    get result() {
      return currentResult;
    },
  };
}

test('acceptance 1: toggleVote rejection rolls back optimistic state, sets voteError, and invokes onVoteError', async () => {
  let rejectVote!: (err: any) => void;
  const mockClient = {
    toggleVote: async () =>
      new Promise((_, reject) => {
        rejectVote = reject;
      }),
  } as any;

  let stateItem = makeItem({ id: 'item_1', voteCount: 5, hasVoted: false });
  const applyChange = (_id: string, transform: (it: FeatureRequestItem) => FeatureRequestItem) => {
    stateItem = transform(stateItem);
  };

  const observedErrors: { error: unknown; item: FeatureRequestItem }[] = [];
  const harness = renderTestHook(() =>
    useToggleVote(mockClient, 'usr_token', applyChange, {
      onVoteError: (error, item) => observedErrors.push({ error, item }),
    })
  );

  // Initial state: no error
  assert.equal(harness.result.voteError, null);
  assert.equal(harness.result.getVoteError('item_1'), null);

  // Optimistic vote tap
  harness.result.toggleVote(stateItem);
  assert.equal(stateItem.hasVoted, true);
  assert.equal(stateItem.voteCount, 6);
  assert.equal(harness.result.isVoting('item_1'), true);

  // Network rejection
  const networkErr = new Error('HTTP 429: Rate limited');
  rejectVote(networkErr);
  await new Promise((r) => setTimeout(r, 10));

  // Rollback applied
  assert.equal(stateItem.hasVoted, false);
  assert.equal(stateItem.voteCount, 5);
  assert.equal(harness.result.isVoting('item_1'), false);

  // voteError set
  assert.equal(harness.result.voteError, networkErr);
  assert.equal(harness.result.getVoteError('item_1'), networkErr);

  // onVoteError callback invoked
  assert.equal(observedErrors.length, 1);
  assert.equal(observedErrors[0].error, networkErr);
  assert.equal(observedErrors[0].item.id, 'item_1');
});

test('acceptance 2: subsequent successful toggle clears voteError', async () => {
  let failFirst = true;
  const mockClient = {
    toggleVote: async () => {
      if (failFirst) {
        throw new Error('500 Server Error');
      }
      return { voted: true, voteCount: 6 };
    },
  } as any;

  let stateItem = makeItem({ id: 'item_2', voteCount: 5, hasVoted: false });
  const applyChange = (_id: string, transform: (it: FeatureRequestItem) => FeatureRequestItem) => {
    stateItem = transform(stateItem);
  };

  const harness = renderTestHook(() => useToggleVote(mockClient, 'usr_token', applyChange));

  // First tap fails
  harness.result.toggleVote(stateItem);
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(harness.result.voteError instanceof Error);

  // Retry succeeds
  failFirst = false;
  harness.result.toggleVote(stateItem);
  await new Promise((r) => setTimeout(r, 10));

  // voteError must be cleared on success
  assert.equal(harness.result.voteError, null);
  assert.equal(harness.result.getVoteError('item_2'), null);
  assert.equal(stateItem.hasVoted, true);
  assert.equal(stateItem.voteCount, 6);
});

test('acceptance 3: new attempt on the same item clears previous error at tap time', async () => {
  let pendingResolve!: (val: any) => void;
  const mockClient = {
    toggleVote: async () => {
      return new Promise((resolve) => {
        pendingResolve = resolve;
      });
    },
  } as any;

  let stateItem = makeItem({ id: 'item_3', voteCount: 1, hasVoted: false });
  const applyChange = (_id: string, transform: (it: FeatureRequestItem) => FeatureRequestItem) => {
    stateItem = transform(stateItem);
  };

  const harness = renderTestHook(() => useToggleVote(mockClient, 'usr_token', applyChange));

  // Simulate an existing failure state
  mockClient.toggleVote = async () => {
    throw new Error('Initial fail');
  };
  harness.result.toggleVote(stateItem);
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(harness.result.voteError !== null);

  // Switch to pending implementation
  mockClient.toggleVote = async () =>
    new Promise((resolve) => {
      pendingResolve = resolve;
    });

  // Tap again: must clear previous error immediately at tap time before request resolves
  harness.result.toggleVote(stateItem);
  assert.equal(harness.result.voteError, null, 'voteError must be cleared at tap time');
  assert.equal(
    harness.result.getVoteError('item_3'),
    null,
    'item voteError must be cleared at tap time'
  );

  // Finish pending request
  pendingResolve({ voted: true, voteCount: 2 });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(harness.result.voteError, null);
});

test('acceptance 4: per-item isolation: failure on item A is not reported as error for item B', async () => {
  const mockClient = {
    toggleVote: async (id: string) => {
      if (id === 'item_A') {
        throw new Error('Item A failed');
      }
      return { voted: true, voteCount: 10 };
    },
  } as any;

  const itemsMap: Record<string, FeatureRequestItem> = {
    item_A: makeItem({ id: 'item_A', voteCount: 1, hasVoted: false }),
    item_B: makeItem({ id: 'item_B', voteCount: 2, hasVoted: false }),
  };

  const applyChange = (id: string, transform: (it: FeatureRequestItem) => FeatureRequestItem) => {
    itemsMap[id] = transform(itemsMap[id]);
  };

  const harness = renderTestHook(() => useToggleVote(mockClient, 'usr_token', applyChange));

  // Toggle item A -> fails
  harness.result.toggleVote(itemsMap.item_A);
  await new Promise((r) => setTimeout(r, 10));

  // Verify item A has error
  assert.ok(harness.result.getVoteError('item_A') instanceof Error);
  assert.equal(harness.result.getVoteError('item_A')?.message, 'Item A failed');

  // Verify item B has NO error
  assert.equal(harness.result.getVoteError('item_B'), null);

  // Clear item A specifically
  harness.result.clearVoteError('item_A');
  assert.equal(harness.result.getVoteError('item_A'), null);
});

test('acceptance 7 (#163): clearVoteError(itemId) leaves the global voteError untouched', async () => {
  const mockClient = {
    toggleVote: async (id: string) => {
      if (id === 'item_A') {
        throw new Error('Item A failed');
      }
      throw new Error('Item B failed');
    },
  } as any;

  const itemsMap: Record<string, FeatureRequestItem> = {
    item_A: makeItem({ id: 'item_A', voteCount: 1, hasVoted: false }),
    item_B: makeItem({ id: 'item_B', voteCount: 2, hasVoted: false }),
  };

  const applyChange = (id: string, transform: (it: FeatureRequestItem) => FeatureRequestItem) => {
    itemsMap[id] = transform(itemsMap[id]);
  };

  const harness = renderTestHook(() => useToggleVote(mockClient, 'usr_token', applyChange));

  // Both rows fail; B fails last, so the global error is B's.
  harness.result.toggleVote(itemsMap.item_A);
  await new Promise((r) => setTimeout(r, 10));
  harness.result.toggleVote(itemsMap.item_B);
  await new Promise((r) => setTimeout(r, 10));

  assert.ok(harness.result.getVoteError('item_A') instanceof Error);
  assert.ok(harness.result.getVoteError('item_B') instanceof Error);
  assert.equal(harness.result.voteError?.message, 'Item B failed');

  // Clearing one row's error must not dismiss the global banner (#163).
  harness.result.clearVoteError('item_A');
  assert.equal(harness.result.getVoteError('item_A'), null);
  assert.equal(harness.result.getVoteError('item_B')?.message, 'Item B failed');
  assert.equal(
    harness.result.voteError?.message,
    'Item B failed',
    'global voteError must survive a per-item clear'
  );

  // The remaining row's error is still clearable per-item.
  harness.result.clearVoteError('item_B');
  assert.equal(harness.result.getVoteError('item_B'), null);
  assert.equal(
    harness.result.voteError?.message,
    'Item B failed',
    'global voteError must survive every per-item clear'
  );

  // Repopulate one item error so the no-argument clear must provably reset
  // both states, not just the global one.
  harness.result.toggleVote(itemsMap.item_B);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(harness.result.getVoteError('item_B')?.message, 'Item B failed');
  assert.equal(harness.result.voteError?.message, 'Item B failed');

  // A no-argument call resets everything, including the global error.
  harness.result.clearVoteError();
  assert.equal(harness.result.getVoteError('item_B'), null);
  assert.equal(harness.result.voteError, null);
});

test('acceptance 8 (#163): clearVoteError(itemId) on an unknown id is a no-op', async () => {
  const mockClient = {
    toggleVote: async () => {
      throw new Error('boom');
    },
  } as any;

  let stateItem = makeItem({ id: 'item_x', voteCount: 1, hasVoted: false });
  const applyChange = (_id: string, transform: (it: FeatureRequestItem) => FeatureRequestItem) => {
    stateItem = transform(stateItem);
  };

  const harness = renderTestHook(() => useToggleVote(mockClient, 'usr_token', applyChange));

  harness.result.toggleVote(stateItem);
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(harness.result.voteError instanceof Error);

  // Clearing an unrelated item must not disturb any error state.
  harness.result.clearVoteError('item_unknown');
  assert.equal(harness.result.getVoteError('item_x')?.message, 'boom');
  assert.ok(harness.result.voteError instanceof Error);

  // A supplied-but-unknown empty id is also a per-item no-op, not a global
  // clear: only the undefined argument resets everything.
  harness.result.clearVoteError('');
  assert.equal(harness.result.getVoteError('item_x')?.message, 'boom');
  assert.ok(harness.result.voteError instanceof Error);
});

test(
  'VoteButton renders danger styling and error accessibility label when error is passed',
  renderTestOptions,
  () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_test_vote_button',
    });

    // Without error:
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(CupThreadProvider, {
          client,
          children: React.createElement(VoteButton, {
            voteCount: 7,
            hasVoted: false,
            onPress: () => {},
            error: null,
          }),
        })
      );
    });

    let touchable = renderer.root.findByType(TouchableOpacityStub as any);
    assert.equal(touchable.props.accessibilityLabel, 'Upvote');

    // With error:
    act(() => {
      renderer.update(
        React.createElement(CupThreadProvider, {
          client,
          children: React.createElement(VoteButton, {
            voteCount: 7,
            hasVoted: false,
            onPress: () => {},
            error: new Error('Rate limited'),
          }),
        })
      );
    });

    touchable = renderer.root.findByType(TouchableOpacityStub as any);
    assert.ok(
      touchable.props.accessibilityLabel.includes('Failed to update vote'),
      'accessibility label must mention vote failure'
    );

    // Style must reflect danger border
    const style = Array.isArray(touchable.props.style)
      ? touchable.props.style
      : [touchable.props.style];
    assert.ok(
      style.some((s: any) => s && s.borderColor && s.borderColor !== 'transparent'),
      'must apply danger border color'
    );

    renderer.unmount();
  }
);

test(
  'acceptance 5: screen consuming useToggleVote renders localized failure notice after rejection and removes it on successful retry',
  renderTestOptions,
  async () => {
    let shouldFail = true;
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_test_screen_vote_fail',
    });

    const item = makeItem({ id: 'fr_screen_1', voteCount: 3, hasVoted: false });

    client.toggleVote = async () => {
      if (shouldFail) {
        throw new Error('429 Rate limited');
      }
      return { voted: true, voteCount: 4 };
    };

    let renderer!: TestRenderer.ReactTestRenderer;
    try {
      await act(async () => {
        renderer = TestRenderer.create(
          React.createElement(CupThreadProvider, {
            client,
            userToken: 'usr_screen_test',
            children: React.createElement(FeatureRequestDetail, {
              visible: true,
              item,
              onClose: () => {},
            }),
          })
        );
      });
      await flush();

      // Find VoteButton in rendered tree. The detail view also has a labeled
      // back button, so match the vote label rather than the first button.
      const buttons = renderer.root.findAllByType(TouchableOpacityStub as any);
      const voteBtn = buttons.find(
        (b) => b.props?.accessibilityLabel === 'Upvote' || b.props?.accessibilityLabel === 'Upvoted'
      );
      assert.ok(voteBtn, 'VoteButton must exist in rendered detail view');

      // Tap vote button -> fails
      await act(async () => {
        voteBtn.props.onPress();
      });
      await flush();

      // Check for failure banner in rendered tree
      const texts = renderer.root.findAllByType(TextStub as any);
      const errorNotice = texts.find((t) => {
        const content = t.props?.children;
        return typeof content === 'string' && content.includes('Failed to update vote');
      });
      assert.ok(errorNotice, 'Failure notice banner must be rendered after vote rejection');

      // Retry -> succeeds
      shouldFail = false;
      await act(async () => {
        voteBtn.props.onPress();
      });
      await flush();

      // Failure banner must be removed after successful retry
      const textsAfter = renderer.root.findAllByType(TextStub as any);
      const errorNoticeAfter = textsAfter.find((t) => {
        const content = t.props?.children;
        return typeof content === 'string' && content.includes('Failed to update vote');
      });
      assert.equal(
        errorNoticeAfter,
        undefined,
        'Failure banner must be removed after successful retry'
      );
    } finally {
      renderer.unmount();
    }
  }
);

test(
  'acceptance: FeatureRequestDetail does not leak vote error banner across swapped items (#261)',
  renderTestOptions,
  async () => {
    let shouldFail = true;
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_test_screen_vote_fail_swap',
    });

    const itemA = makeItem({ id: 'fr_screen_swap_A', voteCount: 3, hasVoted: false });
    const itemB = makeItem({ id: 'fr_screen_swap_B', voteCount: 5, hasVoted: false });

    client.listComments = async () =>
      ({ comments: [], total: 0, hasMore: false, nextCursor: null }) as any;
    client.fetchAppConfig = async () => ({}) as any;
    client.toggleVote = async () => {
      if (shouldFail) {
        throw new Error('500 Server Error');
      }
      return { voted: true, voteCount: 4 };
    };

    let renderer!: TestRenderer.ReactTestRenderer;
    try {
      await act(async () => {
        renderer = TestRenderer.create(
          React.createElement(CupThreadProvider, {
            client,
            userToken: 'usr_screen_test',
            children: React.createElement(FeatureRequestDetail, {
              visible: true,
              item: itemA,
              onClose: () => {},
            }),
          })
        );
      });
      await flush();

      // Find VoteButton on item A
      const buttonsA = renderer.root.findAllByType(TouchableOpacityStub as any);
      const voteBtnA = buttonsA.find(
        (b) => b.props?.accessibilityLabel === 'Upvote' || b.props?.accessibilityLabel === 'Upvoted'
      );
      assert.ok(voteBtnA, 'VoteButton must exist on item A');

      // Tap vote on item A -> fails
      await act(async () => {
        voteBtnA.props.onPress();
      });
      await flush();

      // Check that error banner is rendered on item A
      const textsA = renderer.root.findAllByType(TextStub as any);
      const errorNoticeA = textsA.find((t) => {
        const content = t.props?.children;
        return typeof content === 'string' && content.includes('Failed to update vote');
      });
      assert.ok(errorNoticeA, 'Failure notice banner must be rendered for item A after rejection');

      // Swap item to item B while keeping the detail modal mounted
      await act(async () => {
        renderer.update(
          React.createElement(CupThreadProvider, {
            client,
            userToken: 'usr_screen_test',
            children: React.createElement(FeatureRequestDetail, {
              visible: true,
              item: itemB,
              onClose: () => {},
            }),
          })
        );
      });
      await flush();

      // Item B must NOT display the error banner
      const textsB = renderer.root.findAllByType(TextStub as any);
      const errorNoticeB = textsB.find((t) => {
        const content = t.props?.children;
        return typeof content === 'string' && content.includes('Failed to update vote');
      });
      assert.equal(
        errorNoticeB,
        undefined,
        'Failure notice banner must NOT leak onto swapped item B'
      );
    } finally {
      renderer.unmount();
    }
  }
);

test('acceptance 6: toggling a vote on an imported request keeps the imported vote portion', async () => {
  const mockClient = {
    // The server answers with the displayed total: 120 imported + 5 in-app.
    toggleVote: async () => ({ voted: true, voteCount: 125 }),
  } as any;

  let stateItem = makeItem({
    id: 'item_imported',
    voteCount: 124,
    importedVotes: 120,
    hasVoted: false,
  });
  const applyChange = (_id: string, transform: (it: FeatureRequestItem) => FeatureRequestItem) => {
    stateItem = transform(stateItem);
  };

  const harness = renderTestHook(() => useToggleVote(mockClient, 'usr_token', applyChange));

  harness.result.toggleVote(stateItem);

  // Issue #111: the optimistic delta moves the summed total, never the imported portion.
  assert.equal(stateItem.voteCount, 125);
  assert.equal(stateItem.importedVotes, 120);

  await new Promise((r) => setTimeout(r, 10));

  // The server total replaces the optimistic one and the imported portion survives.
  assert.equal(stateItem.hasVoted, true);
  assert.equal(stateItem.voteCount, 125);
  assert.equal(stateItem.importedVotes, 120);
});

test('acceptance: a throwing onVoteError after a failed vote keeps rollback, records voteError, releases isVoting, and produces no unhandled rejection', async () => {
  const mockClient = {
    toggleVote: async () => {
      throw new Error('Network error');
    },
  } as any;

  let stateItem = makeItem({ id: 'item_throw_err', voteCount: 5, hasVoted: false });
  let rollbackCount = 0;
  const applyChange = (
    _id: string,
    transform: (it: FeatureRequestItem) => FeatureRequestItem,
    meta?: any
  ) => {
    if (meta?.isRollback) {
      rollbackCount++;
    }
    stateItem = transform(stateItem);
  };

  const unhandledRejections: unknown[] = [];
  const onUnhandled = (err: unknown) => {
    unhandledRejections.push(err);
  };
  process.on('unhandledRejection', onUnhandled);

  try {
    const harness = renderTestHook(() =>
      useToggleVote(mockClient, 'usr_token', applyChange, {
        onVoteError: () => {
          throw new Error('Host onVoteError crashed');
        },
      })
    );

    harness.result.toggleVote(stateItem);
    assert.equal(harness.result.isVoting('item_throw_err'), true);

    await new Promise((r) => setTimeout(r, 15));

    // Rollback applied exactly once
    assert.equal(rollbackCount, 1, 'rollback must be applied exactly once');
    assert.equal(stateItem.hasVoted, false);
    assert.equal(stateItem.voteCount, 5);

    // voteError is still recorded correctly for the item
    assert.ok(harness.result.voteError instanceof Error);
    assert.equal(harness.result.voteError?.message, 'Network error');
    assert.equal(harness.result.getVoteError('item_throw_err')?.message, 'Network error');

    // isVoting released
    assert.equal(harness.result.isVoting('item_throw_err'), false);

    // unhandled rejection stays silent
    assert.equal(unhandledRejections.length, 0, 'process unhandledRejection must stay silent');
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('acceptance: a throwing applyChange during rollback does not trigger unhandled rejection and releases isVoting', async () => {
  const mockClient = {
    toggleVote: async () => {
      throw new Error('Network failure');
    },
  } as any;

  let optimisticApplied = false;
  const applyChange = (
    _id: string,
    _transform: (it: FeatureRequestItem) => FeatureRequestItem,
    meta?: any
  ) => {
    if (meta?.isRollback) {
      throw new Error('applyChange rollback threw');
    }
    optimisticApplied = true;
  };

  const unhandledRejections: unknown[] = [];
  const onUnhandled = (err: unknown) => {
    unhandledRejections.push(err);
  };
  process.on('unhandledRejection', onUnhandled);

  try {
    const harness = renderTestHook(() => useToggleVote(mockClient, 'usr_token', applyChange));

    const item = makeItem({ id: 'fr_rollback_throw', voteCount: 5, hasVoted: false });
    harness.result.toggleVote(item);
    assert.equal(optimisticApplied, true);
    assert.equal(harness.result.isVoting('fr_rollback_throw'), true);

    await new Promise((r) => setTimeout(r, 15));

    assert.equal(harness.result.isVoting('fr_rollback_throw'), false);
    assert.ok(harness.result.voteError instanceof Error);
    assert.equal(harness.result.voteError?.message, 'Network failure');
    assert.equal(unhandledRejections.length, 0, 'no unhandled rejections');
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('acceptance (#236): whitespace-only userToken safely no-ops without optimistic mutation, client call, or rollback error', async () => {
  let networkCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    networkCalls++;
    return new Response(JSON.stringify({ voted: true, voteCount: 6 }), { status: 200 });
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_test_whitespace_token',
    });

    let applyCalled = false;
    let stateItem = makeItem({ id: 'item_whitespace', voteCount: 5, hasVoted: false });
    const applyChange = (
      _id: string,
      transform: (it: FeatureRequestItem) => FeatureRequestItem
    ) => {
      applyCalled = true;
      stateItem = transform(stateItem);
    };

    const observedErrors: { error: unknown; item: FeatureRequestItem }[] = [];
    const harness = renderTestHook(() =>
      useToggleVote(client, '   \t  \n  ', applyChange, {
        onVoteError: (error, item) => observedErrors.push({ error, item }),
      })
    );

    harness.result.toggleVote(stateItem);
    await new Promise((r) => setTimeout(r, 20));

    assert.equal(applyCalled, false, 'applyChange should not be called');
    assert.equal(networkCalls, 0, 'no network calls should be dispatched');
    assert.equal(stateItem.hasVoted, false, 'hasVoted must remain unchanged');
    assert.equal(stateItem.voteCount, 5, 'voteCount must remain unchanged');
    assert.equal(harness.result.isVoting('item_whitespace'), false);
    assert.equal(harness.result.voteError, null, 'voteError must remain null');
    assert.equal(harness.result.getVoteError('item_whitespace'), null);
    assert.equal(observedErrors.length, 0, 'onVoteError must not be invoked');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
