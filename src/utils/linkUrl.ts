/**
 * URL schemes that are safe to open from user-generated markdown content.
 *
 * Everything else (`tel:`, `sms:`, `facetime:`, `intent:`, `javascript:`,
 * custom third-party app schemes, …) is rejected so malicious links embedded
 * in remote comments or feature-request descriptions cannot trigger device
 * side effects with disguised link text.
 */
const DEFAULT_SAFE_SCHEMES = new Set(['http:', 'https:']);

/**
 * Checks whether a URL coming from untrusted content is safe to open.
 *
 * URLs containing ASCII control characters are strictly rejected to prevent
 * parser differentials or smuggling exploits. The scheme is extracted after
 * trimming leading/trailing whitespace and normalized to lowercase.
 *
 * @param url - Raw URL string extracted from content.
 * @param options - Optional toggles for additional allowed schemes.
 * @returns `true` only when the URL uses an explicitly allowed scheme and contains no control characters.
 *
 * @example
 * ```ts
 * isSafeLinkUrl('https://cupthread.com');       // true
 * isSafeLinkUrl('  HTTPS://cupthread.com ');    // true
 * isSafeLinkUrl('mailto:hi@cupthread.com');     // false
 * isSafeLinkUrl('mailto:hi@cupthread.com', { allowMailto: true }); // true
 * isSafeLinkUrl('tel:+18005550199');            // false
 * isSafeLinkUrl('intent://share#Intent');       // false
 * isSafeLinkUrl('javascript:alert(1)');         // false
 * isSafeLinkUrl('java\nscript:alert(1)');       // false
 * ```
 */
export function isSafeLinkUrl(
  url: string,
  options?: { allowMailto?: boolean }
): boolean {
  if (!url || typeof url !== 'string') return false;

  // Reject control characters outright to prevent parser differentials or smuggling
  if (/[\u0000-\u001f\u007f]/.test(url)) return false;

  const trimmed = url.trim();
  if (!trimmed) return false;

  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.\-]*):/.exec(trimmed);
  if (!schemeMatch) return false;

  const scheme = `${schemeMatch[1]}:`.toLowerCase();
  if (scheme === 'mailto:') {
    return options?.allowMailto === true;
  }
  return DEFAULT_SAFE_SCHEMES.has(scheme);
}

/**
 * Returns the trimmed URL if it passes {@link isSafeLinkUrl}, or `null` otherwise.
 */
export function sanitizeSafeLinkUrl(
  url: string,
  options?: { allowMailto?: boolean }
): string | null {
  if (!isSafeLinkUrl(url, options)) return null;
  return url.trim();
}

