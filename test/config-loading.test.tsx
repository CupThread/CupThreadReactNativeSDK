import test, { beforeEach, afterEach, type TestOptions } from 'node:test';
import assert from 'node:assert/strict';
import React, { useEffect } from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { FeedbackClient } from '../src/client/FeedbackClient';
import type { PublicAppConfig } from '../src/types';

const supportsModuleMocks = typeof (test as any).mock?.module === 'function';
if (supportsModuleMocks) {
  (test as any).mock.module('react-native', {
    namedExports: { useColorScheme: () => 'light' },
  });
}

const { CupThreadProvider, useCupThreadContext, nextConfigState, shouldRetryAfterFailure } =
  await import('../src/theme/CupThreadThemeProvider');
type ConfigFetchState = import('../src/theme/CupThreadThemeProvider').ConfigFetchState;

const sampleConfig: PublicAppConfig = {
  appId: 'app_123',
  appKey: 'app_config_test',
  name: 'Test App',
  slug: 'test-app',
  allowPublic: true,
  allowedPlatforms: ['ios', 'android'],
  maxAttachmentBytes: 10485760,
  allowAnonymousRoadmap: true,
  allowAnonymousVote: true,
  allowAnonymousFeedback: true,
  allowAnonymousChangelog: true,
  sdk: {
    theme: 'midnight',
    features: {
      roadmap: true,
      featureRequests: true,
      feedback: true,
      changelog: true,
    },
    changelogOverlay: {
      title: "What's New",
      entryCount: 3,
      primaryButton: 'Got it',
      closeButton: 'Dismiss',
    },
  },
};

// ---------------------------------------------------------------------------
// 1. Pure state machine tests (no React renderer needed)
// ---------------------------------------------------------------------------

test('nextConfigState: success event after start sets appConfig, clears configError, and ends loading', () => {
  const initial: ConfigFetchState = {
    appConfig: null,
    isLoadingConfig: false,
    configError: null,
  };

  const started = nextConfigState(initial, { type: 'start' });
  assert.equal(started.isLoadingConfig, true);
  assert.equal(started.configError, null);
  assert.equal(started.appConfig, null);

  const succeeded = nextConfigState(started, { type: 'success', config: sampleConfig });
  assert.equal(succeeded.isLoadingConfig, false);
  assert.equal(succeeded.configError, null);
  assert.deepEqual(succeeded.appConfig, sampleConfig);
});

test('nextConfigState: failure event sets configError and ends loading while retaining null appConfig', () => {
  const initial: ConfigFetchState = {
    appConfig: null,
    isLoadingConfig: true,
    configError: null,
  };

  const networkErr = new Error('500 Internal Server Error');
  const failed = nextConfigState(initial, { type: 'failure', error: networkErr });

  assert.equal(failed.isLoadingConfig, false);
  assert.equal(failed.configError, networkErr);
  assert.equal(failed.appConfig, null);
});

test('nextConfigState: failure followed by start and success (manual refreshConfig) clears error and sets config', () => {
  const failedState: ConfigFetchState = {
    appConfig: null,
    isLoadingConfig: false,
    configError: new Error('Network unreachable'),
  };

  const restarting = nextConfigState(failedState, { type: 'start' });
  assert.equal(restarting.isLoadingConfig, true);
  assert.equal(restarting.configError, null);

  const succeeded = nextConfigState(restarting, { type: 'success', config: sampleConfig });
  assert.equal(succeeded.isLoadingConfig, false);
  assert.equal(succeeded.configError, null);
  assert.deepEqual(succeeded.appConfig, sampleConfig);
});

test('nextConfigState: abort event keeps configError null and leaves isLoadingConfig unchanged', () => {
  const loadingState: ConfigFetchState = {
    appConfig: null,
    isLoadingConfig: true,
    configError: null,
  };

  const aborted = nextConfigState(loadingState, { type: 'abort' });
  assert.equal(aborted.configError, null);
  assert.equal(aborted.isLoadingConfig, true);
  assert.equal(aborted.appConfig, null);
});

test('shouldRetryAfterFailure: retries exactly once for non-abort failures and never for AbortError', () => {
  const normalError = new Error('Connection reset');
  const typeError = new TypeError('Failed to fetch');
  const abortError = new Error('The operation was aborted');
  abortError.name = 'AbortError';

  // Initial failure (attempt 0): should retry non-abort errors
  assert.equal(shouldRetryAfterFailure(0, normalError), true);
  assert.equal(shouldRetryAfterFailure(0, typeError), true);
  assert.equal(shouldRetryAfterFailure(0, 'string error'), true);

  // Subsequent attempts (attempt >= 1): never retry
  assert.equal(shouldRetryAfterFailure(1, normalError), false);
  assert.equal(shouldRetryAfterFailure(2, normalError), false);

  // AbortError: never retry, even on attempt 0
  assert.equal(shouldRetryAfterFailure(0, abortError), false);
  assert.equal(shouldRetryAfterFailure(1, abortError), false);
});

// ---------------------------------------------------------------------------
// 2. React runtime provider integration tests
// ---------------------------------------------------------------------------

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const renderTestOptions: TestOptions = supportsModuleMocks
  ? {}
  : {
      skip: 'node:test module mocking unavailable (needs Node >= 22.3 with --experimental-test-module-mocks)',
    };

function makeClient(): FeedbackClient {
  return new FeedbackClient({
    baseUrl: 'https://api.cupthread.com',
    appKey: 'app_config_test',
  });
}

async function flush(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    await act(async () => {});
  }
}

type ProbeContext = ReturnType<typeof useCupThreadContext>;

