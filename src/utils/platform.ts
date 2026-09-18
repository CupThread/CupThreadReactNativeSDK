import type { FeedbackPlatform } from '../types';

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
 * - When `allowed` is empty or undefined, `requested ?? fallback` is returned unchanged
 *   (preserving legacy behavior where the server remains authoritative).
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
  if (!allowed || allowed.length === 0) {
    return requested ?? fallback;
  }

  if (requested && allowed.includes(requested)) {
    return requested;
  }

  // If requested is absent and fallback is in the allowlist, honor fallback without warning.
  if (!requested && allowed.includes(fallback)) {
    return fallback;
  }

  const resolved = allowed[0] ?? fallback;
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
