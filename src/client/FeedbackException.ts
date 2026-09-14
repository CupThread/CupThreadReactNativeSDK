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
    super(`CupThread API responded with unexpected status HTTP ${status}: ${responseBody}`);
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
