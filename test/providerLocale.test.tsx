import test, { after, beforeEach, afterEach, type TestOptions } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { FeedbackClient } from '../src/client/FeedbackClient';
import { getLocaleStrings } from '../src/i18n';

// `CupThreadProvider` imports `useColorScheme` from react-native, which cannot
// load under plain Node. Mock that surface, then dynamically import the
// provider module so the mock is in place before evaluation. Module mocking
// needs Node >= 22.3 with --experimental-test-module-mocks; without it the
// render-level tests below are skipped.
const supportsModuleMocks = typeof (test as any).mock?.module === 'function';
if (supportsModuleMocks) {
  // `namedExports` is what Node 22 (the CI baseline) uses to link ESM named
  // imports against the mock; newer runtimes still accept it (deprecation
  // warning only), while the replacement `exports` option breaks Node 22.
  (test as any).mock.module('react-native', {
    namedExports: { useColorScheme: () => 'light' },
  });
}

const { CupThreadProvider, useCupThreadContext } =
  await import('../src/theme/CupThreadThemeProvider');
const { setDeviceLocaleProvider, resetDeviceLocaleCache } = await import('../src/i18n');

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// Options shared by the render-level tests: skipped cleanly when the runtime
// lacks node:test module mocking (Node < 22.3 or the flag is absent).
const renderTestOptions: TestOptions = supportsModuleMocks
  ? {}
  : {
      skip: 'node:test module mocking unavailable (needs Node >= 22.3 with --experimental-test-module-mocks)',
    };

// The built-in require-chain detection cannot run under plain Node (react-native
// and the optional locale packages do not load), so device languages are
// simulated through the same seam a host would use: setDeviceLocaleProvider.
// The holder lets each case pick a different device language without
// re-registering module mocks.
const deviceLocale: { tag: string | null } = { tag: null };
setDeviceLocaleProvider(() => deviceLocale.tag);

after(() => {
  setDeviceLocaleProvider(null);
  resetDeviceLocaleCache();
});

type LocaleObservation = {
  locale: string;
  composerTitle: string;
  screenTitle: string;
  upvote: string;
};

function LocaleProbe({ observations }: { observations: LocaleObservation[] }) {
  const ctx = useCupThreadContext();
  const { locale, strings } = ctx;
  React.useEffect(() => {
    observations.push({
      locale,
      composerTitle: strings.feedbackComposer.title,
      screenTitle: strings.featureRequests.screenTitle,
      upvote: strings.featureRequests.upvote,
    });
  });
  return null;
}

/** Let pending microtasks and pending act-batched state updates settle. */
async function flush(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2));
    await act(async () => {});
  }
}

function makeClient(): FeedbackClient {
  return new FeedbackClient({
    baseUrl: 'https://api.cupthread.com',
    appKey: 'app_test_locale_auto',
  });
}

// The provider fetches remote config on mount; disable the network by default.
const originalFetch = globalThis.fetch;

beforeEach(() => {
  deviceLocale.tag = null;
  globalThis.fetch = (async () => {
    throw new TypeError('network disabled in provider locale tests');
  }) as any;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

async function renderProvider(
  observations: LocaleObservation[],
  props: { locale?: string } = {}
): Promise<TestRenderer.ReactTestRenderer> {
  let renderer: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <CupThreadProvider client={makeClient()} {...props}>
        <LocaleProbe observations={observations} />
      </CupThreadProvider>
    );
  });
  await flush();
  return renderer!;
}

function lastObservation(observations: LocaleObservation[]): LocaleObservation {
  return observations[observations.length - 1];
}

test(
  'provider follows the detected device locale when no locale prop is passed',
  renderTestOptions,
  async () => {
    deviceLocale.tag = 'pt-BR';
    const observations: LocaleObservation[] = [];
    const renderer = await renderProvider(observations);

    const last = lastObservation(observations);
    assert.equal(last.locale, 'pt-BR');
    assert.equal(last.composerTitle, getLocaleStrings('pt-BR').feedbackComposer.title);
    assert.equal(last.screenTitle, getLocaleStrings('pt-BR').featureRequests.screenTitle);
    renderer.unmount();
  }
);

