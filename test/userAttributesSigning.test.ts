import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { FeedbackClient } from '../src/client/FeedbackClient';
import {
  InvalidUserAttributesException,
  InvalidUserAttributesSignatureException,
  RequestTimeoutException,
} from '../src/client/FeedbackException';
import {
  buildUserAttributesCanonicalString,
  canonicalNumber,
  hmacSha256Hex,
  USER_ATTRIBUTES_SIGNATURE_VERSION,
} from '../src/utils/userAttributesSigning';

const APP_KEY = 'app_key_abc';
const USER_TOKEN = 'usr_tok';
const TIMESTAMP = 1_700_000_000;

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
}

function installRecordingFetch(
  responseBody: unknown = { ok: true, updatedAt: '2026-01-01T00:00:00.000Z' }
) {
  const originalFetch = globalThis.fetch;
  const requests: RecordedRequest[] = [];

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({
      url: url.toString(),
      method: init?.method || 'GET',
      headers: (init?.headers || {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
    });
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as any;

  return {
    requests,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

function expectedSignature(secret: string, canonical: string): string {
  return createHmac('sha256', secret).update(canonical, 'utf8').digest('hex');
}

function canonicalFor(values: {
  isPaying?: string;
  plan?: string;
  mrr?: string;
  currency?: string;
  timestamp?: number;
}): string {
  return [
    USER_ATTRIBUTES_SIGNATURE_VERSION,
    APP_KEY,
    USER_TOKEN,
    values.isPaying ?? 'unset',
    values.plan ?? 'unset',
    values.mrr ?? 'unset',
    values.currency ?? 'unset',
    String(values.timestamp ?? TIMESTAMP),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Cryptographic primitives
// ---------------------------------------------------------------------------

test('hmacSha256Hex matches RFC 4231 vectors and Node crypto', () => {
  // RFC 4231 test case 1.
  assert.equal(
    hmacSha256Hex('\x0b'.repeat(20), 'Hi There'),
    'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7'
  );

  // RFC 4231 test case 2.
  assert.equal(
    hmacSha256Hex('Jefe', 'what do ya want for nothing?'),
    '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843'
  );

  const cases = [
    { secret: '', message: '' },
    { secret: 'key', message: 'The quick brown fox jumps over the lazy dog' },
    { secret: 's'.repeat(100), message: 'long key falls back to SHA-256(key)' },
    { secret: '中文密钥', message: '多字节消息 🚀' },
    { secret: 'line\r\nbreaks', message: 'message\nwith\nnewlines' },
  ];
  for (const { secret, message } of cases) {
    assert.equal(
      hmacSha256Hex(secret, message),
      expectedSignature(secret, message),
      `HMAC mismatch for ${JSON.stringify({ secret, message })}`
    );
  }
});

test('canonicalNumber mirrors the server toFixed(2) stripping', () => {
  assert.equal(canonicalNumber(1200), '1200');
  assert.equal(canonicalNumber(99.5), '99.5');
  assert.equal(canonicalNumber(29.99), '29.99');
  assert.equal(canonicalNumber(0), '0');
  assert.equal(canonicalNumber(-0), '0');
  assert.equal(canonicalNumber(12.34), '12.34');
  // Exact binary values decide the rounding: 9.995 is stored just below the
  // half-way point, while 1200.005 is stored just above it.
  assert.equal(canonicalNumber(9.995), '9.99');
  assert.equal(canonicalNumber(1200.005), '1200.01');
  assert.equal(canonicalNumber(1.125), '1.13');
  assert.equal(canonicalNumber(-1.125), '-1.13');
  assert.equal(canonicalNumber(-0.004), '-0');
  assert.throws(() => canonicalNumber(Number.NaN), InvalidUserAttributesException);
  assert.throws(() => canonicalNumber(Number.POSITIVE_INFINITY), InvalidUserAttributesException);
});

// ---------------------------------------------------------------------------
// Canonical string
// ---------------------------------------------------------------------------

test('buildUserAttributesCanonicalString pins the wire format', () => {
  assert.equal(
    buildUserAttributesCanonicalString({
      appKey: APP_KEY,
      userToken: USER_TOKEN,
      isPaying: true,
      plan: 'Pro Annual',
      mrr: 1200,
      currency: 'USD',
      timestamp: TIMESTAMP,
    }),
    [
      'cpt-user-attrs-v1',
      APP_KEY,
      USER_TOKEN,
      'true',
      'Pro Annual',
      '1200',
      'USD',
      String(TIMESTAMP),
    ].join('\n')
  );
});

test('canonical string distinguishes absent fields from explicit nulls', () => {
  const absent = buildUserAttributesCanonicalString({
    appKey: APP_KEY,
    userToken: USER_TOKEN,
    timestamp: TIMESTAMP,
  });
  assert.equal(
    absent,
    ['cpt-user-attrs-v1', APP_KEY, USER_TOKEN, 'unset', 'unset', 'unset', 'unset', TIMESTAMP].join(
      '\n'
    )
  );

  const explicitNulls = buildUserAttributesCanonicalString({
    appKey: APP_KEY,
    userToken: USER_TOKEN,
    isPaying: null,
    plan: null,
    mrr: null,
    currency: null,
    timestamp: TIMESTAMP,
  });
  assert.equal(
    explicitNulls,
    ['cpt-user-attrs-v1', APP_KEY, USER_TOKEN, 'null', 'null', 'null', 'null', TIMESTAMP].join('\n')
  );
});

test('canonical string signs currency exactly as sent', () => {
  const canonical = buildUserAttributesCanonicalString({
    appKey: APP_KEY,
    userToken: USER_TOKEN,
    currency: 'usd',
    timestamp: TIMESTAMP,
  });
  assert.ok(canonical.endsWith('\nunset\nusd\n1700000000'));
});

test('canonical string rejects non-integer or negative timestamps', () => {
  for (const timestamp of [1.5, -1, Number.NaN]) {
    assert.throws(
      () =>
        buildUserAttributesCanonicalString({
          appKey: APP_KEY,
          userToken: USER_TOKEN,
          timestamp,
        }),
      InvalidUserAttributesException
    );
  }
});

// ---------------------------------------------------------------------------
// FeedbackClient integration
// ---------------------------------------------------------------------------

test('updateUserAttributes signs payment attributes with the configured secret', async () => {
  const recorder = installRecordingFetch();
  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: APP_KEY,
      signingSecret: 'super-secret',
    });

    await client.updateUserAttributes({
      userToken: USER_TOKEN,
      isPaying: true,
      plan: '  Pro Annual  ',
      mrr: 29.99,
      currency: ' USD ',
      timestamp: TIMESTAMP,
    });

    assert.equal(recorder.requests.length, 1);
    const request = recorder.requests[0];
    assert.equal(request.url, `https://api.cupthread.com/api/v1/public/apps/${APP_KEY}/user`);
    assert.equal(request.method, 'PUT');
    assert.equal(request.headers['X-User-Token'], USER_TOKEN);

    const canonical = canonicalFor({
      isPaying: 'true',
      plan: 'Pro Annual',
      mrr: '29.99',
      currency: 'USD',
    });
    assert.deepEqual(request.body, {
      isPaying: true,
      plan: 'Pro Annual',
      mrr: 29.99,
      currency: 'USD',
      signature: expectedSignature('super-secret', canonical),
      timestamp: TIMESTAMP,
    });
  } finally {
    recorder.restore();
  }
});

test('currency-only writes count as payment attributes and are signed', async () => {
  const recorder = installRecordingFetch();
  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: APP_KEY,
      signingSecret: 'super-secret',
    });

    await client.updateUserAttributes({
      userToken: USER_TOKEN,
      currency: 'eur',
      timestamp: TIMESTAMP,
    });

    const canonical = canonicalFor({ currency: 'eur' });
    assert.deepEqual(recorder.requests[0].body, {
      currency: 'eur',
      signature: expectedSignature('super-secret', canonical),
      timestamp: TIMESTAMP,
    });
  } finally {
    recorder.restore();
  }
});