function ConfigProbe({ onUpdate }: { onUpdate: (ctx: ProbeContext) => void }) {
  const ctx = useCupThreadContext();
  useEffect(() => {
    onUpdate(ctx);
  }, [ctx, onUpdate]);
  return null;
}

const originalFetch = globalThis.fetch;
const originalWarn = console.warn;

beforeEach(() => {
  globalThis.fetch = originalFetch;
  console.warn = originalWarn;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  console.warn = originalWarn;
});

test(
  'CupThreadProvider: successful mount config fetch populates appConfig and theme',
  renderTestOptions,
  async () => {
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify(sampleConfig), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    let latestContext: ProbeContext | undefined;
    let renderer: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(
        <CupThreadProvider client={makeClient()} _retryDelayMs={1}>
          <ConfigProbe onUpdate={(ctx) => (latestContext = ctx)} />
        </CupThreadProvider>
      );
    });
    await flush();

    assert.ok(latestContext);
    assert.equal(latestContext.isLoadingConfig, false);
    assert.equal(latestContext.configError, null);
    assert.deepEqual(latestContext.appConfig, sampleConfig);
    assert.equal(latestContext.themeName, 'midnight');

    renderer!.unmount();
  }
);

test(
  'CupThreadProvider: retries once on cold-start failure then surfaces configError and logs warning',
  renderTestOptions,
  async () => {
    let fetchCount = 0;
    const warnings: any[] = [];
    console.warn = (...args: any[]) => {
      warnings.push(args);
    };

    globalThis.fetch = (async () => {
      fetchCount++;
      return new Response(JSON.stringify({ error: 'service unavailable' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    let latestContext: ProbeContext | undefined;
    let renderer: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(
        <CupThreadProvider client={makeClient()} _retryDelayMs={5}>
          <ConfigProbe onUpdate={(ctx) => (latestContext = ctx)} />
        </CupThreadProvider>
      );
    });
    // Wait for initial attempt + retry delay + retry attempt
    await flush(16);

    assert.equal(fetchCount, 2, 'mount must attempt fetch and retry exactly once');
    assert.ok(latestContext);
    assert.equal(latestContext.isLoadingConfig, false);
    assert.equal(latestContext.appConfig, null);
    assert.ok(
      latestContext.configError !== null,
      'configError must be non-null after retry failure'
    );
    assert.equal(latestContext.themeName, 'system', 'falls back to system theme on failure');
    assert.ok(warnings.length >= 1, 'dev console.warn must be logged');
    assert.match(String(warnings[0][0]), /\[CupThread\] Failed to load app config:/);

    renderer!.unmount();
  }
);

test(
  'CupThreadProvider: initial failure followed by successful retry resolves config',
  renderTestOptions,
  async () => {
    let fetchCount = 0;

    globalThis.fetch = (async () => {
      fetchCount++;
      if (fetchCount === 1) {
        return new Response('offline', { status: 500 });
      }
      return new Response(JSON.stringify(sampleConfig), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    let latestContext: ProbeContext | undefined;
    let renderer: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(
        <CupThreadProvider client={makeClient()} _retryDelayMs={5}>
          <ConfigProbe onUpdate={(ctx) => (latestContext = ctx)} />
        </CupThreadProvider>
      );
    });
    await flush(16);

    assert.equal(fetchCount, 2);
    assert.ok(latestContext);
    assert.equal(latestContext.isLoadingConfig, false);
    assert.equal(latestContext.configError, null);
    assert.deepEqual(latestContext.appConfig, sampleConfig);
    assert.equal(latestContext.themeName, 'midnight');

    renderer!.unmount();
  }
);

test(
  'CupThreadProvider: manual refreshConfig recovers from failed state',
  renderTestOptions,
  async () => {
    let fetchShouldFail = true;
    console.warn = () => {};

    globalThis.fetch = (async () => {
      if (fetchShouldFail) {
        return new Response('server down', { status: 503 });
      }
      return new Response(JSON.stringify(sampleConfig), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    let latestContext: ProbeContext | undefined;
    let renderer: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(
        <CupThreadProvider client={makeClient()} _retryDelayMs={5}>
          <ConfigProbe onUpdate={(ctx) => (latestContext = ctx)} />
        </CupThreadProvider>
      );
    });
    await flush(16);

    assert.ok(latestContext);
    assert.ok(latestContext.configError !== null);
    assert.equal(latestContext.appConfig, null);

    // Now fix network and invoke refreshConfig
    fetchShouldFail = false;
    await act(async () => {
      await latestContext!.refreshConfig();
    });
    await flush();

    assert.equal(latestContext!.configError, null, 'refreshConfig must clear previous error');
    assert.equal(latestContext!.isLoadingConfig, false);
    assert.deepEqual(latestContext!.appConfig, sampleConfig);
    assert.equal(latestContext!.themeName, 'midnight');

    renderer!.unmount();
  }
);

test(
  'CupThreadProvider: unmount during retry delay cleans up without setting error',
  renderTestOptions,
  async () => {
    globalThis.fetch = (async () => {
      return new Response('offline', { status: 500 });
    }) as any;

    let latestContext: ProbeContext | undefined;
    let renderer: TestRenderer.ReactTestRenderer;

    await act(async () => {
      renderer = TestRenderer.create(
        <CupThreadProvider client={makeClient()} _retryDelayMs={5000}>
          <ConfigProbe onUpdate={(ctx) => (latestContext = ctx)} />
        </CupThreadProvider>
      );
    });
    // Flush only enough for initial failure, before 5000ms retry delay fires
    await flush(2);

    // Unmount while retry timer is pending
    renderer!.unmount();
    await flush(4);

    // Context at unmount did not set error because retry was pending / aborted
    assert.equal(latestContext?.configError, null);
  }
);
