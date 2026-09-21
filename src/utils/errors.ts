import {
  InvalidResponseException,
  RequestTimeoutException,
  TurnstileRequiredException,
} from '../client/FeedbackException';
import type { CommonStrings } from '../i18n/types';

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
