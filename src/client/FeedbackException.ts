/**
 * Base error class for all CupThread SDK operations.
 */
export class FeedbackException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeedbackException';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when an endpoint requires user authentication / token and none was provided.
 */
export class AuthenticationRequiredException extends FeedbackException {
  constructor(
    message: string = 'Anonymous access is disabled for this surface; a user token is required.'
  ) {
    super(message);
    this.name = 'AuthenticationRequiredException';
  }
}

/**
 * Thrown when the server responds with an unexpected HTTP status code.
 */
export class UnexpectedStatusException extends FeedbackException {
  readonly status: number;
  readonly responseBody: string;

  constructor(status: number, responseBody: string) {
    // Keep the raw body off `message` — it must never reach end-user UI. The
    // full payload stays available on `responseBody` for host diagnostics.
    super(`CupThread API responded with unexpected status HTTP ${status}`);
    this.name = 'UnexpectedStatusException';
    this.status = status;
    this.responseBody = responseBody;
  }
}

/**
 * Thrown when an intake endpoint (`POST /api/v1/feedback`,
 * `POST /api/v1/feature-requests`) rejects the submission because Cloudflare
 * Turnstile human verification is required or the supplied token failed.
 *
 * Retry with a fresh token resolved through
 * `FeedbackClientConfig.turnstileTokenProvider` or a draft-level
 * `turnstileToken`.
 */
export class TurnstileRequiredException extends FeedbackException {
  /**
   * Stable machine-readable code so hosts can branch on the failure without
   * parsing the message.
   */
  readonly code = 'turnstile_required';

  readonly status: number;
  readonly responseBody: string;

  constructor(status: number = 403, responseBody: string = '') {
    super(
      `CupThread API requires human verification (Turnstile) before accepting this submission.`
    );
    this.name = 'TurnstileRequiredException';
    this.status = status;
    this.responseBody = responseBody;
  }
}

/**
 * Thrown when an intake endpoint (`POST /api/v1/feedback`,
 * `POST /api/v1/feature-requests`) returns HTTP 402 Payment Required because
 * the workspace has reached its monthly submission quota or its subscription
 * is inactive.
 */
export class PaymentRequiredException extends FeedbackException {
  readonly status: number = 402;
  readonly code?: string;
  readonly responseBody: string;

