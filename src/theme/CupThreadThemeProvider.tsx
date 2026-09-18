import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useMemo,
  useCallback,
  useRef,
} from 'react';
import { useColorScheme } from 'react-native';
import type { SdkTheme, PublicAppConfig } from '../types';
import { FeedbackClient } from '../client/FeedbackClient';
import { UserTokenStore } from '../client/UserTokenStore';
import { getThemeColors, ThemeColors } from './SdkTheme';
import type { CupThreadStrings, DeepPartial } from '../i18n';
import { getLocaleStrings, enStrings } from '../i18n';

declare const __DEV__: boolean | undefined;

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      return reject(err);
    }

    const timer = setTimeout(() => {
      if (signal?.removeEventListener) {
        signal.removeEventListener('abort', onAbort);
      }
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      if (signal?.removeEventListener) {
        signal.removeEventListener('abort', onAbort);
      }
      const err = new Error('The operation was aborted');
      err.name = 'AbortError';
      reject(err);
    }

    if (signal?.addEventListener) {
      signal.addEventListener('abort', onAbort);
    }
  });
}

function logDevConfigWarning(err: unknown) {
  const isDev =
    typeof __DEV__ !== 'undefined'
      ? Boolean(__DEV__)
      : typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production';
  if (isDev) {
    console.warn('[CupThread] Failed to load app config:', err);
  }
}

/**
 * State representing the remote app configuration fetch lifecycle.
 */
export interface ConfigFetchState {
  /**
   * Remote application settings and feature flags, or `null` while loading or after failure.
   */
  appConfig: PublicAppConfig | null;

  /**
   * True while remote configuration is actively being retrieved.
   */
  isLoadingConfig: boolean;

  /**
   * Last configuration fetch failure, or `null` when the last attempt succeeded (or is in flight).
   */
  configError: Error | null;
}

/**
 * Lifecycle events for remote application configuration fetching.
 */
export type ConfigFetchEvent =
  | { type: 'start' }
  | { type: 'success'; config: PublicAppConfig }
  | { type: 'failure'; error: Error }
  | { type: 'abort' };

/**
 * Pure transition helper computing the next config fetch state given an event.
 */
export function nextConfigState(prev: ConfigFetchState, event: ConfigFetchEvent): ConfigFetchState {
  switch (event.type) {
    case 'start':
      return {
        ...prev,
        isLoadingConfig: true,
        configError: null,
      };
    case 'success':
      return {
        appConfig: event.config,
        isLoadingConfig: false,
        configError: null,
      };
    case 'failure':
      return {
        ...prev,
        isLoadingConfig: false,
        configError: event.error,
      };
    case 'abort':
      return prev;
  }
}

/**
 * Determines whether a failed config fetch should be retried automatically.
 *
 * @param attempt - The zero-indexed attempt count (0 for initial failure).
 * @param error - The error encountered during fetch.
 * @returns True if the request should be retried (retries once for non-abort errors).
 */
export function shouldRetryAfterFailure(attempt: number, error: unknown): boolean {
  if (attempt >= 1) {
    return false;
  }
  if (error && typeof error === 'object' && (error as any).name === 'AbortError') {
    return false;
  }
  return true;
}

/**
 * Context value provided by {@link CupThreadProvider} to descendant SDK components.
 */
export interface CupThreadContextValue {
  /**
   * Configured {@link FeedbackClient} instance for executing API operations.
   */
  client: FeedbackClient;

  /**
   * Current active anonymous or user authentication token.
   *
   * @remarks
   * When no explicit `userToken` prop is provided and an async storage adapter
   * (AsyncStorage / SecureStore) is configured, this is an empty string until
   * the persisted token has been recovered — see {@link CupThreadContextValue.isTokenReady}.
   * The provider also follows later identity switches made through
   * {@link UserTokenStore.setToken} / {@link UserTokenStore.resetToken}
   * (e.g. login/logout), so this value stays in sync with the store.
   */
  userToken: string;

  /**
   * True once {@link CupThreadContextValue.userToken} reflects the persisted
   * token (or the explicit prop). Token-dependent fetches should wait for this
   * to avoid attributing early requests to a throwaway identity.
   */
  isTokenReady: boolean;

  /**
   * Resolved theme name (e.g. `'system'`, `'midnight'`, `'ocean'`).
   */
  themeName: SdkTheme;

  /**
   * Resolved color tokens currently applied to components.
   */
  colors: ThemeColors;

  /**
   * Remote application settings and feature flags, or `null` while loading or after failure.
   */
  appConfig: PublicAppConfig | null;

