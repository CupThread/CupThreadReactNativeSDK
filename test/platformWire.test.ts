import test, { type TestOptions } from 'node:test';
import assert from 'node:assert/strict';
import { FeedbackClient } from '../src/client/FeedbackClient';
import {
  resolveAllowedPlatform,
  toWirePlatform,
  type ApiFeedbackPlatform,
} from '../src/utils/platform';
import type { FeedbackPlatform } from '../src/types';

const supportsModuleMocks = typeof (test as any).mock?.module === 'function';

// Mutable shared Platform stub: getRuntimePlatform() require()s react-native
// and reads Platform.OS on every call, so flipping OS here changes what the
// client resolves without re-importing the module per case.
const platformState = { OS: 'ios' };

if (supportsModuleMocks) {
  (test as any).mock.module('react-native', {
    namedExports: {
      Platform: platformState,
    },
  });
}

const runtimeTestOptions: TestOptions = supportsModuleMocks
  ? {}
  : {
      skip: 'node:test module mocking unavailable (needs Node >= 22.3 with --experimental-test-module-mocks)',
    };

/** The platform enum the intake endpoint accepts on the wire. */
const WIRE_ENUM: ApiFeedbackPlatform[] = ['ios', 'macos', 'android', 'universal'];

interface RecordedFeedback {
  body: any;
}

function installFeedbackFetch(): { submissions: RecordedFeedback[]; restore: () => void } {
  const originalFetch = globalThis.fetch;
  const submissions: RecordedFeedback[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const target = url.toString();
    if (target.endsWith('/api/v1/feedback')) {
      submissions.push({
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
      });
      return new Response(JSON.stringify({ submissionId: 'sub_wire_test' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  }) as any;
  return {
    submissions,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

function makeClient(defaultPlatform?: FeedbackPlatform): FeedbackClient {
  return new FeedbackClient({
    baseUrl: 'https://api.cupthread.com',
    appKey: 'app_platform_wire_test',
    ...(defaultPlatform ? { defaultPlatform } : {}),
  });
}

test('toWirePlatform passes wire-valid values through and coerces web to universal', () => {
  assert.equal(toWirePlatform('ios'), 'ios');
  assert.equal(toWirePlatform('macos'), 'macos');
  assert.equal(toWirePlatform('android'), 'android');
  assert.equal(toWirePlatform('universal'), 'universal');
  assert.equal(toWirePlatform('web'), 'universal');
});

test(
  'submit serializes a wire-enum platform for every runtime platform (including web and no-RN fallbacks)',
  runtimeTestOptions,
  async () => {
    // 'unknownos' exercises the default branch, 'windows' an unlisted OS; the
    // plain-Node no-RN fallback is covered by the other suites that run with
    // the require() throwing.
    for (const os of ['ios', 'android', 'macos', 'web', 'windows', 'unknownos']) {
      platformState.OS = os;
      const mocked = installFeedbackFetch();
      try {
        await makeClient().submit({ title: 'Bug', description: 'It broke' });
        assert.equal(mocked.submissions.length, 1, `runtime "${os}" must produce one submission`);
        const payloadPlatform = mocked.submissions[0].body.platform;
        assert.ok(
          WIRE_ENUM.includes(payloadPlatform),
          `runtime "${os}" must serialize to a wire enum value, got "${payloadPlatform}"`
        );
        assert.equal(
          mocked.submissions[0].body.metadata.platform,
          payloadPlatform,
          `runtime "${os}" metadata.platform must match the serialized platform`
        );
      } finally {
        mocked.restore();
      }
    }
  }
);

test(
  'a web runtime submits successfully end-to-end with no draft.platform and no defaultPlatform',
  runtimeTestOptions,
  async () => {
    platformState.OS = 'web';
    const mocked = installFeedbackFetch();
    try {
      const client = makeClient(); // no defaultPlatform configured
      const result = await client.submit({
        title: 'Web bug',
        description: 'Broken on react-native-web',
      });
      assert.ok(result.submissionId, 'the mocked intake must accept the submission');
      assert.equal(
        mocked.submissions[0].body.platform,
        'universal',
        'the web runtime must ship the universal wire value, not "web"'
      );
    } finally {
      mocked.restore();
    }
  }
);

test(
  'an explicit web platform on the draft or in defaultPlatform is coerced at the client boundary',
  runtimeTestOptions,
  async () => {
    platformState.OS = 'ios';
    const mocked = installFeedbackFetch();
    try {
      await makeClient().submit({
        title: 'Draft platform wins',
        description: 'It broke',
        platform: 'web',
      });
      assert.equal(mocked.submissions[0].body.platform, 'universal');

      await makeClient('web').submit({ title: 'Config default', description: 'It broke' });
      assert.equal(mocked.submissions[1].body.platform, 'universal');
    } finally {
      mocked.restore();
    }
  }
);

test('resolveAllowedPlatform never returns a wire-invalid value', () => {
  // Config fetch failed / allowlist absent: the coercion must not depend on
  // the allowlist being configured.
  assert.equal(resolveAllowedPlatform('web', undefined, 'web'), 'universal');
  assert.equal(resolveAllowedPlatform('web', [], 'web'), 'universal');
  assert.equal(resolveAllowedPlatform(undefined, undefined, 'web'), 'universal');

  // Wire-valid values keep passing through untouched.
  assert.equal(resolveAllowedPlatform('ios', undefined, 'universal'), 'ios');
  assert.equal(resolveAllowedPlatform(undefined, undefined, 'android'), 'android');

  // A misconfigured allowlist entry ('web') resolves to its wire-safe form.
  assert.equal(resolveAllowedPlatform(undefined, ['web' as FeedbackPlatform], 'ios'), 'universal');

  // A coerced requested value that is not allowlisted still falls back to the
  // first allowed (wire-safe) entry.
  assert.equal(resolveAllowedPlatform('web', ['ios'], 'android'), 'ios');
});

test('resolveAllowedPlatform matches allowlist entries against their coerced wire values', () => {
  const warnings: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: any[]) => warnings.push(args.join(' '));
  try {
    // A raw 'web' entry in the allowlist means 'universal': a 'web' request
    // must match it instead of falling back to 'ios'.
    assert.equal(resolveAllowedPlatform('web', ['ios', 'web'], 'android'), 'universal');
    assert.equal(warnings.length, 0, 'a matched request must not warn');

    // Same for the fallback when no request is present.
    assert.equal(resolveAllowedPlatform(undefined, ['ios', 'web'], 'web'), 'universal');
    assert.equal(warnings.length, 0, 'a matched fallback must not warn');
  } finally {
    console.warn = origWarn;
  }
});
