import type { CommonStrings } from '../i18n';

/**
 * Formats an ISO 8601 date string to a human-friendly relative or calendar date.
 *
 * @param isoDateString - ISO 8601 timestamp string.
 * @param commonStrings - Optional localized relative time strings.
 * @returns Human-friendly relative date representation (e.g. `'Just now'`, `'5m ago'`).
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
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSec < 60) return commonStrings?.justNow ?? 'Just now';
  if (diffMin < 60) return commonStrings?.minutesAgo ? commonStrings.minutesAgo(diffMin) : `${diffMin}m ago`;
  if (diffHours < 24) return commonStrings?.hoursAgo ? commonStrings.hoursAgo(diffHours) : `${diffHours}h ago`;
  if (diffDays < 7) return commonStrings?.daysAgo ? commonStrings.daysAgo(diffDays) : `${diffDays}d ago`;

  return date.toLocaleDateString(undefined, {
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    month: 'short',
    day: 'numeric',
  });
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
 * Generates an RFC 4122 v4 compliant UUID in pure JavaScript.
 */
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Returns current ISO 8601 timestamp string in UTC.
 */
export function iso8601Now(): string {
  return new Date().toISOString();
}
