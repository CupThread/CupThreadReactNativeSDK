import test from 'node:test';
import assert from 'node:assert/strict';
import { FeedbackClient } from '../src/client/FeedbackClient';
import {
  TurnstileRequiredException,
  UnexpectedStatusException,
} from '../src/client/FeedbackException';
import { enStrings, zhHansStrings } from '../src/i18n';

interface InterceptedRequest {
  url: string;
  method: string;
  body: any;
}

/**
 * Stubs global fetch, capturing every request. `responses` are consumed in
 * order (the last one repeats) so retry paths can be exercised.
 */
function stubFetch(responses: Array<{ status: number; body?: string }>) {
  const originalFetch = globalThis.fetch;
  const requests: InterceptedRequest[] = [];
  let call = 0;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const response = responses[Math.min(call, responses.length - 1)];
    call += 1;
    requests.push({
      url: url.toString(),
      method: init?.method || 'GET',
      body: init?.body ? JSON.parse(init.body as string) : null,
    });
    return new Response(response.body ?? '', {
      status: response.status,
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

const TURNSTILE_BODY = '{"error":"Human verification (Turnstile) is required"}';

test('submit attaches draft turnstileToken to the payload', async () => {
  const { requests, restore } = stubFetch([{ status: 200, body: '{"submissionId":"sub_1"}' }]);
  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_key_abc',
    });
    await client.submit({
      title: 'Crash on launch',
      description: 'The app crashes immediately on launch.',
      turnstileToken: 'tok_draft_1234567890',
    });
    assert.equal(requests[0].body.turnstileToken, 'tok_draft_1234567890');
  } finally {
    restore();
  }
});

test('submit omits turnstileToken when absent and no provider is configured', async () => {
  const { requests, restore } = stubFetch([{ status: 200, body: '{"submissionId":"sub_1"}' }]);
  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_key_abc',
    });
    await client.submit({
      title: 'Crash on launch',
      description: 'The app crashes immediately on launch.',
    });
    assert.equal('turnstileToken' in requests[0].body, false);
  } finally {
    restore();
  }
});

test('submit resolves turnstileToken through the configured provider', async () => {
  const { requests, restore } = stubFetch([{ status: 200, body: '{"submissionId":"sub_1"}' }]);
  let providerCalls = 0;
  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_key_abc',
      turnstileTokenProvider: async () => {
        providerCalls += 1;
        return 'tok_provider_1234567890';
      },
    });
    await client.submit({
      title: 'Crash on launch',
      description: 'The app crashes immediately on launch.',
    });
    assert.equal(providerCalls, 1);
    assert.equal(requests[0].body.turnstileToken, 'tok_provider_1234567890');
  } finally {
    restore();
  }
});

test('submit prefers the draft turnstileToken over the provider', async () => {
  const { requests, restore } = stubFetch([{ status: 200, body: '{"submissionId":"sub_1"}' }]);
  let providerCalls = 0;
  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_key_abc',
      turnstileTokenProvider: () => {
        providerCalls += 1;
        return 'tok_provider_1234567890';
      },
    });
    await client.submit({
      title: 'Crash on launch',
      description: 'The app crashes immediately on launch.',
      turnstileToken: 'tok_draft_1234567890',
    });
    assert.equal(providerCalls, 0);
    assert.equal(requests[0].body.turnstileToken, 'tok_draft_1234567890');
  } finally {
    restore();
  }
});

test('submit omits turnstileToken when the provider returns undefined or blank', async () => {
  const { requests, restore } = stubFetch([{ status: 200, body: '{"submissionId":"sub_1"}' }]);
  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_key_abc',
      turnstileTokenProvider: async () => '   ',
    });
    await client.submit({
      title: 'Crash on launch',
      description: 'The app crashes immediately on launch.',
    });
    assert.equal('turnstileToken' in requests[0].body, false);

    const clientNoToken = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_key_abc',
      turnstileTokenProvider: async () => undefined,
    });
    await clientNoToken.submit({
      title: 'Crash on launch',
      description: 'The app crashes immediately on launch.',
    });
    assert.equal('turnstileToken' in requests[1].body, false);
  } finally {
    restore();
  }
});

