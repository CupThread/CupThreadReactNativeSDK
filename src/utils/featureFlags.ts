import type { PublicAppConfig, SdkFeatures } from '../types';

/**
 * Valid SDK surfaces governed by remote feature flags.
 */
export type SdkSurface = keyof SdkFeatures;

/**
 * Evaluates whether a given SDK surface is enabled according to remote feature flags.
 *
 * @remarks
 * Safe by default: returns `true` when `appConfig` is `null` or `undefined` (config not
 * yet loaded or fetch failed) or when `sdk.features` or the specific flag is
 * `undefined` (older backend version). Gating activates only on an explicit `false`.
 *
 * @param appConfig - Remote application configuration, or `null`/`undefined`.
 * @param surface - The SDK surface to check ('feedback' | 'featureRequests' | 'roadmap' | 'changelog').
 * @returns `false` only if the remote feature flag explicitly disables the surface; otherwise `true`.
 *
 * @example
 * ```ts
 * if (!isLoadingConfig && !isSurfaceEnabled(appConfig, 'roadmap')) {
 *   // surface is disabled
 * }
 * ```
 */
export function isSurfaceEnabled(
  appConfig: PublicAppConfig | null | undefined,
  surface: SdkSurface
): boolean {
  if (!appConfig) return true;
  const features = appConfig.sdk?.features;
  if (!features) return true;
  const flag = features[surface];
  if (flag === undefined) return true;
  return flag !== false;
}
