import test from 'node:test';
import assert from 'node:assert/strict';
import { FeedbackClient, DEFAULT_TIMEOUT_MS } from '../src/client/FeedbackClient';
import {
  RequestTimeoutException,
  FeedbackException,
  AuthenticationRequiredException,
  UnexpectedStatusException,
  InvalidResponseException,
} from '../src/client/FeedbackException';

test('FeedbackClientConfig defaults timeoutMs to 15000 and respects custom timeoutMs', () => {
  const defaultClient = new FeedbackClient({
    baseUrl: 'https://api.cupthread.com',
    appKey: 'app_test_123',
  });
  assert.equal(defaultClient.config.timeoutMs, DEFAULT_TIMEOUT_MS);
  assert.equal(defaultClient.config.timeoutMs, 15000);

  const customClient = new FeedbackClient({
    baseUrl: 'https://api.cupthread.com',
    appKey: 'app_test_123',
    timeoutMs: 5000,
  });
  assert.equal(customClient.config.timeoutMs, 5000);
});

test('RequestTimeoutException inherits from FeedbackException and carries timeoutMs', () => {
  const err = new RequestTimeoutException(3000, 'Custom timeout');
  assert.ok(err instanceof FeedbackException);
  assert.ok(err instanceof Error);
  assert.equal(err.name, 'RequestTimeoutException');
  assert.equal(err.timeoutMs, 3000);
  assert.equal(err.message, 'Custom timeout');

  const defaultMsgErr = new RequestTimeoutException(15000);
  assert.equal(defaultMsgErr.message, 'Request timed out after 15000ms');
});

