import { enStrings } from './en';
import { zhHansStrings } from './zhHans';
import type { CupThreadStrings, DeepPartial } from './types';

export * from './types';
export { enStrings } from './en';
export { zhHansStrings } from './zhHans';

/**
 * Deeply merges partial override strings into a target base dictionary.
 */
function mergeDeep<T extends Record<string, any>>(target: T, source?: Record<string, any>): T {
  if (!source) return target;
  const result: any = { ...target };
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = target[key];
    if (
      srcVal &&
      typeof srcVal === 'object' &&
      !Array.isArray(srcVal) &&
      typeof srcVal !== 'function' &&
      tgtVal &&
      typeof tgtVal === 'object' &&
      !Array.isArray(tgtVal) &&
      typeof tgtVal !== 'function'
    ) {
      result[key] = mergeDeep(tgtVal, srcVal);
    } else if (srcVal !== undefined) {
      result[key] = srcVal;
    }
  }
  return result;
}

/**
 * Resolves full localized {@link CupThreadStrings} for a specified locale identifier and optional custom overrides.
 *
 * @param locale - BCP 47 language tag or alias (e.g. `'en'`, `'zh-Hans'`, `'zh'`, `'zh-CN'`). Defaults to `'en'`.
 * @param customOverrides - Optional developer-specified string overrides.
 * @returns Fully merged {@link CupThreadStrings} dictionary.
 *
 * @example
 * ```ts
 * const strings = getLocaleStrings('zh-Hans', {
 *   featureRequests: { screenTitle: '社区新想法' },
 * });
 * ```
 */
export function getLocaleStrings(
  locale: string = 'en',
  customOverrides?: DeepPartial<CupThreadStrings>
): CupThreadStrings {
  const norm = locale.toLowerCase().replace(/_/g, '-');
  const base = norm.startsWith('zh') ? zhHansStrings : enStrings;
  if (!customOverrides) {
    return base;
  }
  return mergeDeep(base, customOverrides);
}
