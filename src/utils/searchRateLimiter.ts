/**
 * Default minimum spacing between two query-bearing feature-request searches
 * (2.5s → at most 24 searches/minute). The production API rate-limits search
 * requests to 30 / 60s per client IP, so the client paces itself strictly
 * below that budget; typing bursts are absorbed by the debounce + spacing
 * delay instead of burning the server quota.
 */
export const SEARCH_MIN_SPACING_MS = 2500;

/**
 * Default cooldown applied after an HTTP 429 before query-bearing searches
 * resume. Individual searches stay suppressed until it elapses; plain
 * (non-search) listings are unaffected.
 */
export const SEARCH_COOLDOWN_MS = 60_000;

/**
 * Upper bound clamped onto a server-provided `Retry-After` cooldown so a
 * pathological header value cannot disable searching indefinitely.
 */
export const MAX_SEARCH_COOLDOWN_MS = 120_000;

/**
 * Tuning knobs for {@link SearchRateLimiter}. Production defaults keep the
 * client strictly under the backend's 30 searches / 60s per-IP budget.
 */
export interface SearchRateLimiterOptions {
  /**
   * Minimum spacing in milliseconds between two query-bearing fetches.
   *
   * @defaultValue {@link SEARCH_MIN_SPACING_MS}
   */
  minSpacingMs?: number;

  /**
   * Cooldown in milliseconds applied after an HTTP 429 when the server does
   * not provide a usable `Retry-After` value.
   *
   * @defaultValue {@link SEARCH_COOLDOWN_MS}
   */
  cooldownMs?: number;

  /**
   * Clock used for all timing decisions. Injectable for tests.
   *
   * @defaultValue `Date.now`
   */
  now?: () => number;
}

/**
 * Client-side pacer for query-bearing feature-request searches.
 *
 * Tracks the time of the last started search and a post-429 cooldown so the
 * SDK never exceeds the backend search rate limit during normal use. Pure
 * time logic with an injectable clock — no network, no React.
 */
export class SearchRateLimiter {
  private readonly minSpacingMs: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private lastFetchAt = -Infinity;
  private cooldownUntil = -Infinity;

  constructor(options: SearchRateLimiterOptions = {}) {
    this.minSpacingMs = options.minSpacingMs ?? SEARCH_MIN_SPACING_MS;
    this.cooldownMs = options.cooldownMs ?? SEARCH_COOLDOWN_MS;
    this.now = options.now ?? Date.now;
  }

  /**
   * True when a query-bearing fetch may start right now: outside the 429
   * cooldown and at least {@link SearchRateLimiterOptions.minSpacingMs} after
   * the previous search started.
   */
  canFetch(): boolean {
    const t = this.now();
    return t >= this.cooldownUntil && t - this.lastFetchAt >= this.minSpacingMs;
  }

  /**
   * Milliseconds to wait before {@link SearchRateLimiter.canFetch} turns true
   * (`0` when a fetch may start immediately). Cooldown dominates spacing.
   */
  waitTime(): number {
    const t = this.now();
    return Math.max(0, this.cooldownUntil - t, this.lastFetchAt + this.minSpacingMs - t);
  }

  /** Records that a query-bearing fetch has started. */
  markFetched(): void {
    this.lastFetchAt = this.now();
  }

  /**
   * Enters the post-429 cooldown. A positive server-provided
   * `retryAfterMs` wins over the default cooldown and is clamped to
   * {@link MAX_SEARCH_COOLDOWN_MS}.
   *
   * @returns The applied cooldown duration in milliseconds.
   */
  enterCooldown(retryAfterMs?: number | null): number {
    const requested =
      typeof retryAfterMs === 'number' && retryAfterMs > 0
        ? Math.min(retryAfterMs, MAX_SEARCH_COOLDOWN_MS)
        : this.cooldownMs;
    this.cooldownUntil = this.now() + requested;
    return requested;
  }

  /**
   * Milliseconds until the post-429 cooldown ends (`0` when it already
   * ended or was never entered).
   */
  cooldownRemaining(): number {
    return Math.max(0, this.cooldownUntil - this.now());
  }
}
