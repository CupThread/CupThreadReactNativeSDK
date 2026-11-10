import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FeedbackException,
  InvalidResponseException,
  RequestTimeoutException,
  TurnstileRequiredException,
  UnexpectedStatusException,
  UploadRejectedException,
  UploadValidationException,
} from '../src/client/FeedbackException';
import { uploadErrorMessage, userFacingErrorMessage } from '../src/utils/errors';
import { enStrings, zhHansStrings, jaStrings } from '../src/i18n';

const HTML_502 = '<html><body><h1>502 Bad Gateway</h1></body></html>';

test('UnexpectedStatusException message no longer embeds the raw response body', () => {
  const err = new UnexpectedStatusException(500, 'secret-internals');
  assert.ok(!err.message.includes('secret-internals'));
  assert.equal(err.status, 500);
  assert.equal(err.responseBody, 'secret-internals');
  assert.ok(err instanceof FeedbackException);
});

test('userFacingErrorMessage never leaks transport internals to the UI', () => {
  const err = new UnexpectedStatusException(502, HTML_502);
  const msg = userFacingErrorMessage(err, enStrings.comments.postFailed, enStrings.common);
  assert.equal(msg, enStrings.comments.postFailed);
  assert.ok(!msg.includes('HTTP 502'));
  assert.ok(!msg.includes('<html>'));
  assert.ok(!msg.includes('Bad Gateway'));
});

test('RequestTimeoutException maps to the localized timeout string', () => {
  const err = new RequestTimeoutException(15000);
  assert.equal(
    userFacingErrorMessage(err, enStrings.comments.postFailed, enStrings.common),
    enStrings.common.timeoutError
  );
  assert.equal(
    userFacingErrorMessage(err, '提交失败', zhHansStrings.common),
    zhHansStrings.common.timeoutError
  );
  assert.equal(
    userFacingErrorMessage(err, '投稿失敗', jaStrings.common),
    jaStrings.common.timeoutError
  );
  assert.ok(!enStrings.common.timeoutError.includes('15000'));
});

test('TurnstileRequiredException maps to the localized verification-required string', () => {
  const err = new TurnstileRequiredException(403, 'Human verification required');
  const msg = userFacingErrorMessage(err, enStrings.comments.postFailed, enStrings.common);
  assert.equal(msg, enStrings.common.verificationRequired);
});

test('InvalidResponseException maps to the localized network-error string', () => {
  const err = new InvalidResponseException(
    'Network request failed for https://api.cupthread.com/api/v1/feedback'
  );
  const msg = userFacingErrorMessage(err, enStrings.comments.postFailed, enStrings.common);
  assert.equal(msg, enStrings.common.networkError);
  assert.ok(!msg.includes('https://'));
});

test('Unknown errors fall back to the surface-specific localized string', () => {
  assert.equal(
    userFacingErrorMessage(new Error('boom'), enStrings.comments.postFailed, enStrings.common),
    enStrings.comments.postFailed
  );
  assert.equal(userFacingErrorMessage(undefined, 'Post failed', enStrings.common), 'Post failed');
  assert.equal(userFacingErrorMessage('weird', 'Post failed', enStrings.common), 'Post failed');
});

test('Developer diagnostics are preserved on the exception object', () => {
  const err = new UnexpectedStatusException(502, HTML_502);
  assert.equal(err.status, 502);
  assert.equal(err.responseBody, HTML_502);
  assert.ok(err instanceof FeedbackException);
  assert.ok(err instanceof Error);
});

test('userFacingErrorMessage safely handles null, undefined, or malformed common dictionary and fallback (#369)', () => {
  assert.equal(
    userFacingErrorMessage(new RequestTimeoutException(15000), 'Fallback', null as any),
    'Fallback'
  );
  assert.equal(
    userFacingErrorMessage(new TurnstileRequiredException(403), 'Fallback', undefined as any),
    'Fallback'
  );
  assert.equal(
    userFacingErrorMessage(new InvalidResponseException('error'), 'Fallback', {} as any),
    'Fallback'
  );
  assert.equal(
    userFacingErrorMessage(
      new InvalidResponseException('error'),
      'Fallback',
      'not-an-object' as any
    ),
    'Fallback'
  );
  assert.equal(userFacingErrorMessage(new Error('boom'), '', null as any), '');
  assert.equal(userFacingErrorMessage(new Error('boom'), '   ', undefined as any), '   ');
  assert.equal(
    userFacingErrorMessage(new Error('boom'), null as any, null as any),
    'An unexpected error occurred'
  );
  assert.equal(
    userFacingErrorMessage(new Error('boom'), undefined as any, undefined as any),
    'An unexpected error occurred'
  );
});

