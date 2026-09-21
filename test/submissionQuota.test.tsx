import test, { type TestOptions } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { FeedbackClient } from '../src/client/FeedbackClient';
import {
  FeedbackException,
  InactiveSubscriptionException,
  PaymentRequiredException,
  QuotaExceededException,
  TurnstileRequiredException,
  UnexpectedStatusException,
} from '../src/client/FeedbackException';
import {
  deStrings,
  enStrings,
  esStrings,
  frStrings,
  itStrings,
  jaStrings,
  koStrings,
  noStrings,
  plStrings,
  ptStrings,
  trStrings,
  viStrings,
  zhHansStrings,
  zhHantStrings,
} from '../src/i18n';

// ---------------------------------------------------------------------------
// 1. Exception Hierarchy & Properties
// ---------------------------------------------------------------------------

test('PaymentRequiredException inherits from FeedbackException and carries status 402', () => {
  const err = new PaymentRequiredException('Payment required', 'custom_code', '{"error":"test"}');
  assert.ok(err instanceof Error);
  assert.ok(err instanceof FeedbackException);
  assert.ok(err instanceof PaymentRequiredException);
  assert.equal(err.name, 'PaymentRequiredException');
  assert.equal(err.status, 402);
  assert.equal(err.code, 'custom_code');
  assert.equal(err.message, 'Payment required');
  assert.equal(err.responseBody, '{"error":"test"}');
});

test('PaymentRequiredException provides sensible defaults', () => {
  const err = new PaymentRequiredException();
  assert.equal(err.status, 402);
  assert.equal(err.message, 'Payment required.');
  assert.equal(err.code, undefined);
  assert.equal(err.responseBody, '');
});

test('QuotaExceededException inherits from PaymentRequiredException with tier_limit_submissions code', () => {
  const err = new QuotaExceededException(
    'Monthly quota reached',
    '{"code":"tier_limit_submissions"}'
  );
  assert.ok(err instanceof Error);
  assert.ok(err instanceof FeedbackException);
  assert.ok(err instanceof PaymentRequiredException);
  assert.ok(err instanceof QuotaExceededException);
  assert.equal(err.name, 'QuotaExceededException');
  assert.equal(err.status, 402);
  assert.equal(err.code, 'tier_limit_submissions');
  assert.equal(err.message, 'Monthly quota reached');
  assert.equal(err.responseBody, '{"code":"tier_limit_submissions"}');
});

test('QuotaExceededException provides default message when omitted', () => {
  const err = new QuotaExceededException();
  assert.equal(err.code, 'tier_limit_submissions');
  assert.equal(err.message, 'Monthly submission quota reached for this workspace.');
});

test('InactiveSubscriptionException inherits from PaymentRequiredException with subscription_inactive code', () => {
  const err = new InactiveSubscriptionException(
    'Subscription inactive',
    '{"code":"subscription_inactive"}'
  );
  assert.ok(err instanceof Error);
  assert.ok(err instanceof FeedbackException);
  assert.ok(err instanceof PaymentRequiredException);
  assert.ok(err instanceof InactiveSubscriptionException);
  assert.equal(err.name, 'InactiveSubscriptionException');
  assert.equal(err.status, 402);
  assert.equal(err.code, 'subscription_inactive');
  assert.equal(err.message, 'Subscription inactive');
  assert.equal(err.responseBody, '{"code":"subscription_inactive"}');
});

test('InactiveSubscriptionException provides default message when omitted', () => {
  const err = new InactiveSubscriptionException();
  assert.equal(err.code, 'subscription_inactive');
  assert.equal(err.message, 'Workspace subscription is inactive or canceled.');
});

// ---------------------------------------------------------------------------
// 2. Client HTTP 402 Mapping: submitFeatureRequest
// ---------------------------------------------------------------------------

