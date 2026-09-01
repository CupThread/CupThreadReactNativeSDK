import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import type { SdkTheme, PublicAppConfig } from '../types/index.ts';
import { FeedbackClient } from '../client/FeedbackClient.ts';
import { UserTokenStore } from '../client/UserTokenStore.ts';
import { getThemeColors, ThemeColors } from './SdkTheme.ts';

interface CupThreadContextValue {
  client: FeedbackClient;
  userToken: string;
  themeName: SdkTheme;
  colors: ThemeColors;
  appConfig: PublicAppConfig | null;
  isLoadingConfig: boolean;
  refreshConfig: () => Promise<void>;
}

const CupThreadContext = createContext<CupThreadContextValue | null>(null);

export interface CupThreadProviderProps {
  client: FeedbackClient;
  userToken?: string;
  theme?: SdkTheme;
  children: React.ReactNode;
}

export function CupThreadProvider({
  client,
  userToken: explicitUserToken,
  theme: explicitTheme,
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

  const value: CupThreadContextValue = useMemo(
    () => ({
      client,
      userToken: resolvedUserToken,
      themeName: effectiveTheme,
      colors,
      appConfig,
      isLoadingConfig,
      refreshConfig: loadConfig,
    }),
    [client, resolvedUserToken, effectiveTheme, colors, appConfig, isLoadingConfig]
  );

  return <CupThreadContext.Provider value={value}>{children}</CupThreadContext.Provider>;
}

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

export function useCupThreadClient(): FeedbackClient {
  const ctx = useContext(CupThreadContext);
  if (!ctx) {
    throw new Error('useCupThreadClient must be used within a <CupThreadProvider>');
  }
  return ctx.client;
}

export function useCupThreadUserToken(): string {
  const ctx = useContext(CupThreadContext);
  if (!ctx) {
    return UserTokenStore.shared.token;
  }
  return ctx.userToken;
}

export function useCupThreadContext(): CupThreadContextValue {
  const ctx = useContext(CupThreadContext);
  if (!ctx) {
    throw new Error('useCupThreadContext must be used within a <CupThreadProvider>');
  }
  return ctx;
}