test('uploadErrorMessage safely handles null, undefined, or malformed strings and common dictionaries (#369)', () => {
  assert.equal(
    uploadErrorMessage(
      new UploadValidationException('file_size_required'),
      null as any,
      null as any
    ),
    'Upload failed'
  );
  assert.equal(
    uploadErrorMessage(
      new UploadValidationException('file_size_required'),
      undefined as any,
      undefined as any
    ),
    'Upload failed'
  );
  assert.equal(
    uploadErrorMessage(new UploadValidationException('generic'), null as any, null as any),
    'Upload failed'
  );
  assert.equal(
    uploadErrorMessage(
      new UploadRejectedException(413, 'file_too_large'),
      null as any,
      null as any
    ),
    'Upload failed'
  );
  assert.equal(
    uploadErrorMessage(
      new UploadRejectedException(400, 'unsupported_mime_type'),
      undefined as any,
      undefined as any
    ),
    'Upload failed'
  );
  assert.equal(
    uploadErrorMessage(
      new UploadRejectedException(400, 'executable_extension_prohibited'),
      {} as any,
      {} as any
    ),
    'Upload failed'
  );
  assert.equal(
    uploadErrorMessage(new RequestTimeoutException(15000), null as any, null as any),
    'Upload failed'
  );
  assert.equal(
    uploadErrorMessage(new TurnstileRequiredException(403), null as any, null as any),
    'Upload failed'
  );
  assert.equal(
    uploadErrorMessage(new InvalidResponseException('network failure'), null as any, null as any),
    'Upload failed'
  );
  assert.equal(uploadErrorMessage(new Error('crash'), null as any, null as any), 'Upload failed');
  assert.equal(uploadErrorMessage(new Error('crash'), {} as any, {} as any), 'Upload failed');

  // Verify valid strings and common dictionaries still work as intended
  assert.equal(
    uploadErrorMessage(
      new UploadValidationException('file_size_required'),
      enStrings.feedbackComposer,
      enStrings.common
    ),
    enStrings.feedbackComposer.uploadSizeMissing
  );
  assert.equal(
    uploadErrorMessage(
      new UploadValidationException('generic'),
      enStrings.feedbackComposer,
      enStrings.common
    ),
    enStrings.feedbackComposer.uploadFailed
  );
  assert.equal(
    uploadErrorMessage(
      new UploadRejectedException(413, 'file_too_large'),
      enStrings.feedbackComposer,
      enStrings.common
    ),
    enStrings.feedbackComposer.uploadTooLarge
  );
  assert.equal(
    uploadErrorMessage(
      new UploadRejectedException(400, 'unsupported_mime_type'),
      enStrings.feedbackComposer,
      enStrings.common
    ),
    enStrings.feedbackComposer.uploadUnsupportedType
  );
  assert.equal(
    uploadErrorMessage(
      new UploadRejectedException(400, 'executable_extension_prohibited'),
      enStrings.feedbackComposer,
      enStrings.common
    ),
    enStrings.feedbackComposer.uploadUnsupportedType
  );
  assert.equal(
    uploadErrorMessage(
      new RequestTimeoutException(15000),
      enStrings.feedbackComposer,
      enStrings.common
    ),
    enStrings.common.timeoutError
  );
  assert.equal(
    uploadErrorMessage(
      new TurnstileRequiredException(403),
      enStrings.feedbackComposer,
      enStrings.common
    ),
    enStrings.common.verificationRequired
  );
  assert.equal(
    uploadErrorMessage(
      new InvalidResponseException('net err'),
      enStrings.feedbackComposer,
      enStrings.common
    ),
    enStrings.common.networkError
  );
});