function stubFetch(responses: Array<{ status: number; body?: string }>) {
  const originalFetch = globalThis.fetch;
  let call = 0;
  globalThis.fetch = (async (_url: string | URL | Request, _init?: RequestInit) => {
    const response = responses[Math.min(call, responses.length - 1)];
    call += 1;
    return new Response(response.body ?? '', {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as any;
  return {
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

test('submitFeatureRequest maps HTTP 402 with tier_limit_submissions to QuotaExceededException', async () => {
  const rawBody = JSON.stringify({
    error: 'The workspace has reached its monthly submission quota',
    code: 'tier_limit_submissions',
  });
  const { restore } = stubFetch([{ status: 402, body: rawBody }]);
  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_test_quota',
    });
    await assert.rejects(
      client.submitFeatureRequest(
        { title: 'Dark mode', description: 'Add dark mode' },
        'user_token_123'
      ),
      (err: any) => {
        assert.ok(err instanceof QuotaExceededException);
        assert.ok(err instanceof PaymentRequiredException);
        assert.equal(err.name, 'QuotaExceededException');
        assert.equal(err.status, 402);
        assert.equal(err.code, 'tier_limit_submissions');
        assert.equal(err.message, 'The workspace has reached its monthly submission quota');
        assert.equal(err.responseBody, rawBody);
        return true;
      }
    );
  } finally {
    restore();
  }
});

test('submitFeatureRequest maps HTTP 402 with subscription_inactive to InactiveSubscriptionException', async () => {
  const rawBody = JSON.stringify({
    error: 'The workspace subscription is inactive or canceled',
    code: 'subscription_inactive',
  });
  const { restore } = stubFetch([{ status: 402, body: rawBody }]);
  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_test_quota',
    });
    await assert.rejects(
      client.submitFeatureRequest(
        { title: 'Dark mode', description: 'Add dark mode' },
        'user_token_123'
      ),
      (err: any) => {
        assert.ok(err instanceof InactiveSubscriptionException);
        assert.ok(err instanceof PaymentRequiredException);
        assert.equal(err.name, 'InactiveSubscriptionException');
        assert.equal(err.status, 402);
        assert.equal(err.code, 'subscription_inactive');
        assert.equal(err.message, 'The workspace subscription is inactive or canceled');
        assert.equal(err.responseBody, rawBody);
        return true;
      }
    );
  } finally {
    restore();
  }
});

test('submitFeatureRequest maps HTTP 402 with unknown or missing code to PaymentRequiredException', async () => {
  const rawBody = JSON.stringify({
    error: 'Custom payment required notice',
    code: 'custom_billing_hold',
  });
  const { restore } = stubFetch([{ status: 402, body: rawBody }]);
  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_test_quota',
    });
    await assert.rejects(
      client.submitFeatureRequest(
        { title: 'Dark mode', description: 'Add dark mode' },
        'user_token_123'
      ),
      (err: any) => {
        assert.ok(err instanceof PaymentRequiredException);
        assert.ok(!(err instanceof QuotaExceededException));
        assert.ok(!(err instanceof InactiveSubscriptionException));
        assert.equal(err.name, 'PaymentRequiredException');
        assert.equal(err.status, 402);
        assert.equal(err.code, 'custom_billing_hold');
        assert.equal(err.message, 'Custom payment required notice');
        assert.equal(err.responseBody, rawBody);
        return true;
      }
    );
  } finally {
    restore();
  }
});

test('submitFeatureRequest falls back to default message when 402 error field is missing', async () => {
  const rawBody = JSON.stringify({ code: 'tier_limit_submissions' });
  const { restore } = stubFetch([{ status: 402, body: rawBody }]);
  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_test_quota',
    });
    await assert.rejects(
      client.submitFeatureRequest(
        { title: 'Dark mode', description: 'Add dark mode' },
        'user_token_123'
      ),
      (err: any) => {
        assert.ok(err instanceof QuotaExceededException);
        assert.equal(err.message, 'Monthly submission quota reached for this workspace.');
        return true;
      }
    );
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// 3. Client HTTP 402 Mapping: submit (feedback)
// ---------------------------------------------------------------------------

test('submit (feedback) maps HTTP 402 with tier_limit_submissions to QuotaExceededException', async () => {
  const rawBody = JSON.stringify({
    error: 'Monthly quota reached for feedback',
    code: 'tier_limit_submissions',
  });
  const { restore } = stubFetch([{ status: 402, body: rawBody }]);
  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_test_quota',
    });
    await assert.rejects(
      client.submit({
        title: 'Bug report',
        description: 'App crashed on button click',
      }),
      (err: any) => {
        assert.ok(err instanceof QuotaExceededException);
        assert.equal(err.status, 402);
        assert.equal(err.code, 'tier_limit_submissions');
        assert.equal(err.message, 'Monthly quota reached for feedback');
        return true;
      }
    );
  } finally {
    restore();
  }
});

test('submit (feedback) maps HTTP 402 with subscription_inactive to InactiveSubscriptionException', async () => {
  const rawBody = JSON.stringify({
    error: 'Subscription expired',
    code: 'subscription_inactive',
  });
  const { restore } = stubFetch([{ status: 402, body: rawBody }]);
  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_test_quota',
    });
    await assert.rejects(
      client.submit({
        title: 'Bug report',
        description: 'App crashed on button click',
      }),
      (err: any) => {
        assert.ok(err instanceof InactiveSubscriptionException);
        assert.equal(err.status, 402);
        assert.equal(err.code, 'subscription_inactive');
        assert.equal(err.message, 'Subscription expired');
        return true;
      }
    );
  } finally {
    restore();
  }
});

