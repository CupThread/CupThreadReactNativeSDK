import test from 'node:test';
import assert from 'node:assert/strict';
import { FeedbackClient } from '../src/client/FeedbackClient';
import {
  AuthenticationRequiredException,
  RateLimitedException,
  RequestTimeoutException,
  TurnstileRequiredException,
  UploadRejectedException,
  UploadValidationException,
} from '../src/client/FeedbackException';
import { UserTokenStore } from '../src/client/UserTokenStore';
import { uploadErrorMessage } from '../src/utils/errors';
import { enStrings, jaStrings } from '../src/i18n';
import type { FeedbackDraft, UploadSessionFileSpec } from '../src/types';

interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
}

const SESSION_TOKEN = 'cpt_up_session_token';
const USER_TOKEN = 'usr_token_abc';

/**
 * Installs a fetch stub that answers session creation and slot uploads,
 * recording every request. `slotResponder` lets a test target one slot.
 */
function installUploadFetch(
  options: {
    slots?: string[];
    sessionStatus?: number;
    sessionBody?: unknown;
    slotResponder?: (uploadId: string, index: number) => Response;
  } = {}
) {
  const originalFetch = globalThis.fetch;
  const requests: RecordedRequest[] = [];
  const slots = options.slots ?? ['upl_1'];

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const target = url.toString();
    requests.push({
      url: target,
      method: init?.method || 'GET',
      headers: (init?.headers || {}) as Record<string, string>,
      body: init?.body,
    });

    if (target.endsWith('/api/v1/uploads/sessions')) {
      return new Response(
        JSON.stringify(
          options.sessionBody ?? {
            session: {
              sessionId: 'ups_1',
              sessionToken: SESSION_TOKEN,
              expiresAt: '2026-10-23T13:00:00.000Z',
              maxFileSizeBytes: 10485760,
              maxFiles: 8,
            },
            files: slots.map((uploadId, index) => ({
              clientFileId: `file-${index}`,
              uploadId,
              uploadUrl: `/api/v1/uploads/${uploadId}`,
              maxSizeBytes: 10485760,
            })),
          }
        ),
        {
          status: options.sessionStatus ?? 201,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const uploadId = target.split('/').pop() || '';
    if (options.slotResponder) {
      return options.slotResponder(uploadId, slots.indexOf(uploadId));
    }
    return new Response(
      JSON.stringify({
        uploadId,
        filename: 'file',
        contentType: 'image/png',
        sizeBytes: 1024,
        stored: true,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as any;

  return {
    requests,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

function makeClient(config: Record<string, unknown> = {}): FeedbackClient {
  return new FeedbackClient({
    baseUrl: 'https://api.cupthread.com',
    appKey: 'app_key_abc',
    ...config,
  });
}

function makeSpec(name = 'screenshot.png'): UploadSessionFileSpec {
  return { filename: name, mimeType: 'image/png', sizeBytes: 2048 };
}

function makeBlobOptions(name = 'photo.png') {
  return {
    file: new Blob(['0123456789'], { type: 'image/png' }),
    filename: name,
    mimeType: 'image/png',
  };
}

// ---------------------------------------------------------------------------
// Session creation
// ---------------------------------------------------------------------------

test('createUploadSession posts the declared files with the appKey and purpose', async () => {
  const mocked = installUploadFetch();

  try {
    const session = await makeClient().createUploadSession([makeSpec()], {
      userToken: USER_TOKEN,
    });

    assert.equal(mocked.requests.length, 1);
    const [request] = mocked.requests;
    assert.equal(request.url, 'https://api.cupthread.com/api/v1/uploads/sessions');
    assert.equal(request.method, 'POST');
    assert.equal(request.headers['X-User-Token'], USER_TOKEN);

    const body = JSON.parse(request.body as string);
    assert.equal(body.appKey, 'app_key_abc');
    assert.equal(body.purpose, 'feedback_attachment');
    assert.deepEqual(body.files, [
      {
        clientFileId: 'screenshot.png',
        filename: 'screenshot.png',
        contentType: 'image/png',
        sizeBytes: 2048,
      },
    ]);

    assert.equal(session.sessionToken, SESSION_TOKEN);
    assert.equal(session.maxFiles, 8);
    assert.equal(session.files.length, 1);
    assert.equal(session.files[0].uploadId, 'upl_1');
  } finally {
    mocked.restore();
  }
});

test('createUploadSession falls back to the shared store identity for anonymous callers', async () => {
  const mocked = installUploadFetch();

  try {
    const storeToken = await UserTokenStore.shared.getToken();
    await makeClient().createUploadSession([makeSpec()]);

    assert.equal(
      mocked.requests[0].headers['X-User-Token'],
      storeToken,
      'an unbound session is rejected by the API, so the store identity must be sent'
    );
  } finally {
    mocked.restore();
  }
});

test('createUploadSession attaches the configured turnstile token', async () => {
  const mocked = installUploadFetch();

  try {
    const client = makeClient({ turnstileTokenProvider: async () => 'turnstile-token-1' });
    await client.createUploadSession([makeSpec()], { userToken: USER_TOKEN });

    assert.equal(JSON.parse(mocked.requests[0].body as string).turnstileToken, 'turnstile-token-1');
  } finally {
    mocked.restore();
  }
});

test('createUploadSession omits the turnstile field when no token is available', async () => {
  const mocked = installUploadFetch();

  try {
    await makeClient().createUploadSession([makeSpec()], { userToken: USER_TOKEN });

    assert.equal('turnstileToken' in JSON.parse(mocked.requests[0].body as string), false);
  } finally {
    mocked.restore();
  }
});

test('createUploadSession validates the file count before any request', async () => {
  const mocked = installUploadFetch();

  try {
    const client = makeClient();

    await assert.rejects(client.createUploadSession([], { userToken: USER_TOKEN }), (err: any) => {
      assert.ok(err instanceof UploadValidationException);
      assert.equal(err.code, 'invalid_file_count');
      return true;
    });

    const nine = Array.from({ length: 9 }, (_, index) => makeSpec(`file-${index}.png`));
    await assert.rejects(
      client.createUploadSession(nine, { userToken: USER_TOKEN }),
      (err: any) => {
        assert.ok(err instanceof UploadValidationException);
        assert.equal(err.code, 'invalid_file_count');
        return true;
      }
    );

    assert.equal(mocked.requests.length, 0, 'invalid batches must not reach the network');
  } finally {
    mocked.restore();
  }
});

test('createUploadSession requires a positive size, a filename, and a MIME type', async () => {
  const mocked = installUploadFetch();

  try {
    const client = makeClient();

    await assert.rejects(
      client.createUploadSession([{ filename: 'a.png', mimeType: 'image/png', sizeBytes: 0 }], {
        userToken: USER_TOKEN,
      }),
      (err: any) => {
        assert.ok(err instanceof UploadValidationException);
        assert.equal(err.code, 'file_size_required');
        assert.match(err.message, /a\.png/);
        return true;
      }
    );

    await assert.rejects(
      client.createUploadSession([{ filename: '  ', mimeType: 'image/png', sizeBytes: 10 }], {
        userToken: USER_TOKEN,
      }),
      (err: any) => {
        assert.ok(err instanceof UploadValidationException);
        assert.equal(err.code, 'invalid_field');
        return true;
      }
    );

    assert.equal(mocked.requests.length, 0);
  } finally {
    mocked.restore();
  }
});

test('createUploadSession rounds a fractional declared size up', async () => {
  const mocked = installUploadFetch();

  try {
    await makeClient().createUploadSession(
      [{ filename: 'a.png', mimeType: 'image/png', sizeBytes: 10.2 }],
      { userToken: USER_TOKEN }
    );

    assert.equal(JSON.parse(mocked.requests[0].body as string).files[0].sizeBytes, 11);
  } finally {
    mocked.restore();
  }
});

test('createUploadSession keeps an explicit clientFileId', async () => {
  const mocked = installUploadFetch();

  try {
    await makeClient().createUploadSession(
      [{ filename: 'a.png', mimeType: 'image/png', sizeBytes: 10, clientFileId: 'picker-7' }],
      { userToken: USER_TOKEN }
    );

    assert.equal(JSON.parse(mocked.requests[0].body as string).files[0].clientFileId, 'picker-7');
  } finally {
    mocked.restore();
  }
});

test('createUploadSession maps a rate-limited session to RateLimitedException', async () => {
  const mocked = installUploadFetch({
    sessionStatus: 429,
    sessionBody: {
      error: 'Daily upload storage quota exceeded',
      code: 'daily_storage_quota_exceeded',
    },
  });

  try {
    await assert.rejects(
      makeClient().createUploadSession([makeSpec()], { userToken: USER_TOKEN }),
      (err: any) => {
        assert.ok(err instanceof RateLimitedException);
        return true;
      }
    );
  } finally {
    mocked.restore();
  }
});

test('createUploadSession maps a Turnstile session rejection to TurnstileRequiredException', async () => {
  const mocked = installUploadFetch({
    sessionStatus: 403,
    sessionBody: { error: 'Verification required', code: 'turnstile_required' },
  });

  try {
    await assert.rejects(
      makeClient().createUploadSession([makeSpec()], { userToken: USER_TOKEN }),
      (err: any) => {
        assert.ok(err instanceof TurnstileRequiredException);
        return true;
      }
    );
  } finally {
    mocked.restore();
  }
});

test('createUploadSession maps an unsupported MIME type to a coded rejection', async () => {
  const mocked = installUploadFetch({
    sessionStatus: 400,
    sessionBody: {
      error: 'MIME type "application/x-msdownload" is not supported',
      code: 'unsupported_mime_type',
    },
  });

  try {
    await assert.rejects(
      makeClient().createUploadSession([makeSpec()], { userToken: USER_TOKEN }),
      (err: any) => {
        assert.ok(err instanceof UploadRejectedException);
        assert.equal(err.status, 400);
        assert.equal(err.code, 'unsupported_mime_type');
        return true;
      }
    );
  } finally {
    mocked.restore();
  }
});

test('createUploadSession maps a missing anonymous identity to its server code', async () => {
  const mocked = installUploadFetch({
    sessionStatus: 400,
    sessionBody: { error: 'X-User-Token UUID required', code: 'uploader_identity_required' },
  });

  try {
    await assert.rejects(makeClient().createUploadSession([makeSpec()]), (err: any) => {
      assert.ok(err instanceof UploadRejectedException);
      assert.equal(err.code, 'uploader_identity_required');
      return true;
    });
  } finally {
    mocked.restore();
  }
});

test('createUploadSession rejects an unauthenticated response', async () => {
  const mocked = installUploadFetch({ sessionStatus: 401, sessionBody: { error: 'sign in' } });

  try {
    await assert.rejects(
      makeClient().createUploadSession([makeSpec()], { userToken: USER_TOKEN }),
      (err: any) => {
        assert.ok(err instanceof AuthenticationRequiredException);
        return true;
      }
    );
  } finally {
    mocked.restore();
  }
});

test('createUploadSession rejects a response without a session token', async () => {
  const mocked = installUploadFetch({
    sessionBody: { session: { sessionId: 'ups_1' }, files: [] },
  });

  try {
    await assert.rejects(
      makeClient().createUploadSession([makeSpec()], { userToken: USER_TOKEN }),
      (err: any) => {
        assert.match(err.name, /UnreadableUploadResponse/);
        return true;
      }
    );
  } finally {
    mocked.restore();
  }
});

// ---------------------------------------------------------------------------
// Single and batch uploads
// ---------------------------------------------------------------------------

test('uploadAttachment sends the bytes to the reserved slot with the bearer token', async () => {
  const mocked = installUploadFetch();

  try {
    const attachment = await makeClient().uploadAttachment({
      ...makeBlobOptions(),
      userToken: USER_TOKEN,
    });

    assert.equal(mocked.requests.length, 2);
    const slot = mocked.requests[1];
    assert.equal(slot.url, 'https://api.cupthread.com/api/v1/uploads/upl_1');
    assert.equal(slot.headers.Authorization, `Bearer ${SESSION_TOKEN}`);
    assert.equal(typeof slot.body.get, 'function', 'the slot body must be FormData');
    assert.ok(slot.body.get('file'), 'the file part must be present');

    assert.equal(attachment.uploadId, 'upl_1');
    assert.equal(attachment.key, 'upl_1');
    assert.equal(attachment.kind, 'image');
  } finally {
    mocked.restore();
  }
});

test('uploadAttachment classifies a non-image file as r2 storage', async () => {
  const mocked = installUploadFetch();

  try {
    const attachment = await makeClient().uploadAttachment({
      file: { uri: 'file:///tmp/crash.log' },
      filename: 'crash.log',
      mimeType: 'text/plain',
      size: 4096,
      userToken: USER_TOKEN,
    });

    assert.equal(attachment.kind, 'r2');
  } finally {
    mocked.restore();
  }
});

test('uploadAttachment honors an explicit preferredKind over the MIME type', async () => {
  const mocked = installUploadFetch();

  try {
    const attachment = await makeClient().uploadAttachment({
      file: { uri: 'file:///tmp/a.png' },
      filename: 'a.png',
      mimeType: 'image/png',
      preferredKind: 'r2',
      size: 100,
      userToken: USER_TOKEN,
    });

    assert.equal(attachment.kind, 'r2');
  } finally {
    mocked.restore();
  }
});

test('uploadAttachment URL-encodes the upload id in the slot path', async () => {
  const mocked = installUploadFetch({ slots: ['upl/with space'] });

  try {
    await makeClient().uploadAttachment({ ...makeBlobOptions(), userToken: USER_TOKEN });

    assert.ok(
      mocked.requests[1].url.endsWith(`/api/v1/uploads/${encodeURIComponent('upl/with space')}`),
      `unexpected slot URL: ${mocked.requests[1].url}`
    );
  } finally {
    mocked.restore();
  }
});

test('uploadAttachments reserves one session for the whole batch', async () => {
  const mocked = installUploadFetch({ slots: ['upl_1', 'upl_2', 'upl_3'] });

  try {
    const attachments = await makeClient().uploadAttachments(
      [makeBlobOptions('one.png'), makeBlobOptions('two.png'), makeBlobOptions('three.png')],
      { userToken: USER_TOKEN }
    );

    const sessionRequests = mocked.requests.filter((request) =>
      request.url.endsWith('/api/v1/uploads/sessions')
    );
    assert.equal(sessionRequests.length, 1, 'one pick must reserve one session');
    assert.equal(JSON.parse(sessionRequests[0].body as string).files.length, 3);

    assert.equal(mocked.requests.length, 4, 'one session plus three slot uploads');
    assert.deepEqual(
      attachments.map((attachment) => attachment.uploadId),
      ['upl_1', 'upl_2', 'upl_3']
    );
  } finally {
    mocked.restore();
  }
});

test('uploadAttachments fails before creating a session when one file declares no size', async () => {
  const mocked = installUploadFetch();

  try {
    await assert.rejects(
      makeClient().uploadAttachments(
        [
          makeBlobOptions('ok.png'),
          { file: { uri: 'file:///tmp/x.log' }, filename: 'x.log', mimeType: 'text/plain' },
        ],
        { userToken: USER_TOKEN }
      ),
      (err: any) => {
        assert.ok(err instanceof UploadValidationException);
        assert.equal(err.code, 'file_size_required');
        assert.match(err.message, /x\.log/);
        return true;
      }
    );

    assert.equal(mocked.requests.length, 0, 'a doomed batch must not reserve quota');
  } finally {
    mocked.restore();
  }
});

test('uploadAttachments rejects an empty batch and one above the session limit', async () => {
  const mocked = installUploadFetch();

  try {
    const client = makeClient();

    await assert.rejects(client.uploadAttachments([], { userToken: USER_TOKEN }), (err: any) => {
      assert.ok(err instanceof UploadValidationException);
      assert.equal(err.code, 'invalid_file_count');
      return true;
    });

    const nine = Array.from({ length: 9 }, () => makeBlobOptions());
    await assert.rejects(client.uploadAttachments(nine, { userToken: USER_TOKEN }), (err: any) => {
      assert.ok(err instanceof UploadValidationException);
      assert.equal(err.code, 'invalid_file_count');
      return true;
    });

    assert.equal(mocked.requests.length, 0);
  } finally {
    mocked.restore();
  }
});

test('uploadAttachments stops at a rejected slot and keeps earlier results usable', async () => {
  const mocked = installUploadFetch({
    slots: ['upl_1', 'upl_2'],
    slotResponder: (uploadId) => {
      if (uploadId === 'upl_2') {
        return new Response(JSON.stringify({ error: 'bad type', code: 'unsupported_mime_type' }), {
          status: 415,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ uploadId, sizeBytes: 10, stored: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  try {
    await assert.rejects(
      makeClient().uploadAttachments([makeBlobOptions('one.png'), makeBlobOptions('two.png')], {
        userToken: USER_TOKEN,
      }),
      (err: any) => {
        assert.ok(err instanceof UploadRejectedException);
        assert.equal(err.code, 'unsupported_mime_type');
        return true;
      }
    );

    assert.equal(
      mocked.requests.some((request) => request.url.endsWith('/api/v1/uploads/upl_2')),
      true,
      'the failing slot must be attempted'
    );
  } finally {
    mocked.restore();
  }
});

test('uploadAttachments rejects a file larger than its reserved slot before sending bytes', async () => {
  const originalFetch = globalThis.fetch;
  let slotCalls = 0;

  globalThis.fetch = (async (url: string | URL | Request) => {
    if (url.toString().endsWith('/api/v1/uploads/sessions')) {
      return new Response(
        JSON.stringify({
          session: {
            sessionId: 'ups_1',
            sessionToken: SESSION_TOKEN,
            expiresAt: '2026-10-23T13:00:00.000Z',
            maxFileSizeBytes: 10,
            maxFiles: 8,
          },
          files: [
            {
              clientFileId: 'big.png',
              uploadId: 'upl_1',
              uploadUrl: '/api/v1/uploads/upl_1',
              maxSizeBytes: 5,
            },
          ],
        }),
        { status: 201, headers: { 'Content-Type': 'application/json' } }
      );
    }
    slotCalls += 1;
    return new Response('{}', { status: 200 });
  }) as any;

  try {
    await assert.rejects(
      makeClient().uploadAttachments([makeBlobOptions('big.png')], { userToken: USER_TOKEN }),
      (err: any) => {
        assert.ok(err instanceof UploadRejectedException);
        assert.equal(err.code, 'file_too_large');
        assert.equal(err.status, 413);
        return true;
      }
    );

    assert.equal(slotCalls, 0, 'an oversized file must not be sent at all');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// Submission wiring
// ---------------------------------------------------------------------------

test('submit sends upload-session ids and omits raw keys and URLs', async () => {
  const originalFetch = globalThis.fetch;
  let submitBody: any = null;

  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (url.toString().endsWith('/api/v1/feedback')) {
      submitBody = JSON.parse(init?.body as string);
      return new Response(JSON.stringify({ submissionId: 'sub_1', forwardedToGithub: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  }) as any;

  try {
    const draft: FeedbackDraft = {
      title: 'Attachment submission',
      description: 'Reports a crash with a log attached',
      platform: 'ios',
      attachments: [
        { kind: 'image', uploadId: 'upl_1', key: 'upl_1', url: '/api/v1/uploads/upl_1' },
        // Legacy descriptor without an uploadId: omitted instead of failing the
        // whole draft with direct_attachment_forbidden.
        { kind: 'r2', key: 'legacy-key', url: 'https://cdn.example/legacy.log' },
      ],
    };

    await makeClient().submit(draft, USER_TOKEN);

    assert.deepEqual(submitBody.uploadIds, ['upl_1']);
    assert.equal('attachments' in submitBody, false, 'raw descriptors must not be sent');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('submit omits uploadIds entirely when no attachment has one', async () => {
  const originalFetch = globalThis.fetch;
  let submitBody: any = null;

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    submitBody = JSON.parse(init?.body as string);
    return new Response(JSON.stringify({ submissionId: 'sub_1', forwardedToGithub: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as any;

  try {
    await makeClient().submit(
      { title: 'No files', description: 'Plain text feedback', platform: 'ios' },
      USER_TOKEN
    );

    assert.equal('uploadIds' in submitBody, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// Localized upload errors
// ---------------------------------------------------------------------------

test('uploadErrorMessage maps a missing size to the localized hint', () => {
  const err = new UploadValidationException('file_size_required', 'no size');

  assert.equal(
    uploadErrorMessage(err, enStrings.feedbackComposer, enStrings.common),
    enStrings.feedbackComposer.uploadSizeMissing
  );
  assert.equal(
    uploadErrorMessage(err, jaStrings.feedbackComposer, jaStrings.common),
    jaStrings.feedbackComposer.uploadSizeMissing
  );
});

test('uploadErrorMessage maps an oversized file and an unsupported type', () => {
  const tooLarge = new UploadRejectedException(413, 'file_too_large', '');
  assert.equal(
    uploadErrorMessage(tooLarge, enStrings.feedbackComposer, enStrings.common),
    enStrings.feedbackComposer.uploadTooLarge
  );

  const badType = new UploadRejectedException(400, 'unsupported_mime_type', '');
  assert.equal(
    uploadErrorMessage(badType, enStrings.feedbackComposer, enStrings.common),
    enStrings.feedbackComposer.uploadUnsupportedType
  );

  const badExtension = new UploadRejectedException(400, 'executable_extension_prohibited', '');
  assert.equal(
    uploadErrorMessage(badExtension, enStrings.feedbackComposer, enStrings.common),
    enStrings.feedbackComposer.uploadUnsupportedType
  );
});

test('uploadErrorMessage falls back to the localized upload failure for other errors', () => {
  const err = new UploadRejectedException(500, undefined, 'boom');

  assert.equal(
    uploadErrorMessage(err, enStrings.feedbackComposer, enStrings.common),
    enStrings.feedbackComposer.uploadFailed
  );
});

test('uploadErrorMessage delegates transport failures to the shared mapping', () => {
  assert.equal(
    uploadErrorMessage(
      new RequestTimeoutException(1000),
      enStrings.feedbackComposer,
      enStrings.common
    ),
    enStrings.common.timeoutError
  );
});

test('submit falls back to the store identity when a draft carries session uploads', async () => {
  const originalFetch = globalThis.fetch;
  let submitHeaders: Record<string, string> = {};

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    submitHeaders = (init?.headers || {}) as Record<string, string>;
    return new Response(JSON.stringify({ submissionId: 'sub_1', forwardedToGithub: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as any;

  try {
    const storeToken = await UserTokenStore.shared.getToken();
    await makeClient().submit({
      title: 'Attached report',
      description: 'Includes a crash log',
      platform: 'ios',
      attachments: [{ kind: 'r2', uploadId: 'upl_1', key: 'upl_1' }],
    });

    assert.equal(
      submitHeaders['X-User-Token'],
      storeToken,
      'SEC-28: the submission must present the session uploader identity'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('submit leaves a plain draft anonymous when no token is passed', async () => {
  const originalFetch = globalThis.fetch;
  let submitHeaders: Record<string, string> = {};

  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    submitHeaders = (init?.headers || {}) as Record<string, string>;
    return new Response(JSON.stringify({ submissionId: 'sub_1', forwardedToGithub: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as any;

  try {
    await makeClient().submit({
      title: 'Plain report',
      description: 'No attachments here',
      platform: 'ios',
    });

    assert.equal(submitHeaders['X-User-Token'], undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('submit surfaces an uploader_mismatch rejection with its code', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        error: 'Upload session was created by a different uploader',
        code: 'uploader_mismatch',
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    )) as any;

  try {
    await assert.rejects(
      makeClient().submit(
        {
          title: 'Mismatched report',
          description: 'Uploaded with another identity',
          platform: 'ios',
          attachments: [{ kind: 'image', uploadId: 'upl_1', key: 'upl_1' }],
        },
        'different-token'
      ),
      (err: any) => {
        assert.ok(err instanceof UploadRejectedException);
        assert.equal(err.status, 400);
        assert.equal(err.code, 'uploader_mismatch');
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('submit keeps the shared error mapping for a plain draft rejection', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: 'App not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })) as any;

  try {
    await assert.rejects(
      makeClient().submit(
        { title: 'Plain report', description: 'No attachments here', platform: 'ios' },
        USER_TOKEN
      ),
      (err: any) => {
        assert.equal(err.name, 'UnexpectedStatusException');
        assert.equal(err.status, 404);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('createUploadSession disambiguates duplicate filenames within one session', async () => {
  const mocked = installUploadFetch({ slots: ['upl_1', 'upl_2'] });

  try {
    await makeClient().createUploadSession(
      [
        { filename: 'image.png', mimeType: 'image/png', sizeBytes: 10 },
        { filename: 'image.png', mimeType: 'image/png', sizeBytes: 20 },
      ],
      { userToken: USER_TOKEN }
    );

    const files = JSON.parse(mocked.requests[0].body as string).files;
    assert.deepEqual(
      files.map((file: any) => file.clientFileId),
      ['image.png', 'image.png#2'],
      'same-named files must not share a slot correlation id'
    );
    assert.deepEqual(
      files.map((file: any) => file.contentType),
      ['image/png', 'image/png']
    );
  } finally {
    mocked.restore();
  }
});

test('submit warns in development when legacy descriptors are omitted', async () => {
  const originalFetch = globalThis.fetch;
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  };
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ submissionId: 'sub_1', forwardedToGithub: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as any;

  try {
    await makeClient().submit(
      {
        title: 'Legacy attachment',
        description: 'References a pre-session storage key',
        platform: 'ios',
        attachments: [{ kind: 'r2', key: 'legacy-key', url: 'https://cdn.example/legacy.log' }],
      },
      USER_TOKEN
    );

    assert.ok(
      warnings.some((warning) => warning.includes('without an uploadId')),
      `expected a dev warning, saw: ${JSON.stringify(warnings)}`
    );
  } finally {
    console.warn = originalWarn;
    globalThis.fetch = originalFetch;
  }
});