test('identity-only writes stay unsigned even when a secret is configured', async () => {
  const recorder = installRecordingFetch();
  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: APP_KEY,
      signingSecret: 'super-secret',
    });

    await client.updateUserAttributes({ userToken: USER_TOKEN, timestamp: TIMESTAMP });

    assert.equal(recorder.requests.length, 1);
    assert.deepEqual(recorder.requests[0].body, {});
    assert.equal(recorder.requests[0].headers['X-User-Token'], USER_TOKEN);
  } finally {
    recorder.restore();
  }
});

test('explicit nulls are sent and signed as null', async () => {
  const recorder = installRecordingFetch();
  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: APP_KEY,
      signingSecret: 'super-secret',
    });

    await client.updateUserAttributes({
      userToken: USER_TOKEN,
      isPaying: null,
      plan: null,
      mrr: null,
      currency: null,
      timestamp: TIMESTAMP,
    });

    const canonical = canonicalFor({
      isPaying: 'null',
      plan: 'null',
      mrr: 'null',
      currency: 'null',
    });
    assert.deepEqual(recorder.requests[0].body, {
      isPaying: null,
      plan: null,
      mrr: null,
      currency: null,
      signature: expectedSignature('super-secret', canonical),
      timestamp: TIMESTAMP,
    });
  } finally {
    recorder.restore();
  }
});

