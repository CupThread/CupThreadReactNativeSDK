import test, { type TestOptions } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { FeedbackClient } from '../src/client/FeedbackClient';
import { UserTokenStore } from '../src/client/UserTokenStore';
import { enStrings, esStrings } from '../src/i18n';

const supportsModuleMocks = typeof (test as any).mock?.module === 'function';

let lastModalProps: any = null;
const ModalStub = (props: any) => {
  lastModalProps = props;
  return props.visible ? (props.children ?? null) : null;
};

if (supportsModuleMocks) {
  (test as any).mock.module('react-native', {
    namedExports: {
      useColorScheme: () => 'light',
      View: ({ children }: any) => children ?? null,
      Text: ({ children }: any) => children ?? null,
      TextInput: () => null,
      TouchableOpacity: ({ children, onPress }: any) =>
        React.createElement('button', { onClick: onPress }, children),
      ActivityIndicator: () => null,
      ScrollView: ({ children }: any) => children ?? null,
      Modal: ModalStub,
      SafeAreaView: ({ children }: any) => children ?? null,
      StyleSheet: { create: (styles: any) => styles, flatten: (s: any) => s },
      Linking: { openURL: async () => {}, canOpenURL: async () => true },
    },
  });
}

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const { CupThreadProvider } = await import('../src/theme/CupThreadThemeProvider');
const { ChangelogOverlay } = await import('../src/components/ChangelogOverlay');

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