test('non-402 error statuses on intake still raise their designated exceptions', async () => {
  const client = new FeedbackClient({
    baseUrl: 'https://api.cupthread.com',
    appKey: 'app_test_quota',
  });

  // 401
  const stub401 = stubFetch([{ status: 401, body: '{"error":"Unauthorized"}' }]);
  await assert.rejects(
    client.submitFeatureRequest({ title: 'T', description: 'D' }, 'tok'),
    (err: any) => err.name === 'AuthenticationRequiredException'
  );
  stub401.restore();

  // 403 Turnstile
  const stubTurnstile = stubFetch([
    { status: 403, body: '{"code":"turnstile_required","error":"Turnstile required"}' },
  ]);
  await assert.rejects(
    client.submitFeatureRequest({ title: 'T', description: 'D' }, 'tok'),
    (err: any) => err instanceof TurnstileRequiredException
  );
  stubTurnstile.restore();

  // 403 Generic
  const stub403 = stubFetch([{ status: 403, body: '{"error":"Forbidden"}' }]);
  await assert.rejects(
    client.submitFeatureRequest({ title: 'T', description: 'D' }, 'tok'),
    (err: any) => err instanceof UnexpectedStatusException && err.status === 403
  );
  stub403.restore();

  // 500
  const stub500 = stubFetch([{ status: 500, body: 'Internal server error' }]);
  await assert.rejects(
    client.submitFeatureRequest({ title: 'T', description: 'D' }, 'tok'),
    (err: any) => err instanceof UnexpectedStatusException && err.status === 500
  );
  stub500.restore();
});

// ---------------------------------------------------------------------------
// 4. Localized Strings Coverage
// ---------------------------------------------------------------------------

test('quotaExceeded and subscriptionInactive exist in all 14 shipped locale shapes', () => {
  const allLocales = [
    { name: 'en', dict: enStrings },
    { name: 'de', dict: deStrings },
    { name: 'es', dict: esStrings },
    { name: 'fr', dict: frStrings },
    { name: 'it', dict: itStrings },
    { name: 'ja', dict: jaStrings },
    { name: 'ko', dict: koStrings },
    { name: 'no', dict: noStrings },
    { name: 'pl', dict: plStrings },
    { name: 'pt', dict: ptStrings },
    { name: 'tr', dict: trStrings },
    { name: 'vi', dict: viStrings },
    { name: 'zhHans', dict: zhHansStrings },
    { name: 'zhHant', dict: zhHantStrings },
  ];

  for (const { name, dict } of allLocales) {
    assert.equal(
      typeof dict.common.quotaExceeded,
      'string',
      `expected quotaExceeded string in locale ${name}`
    );
    assert.ok(
      (dict.common.quotaExceeded?.length ?? 0) > 0,
      `expected non-empty quotaExceeded in locale ${name}`
    );

    assert.equal(
      typeof dict.common.subscriptionInactive,
      'string',
      `expected subscriptionInactive string in locale ${name}`
    );
    assert.ok(
      (dict.common.subscriptionInactive?.length ?? 0) > 0,
      `expected non-empty subscriptionInactive in locale ${name}`
    );
  }
});

// ---------------------------------------------------------------------------
// 5. Component UI Error Surfacing Tests
// ---------------------------------------------------------------------------

const supportsModuleMocks = typeof (test as any).mock?.module === 'function';

const alertCalls: any[][] = [];
const touchableOpacityProps: any[] = [];

const TouchableOpacityStub = (props: any) => {
  touchableOpacityProps.push(props);
  return props.children ?? null;
};

if (supportsModuleMocks) {
  (test as any).mock.module('react-native', {
    namedExports: {
      useColorScheme: () => 'light',
      View: ({ children }: any) => children ?? null,
      Text: ({ children }: any) => children ?? null,
      TextInput: () => null,
      TouchableOpacity: TouchableOpacityStub,
      ActivityIndicator: () => null,
      ScrollView: ({ children }: any) => children ?? null,
      Modal: ({ children }: any) => children ?? null,
      SafeAreaView: ({ children }: any) => children ?? null,
      StyleSheet: { create: (styles: any) => styles, flatten: (s: any) => s },
      Alert: { alert: (...args: any[]) => alertCalls.push(args) },
    },
  });
}

