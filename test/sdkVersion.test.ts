import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FeedbackClient } from '../src/client/FeedbackClient';
import { SDK_VERSION } from '../src/generated/version';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
}

/**
 * Records every outgoing request and answers the endpoints these tests touch:
 * app config, feature-request intake, feedback intake, and the two upload
 * steps (session creation plus one slot).
 */
function installRecordingFetch() {
  const originalFetch = globalThis.fetch;
  const requests: RecordedRequest[] = [];

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const target = url.toString();
    requests.push({
      url: target,
      method: init?.method || 'GET',
      headers: (init?.headers || {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
    });

    if (target.endsWith('/api/v1/uploads/sessions')) {
      return new Response(
        JSON.stringify({
          session: {
            sessionId: 'ups_1',
            sessionToken: 'cpt_up_session_token',
            expiresAt: '2026-10-23T13:00:00.000Z',
            maxFileSizeBytes: 10485760,
            maxFiles: 8,
          },
          files: [
            {
              clientFileId: 'screenshot.png',
              uploadId: 'upl_1',
              uploadUrl: '/api/v1/uploads/upl_1',
              maxSizeBytes: 10485760,
            },
          ],
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (target.endsWith('/api/v1/uploads/upl_1')) {
      return new Response(
        JSON.stringify({
          uploadId: 'upl_1',
          filename: 'screenshot.png',
          contentType: 'image/png',
          sizeBytes: 10,
          stored: true,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (target.endsWith('/api/v1/feedback')) {
      return new Response(JSON.stringify({ submissionId: 'sub_1', forwardedToGithub: false }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (target.endsWith('/api/v1/feature-requests')) {
      return new Response(JSON.stringify({ featureRequestId: 'fr_1', pending: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ appKey: 'app_key_abc', name: 'Test app' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as any;

  return {
    requests,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

function makeClient(): FeedbackClient {
  return new FeedbackClient({
    baseUrl: 'https://api.cupthread.com',
    appKey: 'app_key_abc',
    defaultPlatform: 'ios',
  });
}

test('SDK_VERSION is the package.json version and is exported from the root', () => {
  assert.equal(SDK_VERSION, pkg.version);

  // The root entry pulls in React Native components, so assert the re-export
  // statically instead of importing it in the Node test runner.
  const indexSource = readFileSync(path.join(ROOT, 'src', 'index.ts'), 'utf8');
  assert.match(
    indexSource,
    /export \{ SDK_VERSION \} from '\.\/generated\/version';/,
    'the package root must re-export SDK_VERSION for host telemetry'
  );
});

test('every request carries X-SDK-Version, including GET, JSON POST, and upload traffic', async () => {
  const mocked = installRecordingFetch();

  try {
    const client = makeClient();

    await client.fetchAppConfig();
    await client.submitFeatureRequest({ title: 'Dark mode', description: 'Please' }, 'usr_token');
    await client.uploadAttachment({
      file: new Blob(['0123456789'], { type: 'image/png' }),
      filename: 'screenshot.png',
      mimeType: 'image/png',
      userToken: 'usr_token',
    });

    assert.equal(mocked.requests.length, 4, 'config, feature request, session, and slot');
    for (const request of mocked.requests) {
      assert.equal(
        request.headers['X-SDK-Version'],
        pkg.version,
        `${request.method} ${request.url} must identify the SDK version`
      );
    }

    const slot = mocked.requests.find((request) => request.url.endsWith('/api/v1/uploads/upl_1'));
    assert.ok(slot, 'the multipart slot upload must be exercised');
    assert.equal(slot.headers['X-SDK-Version'], pkg.version);
  } finally {
    mocked.restore();
  }
});

test('submit reports sdkVersion next to the stable sdk identifier', async () => {
  const mocked = installRecordingFetch();

  try {
    await makeClient().submit({ title: 'Bug', description: 'It broke' });

    const submission = mocked.requests.find((request) => request.url.endsWith('/api/v1/feedback'));
    assert.ok(submission, 'the feedback submission must be recorded');
    assert.equal(submission.body.metadata.sdk, 'cupthread-react-native');
    assert.equal(submission.body.metadata.sdkVersion, pkg.version);
  } finally {
    mocked.restore();
  }
});

test('SDK-owned metadata wins over host-supplied sdk fields', async () => {
  const mocked = installRecordingFetch();

  try {
    await makeClient().submit({
      title: 'Bug',
      description: 'It broke',
      metadata: { sdk: 'host-override', sdkVersion: '9.9.9', traceId: 'trace-1' },
    });

    const submission = mocked.requests.find((request) => request.url.endsWith('/api/v1/feedback'));
    assert.ok(submission);
    assert.equal(submission.body.metadata.sdk, 'cupthread-react-native');
    assert.equal(submission.body.metadata.sdkVersion, pkg.version);
    assert.equal(submission.body.metadata.traceId, 'trace-1', 'other host metadata survives');
  } finally {
    mocked.restore();
  }
});
