/**
 * A pluggable source for the current device locale. Returns a raw BCP 47 tag
 * (e.g. `'pt-BR'`, `'zh-Hans-CN'`) or `null` when nothing can be detected.
 */
export type DeviceLocaleDetector = () => string | null;

let customDetector: DeviceLocaleDetector | null = null;
let cachedBuiltinLocale: string | null | undefined;

/**
 * Reads the device locale for `'auto'` locale resolution.
 *
 * @returns A raw BCP 47 tag from the first available source, or `null` when
 * nothing is detectable (e.g. plain Node tooling) — callers fall back to `'en'`.
 *
 * @remarks
 * Sources are consulted in order:
 *
 * 1. The detector registered via {@link setDeviceLocaleProvider} (host- or
 *    test-provided; always consulted fresh so dynamic sources keep working).
 * 2. `expo-localization` — top-level `getLocales()[].languageTag`, then
 *    top-level `locale` (expo-localization 10.x), then legacy nested
 *    `Localization` exports when present.
 * 3. `react-native-localize` — the common choice in bare React Native apps.
 * 4. React Native core: `SettingsManager` on iOS, `I18nManager` on Android,
 *    `navigator.language` on web.
 *
 * Both localization packages are **optional**: the requires below use the same
 * runtime-`require` pattern as `getRuntimePlatform()` so plain-Node tooling
 * keeps working, and Metro's default `allowOptionalDependencies` treats the
 * try/catch-wrapped requires as optional instead of failing the bundle when
 * the package is absent. The built-in result is memoized — the device locale
 * is stable within a session — and can be cleared with
 * {@link resetDeviceLocaleCache}.
 */
export function getDeviceLocale(): string | null {
  if (customDetector) {
    return customDetector();
  }
  if (cachedBuiltinLocale === undefined) {
    cachedBuiltinLocale = detectDeviceLocale();
  }
  return cachedBuiltinLocale;
}

/**
 * Registers a custom device-locale source that takes precedence over the
 * built-in detection. Useful for hosts that persist an in-app language
 * choice, and for tests to simulate device languages. Pass `null` to restore
 * built-in detection.
 */
export function setDeviceLocaleProvider(detector: DeviceLocaleDetector | null): void {
  customDetector = detector;
}

/**
 * Clears the memoized built-in detection result so the next
 * {@link getDeviceLocale} call re-runs it. Intended for tests and hot reload.
 */
export function resetDeviceLocaleCache(): void {
  cachedBuiltinLocale = undefined;
}

function detectDeviceLocale(): string | null {
  return detectViaOptionalPackages() ?? detectViaReactNativeCore();
}

/**
 * Reads a BCP 47 tag from a loaded `expo-localization` module export.
 *
 * Supports the modern top-level `getLocales` API, the v10 `locale` string, and
 * the legacy nested `Localization` object for older host bundles.
 */
export function resolveExpoLocalizationLanguageTag(expoLocalization: unknown): string | null {
  if (!expoLocalization || typeof expoLocalization !== 'object') {
    return null;
  }

  const getLocales =
    'getLocales' in expoLocalization && typeof expoLocalization.getLocales === 'function'
      ? expoLocalization.getLocales
      : undefined;
  const modernLocales = getLocales?.();
  if (Array.isArray(modernLocales)) {
    const firstLocale = modernLocales[0];
    if (firstLocale && typeof firstLocale === 'object' && 'languageTag' in firstLocale) {
      const languageTag = firstLocale.languageTag;
      if (typeof languageTag === 'string' && languageTag) {
        return languageTag;
      }
    }
  }

  if ('locale' in expoLocalization) {
    const moduleLocale = expoLocalization.locale;
    if (typeof moduleLocale === 'string' && moduleLocale) {
      return moduleLocale;
    }
  }

  const legacyLocalization =
    'Localization' in expoLocalization ? expoLocalization.Localization : undefined;
  if (!legacyLocalization || typeof legacyLocalization !== 'object') {
    return null;
  }

  const legacyGetLocales =
    'getLocales' in legacyLocalization && typeof legacyLocalization.getLocales === 'function'
      ? legacyLocalization.getLocales
      : undefined;
  const legacyLocales = legacyGetLocales?.();
  if (Array.isArray(legacyLocales)) {
    const firstLegacyLocale = legacyLocales[0];
    if (
      firstLegacyLocale &&
      typeof firstLegacyLocale === 'object' &&
      'languageTag' in firstLegacyLocale
    ) {
      const languageTag = firstLegacyLocale.languageTag;
      if (typeof languageTag === 'string' && languageTag) {
        return languageTag;
      }
    }
  }

  if ('locale' in legacyLocalization) {
    const nestedLocale = legacyLocalization.locale;
    if (typeof nestedLocale === 'string' && nestedLocale) {
      return nestedLocale;
    }
  }

  return null;
}

function detectViaOptionalPackages(): string | null {
  try {
    // Dynamically check expo-localization if the host app ships it.
    // Runtime requires are deliberate here: see getRuntimePlatform() for the
    // zero-dependency rationale, and the try/catch keeps Metro's optional
    // dependency handling from failing bundles without the package.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const expoLocalization = require('expo-localization');
    const tag = resolveExpoLocalizationLanguageTag(expoLocalization);
    if (tag) {
      return tag;
    }
  } catch {
    // expo-localization not installed — fall through to the next source.
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const reactNativeLocalize = require('react-native-localize');
    const tag = reactNativeLocalize?.getLocales?.()[0]?.languageTag;
    if (typeof tag === 'string' && tag) {
      return tag;
    }
  } catch {
    // react-native-localize not installed — fall through to React Native core.
  }
  return null;
}

function detectViaReactNativeCore(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Platform, NativeModules } = require('react-native');
    if (Platform?.OS === 'web') {
      const nav: Navigator | undefined = typeof navigator === 'undefined' ? undefined : navigator;
      const tag = nav?.language ?? nav?.languages?.[0];
      return typeof tag === 'string' && tag ? tag : null;
    }
    // iOS: SettingsManager exposes the system locale (or the per-app override
    // when the host writes AppleLanguages into NSUserDefaults).
    const appleLocale: unknown =
      NativeModules?.SettingsManager?.settings?.AppleLocale ??
      NativeModules?.SettingsManager?.settings?.AppleLanguages?.[0];
    if (typeof appleLocale === 'string' && appleLocale) {
      return appleLocale;
    }
    // Android: I18nManager exposes the resolved locale identifier.
    const androidLocale: unknown = NativeModules?.I18nManager?.localeIdentifier;
    if (typeof androidLocale === 'string' && androidLocale) {
      return androidLocale;
    }
  } catch {
    // react-native not importable (plain Node tooling) — no core locale source.
  }
  return null;
}