const { CupThreadProvider } = await import('../src/theme/CupThreadThemeProvider');
const { FeatureRequestComposeSheet } = await import('../src/components/FeatureRequestComposeSheet');
const { FeedbackComposer } = await import('../src/components/FeedbackComposer');

const renderTestOptions: TestOptions = supportsModuleMocks
  ? {}
  : {
      skip: 'node:test module mocking unavailable (needs Node >= 22.3 with --experimental-test-module-mocks)',
    };

async function flush(times = 8): Promise<void> {
  for (let i = 0; i < times; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2));
    await act(async () => {});
  }
}

test(
  'FeatureRequestComposeSheet displays localized quota error and preserves draft on QuotaExceededException',
  renderTestOptions,
  async () => {
    alertCalls.length = 0;
    touchableOpacityProps.length = 0;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const target = url.toString();
      if (target.includes('/api/v1/feature-requests') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            error: 'The workspace has reached its monthly submission quota',
            code: 'tier_limit_submissions',
          }),
          { status: 402, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('not found', { status: 404 });
    }) as any;

    try {
      const client = new FeedbackClient({
        baseUrl: 'https://api.cupthread.com',
        appKey: 'app_test_sheet_quota',
      });

      let submitted = false;
      let closed = false;

      let renderer!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        renderer = TestRenderer.create(
          React.createElement(CupThreadProvider, {
            client,
            userToken: 'usr_tok_test',
            children: React.createElement(FeatureRequestComposeSheet, {
              initialDraft: { title: 'Great Idea', description: 'Detailed feature description' },
              onSubmitSuccess: () => {
                submitted = true;
              },
              onClose: () => {
                closed = true;
              },
            }),
          })
        );
      });
      await flush();

      // Submit button is the last pressable
      const buttons = renderer.root.findAll(
        (node) => node.type === TouchableOpacityStub && typeof node.props?.onPress === 'function'
      );
      assert.ok(buttons.length >= 1, 'expected pressable submit button');

      await act(async () => {
        await buttons[buttons.length - 1].props.onPress();
      });
      await flush();

      // Ensure submission did not succeed and modal did not close
      assert.equal(submitted, false);
      assert.equal(closed, false);

      // Verify that the error message contains the localized quota string
      const allTextNodes = renderer.root.findAll(
        (n) => typeof n.props?.children === 'string' && n.props.children.length > 0
      );
      const errorTextFound = allTextNodes.some((n) =>
        n.props.children.includes(enStrings.common.quotaExceeded)
      );
      assert.ok(
        errorTextFound,
        `expected to find quota error message in rendered tree: ${enStrings.common.quotaExceeded}`
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
);

test(
  'FeedbackComposer displays localized quota error on QuotaExceededException',
  renderTestOptions,
  async () => {
    alertCalls.length = 0;
    touchableOpacityProps.length = 0;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const target = url.toString();
      if (target.includes('/api/v1/feedback') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            error: 'Quota limit reached',
            code: 'tier_limit_submissions',
          }),
          { status: 402, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response('not found', { status: 404 });
    }) as any;

    try {
      const client = new FeedbackClient({
        baseUrl: 'https://api.cupthread.com',
        appKey: 'app_test_composer_quota',
      });

      let submitted = false;
      let closed = false;

      let renderer!: TestRenderer.ReactTestRenderer;
      await act(async () => {
        renderer = TestRenderer.create(
          React.createElement(CupThreadProvider, {
            client,
            userToken: 'usr_tok_test',
            children: React.createElement(FeedbackComposer, {
              initialDraft: {
                title: 'Bug report title',
                description: 'Bug report description text',
              },
              onSubmitSuccess: () => {
                submitted = true;
              },
              onClose: () => {
                closed = true;
              },
            }),
          })
        );
      });
      await flush();

      // Submit button is pressable
      const buttons = renderer.root.findAll(
        (node) => node.type === TouchableOpacityStub && typeof node.props?.onPress === 'function'
      );
      assert.ok(buttons.length >= 1, 'expected pressable submit button');

      await act(async () => {
        await buttons[buttons.length - 1].props.onPress();
      });
      await flush();

      assert.equal(submitted, false);
      assert.equal(closed, false);

      const allTextNodes = renderer.root.findAll(
        (n) => typeof n.props?.children === 'string' && n.props.children.length > 0
      );
      const errorTextFound = allTextNodes.some((n) =>
        n.props.children.includes(enStrings.common.quotaExceeded)
      );
      assert.ok(
        errorTextFound,
        `expected to find quota error message in rendered tree: ${enStrings.common.quotaExceeded}`
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  }
);
