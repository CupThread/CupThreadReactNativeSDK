import { enStrings } from './en';
import { deStrings } from './de';
import { esStrings } from './es';
import { frStrings } from './fr';
import { itStrings } from './it';
import { jaStrings } from './ja';
import { koStrings } from './ko';
import { noStrings } from './no';
import { plStrings } from './pl';
import { ptStrings } from './pt';
import { trStrings } from './tr';
import { viStrings } from './vi';
import { zhHantStrings } from './zhHant';
import { zhHansStrings } from './zhHans';
import type { CupThreadStrings, DeepPartial } from './types';

export * from './types';
export { enStrings } from './en';
export { deStrings } from './de';
export { esStrings } from './es';
export { frStrings } from './fr';
export { itStrings } from './it';
export { jaStrings } from './ja';
export { koStrings } from './ko';
export { noStrings } from './no';
export { plStrings } from './pl';
export { ptStrings } from './pt';
export { trStrings } from './tr';
export { viStrings } from './vi';
export { zhHantStrings } from './zhHant';
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
 * @param locale - BCP 47 language tag or alias (e.g. `'en'`, `'fr'`, `'ja'`, `'ko-KR'`, `'nb-NO'`, `'pt-BR'`, `'vi-VN'`, `'zh-Hant'`, `'zh-TW'`, `'zh-CN'`). Defaults to `'en'`.
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
  const base = norm.startsWith('zh-hant') || norm.startsWith('zh-tw') || norm.startsWith('zh-hk') || norm.startsWith('zh-mo')
    ? zhHantStrings
    : norm.startsWith('zh')
      ? zhHansStrings
      : norm.startsWith('ja')
        ? jaStrings
        : norm.startsWith('fr')
          ? frStrings
          : norm.startsWith('es')
            ? esStrings
            : norm.startsWith('de')
              ? deStrings
              : norm.startsWith('it')
                ? itStrings
                : norm.startsWith('pt')
                  ? ptStrings
                  : norm.startsWith('ko')
                    ? koStrings
                    : norm.startsWith('pl')
                      ? plStrings
                      : norm.startsWith('no') || norm.startsWith('nb')
                        ? noStrings
                        : norm.startsWith('tr')
                          ? trStrings
                          : norm.startsWith('vi')
                            ? viStrings
                            : enStrings;
  if (!customOverrides) {
    return base;
  }
  return mergeDeep(base, customOverrides);
}
