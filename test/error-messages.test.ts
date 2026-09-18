import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FeedbackException,
  InvalidResponseException,
  RequestTimeoutException,
  TurnstileRequiredException,
  UnexpectedStatusException,
} from '../src/client/FeedbackException';
import { userFacingErrorMessage } from '../src/utils/errors';
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
