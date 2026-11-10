import {
  InactiveSubscriptionException,
  InvalidResponseException,
  PaymentRequiredException,
  QuotaExceededException,
  RequestTimeoutException,
  TurnstileRequiredException,
  UploadRejectedException,
  UploadValidationException,
} from '../client/FeedbackException';
import type { CommonStrings, FeedbackComposerStrings } from '../i18n/types';

/**
 * Maps a caught error to a safe, localized string suitable for rendering to
 * end users.
 *
 * Transport-level exceptions embed technical detail in their `message`
 * (timeouts, URLs, parse failures) and are replaced by localized `common`
 * strings. Quota and subscription exceptions (`QuotaExceededException`,
 * `InactiveSubscriptionException`) map to localized quota and subscription
 * copy, and `PaymentRequiredException` preserves actionable server messaging.
 * Every other error — including `UnexpectedStatusException`, which
 * no longer carries the raw response body in its `message` — falls back to
 * the caller's surface-specific localized string (e.g.
 * `strings.comments.postFailed`), so raw server payloads and English-only
 * internals never bypass i18n on screen.
 *
 * Host developers retain full diagnostics on the error object itself
 * (`err.message`, `err.status`, `err.responseBody`).
 *
 * @param err - The caught error (unknown-safe).
 * @param fallback - Localized fallback string for the failing surface.
 * @param common - The active locale's `common` dictionary.
 * @returns A localized, user-safe error message.
 */
export function userFacingErrorMessage(
  err: unknown,
  fallback: string,
  common?: CommonStrings | null
): string {
  const safeFallback = typeof fallback === 'string' ? fallback : 'An unexpected error occurred';
  const safeCommon = common && typeof common === 'object' ? common : null;

  if (err instanceof TurnstileRequiredException) {
    return typeof safeCommon?.verificationRequired === 'string'
      ? safeCommon.verificationRequired
      : safeFallback;
  }
  if (err instanceof QuotaExceededException) {
    return typeof safeCommon?.quotaExceeded === 'string'
      ? safeCommon.quotaExceeded
      : typeof (err as Error)?.message === 'string' && (err as Error).message
        ? (err as Error).message
        : safeFallback;
  }
  if (err instanceof InactiveSubscriptionException) {
    return typeof safeCommon?.subscriptionInactive === 'string'
      ? safeCommon.subscriptionInactive
      : typeof (err as Error)?.message === 'string' && (err as Error).message
        ? (err as Error).message
        : safeFallback;
  }
  if (err instanceof PaymentRequiredException) {
    return typeof (err as Error)?.message === 'string' && (err as Error).message
      ? (err as Error).message
      : safeFallback;
  }
  if (err instanceof RequestTimeoutException) {
    return typeof safeCommon?.timeoutError === 'string' ? safeCommon.timeoutError : safeFallback;
  }
  if (err instanceof InvalidResponseException) {
    return typeof safeCommon?.networkError === 'string' ? safeCommon.networkError : safeFallback;
  }
  return safeFallback;
}

/**
 * Maps a failed attachment upload to a localized message.
 *
 * Upload failures are actionable in a way generic request failures are not: an
 * undeclared size can only be fixed by the host picker, an oversized or
 * unsupported file can only be fixed by the user, and a session that expired
 * mid-upload only needs a retry. Those cases get dedicated strings; everything
 * else falls back to the upload surface's localized error.
 *
 * @param err - The caught error (unknown-safe).
 * @param strings - The active locale's `feedbackComposer` dictionary.
 * @param common - The active locale's `common` dictionary.
 * @returns A localized, user-safe error message.
 */
export function uploadErrorMessage(
  err: unknown,
  strings?: FeedbackComposerStrings | null,
  common?: CommonStrings | null
): string {
  const safeStrings = strings && typeof strings === 'object' ? strings : null;
  const fallbackUploadFailed =
    typeof safeStrings?.uploadFailed === 'string' ? safeStrings.uploadFailed : 'Upload failed';

  if (err instanceof UploadValidationException) {
    if (err.code === 'file_size_required') {
      return typeof safeStrings?.uploadSizeMissing === 'string'
        ? safeStrings.uploadSizeMissing
        : fallbackUploadFailed;
    }
    return fallbackUploadFailed;
  }
  if (err instanceof UploadRejectedException) {
    if (err.status === 413 || err.code === 'file_too_large') {
      return typeof safeStrings?.uploadTooLarge === 'string'
        ? safeStrings.uploadTooLarge
        : fallbackUploadFailed;
    }
    if (err.code === 'unsupported_mime_type' || err.code === 'executable_extension_prohibited') {
      return typeof safeStrings?.uploadUnsupportedType === 'string'
        ? safeStrings.uploadUnsupportedType
        : fallbackUploadFailed;
    }
  }
  return userFacingErrorMessage(err, fallbackUploadFailed, common);
}