test('payment attributes without a secret are sent unsigned for the server to reject', async () => {
  const recorder = installRecordingFetch();
  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: APP_KEY,
    });

    await client.updateUserAttributes({
      userToken: USER_TOKEN,
      isPaying: true,
      timestamp: TIMESTAMP,
    });

    assert.equal(recorder.requests.length, 1);
    assert.deepEqual(recorder.requests[0].body, { isPaying: true });
  } finally {
    recorder.restore();
  }
});

test('the userAttributesSigner provider produces the signature that is sent', async () => {
  const recorder = installRecordingFetch();
  try {
    const providerSignature = 'a'.repeat(64);
    const seen: Array<{ canonicalString: string; arguments: unknown }> = [];
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: APP_KEY,
      signingSecret: 'embedded-secret-is-ignored',
      userAttributesSigner: async (request) => {
        seen.push(request);
        return { signature: providerSignature, timestamp: request.arguments.timestamp };
      },
    });

    await client.updateUserAttributes({
      userToken: USER_TOKEN,
      isPaying: true,
      plan: 'Pro',
      mrr: 5,
      timestamp: TIMESTAMP,
    });

    const canonical = canonicalFor({ isPaying: 'true', plan: 'Pro', mrr: '5' });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].canonicalString, canonical);
    assert.deepEqual(seen[0].arguments, {
      appKey: APP_KEY,
      userToken: USER_TOKEN,
      isPaying: true,
      plan: 'Pro',
      mrr: 5,
      currency: undefined,
      timestamp: TIMESTAMP,
    });
    assert.deepEqual(recorder.requests[0].body, {
      isPaying: true,
      plan: 'Pro',
      mrr: 5,
      signature: providerSignature,
      timestamp: TIMESTAMP,
    });
  } finally {
    recorder.restore();
  }
});

test('a provider that declines falls back to the embedded secret', async () => {
  const recorder = installRecordingFetch();
  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: APP_KEY,
      signingSecret: 'embedded-secret',
      userAttributesSigner: () => null,
    });

    await client.updateUserAttributes({
      userToken: USER_TOKEN,
      isPaying: false,
      timestamp: TIMESTAMP,
    });

    const canonical = canonicalFor({ isPaying: 'false' });
    assert.equal(
      recorder.requests[0].body.signature,
      expectedSignature('embedded-secret', canonical)
    );
  } finally {
    recorder.restore();
  }
});

test('a per-call signingSecret overrides the configured one', async () => {
  const recorder = installRecordingFetch();
  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: APP_KEY,
      signingSecret: 'configured-secret',
    });

    await client.updateUserAttributes({
      userToken: USER_TOKEN,
      isPaying: true,
      signingSecret: 'per-call-secret',
      timestamp: TIMESTAMP,
    });

    const canonical = canonicalFor({ isPaying: 'true' });
    assert.equal(
      recorder.requests[0].body.signature,
      expectedSignature('per-call-secret', canonical)
    );
  } finally {
    recorder.restore();
  }
});

test('malformed provider signatures fail before any request', async () => {
  const recorder = installRecordingFetch();
  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: APP_KEY,
      userAttributesSigner: () => ({ signature: 'not-hex', timestamp: TIMESTAMP }),
    });

    await assert.rejects(
      () =>
        client.updateUserAttributes({
          userToken: USER_TOKEN,
          isPaying: true,
          timestamp: TIMESTAMP,
        }),
      InvalidUserAttributesSignatureException
    );
    assert.equal(recorder.requests.length, 0);
  } finally {
    recorder.restore();
  }
});

