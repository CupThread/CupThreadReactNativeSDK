import type { FeedbackPlatform } from '../types';

/**
 * Platform values the intake endpoint accepts on the wire.
 *
 * The live schema (`FeedbackSubmissionInput.platform`) enumerates only these
 * four — `'web'` is a host-facing convenience that must be coerced before
 * serialization.
 */
export type ApiFeedbackPlatform = 'ios' | 'macos' | 'android' | 'universal';

/**
 * Coerces a host-facing platform to the nearest value the intake endpoint
 * accepts. `'web'` submissions are cross-platform by nature, so they map to
 * `'universal'`; every already-valid value passes through unchanged.
 */
export function toWirePlatform(platform: FeedbackPlatform): ApiFeedbackPlatform {
  if (
    platform === 'ios' ||
    platform === 'macos' ||
    platform === 'android' ||
    platform === 'universal'
  ) {
    return platform;
  }
  return 'universal';
}

export function getRuntimePlatform(): FeedbackPlatform {
  try {
    // Dynamically check React Native Platform if running in RN runtime.
    // A runtime require is deliberate: a static import would make this module
    // (and everything transitively importing it) fail to load in plain Node
    // environments where the react-native peer dependency is absent.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Platform } = require('react-native');
    if (Platform && Platform.OS) {
      switch (Platform.OS) {
        case 'ios':
          return 'ios';
        case 'macos':
          return 'macos';
        case 'android':
          return 'android';
        case 'web':
          return 'web';
        default:
          return 'universal';
      }
    }
  } catch {
    // Ignore runtime resolution failure
  }
  return 'universal';
}

function isDev(): boolean {
  if (typeof (globalThis as any).__DEV__ !== 'undefined') {
    return Boolean((globalThis as any).__DEV__);
  }
  return process.env.NODE_ENV !== 'production';
}

/**
 * Resolves an outgoing feedback platform against the application's configured allowlist.
 *
 * Host-facing values that the intake endpoint rejects on the wire (`'web'`) are
 * coerced via {@link toWirePlatform} before matching, so the resolved platform is
 * always serializable whether or not an allowlist is configured.
 *
 * - When `allowed` is empty or undefined, the coerced `requested ?? fallback` is returned.
 * - When `requested` is present and contained in `allowed`, `requested` is returned.
 * - When `requested` is absent or not in `allowed`, the first entry of `allowed` (or `fallback`
 *   if `allowed` is empty) is returned, and a warning is logged via `console.warn` in development
 *   builds so hosts learn of the configuration/allowlist mismatch.
 *
 * @param requested - The platform requested on the feedback draft or client configuration.
 * @param allowed - Target platforms enabled for this application (`PublicAppConfig.allowedPlatforms`).
 * @param fallback - Fallback runtime platform to use when no allowlist is configured or allowlist is empty.
 * @returns The resolved platform conforming to the allowlist when provided.
 */
export function resolveAllowedPlatform(
  requested: FeedbackPlatform | undefined,
  allowed: FeedbackPlatform[] | undefined,
  fallback: FeedbackPlatform
): FeedbackPlatform {
  const wireRequested = requested ? toWirePlatform(requested) : undefined;
  const wireFallback = toWirePlatform(fallback);

  if (!allowed || allowed.length === 0) {
    return wireRequested ?? wireFallback;
  }

  if (wireRequested && allowed.includes(wireRequested)) {
    return wireRequested;
  }

  // If requested is absent and fallback is in the allowlist, honor fallback without warning.
  if (!wireRequested && allowed.includes(wireFallback)) {
    return wireFallback;
  }

  const resolved = toWirePlatform(allowed[0] ?? fallback);
  if (isDev()) {
    const requestedStr = requested ? `"${requested}"` : `default/fallback "${fallback}"`;
    console.warn(
      `[CupThread] Feedback platform ${requestedStr} is not in the app's allowedPlatforms allowlist (${allowed.join(', ')}). Falling back to "${resolved}".`
    );
  }
  return resolved;
}

export const FeedbackPlatformUtil = {
  get current(): FeedbackPlatform {
    return getRuntimePlatform();
  },
  fromWire(value: string): FeedbackPlatform | undefined {
    const valid: FeedbackPlatform[] = ['ios', 'macos', 'android', 'universal', 'web'];
    return valid.includes(value as FeedbackPlatform) ? (value as FeedbackPlatform) : undefined;
  },
  resolveAllowedPlatform,
};
