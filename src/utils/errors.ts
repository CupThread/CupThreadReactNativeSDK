import {
  InvalidResponseException,
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
 * strings. Every other error — including `UnexpectedStatusException`, which
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
  common: CommonStrings
): string {
  if (err instanceof TurnstileRequiredException) return common.verificationRequired;
  if (err instanceof RequestTimeoutException) return common.timeoutError;
  if (err instanceof InvalidResponseException) return common.networkError;
  return fallback;
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
  strings: FeedbackComposerStrings,
  common: CommonStrings
): string {
  if (err instanceof UploadValidationException) {
    if (err.code === 'file_size_required') return strings.uploadSizeMissing;
    return strings.uploadFailed;
  }
  if (err instanceof UploadRejectedException) {
    if (err.status === 413 || err.code === 'file_too_large') return strings.uploadTooLarge;
    if (err.code === 'unsupported_mime_type' || err.code === 'executable_extension_prohibited') {
      return strings.uploadUnsupportedType;
    }
  }
  return userFacingErrorMessage(err, strings.uploadFailed, common);
}