test(
  'ChangelogOverlay passes tokenStore prop to prepareChangelogOverlay and records seen status to custom store',
  renderTestOptions,
  async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      const s = url.toString();
      if (s.includes('/api/v1/public/config/')) {
        return new Response(
          JSON.stringify({
            appKey: 'app_overlay_prop_test',
            sdk: {
              features: { changelog: true },
              changelogOverlay: { entryCount: 3 },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (s.includes('/changelog')) {
        return new Response(
          JSON.stringify({
            entries: [
              {
                id: 'ch_prop_test',
                versionLabel: '3.0.0',
                title: 'Release 3.0.0',
                body: 'Release details',
                publishedAt: new Date().toISOString(),
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('{}', { status: 200 });
    }) as any;

    try {
      const client = new FeedbackClient({
        baseUrl: 'https://api.cupthread.com',
        appKey: 'app_overlay_prop_test',
      });

      const mem: Record<string, string> = {};
      const customStore = new UserTokenStore({
        getItem: (k) => mem[k] || null,
        setItem: (k, v) => {
          mem[k] = v;
        },
      });

      let dismissed = false;
      let renderer: any = null;

      await act(async () => {
        renderer = TestRenderer.create(
          <CupThreadProvider client={client}>
            <ChangelogOverlay
              visible={true}
              onlyIfUnseen={true}
              autoMarkSeen={true}
              tokenStore={customStore}
              onClose={() => {
                dismissed = true;
              }}
            />
          </CupThreadProvider>
        );
      });

      await flush(10);

      // Verify custom store has not yet marked it seen
      assert.equal(await customStore.hasSeenChangelog('3.0.0', 'app_overlay_prop_test'), false);

      // Dismiss overlay via Modal onRequestClose
      assert.ok(lastModalProps);
      await act(async () => {
        await lastModalProps.onRequestClose();
      });

      assert.equal(dismissed, true);

      // The overlay marks the version as seen within the client's app scope
      assert.equal(await customStore.hasSeenChangelog('3.0.0', 'app_overlay_prop_test'), true);
      assert.equal(
        await customStore.hasSeenChangelog('3.0.0'),
        false,
        'the unscoped legacy set must stay untouched'
      );

      // A cold start store using the same storage sees it as well
      const coldStartStore = new UserTokenStore({
        getItem: (k) => mem[k] || null,
        setItem: (k, v) => {
          mem[k] = v;
        },
      });
      assert.equal(await coldStartStore.hasSeenChangelog('3.0.0', 'app_overlay_prop_test'), true);

      renderer?.unmount();
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
);

test(
  'ChangelogOverlay safely guards entry title against empty, whitespace, and non-string types (#333)',
  renderTestOptions,
  async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      const s = url.toString();
      if (s.includes('/api/v1/public/config/')) {
        return new Response(
          JSON.stringify({
            appKey: 'app_overlay_title_guard_test',
            sdk: {
              features: { changelog: true },
              changelogOverlay: { entryCount: 10 },
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (s.includes('/changelog')) {
        return new Response(
          JSON.stringify({
            entries: [
              {
                id: 'ch_overlay_valid',
                versionLabel: '1.0.0',
                title: '   Trimmed Overlay Title   ',
                body: 'Release details',
                publishedAt: '2025-01-01T00:00:00.000Z',
              },
              {
                id: 'ch_overlay_object',
                versionLabel: '1.0.1',
                title: { invalid: true } as any,
                body: 'Release details object',
                publishedAt: '2025-01-02T00:00:00.000Z',
              },
              {
                id: 'ch_overlay_bool',
                versionLabel: '1.0.2',
                title: true as any,
                body: 'Release details bool',
                publishedAt: '2025-01-03T00:00:00.000Z',
              },
              {
                id: 'ch_overlay_num',
                versionLabel: '1.0.3',
                title: 12345 as any,
                body: 'Release details num',
                publishedAt: '2025-01-04T00:00:00.000Z',
              },
              {
                id: 'ch_overlay_null',
                versionLabel: '1.0.4',
                title: null as any,
                body: 'Release details null',
                publishedAt: '2025-01-05T00:00:00.000Z',
              },
              {
                id: 'ch_overlay_empty',
                versionLabel: '1.0.5',
                title: '',
                body: 'Release details empty',
                publishedAt: '2025-01-06T00:00:00.000Z',
              },
              {
                id: 'ch_overlay_ws',
                versionLabel: '1.0.6',
                title: '   \t   ',
                body: 'Release details ws',
                publishedAt: '2025-01-07T00:00:00.000Z',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('{}', { status: 200 });
    }) as any;

    try {
      const client = new FeedbackClient({
        baseUrl: 'https://api.cupthread.com',
        appKey: 'app_overlay_title_guard_test',
      });

      const mem: Record<string, string> = {};
      const customStore = new UserTokenStore({
        getItem: (k) => mem[k] || null,
        setItem: (k, v) => {
          mem[k] = v;
        },
      });

      lastModalProps = null;

      let renderer!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        renderer = TestRenderer.create(
          <CupThreadProvider client={client}>
            <ChangelogOverlay visible={true} tokenStore={customStore} onClose={() => {}} />
          </CupThreadProvider>
        );
      });
      await flush();

      assert.ok(lastModalProps, 'lastModalProps must be captured');
      assert.equal(lastModalProps.visible, true);

      const json = JSON.stringify(renderer.toJSON());
      assert.ok(json.includes('Trimmed Overlay Title'), 'Trimmed title must be rendered');
      assert.equal(
        json.includes('   Trimmed Overlay Title   '),
        false,
        'Untrimmed title must not be rendered'
      );

      renderer?.unmount();
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
);

async function renderOverlayWithEntries(
  appKey: string,
  onlyIfUnseen: boolean,
  onClose: () => void
): Promise<{ renderer: any; restore: () => void }> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    const s = url.toString();
    if (s.includes('/api/v1/public/config/')) {
      return new Response(JSON.stringify({ appKey, sdk: { features: { changelog: true } } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (s.includes('/changelog')) {
      return new Response(JSON.stringify({ entries: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('{}', { status: 200 });
  }) as any;
  const client = new FeedbackClient({ baseUrl: 'https://api.cupthread.com', appKey });
  let renderer: any = null;
  await act(async () => {
    renderer = TestRenderer.create(
      <CupThreadProvider client={client}>
        <ChangelogOverlay visible={true} onlyIfUnseen={onlyIfUnseen} onClose={onClose} />
      </CupThreadProvider>
    );
  });
  await flush(10);
  return {
    renderer,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

test(
  'ChangelogOverlay renders the empty-changelog notice instead of a blank card when there are no entries (#199)',
  renderTestOptions,
  async () => {
    let closed = false;
    const { renderer, restore } = await renderOverlayWithEntries('app_overlay_empty', false, () => {
      closed = true;
    });
    try {
      assert.ok(
        JSON.stringify(renderer.toJSON()).includes('No release notes published yet.'),
        'empty overlay must show the emptyChangelog copy'
      );
      assert.equal(closed, false, 'non-onlyIfUnseen overlay must not auto-dismiss');
    } finally {
      restore();
      renderer?.unmount();
    }
  }
);

test(
  'ChangelogOverlay still auto-dismisses with onlyIfUnseen when there is nothing to show (#199)',
  renderTestOptions,
  async () => {
    let closed = false;
    const { renderer, restore } = await renderOverlayWithEntries('app_overlay_empty2', true, () => {
      closed = true;
    });
    try {
      assert.equal(closed, true);
    } finally {
      restore();
      renderer?.unmount();
    }
  }
);

test(
  'ChangelogOverlay scopes entries, latestKey, and custom copy to client when replacement load fails (#464)',
  renderTestOptions,
  async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response('{}', { status: 200 })) as any;

    try {
      const clientA = {
        config: { appKey: 'app_overlay_swap_a' },
        fetchAppConfig: async () => ({ appKey: 'app_overlay_swap_a' }),
        prepareChangelogOverlay: async () => ({
          entries: [
            {
              id: 'ch_a_1',
              versionLabel: '2.0.0',
              title: 'App A Release Notes',
              body: 'App A body details',
              publishedAt: '2026-11-01T00:00:00.000Z',
            },
          ],
          appearance: {
            changelogOverlay: {
              title: 'App A Custom Title',
              subtitle: 'App A Custom Subtitle',
              entryCount: 3,
              primaryButton: 'App A Continue',
              closeButton: 'Close',
            },
          },
          latestKey: '2.0.0',
        }),
      } as unknown as FeedbackClient;

      let clientBShouldFail = true;
      const clientB = {
        config: { appKey: 'app_overlay_swap_b' },
        fetchAppConfig: async () => ({ appKey: 'app_overlay_swap_b' }),
        prepareChangelogOverlay: async () => {
          if (clientBShouldFail) {
            throw new Error('clientB network error');
          }
          return {
            entries: [
              {
                id: 'ch_b_1',
                versionLabel: '4.1.0',
                title: 'App B Recovered Release',
                body: 'App B body details',
                publishedAt: '2026-11-02T00:00:00.000Z',
              },
            ],
            appearance: {},
            latestKey: '4.1.0',
          };
        },
      } as unknown as FeedbackClient;

      const mem: Record<string, string> = {};
      const store = new UserTokenStore({
        getItem: (k) => mem[k] || null,
        setItem: (k, v) => {
          mem[k] = v;
        },
      });

      let dismissedCount = 0;
      let renderer!: TestRenderer.ReactTestRenderer;

      await act(async () => {
        renderer = TestRenderer.create(
          <CupThreadProvider client={clientA}>
            <ChangelogOverlay
              visible={true}
              autoMarkSeen={true}
              tokenStore={store}
              onClose={() => {
                dismissedCount += 1;
              }}
            />
          </CupThreadProvider>
        );
      });
      await flush();

      const jsonA = JSON.stringify(renderer.toJSON());
      assert.ok(jsonA.includes('App A Release Notes'));
      assert.ok(jsonA.includes('App A Custom Title'));
      assert.ok(jsonA.includes('App A Custom Subtitle'));
      assert.ok(jsonA.includes('App A Continue'));

      // Swap to clientB whose prepareChangelogOverlay rejects.
      await act(async () => {
        renderer.update(
          <CupThreadProvider client={clientB}>
            <ChangelogOverlay
              visible={true}
              autoMarkSeen={true}
              tokenStore={store}
              onClose={() => {
                dismissedCount += 1;
              }}
            />
          </CupThreadProvider>
        );
      });
      await flush();

      const jsonBFail = JSON.stringify(renderer.toJSON());
      assert.ok(
        jsonBFail.includes(enStrings.common.error),
        'ErrorState must render on failed swap'
      );
      assert.ok(jsonBFail.includes(enStrings.common.retry), 'Retry affordance must render');
      assert.equal(jsonBFail.includes('App A Release Notes'), false);
      assert.equal(jsonBFail.includes('App A Custom Title'), false);
      assert.equal(jsonBFail.includes('App A Custom Subtitle'), false);
      assert.equal(jsonBFail.includes('App A Continue'), false);
      assert.ok(jsonBFail.includes(enStrings.changelog.overlayTitle));
      assert.ok(jsonBFail.includes(enStrings.changelog.continueButton));

      // Dismissing while clientB failed must NOT persist clientA's '2.0.0' under clientB.
      await act(async () => {
        await lastModalProps.onRequestClose();
      });
      assert.equal(dismissedCount, 1);
      assert.equal(
        await store.hasSeenChangelog('2.0.0', 'app_overlay_swap_b'),
        false,
        "clientA's latestKey must not be recorded under clientB"
      );
      assert.equal(await store.hasSeenChangelog('2.0.0', 'app_overlay_swap_a'), false);

      // Recover clientB and trigger Retry button.
      clientBShouldFail = false;
      const buttons = renderer.root.findAllByType('button');
      const retryBtn = buttons.find(
        (b) =>
          b.findAll(
            (node) => Array.isArray(node.children) && node.children.includes(enStrings.common.retry)
          ).length > 0
      );
      assert.ok(retryBtn, 'Retry button must exist');
      await act(async () => {
        retryBtn!.props.onClick();
      });
      await flush();

      const jsonBRecovered = JSON.stringify(renderer.toJSON());
      assert.ok(jsonBRecovered.includes('App B Recovered Release'));

      await act(async () => {
        await lastModalProps.onRequestClose();
      });
      assert.equal(await store.hasSeenChangelog('4.1.0', 'app_overlay_swap_b'), true);

      renderer.unmount();
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
);

test(
  'ChangelogOverlay clears entries, latestKey, and custom copy on empty/null reloads and client swaps (#464)',
  renderTestOptions,
  async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response('{}', { status: 200 })) as any;

    try {
      let clientAHasEntries = true;
      const clientA = {
        config: { appKey: 'app_overlay_null_a' },
        fetchAppConfig: async () => ({ appKey: 'app_overlay_null_a' }),
        prepareChangelogOverlay: async () => {
          if (!clientAHasEntries) return null;
          return {
            entries: [
              {
                id: 'ch_null_a',
                versionLabel: '1.5.0',
                title: 'App A Entry',
                body: 'Details',
                publishedAt: '2026-11-01T00:00:00.000Z',
              },
            ],
            appearance: {
              changelogOverlay: {
                title: 'Custom A Title',
                subtitle: 'Custom A Subtitle',
                entryCount: 3,
                primaryButton: 'Custom A CTA',
                closeButton: 'Close',
              },
            },
            latestKey: '1.5.0',
          };
        },
      } as unknown as FeedbackClient;

      const clientBEmpty = {
        config: { appKey: 'app_overlay_null_b' },
        fetchAppConfig: async () => ({ appKey: 'app_overlay_null_b' }),
        prepareChangelogOverlay: async () => null,
      } as unknown as FeedbackClient;

      const mem: Record<string, string> = {};
      const store = new UserTokenStore({
        getItem: (k) => mem[k] || null,
        setItem: (k, v) => {
          mem[k] = v;
        },
      });

      let renderer!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        renderer = TestRenderer.create(
          <CupThreadProvider client={clientA}>
            <ChangelogOverlay
              visible={true}
              onlyIfUnseen={false}
              autoMarkSeen={true}
              tokenStore={store}
              onClose={() => {}}
            />
          </CupThreadProvider>
        );
      });
      await flush();

      assert.ok(JSON.stringify(renderer.toJSON()).includes('App A Entry'));
      assert.ok(JSON.stringify(renderer.toJSON()).includes('Custom A Title'));

      // Swap to clientB returning null (0 entries / disabled) with onlyIfUnseen={false}.
      await act(async () => {
        renderer.update(
          <CupThreadProvider client={clientBEmpty}>
            <ChangelogOverlay
              visible={true}
              onlyIfUnseen={false}
              autoMarkSeen={true}
              tokenStore={store}
              onClose={() => {}}
            />
          </CupThreadProvider>
        );
      });
      await flush();

      const jsonBEmpty = JSON.stringify(renderer.toJSON());
      assert.ok(jsonBEmpty.includes(enStrings.changelog.emptyChangelog));
      assert.equal(jsonBEmpty.includes('App A Entry'), false);
      assert.equal(jsonBEmpty.includes('Custom A Title'), false);
      assert.equal(jsonBEmpty.includes('Custom A Subtitle'), false);
      assert.equal(jsonBEmpty.includes('Custom A CTA'), false);

      await act(async () => {
        await lastModalProps.onRequestClose();
      });
      assert.equal(await store.hasSeenChangelog('1.5.0', 'app_overlay_null_b'), false);

      // Same-client reload returning null (e.g. entries unpublished after close/reopen)
      // must also clear stale entries and latestKey.
      await act(async () => {
        renderer.update(
          <CupThreadProvider client={clientA}>
            <ChangelogOverlay
              visible={true}
              onlyIfUnseen={false}
              autoMarkSeen={false}
              tokenStore={store}
              onClose={() => {}}
            />
          </CupThreadProvider>
        );
      });
      await flush();
      assert.ok(JSON.stringify(renderer.toJSON()).includes('App A Entry'));

      clientAHasEntries = false;
      await act(async () => {
        renderer.update(
          <CupThreadProvider client={clientA}>
            <ChangelogOverlay
              visible={false}
              onlyIfUnseen={false}
              autoMarkSeen={true}
              tokenStore={store}
              onClose={() => {}}
            />
          </CupThreadProvider>
        );
      });
      await act(async () => {
        renderer.update(
          <CupThreadProvider client={clientA}>
            <ChangelogOverlay
              visible={true}
              onlyIfUnseen={false}
              autoMarkSeen={true}
              tokenStore={store}
              onClose={() => {}}
            />
          </CupThreadProvider>
        );
      });
      await flush();

      const jsonAReloadNull = JSON.stringify(renderer.toJSON());
      assert.ok(jsonAReloadNull.includes(enStrings.changelog.emptyChangelog));
      assert.equal(jsonAReloadNull.includes('App A Entry'), false);
      assert.equal(jsonAReloadNull.includes('Custom A Title'), false);

      await act(async () => {
        await lastModalProps.onRequestClose();
      });
      assert.equal(await store.hasSeenChangelog('1.5.0', 'app_overlay_null_a'), false);

      renderer.unmount();
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
);

test(
  'ChangelogOverlay drops custom sdk.changelogOverlay on client swap and updates default copy when locale changes (#464)',
  renderTestOptions,
  async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response('{}', { status: 200 })) as any;

    try {
      const clientWithCustomCopy = {
        config: { appKey: 'app_custom_copy' },
        fetchAppConfig: async () => ({ appKey: 'app_custom_copy' }),
        prepareChangelogOverlay: async () => ({
          entries: [
            {
              id: 'ch_c1',
              versionLabel: '1.0.0',
              title: 'First App Release',
              body: 'Body 1',
              publishedAt: '2026-11-01T00:00:00.000Z',
            },
          ],
          appearance: {
            changelogOverlay: {
              title: 'Bespoke Header',
              subtitle: 'Bespoke Subtitle',
              entryCount: 3,
              primaryButton: 'Bespoke Button',
              closeButton: 'Close',
            },
          },
          latestKey: '1.0.0',
        }),
      } as unknown as FeedbackClient;

      const clientDefaultCopy = {
        config: { appKey: 'app_default_copy' },
        fetchAppConfig: async () => ({ appKey: 'app_default_copy' }),
        prepareChangelogOverlay: async () => ({
          entries: [
            {
              id: 'ch_c2',
              versionLabel: '2.1.0',
              title: 'Second App Release',
              body: 'Body 2',
              publishedAt: '2026-11-02T00:00:00.000Z',
            },
          ],
          appearance: {},
          latestKey: '2.1.0',
        }),
      } as unknown as FeedbackClient;

      let renderer!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        renderer = TestRenderer.create(
          <CupThreadProvider client={clientWithCustomCopy} locale="en">
            <ChangelogOverlay visible={true} autoMarkSeen={false} onClose={() => {}} />
          </CupThreadProvider>
        );
      });
      await flush();

      const json1 = JSON.stringify(renderer.toJSON());
      assert.ok(json1.includes('Bespoke Header'));
      assert.ok(json1.includes('Bespoke Subtitle'));
      assert.ok(json1.includes('Bespoke Button'));

      // Swap to clientDefaultCopy without sdk.changelogOverlay.
      await act(async () => {
        renderer.update(
          <CupThreadProvider client={clientDefaultCopy} locale="en">
            <ChangelogOverlay visible={true} autoMarkSeen={false} onClose={() => {}} />
          </CupThreadProvider>
        );
      });
      await flush();

      const json2 = JSON.stringify(renderer.toJSON());
      assert.ok(json2.includes('Second App Release'));
      assert.ok(json2.includes(enStrings.changelog.overlayTitle));
      assert.ok(json2.includes(enStrings.changelog.continueButton));
      assert.equal(json2.includes('Bespoke Header'), false);
      assert.equal(json2.includes('Bespoke Subtitle'), false);
      assert.equal(json2.includes('Bespoke Button'), false);

      // Update locale on CupThreadProvider from 'en' -> 'es': default overlay copy must update.
      await act(async () => {
        renderer.update(
          <CupThreadProvider client={clientDefaultCopy} locale="es">
            <ChangelogOverlay visible={true} autoMarkSeen={false} onClose={() => {}} />
          </CupThreadProvider>
        );
      });

      const jsonEs = JSON.stringify(renderer.toJSON());
      assert.ok(jsonEs.includes(esStrings.changelog.overlayTitle));
      assert.ok(jsonEs.includes(esStrings.changelog.continueButton));

      renderer.unmount();
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
);