  /**
   * True while remote configuration is actively being retrieved.
   */
  isLoadingConfig: boolean;

  /**
   * Last configuration fetch failure, or `null` when the last attempt succeeded (or is in flight).
   */
  configError: Error | null;

  /**
   * Active locale string (e.g. `'en'`, `'zh-Hans'`).
   */
  locale: string;

  /**
   * Resolved localized strings used by CupThread UI components.
   */
  strings: CupThreadStrings;

  /**
   * Re-fetches remote application configuration from the server.
   *
   * @remarks
   * Clears any previous {@link configError}, resets loading state, and retrieves
   * fresh application settings and branding from the server.
   */
  refreshConfig: () => Promise<void>;
}

const CupThreadContext = createContext<CupThreadContextValue | null>(null);

/**
 * Props for configuring the {@link CupThreadProvider}.
 *
 * @example
 * ```tsx
 * const client = new FeedbackClient({
 *   baseUrl: 'https://api.cupthread.com',
 *   appKey: 'app_sample123',
 * });
 *
 * <CupThreadProvider client={client} theme="system">
 *   <AppContent />
 * </CupThreadProvider>
 * ```
 */
export interface CupThreadProviderProps {
  /**
   * An instantiated {@link FeedbackClient} configured with your API base URL and application key.
   */
  client: FeedbackClient;

  /**
   * Optional custom user token string.
   * If omitted, {@link UserTokenStore.shared} generates and manages a persistent device token
   * and the provider follows later identity switches made via
   * {@link UserTokenStore.setToken} / {@link UserTokenStore.resetToken}
   * (login/logout). When provided, this prop always wins and store switches are ignored.
   */
  userToken?: string;

  /**
   * Optional visual theme override (e.g., `'light'`, `'dark'`, `'midnight'`, `'ocean'`, `'forest'`, `'sunset'`, `'candy'`).
   * Defaults to remote app configuration or `'system'`.
   */
  theme?: SdkTheme;

  /**
   * Locale identifier for UI text localization (e.g. `'en'`, `'zh-Hans'`, `'zh'`, `'zh-CN'`).
   *
   * @defaultValue `'en'`
   */
  locale?: string;

  /**
   * Custom string overrides deeply merged on top of the active locale dictionary.
   */
  strings?: DeepPartial<CupThreadStrings>;

  /**
   * Internal delay in milliseconds before retrying a failed initial config fetch at mount.
   * Defaults to 2000ms.
   * @internal
   */
  _retryDelayMs?: number;

  /**
   * React child elements wrapped by the SDK context provider.
   */
  children: React.ReactNode;
}

/**
 * Top-level React context provider for CupThread SDK screens and components.
 *
 * @remarks
 * Wrap your root React Native app component or navigation container in `<CupThreadProvider>`
 * to supply the active {@link FeedbackClient}, theme tokens, and user credentials.
 *
 * @example
 * ```tsx
 * import React from 'react';
 * import { FeedbackClient, CupThreadProvider, FeatureRequestsScreen } from '@cupthread/react-native';
 *
 * const client = new FeedbackClient({
 *   baseUrl: 'https://api.cupthread.com',
 *   appKey: 'app_live_abc123',
 * });
 *
 * export default function App() {
 *   return (
 *     <CupThreadProvider client={client} theme="system" locale="zh-Hans">
 *       <FeatureRequestsScreen />
 *     </CupThreadProvider>
 *   );
 * }
 * ```
 */