test(
  'regional device tags resolve through the BCP 47 prefix matching',
  renderTestOptions,
  async () => {
    // zh-Hans-CN → Simplified Chinese
    deviceLocale.tag = 'zh-Hans-CN';
    const simplified: LocaleObservation[] = [];
    const simplifiedRenderer = await renderProvider(simplified);
    assert.equal(lastObservation(simplified).locale, 'zh-Hans-CN');
    assert.equal(lastObservation(simplified).screenTitle, '需求墙');
    simplifiedRenderer.unmount();

    // zh-TW → Traditional Chinese
    deviceLocale.tag = 'zh-TW';
    const traditional: LocaleObservation[] = [];
    const traditionalRenderer = await renderProvider(traditional);
    assert.equal(lastObservation(traditional).locale, 'zh-TW');
    assert.equal(lastObservation(traditional).screenTitle, '功能需求');
    traditionalRenderer.unmount();

    // nb-NO → Norwegian
    deviceLocale.tag = 'nb-NO';
    const norwegian: LocaleObservation[] = [];
    const norwegianRenderer = await renderProvider(norwegian);
    assert.equal(lastObservation(norwegian).locale, 'nb-NO');
    assert.equal(lastObservation(norwegian).upvote, 'Stem');
    norwegianRenderer.unmount();
  }
);

test(
  'an explicit locale prop wins over the detected device locale',
  renderTestOptions,
  async () => {
    deviceLocale.tag = 'fr-FR';
    const observations: LocaleObservation[] = [];
    const renderer = await renderProvider(observations, { locale: 'ja' });

    const last = lastObservation(observations);
    assert.equal(last.locale, 'ja');
    assert.equal(last.composerTitle, 'フィードバックを送る');
    assert.equal(last.screenTitle, '機能リクエスト');
    renderer.unmount();
  }
);

test('locale="auto" behaves identically to omitting the prop', renderTestOptions, async () => {
  deviceLocale.tag = 'ko-KR';
  const omitted: LocaleObservation[] = [];
  const omittedRenderer = await renderProvider(omitted);
  const explicit: LocaleObservation[] = [];
  const explicitRenderer = await renderProvider(explicit, { locale: 'auto' });

  const omittedLast = lastObservation(omitted);
  const explicitLast = lastObservation(explicit);
  assert.equal(omittedLast.locale, 'ko-KR');
  assert.deepEqual(explicitLast, omittedLast);
  omittedRenderer.unmount();
  explicitRenderer.unmount();
});

test(
  'provider falls back to English when no device locale is detectable',
  renderTestOptions,
  async () => {
    const observations: LocaleObservation[] = [];
    const renderer = await renderProvider(observations);

    const last = lastObservation(observations);
    assert.equal(last.locale, 'en');
    assert.equal(last.composerTitle, 'Send Feedback');
    assert.equal(last.screenTitle, 'Feature Requests');
    renderer.unmount();
  }
);

test(
  'custom string overrides still merge on top of the detected device locale',
  renderTestOptions,
  async () => {
    deviceLocale.tag = 'zh-Hans-CN';
    const observations: LocaleObservation[] = [];
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <CupThreadProvider
          client={makeClient()}
          strings={{ featureRequests: { screenTitle: '功能期望池' } }}
        >
          <LocaleProbe observations={observations} />
        </CupThreadProvider>
      );
    });
    await flush();

    const last = lastObservation(observations);
    assert.equal(last.locale, 'zh-Hans-CN');
    assert.equal(last.screenTitle, '功能期望池', 'the override wins');
    assert.equal(last.composerTitle, '提供反馈', 'unrelated strings come from the detected locale');
    renderer!.unmount();
  }
);