test('a provider timestamp that does not match the canonical string fails locally', async () => {
  const recorder = installRecordingFetch();
  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: APP_KEY,
      userAttributesSigner: () => ({ signature: 'b'.repeat(64), timestamp: TIMESTAMP + 1 }),
    });

    await assert.rejects(
      () =>
        client.updateUserAttributes({
          userToken: USER_TOKEN,
          isPaying: true,
          timestamp: TIMESTAMP,
        }),
      InvalidUserAttributesSignatureException
    );
    assert.equal(recorder.requests.length, 0);
  } finally {
    recorder.restore();
  }
});

test('a non-finite mrr fails before any request', async () => {
  const recorder = installRecordingFetch();
  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: APP_KEY,
      signingSecret: 'super-secret',
    });

    await assert.rejects(
      () =>
        client.updateUserAttributes({
          userToken: USER_TOKEN,
          mrr: Number.NaN,
          timestamp: TIMESTAMP,
        }),
      InvalidUserAttributesException
    );
    assert.equal(recorder.requests.length, 0);
  } finally {
    recorder.restore();
  }
});

test('a provider that ignores the abort signal cannot outlive the operation timeout', async () => {
  const recorder = installRecordingFetch();
  try {
    let providerSignal: AbortSignal | undefined;
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: APP_KEY,
      userAttributesSigner: (request) => {
        providerSignal = request.signal;
        return new Promise(() => {});
      },
    });

    await assert.rejects(
      () =>
        client.updateUserAttributes({
          userToken: USER_TOKEN,
          isPaying: true,
          timestamp: TIMESTAMP,
          timeoutMs: 25,
        }),
      (err: any) => {
        assert.ok(err instanceof RequestTimeoutException);
        assert.equal(err.timeoutMs, 25);
        return true;
      }
    );

    assert.equal(recorder.requests.length, 0);
    assert.equal(providerSignal?.aborted, true);
  } finally {
    recorder.restore();
  }
});

test('the caller signal aborts an uncooperative signer and is forwarded to the provider', async () => {
  const recorder = installRecordingFetch();
  try {
    const controller = new AbortController();
    let markProviderStarted!: () => void;
    const providerStarted = new Promise<void>((resolve) => {
      markProviderStarted = resolve;
    });
    let providerSignal: AbortSignal | undefined;
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: APP_KEY,
      userAttributesSigner: (request) => {
        providerSignal = request.signal;
        markProviderStarted();
        return new Promise(() => {});
      },
    });

    const pending = client.updateUserAttributes({
      userToken: USER_TOKEN,
      isPaying: true,
      timestamp: TIMESTAMP,
      signal: controller.signal,
    });
    await providerStarted;
    controller.abort();

    await assert.rejects(pending, (err: any) => err.name === 'AbortError');
    assert.equal(recorder.requests.length, 0);
    assert.equal(providerSignal?.aborted, true);
  } finally {
    recorder.restore();
  }
});

test('a pre-aborted signal rejects before invoking the provider', async () => {
  const recorder = installRecordingFetch();
  try {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: APP_KEY,
      userAttributesSigner: () => {
        calls += 1;
        return { signature: 'a'.repeat(64), timestamp: TIMESTAMP };
      },
    });

    await assert.rejects(
      () =>
        client.updateUserAttributes({
          userToken: USER_TOKEN,
          isPaying: true,
          timestamp: TIMESTAMP,
          signal: controller.signal,
        }),
      (err: any) => err.name === 'AbortError'
    );
    assert.equal(calls, 0);
    assert.equal(recorder.requests.length, 0);
  } finally {
    recorder.restore();
  }
});

test('the signature timestamp defaults to the current epoch seconds', async () => {
  const recorder = installRecordingFetch();
  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: APP_KEY,
      signingSecret: 'super-secret',
    });

    const before = Math.floor(Date.now() / 1000);
    await client.updateUserAttributes({ userToken: USER_TOKEN, isPaying: true });
    const after = Math.floor(Date.now() / 1000);

    const timestamp = recorder.requests[0].body.timestamp;
    assert.ok(Number.isInteger(timestamp));
    assert.ok(timestamp >= before && timestamp <= after);
    assert.equal(recorder.requests[0].body.signature.length, 64);
  } finally {
    recorder.restore();
  }
});