test('FeedbackClient request aborts after timeoutMs and throws RequestTimeoutException', async () => {
  const originalFetch = globalThis.fetch;
  let receivedSignal: AbortSignal | undefined;

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    receivedSignal = init?.signal as AbortSignal;
    return new Promise((_resolve, reject) => {
      if (receivedSignal?.aborted) {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        return reject(err);
      }
      receivedSignal?.addEventListener('abort', () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      }, { once: true });
    });
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_test_timeout',
      timeoutMs: 50,
    });

    await assert.rejects(
      async () => {
        await client.fetchColumns();
      },
      (err: any) => {
        assert.ok(err instanceof RequestTimeoutException, `Expected RequestTimeoutException, got ${err?.name}`);
        assert.equal(err.name, 'RequestTimeoutException');
        assert.equal(err.timeoutMs, 50);
        return true;
      }
    );

    assert.ok(receivedSignal);
    assert.equal(receivedSignal.aborted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient uploadAttachment aborts after timeoutMs and throws RequestTimeoutException', async () => {
  const originalFetch = globalThis.fetch;
  let receivedSignal: AbortSignal | undefined;

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    receivedSignal = init?.signal as AbortSignal;
    return new Promise((_resolve, reject) => {
      receivedSignal?.addEventListener('abort', () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      }, { once: true });
    });
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_test_upload_timeout',
      timeoutMs: 50,
    });

    await assert.rejects(
      async () => {
        await client.uploadAttachment({
          file: new Blob(['test-content'], { type: 'image/png' }),
          filename: 'test.png',
          mimeType: 'image/png',
        });
      },
      (err: any) => {
        assert.ok(err instanceof RequestTimeoutException, `Expected RequestTimeoutException, got ${err?.name}`);
        assert.equal(err.timeoutMs, 50);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient respects per-request timeoutMs override', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const signal = init?.signal as AbortSignal;
    return new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      }, { once: true });
    });
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_test_override',
      timeoutMs: 15000,
    });

    const start = Date.now();
    await assert.rejects(
      async () => {
        await client.fetchColumns({ timeoutMs: 40 });
      },
      (err: any) => {
        assert.ok(err instanceof RequestTimeoutException);
        assert.equal(err.timeoutMs, 40);
        return true;
      }
    );
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 1000, `Expected operation to timeout quickly, took ${elapsed}ms`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient rethrows AbortError when caller signal cancels in-flight request', async () => {
  const originalFetch = globalThis.fetch;
  let receivedSignal: AbortSignal | undefined;

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    receivedSignal = init?.signal as AbortSignal;
    return new Promise((_resolve, reject) => {
      receivedSignal?.addEventListener('abort', () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      }, { once: true });
    });
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_test_caller_cancel',
      timeoutMs: 15000,
    });

    const controller = new AbortController();
    setTimeout(() => {
      controller.abort();
    }, 30);

    await assert.rejects(
      async () => {
        await client.fetchColumns({ signal: controller.signal });
      },
      (err: any) => {
        assert.equal(err.name, 'AbortError');
        assert.ok(!(err instanceof RequestTimeoutException));
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient rethrows AbortError when caller signal cancels uploadAttachment', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const signal = init?.signal as AbortSignal;
    return new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      }, { once: true });
    });
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_test_upload_cancel',
      timeoutMs: 15000,
    });

    const controller = new AbortController();
    setTimeout(() => {
      controller.abort();
    }, 30);

    await assert.rejects(
      async () => {
        await client.uploadAttachment({
          file: new Blob(['test-content'], { type: 'image/png' }),
          filename: 'test.png',
          mimeType: 'image/png',
          signal: controller.signal,
        });
      },
      (err: any) => {
        assert.equal(err.name, 'AbortError');
        assert.ok(!(err instanceof RequestTimeoutException));
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient throws AbortError immediately when caller signal is already aborted', async () => {
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    return new Response('{}', { status: 200 });
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_test_pre_aborted',
    });

    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      async () => {
        await client.fetchColumns({ signal: controller.signal });
      },
      (err: any) => {
        assert.equal(err.name, 'AbortError');
        return true;
      }
    );
    assert.equal(fetchCalled, false, 'fetch() should not be called when signal is already aborted');

    await assert.rejects(
      async () => {
        await client.uploadAttachment({
          file: new Blob(['data'], { type: 'image/png' }),
          filename: 'f.png',
          mimeType: 'image/png',
          signal: controller.signal,
        });
      },
      (err: any) => {
        assert.equal(err.name, 'AbortError');
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient normal responses are unaffected by timeout and caller signal', async () => {
  const originalFetch = globalThis.fetch;
  let capturedInit: RequestInit | undefined;

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    capturedInit = init;
    return new Response(
      JSON.stringify({
        columns: [
          { id: 'c1', name: 'Planned', position: 1, isVisible: true, isSystem: false, kind: 'normal' },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_test_normal',
      timeoutMs: 5000,
    });

    const controller = new AbortController();
    const columns = await client.fetchColumns({ signal: controller.signal });

    assert.equal(columns.length, 1);
    assert.equal(columns[0].id, 'c1');
    assert.ok(capturedInit?.signal, 'Internal AbortSignal should be passed to fetch');
    assert.equal((capturedInit?.signal as AbortSignal).aborted, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient supports passing AbortSignal directly as argument', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return new Response(
      JSON.stringify({
        columns: [
          { id: 'c1', name: 'Planned', position: 1, isVisible: true, isSystem: false, kind: 'normal' },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_test_direct_signal',
    });

    const controller = new AbortController();
    const columns = await client.fetchColumns(controller.signal);
    assert.equal(columns.length, 1);

    const controller2 = new AbortController();
    controller2.abort();
    await assert.rejects(
      async () => {
        await client.fetchColumns(controller2.signal);
      },
      (err: any) => {
        assert.equal(err.name, 'AbortError');
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient normal uploadAttachment is unaffected by timeout', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return new Response(
      JSON.stringify({
        kind: 'image',
        key: 'img_123',
        url: 'https://cdn.cupthread.com/img_123.png',
        filename: 'screenshot.png',
        mimeType: 'image/png',
        size: 1024,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_test_upload_normal',
      timeoutMs: 5000,
    });

    const controller = new AbortController();
    const attachment = await client.uploadAttachment({
      file: new Blob(['file-bytes'], { type: 'image/png' }),
      filename: 'screenshot.png',
      mimeType: 'image/png',
      signal: controller.signal,
    });

    assert.equal(attachment.key, 'img_123');
    assert.equal(attachment.url, 'https://cdn.cupthread.com/img_123.png');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient.submit supports options with signal and userToken', async () => {
  const originalFetch = globalThis.fetch;
  let receivedSignal: AbortSignal | undefined;
  let receivedHeaders: any = {};

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    receivedSignal = init?.signal as AbortSignal;
    receivedHeaders = init?.headers;
    return new Response(
      JSON.stringify({ submissionId: 'sub_123', forwardedToGithub: false }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    );
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_submit_test',
    });

    const controller = new AbortController();
    const result = await client.submit(
      { title: 'Bug title', description: 'Bug description' },
      'user_token_abc',
      { signal: controller.signal }
    );

    assert.equal(result.submissionId, 'sub_123');
    assert.equal(receivedHeaders['X-User-Token'], 'user_token_abc');
    assert.ok(receivedSignal);
    assert.equal(receivedSignal.aborted, false);

    // Also test submit with signal passed directly as 3rd param
    const result2 = await client.submit(
      { title: 'Bug title 2', description: 'Bug description 2' },
      'user_token_abc',
      controller.signal
    );
    assert.equal(result2.submissionId, 'sub_123');

    // Also test submit without userToken but with options passed as 2nd param
    const result3 = await client.submit(
      { title: 'Bug title 3', description: 'Bug description 3' },
      { signal: controller.signal } as any
    );
    assert.equal(result3.submissionId, 'sub_123');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient methods thread signal through to fetch', async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const s = url.toString();
    calls.push(s);
    assert.ok(init?.signal, `Signal should be provided for ${s}`);
    if (s.includes('/api/v1/public/config/')) {
      return new Response(
        JSON.stringify({
          appKey: 'app_test',
          sdk: { features: { changelog: true }, changelogOverlay: { entryCount: 3 } },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (s.includes('/changelog')) {
      return new Response(
        JSON.stringify({ entries: [{ id: '1', versionLabel: '1.0', title: 'T', body: 'B', publishedAt: new Date().toISOString() }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (s.includes('/feature-requests?')) {
      return new Response(JSON.stringify({ requests: [], total: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (s.includes('/vote')) {
      return new Response(JSON.stringify({ voted: true, voteCount: 5 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (s.includes('/comments')) {
      return new Response(JSON.stringify({ comments: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (s.includes('/user')) {
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (s.includes('/profile')) {
      return new Response(JSON.stringify({ profile: { id: 'u1', displayName: 'D' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_methods_test',
    });

    const controller = new AbortController();
    const opts = { signal: controller.signal };

    await client.fetchAppConfig(opts);
    await client.fetchVersions(opts);
    await client.fetchFeatureRequests({ userToken: 'u', signal: controller.signal });
    await client.submitFeatureRequest({ title: 'T', description: 'D' }, 'u', opts);
    await client.toggleVote('fr_1', 'u', opts);
    await client.fetchComments('fr_1', opts);
    await client.postComment('fr_1', { body: 'hello' }, 'u', opts);
    await client.fetchChangelog(opts);
    await client.prepareChangelogOverlay({ signal: controller.signal });
    await client.subscribeToChangelog('a@b.com', 'u', opts);
    await client.unsubscribeFromChangelog('a@b.com', opts);
    await client.updateUserAttributes({ userToken: 'u', signal: controller.signal });
    await client.fetchUserProfile('u1', opts);

    assert.ok(calls.length >= 13, `Expected at least 13 calls with signal, got ${calls.length}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient clears timeout on HTTP errors or parse failures', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (url: string | URL | Request) => {
    const s = url.toString();
    if (s.includes('/auth-error')) {
      return new Response('Unauthorized', { status: 401 });
    }
    if (s.includes('/server-error')) {
      return new Response('Internal Server Error', { status: 500 });
    }
    if (s.includes('/bad-json')) {
      return new Response('not a json', { status: 200 });
    }
    return new Response('{}', { status: 200 });
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_errors_test',
      timeoutMs: 1000,
    });

    await assert.rejects(
      async () => {
        await (client as any).request({ method: 'GET', path: '/auth-error' });
      },
      AuthenticationRequiredException
    );

    await assert.rejects(
      async () => {
        await (client as any).request({ method: 'GET', path: '/server-error' });
      },
      UnexpectedStatusException
    );

    await assert.rejects(
      async () => {
        await (client as any).request({ method: 'GET', path: '/bad-json' });
      },
      InvalidResponseException
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient request aborts when response body read stalls past timeoutMs and throws RequestTimeoutException', async () => {
  const originalFetch = globalThis.fetch;
  let receivedSignal: AbortSignal | undefined;

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    receivedSignal = init?.signal as AbortSignal;
    return {
      status: 200,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      text: () =>
        new Promise((_resolve, reject) => {
          receivedSignal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          }, { once: true });
        }),
    } as any;
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_test_stalled_body',
      timeoutMs: 50,
    });

    const start = Date.now();
    await assert.rejects(
      async () => {
        await client.fetchColumns();
      },
      (err: any) => {
        assert.ok(err instanceof RequestTimeoutException, `Expected RequestTimeoutException, got ${err?.name}`);
        assert.equal(err.name, 'RequestTimeoutException');
        assert.equal(err.timeoutMs, 50);
        return true;
      }
    );
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 1000, `Expected stalled body read to timeout quickly, took ${elapsed}ms`);
    assert.ok(receivedSignal?.aborted, 'Internal signal should be aborted');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient uploadAttachment aborts when success response json read stalls past timeoutMs and throws RequestTimeoutException', async () => {
  const originalFetch = globalThis.fetch;
  let receivedSignal: AbortSignal | undefined;

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    receivedSignal = init?.signal as AbortSignal;
    return {
      status: 200,
      json: () =>
        new Promise((_resolve, reject) => {
          receivedSignal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          }, { once: true });
        }),
    } as any;
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_test_upload_stalled_json',
      timeoutMs: 50,
    });

    const start = Date.now();
    await assert.rejects(
      async () => {
        await client.uploadAttachment({
          file: new Blob(['test-content'], { type: 'image/png' }),
          filename: 'test.png',
          mimeType: 'image/png',
        });
      },
      (err: any) => {
        assert.ok(err instanceof RequestTimeoutException, `Expected RequestTimeoutException, got ${err?.name}`);
        assert.equal(err.timeoutMs, 50);
        return true;
      }
    );
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 1000, `Expected stalled upload JSON read to timeout quickly, took ${elapsed}ms`);
    assert.ok(receivedSignal?.aborted, 'Internal signal should be aborted');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient uploadAttachment aborts when error response text read stalls past timeoutMs and throws RequestTimeoutException', async () => {
  const originalFetch = globalThis.fetch;
  let receivedSignal: AbortSignal | undefined;

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    receivedSignal = init?.signal as AbortSignal;
    return {
      status: 500,
      text: () =>
        new Promise((_resolve, reject) => {
          receivedSignal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          }, { once: true });
        }),
    } as any;
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_test_upload_stalled_text',
      timeoutMs: 50,
    });

    const start = Date.now();
    await assert.rejects(
      async () => {
        await client.uploadAttachment({
          file: new Blob(['test-content'], { type: 'image/png' }),
          filename: 'test.png',
          mimeType: 'image/png',
        });
      },
      (err: any) => {
        assert.ok(err instanceof RequestTimeoutException, `Expected RequestTimeoutException, got ${err?.name}`);
        assert.equal(err.timeoutMs, 50);
        return true;
      }
    );
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 1000, `Expected stalled upload error text read to timeout quickly, took ${elapsed}ms`);
    assert.ok(receivedSignal?.aborted, 'Internal signal should be aborted');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient request cancels stalled body read when caller signal aborts', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () => {
    return {
      status: 200,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      text: () => new Promise(() => {}), // Stalled promise that never resolves
    } as any;
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_test_body_caller_cancel',
      timeoutMs: 5000,
    });

    const controller = new AbortController();
    setTimeout(() => {
      controller.abort();
    }, 30);

    await assert.rejects(
      async () => {
        await client.fetchColumns({ signal: controller.signal });
      },
      (err: any) => {
        assert.equal(err.name, 'AbortError');
        assert.ok(!(err instanceof RequestTimeoutException));
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('FeedbackClient uploadAttachment cancels stalled body read when caller signal aborts', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () => {
    return {
      status: 200,
      json: () => new Promise(() => {}), // Stalled promise that never resolves
    } as any;
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_test_upload_body_caller_cancel',
      timeoutMs: 5000,
    });

    const controller = new AbortController();
    setTimeout(() => {
      controller.abort();
    }, 30);

    await assert.rejects(
      async () => {
        await client.uploadAttachment({
          file: new Blob(['test-content'], { type: 'image/png' }),
          filename: 'test.png',
          mimeType: 'image/png',
          signal: controller.signal,
        });
      },
      (err: any) => {
        assert.equal(err.name, 'AbortError');
        assert.ok(!(err instanceof RequestTimeoutException));
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