  constructor(message: string = 'Payment required.', code?: string, responseBody: string = '') {
    super(message);
    this.name = 'PaymentRequiredException';
    this.code = code;
    this.responseBody = responseBody;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when a submission is rejected because the workspace has reached its
 * monthly submission quota (`tier_limit_submissions`).
 */
export class QuotaExceededException extends PaymentRequiredException {
  override readonly code = 'tier_limit_submissions';

  constructor(
    message: string = 'Monthly submission quota reached for this workspace.',
    responseBody: string = ''
  ) {
    super(message, 'tier_limit_submissions', responseBody);
    this.name = 'QuotaExceededException';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when a submission is rejected because the workspace subscription is
 * inactive or canceled (`subscription_inactive`).
 */
export class InactiveSubscriptionException extends PaymentRequiredException {
  override readonly code = 'subscription_inactive';

  constructor(
    message: string = 'Workspace subscription is inactive or canceled.',
    responseBody: string = ''
  ) {
    super(message, 'subscription_inactive', responseBody);
    this.name = 'InactiveSubscriptionException';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown when a response cannot be parsed or transport failure occurs.
 */
export class InvalidResponseException extends FeedbackException {
  readonly cause?: unknown;

  constructor(message: string = 'Failed to parse response from CupThread API', cause?: unknown) {
    super(message);
    this.name = 'InvalidResponseException';
    this.cause = cause;
  }
}

/**
 * Thrown when an attachment upload succeeds at HTTP level but returns unreadable payload.
 */
export class UnreadableUploadResponseException extends FeedbackException {
  constructor(
    message: string = 'Attachment upload completed but server response could not be parsed.'
  ) {
    super(message);
    this.name = 'UnreadableUploadResponseException';
  }
}

/**
 * Thrown when an email unsubscribe is attempted without a signed token.
 *
 * Both unsubscribe endpoints are token-gated: the changelog route was changed
 * because a bare email address could unsubscribe anyone (SEC-14), and the
 * weekly digest route only clears the preference described by the signed token
 * in its own email. A blank value has no signature to verify, so it is
 * rejected locally instead of being sent to the API.
 */
export class MissingUnsubscribeTokenException extends FeedbackException {
  constructor(message: string = 'A signed unsubscribe token from the email link is required.') {
    super(message);
    this.name = 'MissingUnsubscribeTokenException';
  }
}

/**
 * Thrown before any network round trip when an attachment upload cannot even
 * be described to the upload-session API.
 *
 * The session endpoint reserves quota from the declared byte size, so an
 * undeclared size is a client error (`file_size_required`) rather than a
 * request the server could recover from. React Native pickers that hand back
 * a bare `{ uri }` carry no size; hosts must forward the picker's `fileSize`.
 */
export class UploadValidationException extends FeedbackException {
  /**
   * Machine-readable reason:
   * - `file_size_required`: the attachment declared no positive byte size.
   * - `invalid_file_count`: a session was requested for 0 or more than 8 files.
   * - `invalid_field`: a filename or MIME type was blank.
   */
  readonly code: 'file_size_required' | 'invalid_file_count' | 'invalid_field';

  constructor(
    code: 'file_size_required' | 'invalid_file_count' | 'invalid_field',
    message: string
  ) {
    super(message);
    this.name = 'UploadValidationException';
    this.code = code;
  }
}

/**
 * Thrown when the upload-session API rejects a session or a file slot.
 *
 * The public upload endpoints answer with a deterministic `code`; this class
 * keeps it alongside the HTTP status so hosts can distinguish an oversized
 * file (`file_too_large`, HTTP 413) from an unsupported MIME type, a prohibited
 * executable extension, a missing anonymous identity, or a session that
 * expired mid-upload.
 */
export class UploadRejectedException extends FeedbackException {
  readonly status: number;

  /**
   * Server-provided machine-readable code (e.g. `file_too_large`,
   * `unsupported_mime_type`, `executable_extension_prohibited`,
   * `uploader_identity_required`, `uploader_mismatch`,
   * `session_invalid_or_expired`), when the response carried one.
   */
  readonly code?: string;

  /**
   * Raw API error body. A rejection this client decided locally (an oversize
   * pre-flight against the reserved slot limit) synthesizes the API's
   * `{ error, code }` shape here so hosts parse one format.
   */
  readonly responseBody: string;

  constructor(status: number, code?: string, responseBody: string = '') {
    super(
      code
        ? `Upload rejected by CupThread API (HTTP ${status}, ${code}).`
        : `Upload rejected by CupThread API (HTTP ${status}).`
    );
    this.name = 'UploadRejectedException';
    this.status = status;
    this.code = code;
    this.responseBody = responseBody;
  }
}

/**
 * Thrown when an HTTP request or file upload times out before completion.
 */
export class RequestTimeoutException extends FeedbackException {
  readonly timeoutMs: number;

  constructor(timeoutMs: number, message?: string) {
    super(message || `Request timed out after ${timeoutMs}ms`);
    this.name = 'RequestTimeoutException';
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Thrown when the API rate-limits a request (HTTP 429) — e.g. the production
 * search endpoint allows 30 requests / 60s per client IP.
 *
 * Carries the server-provided `Retry-After` hint converted to milliseconds
 * when present so callers can pace their retries.
 */
export class RateLimitedException extends FeedbackException {
  readonly status = 429;
  readonly retryAfterMs: number | null;
  readonly responseBody: string;

  constructor(retryAfterMs: number | null = null, responseBody: string = '') {
    super('CupThread API rate limit exceeded. Please slow down and retry shortly.');
    this.name = 'RateLimitedException';
    this.retryAfterMs = retryAfterMs;
    this.responseBody = responseBody;
  }
}
