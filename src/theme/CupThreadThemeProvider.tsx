import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import type { SdkTheme, PublicAppConfig } from '../types';
import { FeedbackClient } from '../client/FeedbackClient';
import { UserTokenStore } from '../client/UserTokenStore';
import { getThemeColors, ThemeColors } from './SdkTheme';
import type { CupThreadStrings, DeepPartial } from '../i18n';
import { getLocaleStrings, enStrings } from '../i18n';

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
   */
  userToken: string;

  /**
   * Resolved theme name (e.g. `'system'`, `'midnight'`, `'ocean'`).
   */
  themeName: SdkTheme;

  /**
   * Resolved color tokens currently applied to components.
   */
  colors: ThemeColors;

  /**
   * Remote application settings and feature flags, or `null` while loading.
   */
  appConfig: PublicAppConfig | null;

  /**
   * True while remote configuration is actively being retrieved.
   */
  isLoadingConfig: boolean;

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
   * If omitted, {@link UserTokenStore.shared} generates and manages a persistent device token.
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
}: CupThreadProviderProps) {
  const colorScheme = useColorScheme();
  const isDarkMode = colorScheme === 'dark';

  const [resolvedUserToken, setResolvedUserToken] = useState<string>(
    explicitUserToken || UserTokenStore.shared.token
  );
  const [appConfig, setAppConfig] = useState<PublicAppConfig | null>(null);
  const [isLoadingConfig, setIsLoadingConfig] = useState<boolean>(true);

  useEffect(() => {
    if (explicitUserToken) {
      setResolvedUserToken(explicitUserToken);
    } else {
      UserTokenStore.shared.getToken().then((token) => {
        setResolvedUserToken(token);
      });
    }
  }, [explicitUserToken]);

  const loadConfig = async () => {
    try {
      setIsLoadingConfig(true);
      const config = await client.fetchAppConfig();
      setAppConfig(config);
    } catch {
      // Non-fatal
    } finally {
      setIsLoadingConfig(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, [client]);

  const effectiveTheme: SdkTheme =
    explicitTheme || appConfig?.sdk?.theme || 'system';

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
      themeName: effectiveTheme,
      colors,
      appConfig,
      isLoadingConfig,
      locale,
      strings: resolvedStrings,
      refreshConfig: loadConfig,
    }),
    [client, resolvedUserToken, effectiveTheme, colors, appConfig, isLoadingConfig, locale, resolvedStrings]
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
 * @returns Active user token string.
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
 * Hook returning the full CupThread context value including client, colors, config, and refresh handler.
 *
 * @returns The entire {@link CupThreadContextValue}.
 * @throws `Error` If called outside of a `<CupThreadProvider>`.
 *
 * @example
 * ```tsx
 * function DiagnosticsBar() {
 *   const { appConfig, isLoadingConfig, refreshConfig } = useCupThreadContext();
 *   return (
 *     <TouchableOpacity onPress={refreshConfig}>
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
