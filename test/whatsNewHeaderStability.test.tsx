import test, { type TestOptions } from 'node:test';
import assert from 'node:assert/strict';
import React, { useState } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { createFlatListStub } from './helpers/virtualizedListStub';
import { FeedbackClient } from '../src/client/FeedbackClient';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Regression tests for issue #143: the subscribe email `TextInput` lives in
// the changelog list header. `VirtualizedList` instantiates a component prop
// via `React.createElement(ListHeaderComponent)`, so a fresh closure identity
// there is a new element type on every screen render and React unmounts and
// remounts the whole header per keystroke — the native text field is
// destroyed, focus is lost, and the keyboard dismisses after every typed
// character. The fix renders the header as an element with a stable
// module-scope component type, which reconciles in place.
//
// The `TextInput` stub counts mounts with an empty-deps effect: it fires once
// per mount and never on re-render, so the counter is a remount detector, not
// a render counter. A companion test drives the known-bad fresh-closure
// pattern through the same stubs and asserts the counter DOES climb, guarding
// the harness itself.
const supportsModuleMocks = typeof (test as any).mock?.module === 'function';

let textInputMounts = 0;
const textInputProps: any[] = [];

const TextInputStub = (props: any) => {
  React.useEffect(() => {
    textInputMounts += 1;
  }, []);
  textInputProps.push(props);
  return null;
};

if (supportsModuleMocks) {
  (test as any).mock.module('react-native', {
    namedExports: {
      useColorScheme: () => 'light',
      View: ({ children }: any) => children ?? null,
      Text: ({ children }: any) => children ?? null,
      TextInput: TextInputStub,
      TouchableOpacity: ({ children, ...rest }: any) =>
        React.createElement('TouchableOpacity', rest, children),
      ActivityIndicator: () => null,
      ScrollView: ({ children }: any) => children ?? null,
      Modal: ({ children }: any) => children ?? null,
      SafeAreaView: ({ children }: any) => children ?? null,
      FlatList: createFlatListStub(),
      RefreshControl: () => null,
      StyleSheet: { create: (styles: any) => styles, flatten: (s: any) => s },
      Alert: { alert: () => {} },
      Linking: { openURL: async () => {} },
    },
  });
}

const { CupThreadProvider } = supportsModuleMocks
  ? await import('../src/theme/CupThreadThemeProvider')
  : ({} as any);
const { WhatsNewScreen } = supportsModuleMocks
  ? await import('../src/components/WhatsNewScreen')
  : ({} as any);

const renderTestOptions: TestOptions = supportsModuleMocks
  ? {}
  : {
      skip: 'node:test module mocking unavailable (needs Node >= 22.3 with --experimental-test-module-mocks)',
    };

async function flush(times = 10): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2));
    await act(async () => {});
  }
}

function makeClient(): FeedbackClient {
  return new FeedbackClient({
    baseUrl: 'https://api.cupthread.com',
    appKey: 'app_header_stability',
  });
}

/** Answers the changelog list with an empty page; everything else rejects. */
function installFetch(): void {
  globalThis.fetch = (async (url: string | URL | Request) => {
    const target = url.toString();
    if (target.includes('/changelog')) {
      return new Response(JSON.stringify({ entries: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new TypeError('unexpected endpoint in header-stability tests');
  }) as any;
}

function resetProbes(): void {
  textInputMounts = 0;
  textInputProps.length = 0;
}

test(
  'WhatsNewScreen keeps the subscribe TextInput mounted across keystrokes',
  renderTestOptions,
  async () => {
    installFetch();
    resetProbes();

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <CupThreadProvider client={makeClient()}>
          <WhatsNewScreen />
        </CupThreadProvider>
      );
    });
    await flush();

    assert.ok(textInputProps.length > 0, 'the subscribe header must be rendered');
    assert.equal(
      textInputMounts,
      1,
      'the header TextInput must mount exactly once before typing starts'
    );

    const latest = () => textInputProps[textInputProps.length - 1];
    for (const value of ['u', 'us', 'use', 'user']) {
      await act(async () => {
        latest().onChangeText?.(value);
      });
    }
    await flush();

    assert.equal(
      textInputMounts,
      1,
      `typing must not remount the TextInput (saw ${textInputMounts} mounts) — ` +
        'a remount per keystroke destroys the native text field and dismisses the keyboard'
    );
    assert.equal(
      latest().value,
      'user',
      'the field must still receive the updated email state in place'
    );
    renderer.unmount();
  }
);

test(
  'harness guard: a fresh-closure ListHeaderComponent remounts the header per keystroke',
  renderTestOptions,
  async () => {
    const RN: any = await import('react-native');

    // The known-bad pattern WhatsNewScreen shipped before the fix: a header
    // component built from a fresh closure that closes over changing state.
    function BrokenScreen(): React.ReactElement {
      const [value, setValue] = useState('');
      const renderHeader = () =>
        React.createElement(
          RN.View,
          null,
          React.createElement(RN.TextInput, { value, onChangeText: setValue })
        );
      return React.createElement(RN.FlatList, {
        data: [],
        renderItem: () => null,
        ListHeaderComponent: renderHeader,
      });
    }

    resetProbes();

    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(React.createElement(BrokenScreen));
    });
    assert.equal(textInputMounts, 1, 'the bad pattern still mounts its first instance');

    for (const value of ['u', 'us', 'use', 'user']) {
      await act(async () => {
        textInputProps[textInputProps.length - 1]?.onChangeText?.(value);
      });
    }

    assert.equal(
      textInputMounts,
      5,
      'the remount detector must fire for the known-bad pattern — ' +
        'if this fails, the mount counter no longer detects remounts'
    );
    renderer.unmount();
  }
);
