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
 * The scheme is resolved after stripping whitespace and control characters and
 * normalized to lowercase, so inputs like `' HTTPS://example.com'` or
 * `'java\u0000script:alert(1)'` are parsed by their real scheme rather than by
 * a literal prefix match.
 *
 * @param url - Raw URL string extracted from content.
 * @param options - Optional toggles for additional allowed schemes.
 * @returns `true` only when the URL uses an explicitly allowed scheme.
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
 * ```
 */
export function isSafeLinkUrl(
  url: string,
  options?: { allowMailto?: boolean }
): boolean {
  if (!url || typeof url !== 'string') return false;

  const cleaned = url.replace(/[\u0000-\u001f\u007f\s]+/g, '');
  if (!cleaned) return false;

  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.\-]*):/.exec(cleaned);
  if (!schemeMatch) return false;

  const scheme = `${schemeMatch[1]}:`.toLowerCase();
  if (scheme === 'mailto:') {
    return options?.allowMailto === true;
  }
  return DEFAULT_SAFE_SCHEMES.has(scheme);
}