test('submitFeatureRequest resolves the provider token and honors the draft token', async () => {
  const { requests, restore } = stubFetch([
    { status: 200, body: '{"featureRequestId":"fr_1","pending":false}' },
    { status: 200, body: '{"featureRequestId":"fr_2","pending":false}' },
  ]);
  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_key_abc',
      turnstileTokenProvider: async () => 'tok_provider_1234567890',
    });
    await client.submitFeatureRequest(
      { title: 'Widget support', description: 'Add home screen widgets' },
      'usr_tok_123'
    );
    assert.equal(requests[0].body.turnstileToken, 'tok_provider_1234567890');

    await client.submitFeatureRequest(
      {
        title: 'Widget support',
        description: 'Add home screen widgets',
        turnstileToken: 'tok_draft_1234567890',
      },
      'usr_tok_123'
    );
    assert.equal(requests[1].body.turnstileToken, 'tok_draft_1234567890');
  } finally {
    restore();
  }
});

test('Turnstile 403 error body maps to TurnstileRequiredException on submit', async () => {
  const { restore } = stubFetch([{ status: 403, body: TURNSTILE_BODY }]);
  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_key_abc',
    });
    await assert.rejects(
      client.submit({
        title: 'Crash on launch',
        description: 'The app crashes immediately on launch.',
      }),
      (err: any) => {
        assert.ok(err instanceof TurnstileRequiredException);
        assert.equal(err.name, 'TurnstileRequiredException');
        assert.equal(err.code, 'turnstile_required');
        assert.equal(err.status, 403);
        // The raw server body stays on the exception for host debugging…
        assert.ok(err.responseBody.includes('Turnstile'));
        // …but is never interpolated into the user-facing message.
        assert.ok(!err.message.includes('Human verification (Turnstile) is required'));
        return true;
      }
    );
  } finally {
    restore();
  }
});

test('Machine-readable turnstile failure codes map to TurnstileRequiredException', async () => {
  const { restore } = stubFetch([
    { status: 403, body: '{"code":"turnstile_required"}' },
    { status: 403, body: '{"code":"turnstile_verification_failed"}' },
  ]);
  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_key_abc',
    });
    for (const path of ['first', 'second'] as const) {
      await assert.rejects(
        client.submitFeatureRequest(
          { title: `Widget support ${path}`, description: 'Add home screen widgets' },
          'usr_tok_123'
        ),
        (err: any) => err instanceof TurnstileRequiredException
      );
    }
  } finally {
    restore();
  }
});

test('Non-Turnstile 403 responses keep raising UnexpectedStatusException', async () => {
  const { restore } = stubFetch([{ status: 403, body: '{"error":"Forbidden app key"}' }]);
  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_key_abc',
    });
    await assert.rejects(
      client.submitFeatureRequest(
        { title: 'Widget support', description: 'Add home screen widgets' },
        'usr_tok_123'
      ),
      (err: any) => {
        assert.ok(err instanceof UnexpectedStatusException);
        assert.ok(!(err instanceof TurnstileRequiredException));
        return true;
      }
    );
  } finally {
    restore();
  }
});

test('Retrying after a Turnstile rejection resolves a fresh provider token', async () => {
  const { requests, restore } = stubFetch([
    { status: 403, body: TURNSTILE_BODY },
    { status: 200, body: '{"featureRequestId":"fr_ok","pending":false}' },
  ]);
  const tokens = ['tok_stale_1234567890', 'tok_fresh_1234567890'];
  let providerCalls = 0;
  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_key_abc',
      turnstileTokenProvider: async () => {
        const token = tokens[providerCalls] ?? tokens[tokens.length - 1];
        providerCalls += 1;
        return token;
      },
    });
    const draft = {
      title: 'Widget support',
      description: 'Add home screen widgets',
    };

    await assert.rejects(
      client.submitFeatureRequest(draft, 'usr_tok_123'),
      (err: any) => err instanceof TurnstileRequiredException
    );
    // A second submission attempt re-runs the provider and sends a new token.
    const result = await client.submitFeatureRequest(draft, 'usr_tok_123');
    assert.equal(result.featureRequestId, 'fr_ok');
    assert.equal(providerCalls, 2);
    assert.equal(requests[0].body.turnstileToken, 'tok_stale_1234567890');
    assert.equal(requests[1].body.turnstileToken, 'tok_fresh_1234567890');
  } finally {
    restore();
  }
});

test('verificationRequired copy exists in every shipped locale shape', () => {
  assert.equal(
    enStrings.common.verificationRequired,
    'Human verification is required to submit. Please try again after completing verification.'
  );
  assert.equal(typeof zhHansStrings.common.verificationRequired, 'string');
  assert.ok(zhHansStrings.common.verificationRequired.length > 0);
});