export function CupThreadProvider({
  client,
  userToken: explicitUserToken,
  theme: explicitTheme,
  locale = 'en',
  strings: customStrings,
  children,
  _retryDelayMs,
}: CupThreadProviderProps) {
  const colorScheme = useColorScheme();
  const isDarkMode = colorScheme === 'dark';

  // Never seed from the synchronous `.token` getter here: with an async
  // storage adapter it would mint a throwaway UUID before the persisted
  // token finishes loading, and requests fired in that window would be
  // attributed to a throwaway identity.
  const [resolvedUserToken, setResolvedUserToken] = useState<string>(explicitUserToken || '');
  const [isTokenReady, setIsTokenReady] = useState<boolean>(Boolean(explicitUserToken));
  const [configState, setConfigState] = useState<ConfigFetchState>({
    appConfig: null,
    isLoadingConfig: true,
    configError: null,
  });
  const activeRequestIdRef = useRef(0);

  useEffect(() => {
    if (explicitUserToken) {
      setResolvedUserToken(explicitUserToken);
      setIsTokenReady(true);
      return;
    }
    let cancelled = false;
    setIsTokenReady(false);
    const resolve = () => {
      UserTokenStore.shared.getToken().then((token) => {
        if (!cancelled) {
          setResolvedUserToken(token);
          setIsTokenReady(true);
        }
      });
    };
    resolve();
    // Follow explicit identity switches made after mount (login/logout via
    // UserTokenStore.setToken / resetToken) so SDK screens never keep sending
    // a stale token. The explicit userToken prop always wins and disables
    // this subscription.
    const unsubscribe = UserTokenStore.shared.subscribe(() => {
      if (!cancelled) {
        resolve();
      }
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [explicitUserToken]);

  const loadConfig = useCallback(
    async (signal?: AbortSignal, options?: { maxRetries?: number; retryDelayMs?: number }) => {
      const requestId = ++activeRequestIdRef.current;
      const maxRetries = options?.maxRetries ?? 0;
      const retryDelayMs = options?.retryDelayMs ?? _retryDelayMs ?? 2000;

      setConfigState((prev) => nextConfigState(prev, { type: 'start' }));

      let attempt = 0;
      while (true) {
        try {
          const config = await client.fetchAppConfig({ signal });
          if (signal?.aborted || requestId !== activeRequestIdRef.current) {
            if (signal?.aborted) {
              setConfigState((prev) => nextConfigState(prev, { type: 'abort' }));
            }
            return;
          }
          setConfigState((prev) => nextConfigState(prev, { type: 'success', config }));
          return;
        } catch (rawErr: any) {
          if (
            rawErr?.name === 'AbortError' ||
            signal?.aborted ||
            requestId !== activeRequestIdRef.current
          ) {
            if (rawErr?.name === 'AbortError' || signal?.aborted) {
              setConfigState((prev) => nextConfigState(prev, { type: 'abort' }));
            }
            return;
          }

          if (attempt < maxRetries && shouldRetryAfterFailure(attempt, rawErr)) {
            attempt++;
            try {
              await delay(retryDelayMs, signal);
            } catch (delayErr: any) {
              if (
                delayErr?.name === 'AbortError' ||
                signal?.aborted ||
                requestId !== activeRequestIdRef.current
              ) {
                if (delayErr?.name === 'AbortError' || signal?.aborted) {
                  setConfigState((prev) => nextConfigState(prev, { type: 'abort' }));
                }
                return;
              }
            }
            if (signal?.aborted || requestId !== activeRequestIdRef.current) {
              if (signal?.aborted) {
                setConfigState((prev) => nextConfigState(prev, { type: 'abort' }));
              }
              return;
            }
            continue;
          }

          const error = rawErr instanceof Error ? rawErr : new Error(String(rawErr));
          logDevConfigWarning(rawErr);

          setConfigState((prev) => nextConfigState(prev, { type: 'failure', error }));
          return;
        }
      }
    },
    [client, _retryDelayMs]
  );

  const refreshConfig = useCallback(
    async (signal?: AbortSignal) => {
      await loadConfig(signal, { maxRetries: 0 });
    },
    [loadConfig]
  );

  useEffect(() => {
    const controller = new AbortController();
    loadConfig(controller.signal, { maxRetries: 1 });
    return () => {
      controller.abort();
    };
  }, [loadConfig]);

  const effectiveTheme: SdkTheme = explicitTheme || configState.appConfig?.sdk?.theme || 'system';

  const colors = useMemo(() => {
    return getThemeColors(effectiveTheme, isDarkMode);
  }, [effectiveTheme, isDarkMode]);

  const resolvedStrings = useMemo(() => {
    return getLocaleStrings(locale, customStrings);
  }, [locale, customStrings]);

  const value: CupThreadContextValue = useMemo(
    () => ({
      client,
      userToken: resolvedUserToken,
      isTokenReady,
      themeName: effectiveTheme,
      colors,
      appConfig: configState.appConfig,
      isLoadingConfig: configState.isLoadingConfig,
      configError: configState.configError,
      locale,
      strings: resolvedStrings,
      refreshConfig,
    }),
    [
      client,
      resolvedUserToken,
      isTokenReady,
      effectiveTheme,
      colors,
      configState.appConfig,
      configState.isLoadingConfig,
      configState.configError,
      locale,
      resolvedStrings,
      refreshConfig,
    ]
  );

  return <CupThreadContext.Provider value={value}>{children}</CupThreadContext.Provider>;
}

/**
 * Hook retrieving the resolved localized UI strings from the enclosing provider.
 *
 * @returns The active {@link CupThreadStrings} dictionary.
 *
 * @example
 * ```tsx
 * function CustomHeader() {
 *   const strings = useCupThreadStrings();
 *   return <Text>{strings.feedbackComposer.title}</Text>;
 * }
 * ```
 */
export function useCupThreadStrings(): CupThreadStrings {
  const ctx = useContext(CupThreadContext);
  if (!ctx) {
    return enStrings;
  }
  return ctx.strings;
}

/**
 * Hook providing the currently active theme name and resolved design color tokens.
 *
 * @returns An object containing `themeName` (e.g. `'midnight'`) and full `colors` tokens.
 *
 * @example
 * ```tsx
 * function CustomHeader() {
 *   const { colors, themeName } = useCupThreadTheme();
 *   return (
 *     <Text style={{ color: colors.primary }}>
 *       Theme: {themeName}
 *     </Text>
 *   );
 * }
 * ```
 */
export function useCupThreadTheme(): { themeName: SdkTheme; colors: ThemeColors } {
  const ctx = useContext(CupThreadContext);
  if (!ctx) {
    return {
      themeName: 'system',
      colors: getThemeColors('system', false),
    };
  }
  return {
    themeName: ctx.themeName,
    colors: ctx.colors,
  };
}

/**
 * Hook retrieving the configured {@link FeedbackClient} instance from the enclosing provider.
 *
 * @returns The active {@link FeedbackClient}.
 * @throws `Error` If invoked outside of a `<CupThreadProvider>`.
 *
 * @example
 * ```tsx
 * function SubmitButton() {
 *   const client = useCupThreadClient();
 *   const handlePress = async () => {
 *     const columns = await client.fetchColumns();
 *   };
 *   return <Button title="Load Columns" onPress={handlePress} />;
 * }
 * ```
 */
export function useCupThreadClient(): FeedbackClient {
  const ctx = useContext(CupThreadContext);
  if (!ctx) {
    throw new Error('useCupThreadClient must be used within a <CupThreadProvider>');
  }
  return ctx.client;
}

/**
 * Hook retrieving the current user or device authentication token.
 *
 * @returns Active user token string. Inside a `<CupThreadProvider>` without an
 * explicit `userToken` prop and with an async storage adapter configured, this
 * is `''` until the persisted token resolves — gate token-dependent fetches on
 * `useCupThreadTokenReadiness()`.
 *
 * @example
 * ```tsx
 * function UserHeader() {
 *   const userToken = useCupThreadUserToken();
 *   return <Text>User ID: {userToken.substring(0, 8)}</Text>;
 * }
 * ```
 */
export function useCupThreadUserToken(): string {
  const ctx = useContext(CupThreadContext);
  if (!ctx) {
    return UserTokenStore.shared.token;
  }
  return ctx.userToken;
}

/**
 * Hook reporting whether the resolved user token is final.
 *
 * @returns `true` once the token reflects the persisted value (or an explicit
 * prop). Token-dependent data fetches should wait for this to avoid racing an
 * async storage adapter and attributing early requests to a throwaway identity.
 *
 * @example
 * ```tsx
 * function Requests() {
 *   const isTokenReady = useCupThreadTokenReadiness();
 *   useEffect(() => {
 *     if (!isTokenReady) return;
 *     // fetch with the resolved user token
 *   }, [isTokenReady]);
 *   return null;
 * }
 * ```
 */
export function useCupThreadTokenReadiness(): boolean {
  const ctx = useContext(CupThreadContext);
  if (!ctx) {
    return true;
  }
  return ctx.isTokenReady;
}

/**
 * Hook returning the full CupThread context value including client, colors, config, and refresh handler.
 *
 * @returns The entire {@link CupThreadContextValue}.
 * @throws `Error` If called outside of a `<CupThreadProvider>`.
 *
 * @example
 * ```tsx
 * function DiagnosticsBar() {
 *   const { appConfig, isLoadingConfig, configError, refreshConfig } = useCupThreadContext();
 *   if (configError) {
 *     return (
 *       <TouchableOpacity onPress={() => refreshConfig()}>
 *         <Text>Config failed: {configError.message}. Tap to retry.</Text>
 *       </TouchableOpacity>
 *     );
 *   }
 *   return (
 *     <TouchableOpacity onPress={() => refreshConfig()}>
 *       <Text>{isLoadingConfig ? 'Updating...' : appConfig?.name}</Text>
 *     </TouchableOpacity>
 *   );
 * }
 * ```
 */
export function useCupThreadContext(): CupThreadContextValue {
  const ctx = useContext(CupThreadContext);
  if (!ctx) {
    throw new Error('useCupThreadContext must be used within a <CupThreadProvider>');
  }
  return ctx;
}
