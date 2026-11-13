import test, { after, beforeEach, afterEach, type TestOptions } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { FeedbackClient } from '../src/client/FeedbackClient';
import { frStrings, setDeviceLocaleProvider, resetDeviceLocaleCache } from '../src/i18n';

const supportsModuleMocks = typeof (test as any).mock?.module === 'function';

if (supportsModuleMocks) {
  (test as any).mock.module('react-native', {
    namedExports: { useColorScheme: () => 'light' },
  });
}

const { CupThreadProvider, useCupThreadContext } =
  await import('../src/theme/CupThreadThemeProvider');

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const renderTestOptions: TestOptions = supportsModuleMocks
  ? {}
  : {
      skip: 'node:test module mocking unavailable (needs Node >= 22.3 with --experimental-test-module-mocks)',
    };

const originalFetch = globalThis.fetch;

beforeEach(() => {
  setDeviceLocaleProvider(null);
  resetDeviceLocaleCache();
  globalThis.fetch = (async () => {
    throw new TypeError('network disabled in device locale provider tests');
  }) as any;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  setDeviceLocaleProvider(null);
  resetDeviceLocaleCache();
});

after(() => {
  setDeviceLocaleProvider(null);
  resetDeviceLocaleCache();
});

async function flush(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2));
    await act(async () => {});
  }
}

function makeClient(): FeedbackClient {
  return new FeedbackClient({
    baseUrl: 'https://api.cupthread.com',
    appKey: 'app_device_locale_auto',
  });
}

function StringsProbe({ observations }: { observations: string[] }) {
  const { strings } = useCupThreadContext();
  React.useEffect(() => {
    observations.push(strings.feedbackComposer.title);
  });
  return null;
}

test(
  'CupThreadProvider with locale auto renders the French dictionary when detection resolves to fr-FR (#443)',
  renderTestOptions,
  async () => {
    setDeviceLocaleProvider(() => 'fr-FR');
    const titles: string[] = [];
    let renderer: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(
        <CupThreadProvider client={makeClient()} locale="auto">
          <StringsProbe observations={titles} />
        </CupThreadProvider>
      );
    });
    await flush();

    assert.ok(
      titles.includes(frStrings.feedbackComposer.title),
      'auto locale should render the detected French dictionary'
    );
    renderer!.unmount();
  }
);
