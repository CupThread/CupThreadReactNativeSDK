/**
 * Minimal pragmatic email-shape check shared by every surface that collects a
 * contact address (feedback composer reporter email, changelog subscribe).
 *
 * Deliberately not a full RFC 5322 grammar — it rejects the realistic typos
 * that break the reply loop (missing TLD, doubled `@`, whitespace, a trailing
 * comma from a paste) without rejecting exotic-but-real addresses.
 *
 * An empty string is reported as valid: the optional-vs-required decision
 * belongs to the caller (the feedback composer allows an empty reporter
 * email, while the subscribe form rejects empty input before consulting this
 * helper).
 *
 * @param value - The already-trimmed address to check.
 * @returns `true` when the value has a `local@domain.tld` shape.
 *
 * @example
 * ```ts
 * isValidEmail('jane@example.com'); // true
 * isValidEmail('john@gmail');       // false
 * isValidEmail('');                 // true (emptiness is the caller's call)
 * ```
 */
export function isValidEmail(value: string): boolean {
  // The shape alone would accept paste artifacts that ride inside the TLD
  // (`jane@example.com,`), so also require the address to end alphanumerically
  // — no real domain ends in punctuation.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && /[a-zA-Z0-9]$/.test(value);
}
