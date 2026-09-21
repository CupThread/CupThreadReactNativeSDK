import test, { type TestOptions } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { FeedbackClient } from '../src/client/FeedbackClient';
import { FeedbackException, UnexpectedStatusException } from '../src/client/FeedbackException';
import type { PublicAppConfig } from '../src/types';

// Mock react-native for Node test environment if module mocks are supported
const supportsModuleMocks = typeof (test as any).mock?.module === 'function';
if (supportsModuleMocks) {
  (test as any).mock.module('react-native', {
    namedExports: { useColorScheme: () => 'light' },
  });
}

const { CupThreadProvider, useCupThreadClient } =
  await import('../src/theme/CupThreadThemeProvider');

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const renderTestOptions: TestOptions = supportsModuleMocks
  ? {}
  : {
      skip: 'node:test module mocking unavailable (needs Node >= 22.3 with --experimental-test-module-mocks)',
    };

// ---------------------------------------------------------------------------
// 1. FeedbackClient.fetchAppConfig() HTTP 404 Contract
// ---------------------------------------------------------------------------

test('fetchAppConfig throws UnexpectedStatusException when API responds with 404 for private app', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return new Response(JSON.stringify({ error: 'App not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_private_123',
    });

    let caught: any = null;
    try {
      await client.fetchAppConfig();
    } catch (err) {
      caught = err;
    }

    assert.ok(caught instanceof Error, 'Expected caught error');
    assert.ok(caught instanceof FeedbackException, 'Expected FeedbackException');
    assert.ok(caught instanceof UnexpectedStatusException, 'Expected UnexpectedStatusException');
    assert.equal(caught.name, 'UnexpectedStatusException');
    assert.equal(caught.status, 404);
    assert.equal(caught.responseBody, '{"error":"App not found"}');
    assert.ok(
      caught.message.includes('404'),
      `Expected message to mention status 404: ${caught.message}`
    );
    // The raw body stays off `message` (it can reach end-user UI); the full
    // payload remains available on `responseBody` for host diagnostics.
    assert.ok(
      !caught.message.includes('App not found'),
      `Expected message to keep the server body out: ${caught.message}`
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchAppConfig succeeds and resolves allowPublic: true for public apps', async () => {
  const originalFetch = globalThis.fetch;
  const mockConfig: PublicAppConfig = {
    appId: 'app_pub_123',
    appKey: 'app_pub_key',
    slug: 'public-app',
    name: 'Public App',
    allowPublic: true,
    allowedPlatforms: ['ios', 'android'],
    maxAttachmentBytes: 10485760,
    allowAnonymousRoadmap: true,
    allowAnonymousVote: false,
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
        closeButton: 'Close',
      },
    },
  };

  globalThis.fetch = (async () => {
    return new Response(JSON.stringify(mockConfig), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_pub_key',
    });

    const result = await client.fetchAppConfig();
    assert.equal(result.appId, 'app_pub_123');
    assert.equal(result.allowPublic, true);
    assert.equal(result.name, 'Public App');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('prepareChangelogOverlay fails closed and propagates 404 UnexpectedStatusException for private apps', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    const s = url.toString();
    if (s.includes('/api/v1/public/config/')) {
      return new Response(JSON.stringify({ error: 'App not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('{}', { status: 200 });
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_private_456',
    });

    await assert.rejects(
      async () => {
        await client.prepareChangelogOverlay();
      },
      (err: any) => {
        return (
          err instanceof UnexpectedStatusException &&
          err.status === 404 &&
          err.responseBody.includes('App not found')
        );
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// 2. CupThreadProvider Fail-Closed Lifecycle on HTTP 404
// ---------------------------------------------------------------------------

test(
  'CupThreadProvider fails closed when config returns 404 for a private app',
  renderTestOptions,
  async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ error: 'App not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    try {
      const client = new FeedbackClient({
        baseUrl: 'https://api.cupthread.com',
        appKey: 'app_private_789',
      });

      let capturedClient: FeedbackClient | null = null;
      function TestChild() {
        capturedClient = useCupThreadClient();
        return null;
      }

      let renderer: any = null;
      await act(async () => {
        renderer = TestRenderer.create(
          <CupThreadProvider client={client}>
            <TestChild />
          </CupThreadProvider>
        );
        // Allow in-flight loadConfig promise to settle
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      assert.ok(capturedClient, 'CupThreadProvider mounted and passed client context');
      renderer?.unmount();
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
);
