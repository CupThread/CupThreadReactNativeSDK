import type { CommonStrings } from '../i18n';

/**
 * Tolerance for device clock skew: timestamps up to a day in the future are
 * still rendered with relative phrasing (clamped to "Just now"). Anything
 * further ahead is treated as a scheduled or incorrect date and rendered as a
 * calendar date instead of a permanently stale relative label.
 */
const FUTURE_DATE_TOLERANCE_MS = 24 * 60 * 60 * 1000;

function formatCalendarDate(date: Date, now: Date): string {
  return date.toLocaleDateString(undefined, {
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Formats an ISO 8601 date string to a human-friendly relative or calendar date.
 *
 * @param isoDateString - ISO 8601 timestamp string.
 * @param commonStrings - Optional localized relative time strings.
 * @returns Human-friendly relative date representation (e.g. `'Just now'`, `'5m ago'`).
 *
 * @remarks
 * Small device clock skew is clamped, so a timestamp a few seconds or minutes
 * ahead still renders as `'Just now'`. Dates more than {@link FUTURE_DATE_TOLERANCE_MS}
 * ahead fall through to the calendar rendering rather than showing a relative label forever.
 */
export function formatDate(
  isoDateString?: string | null,
  commonStrings?: CommonStrings
): string {
  if (!isoDateString) return '';
  const date = new Date(isoDateString);
  if (isNaN(date.getTime())) return isoDateString;

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  if (diffMs < -FUTURE_DATE_TOLERANCE_MS) {
    return formatCalendarDate(date, now);
  }

  const diffSec = Math.floor(Math.max(0, diffMs) / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSec < 60) return commonStrings?.justNow ?? 'Just now';
  if (diffMin < 60) return commonStrings?.minutesAgo ? commonStrings.minutesAgo(diffMin) : `${diffMin}m ago`;
  if (diffHours < 24) return commonStrings?.hoursAgo ? commonStrings.hoursAgo(diffHours) : `${diffHours}h ago`;
  if (diffDays < 7) return commonStrings?.daysAgo ? commonStrings.daysAgo(diffDays) : `${diffDays}d ago`;

  return formatCalendarDate(date, now);
}

/**
 * Formats byte counts into human-readable strings (e.g. 512 B, 1.2 MB).
 *
 * @param bytes - Size in bytes.
 * @returns Readable file size string.
 */
export function formatFileSize(bytes?: number): string {
  if (bytes === undefined || bytes === null || isNaN(bytes)) return '';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const size = bytes / Math.pow(1024, i);
  return `${size >= 10 || i === 0 ? Math.round(size) : size.toFixed(1)} ${units[i]}`;
}

/**
 * Minimal structural view of the Web Crypto surfaces used by {@link generateUUID}.
 * Optional members tolerate runtimes and polyfills that expose only one of them.
 */
interface SecureRandomSource {
  randomUUID?: () => string;
  getRandomValues?: (array: Uint8Array) => Uint8Array;
}

function uuidHexByte(byte: number): string {
  return byte.toString(16).padStart(2, '0');
}

/**
 * Generates an RFC 4122 v4 compliant UUID from a cryptographically secure source.
 *
 * @returns A v4 UUID string.
 *
 * @remarks
 * Prefers `crypto.randomUUID`, then fills the 16 bytes via `crypto.getRandomValues`
 * with the RFC 4122 version/variant bits applied. The user token store mints
 * anonymous identity tokens with this function; those tokens authorize votes,
 * comments, and subscriptions, so `Math.random` must never back them. A runtime
 * exposing neither secure API throws instead of silently degrading.
 */
export function generateUUID(): string {
  const secureRandom: SecureRandomSource | undefined =
    typeof crypto !== 'undefined' ? (crypto as SecureRandomSource) : undefined;

  if (secureRandom && typeof secureRandom.randomUUID === 'function') {
    return secureRandom.randomUUID();
  }

  if (secureRandom && typeof secureRandom.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    secureRandom.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
    const hex = Array.from(bytes, uuidHexByte).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  throw new Error(
    'generateUUID requires a cryptographically secure random source ' +
      '(crypto.randomUUID or crypto.getRandomValues). Math.random is not ' +
      'acceptable for anonymous identity tokens; install a Web Crypto ' +
      'polyfill such as react-native-get-random-values or expo-crypto.'
  );
}

/**
 * Returns current ISO 8601 timestamp string in UTC.
 */
export function iso8601Now(): string {
  return new Date().toISOString();
}
