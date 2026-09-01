import type { SdkTheme } from '../types/index.ts';

export interface ThemeColors {
  background: string;
  card: string;
  cardBorder: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  primary: string;
  primaryHover: string;
  primaryText: string;
  border: string;
  inputBg: string;
  inputBorder: string;
  accent: string;
  voteActiveBg: string;
  voteActiveText: string;
  voteInactiveBg: string;
  voteInactiveText: string;
  chipBg: string;
  chipText: string;
  divider: string;
}

export const lightTheme: ThemeColors = {
  background: '#f8fafc',
  card: '#ffffff',
  cardBorder: '#e2e8f0',
  textPrimary: '#0f172a',
  textSecondary: '#475569',
  textMuted: '#94a3b8',
  primary: '#2563eb',
  primaryHover: '#1d4ed8',
  primaryText: '#ffffff',
  border: '#e2e8f0',
  inputBg: '#ffffff',
  inputBorder: '#cbd5e1',
  accent: '#3b82f6',
  voteActiveBg: '#eff6ff',
  voteActiveText: '#2563eb',
  voteInactiveBg: '#f1f5f9',
  voteInactiveText: '#64748b',
  chipBg: '#f1f5f9',
  chipText: '#334155',
  divider: '#e2e8f0',
};

export const darkTheme: ThemeColors = {
  background: '#090d16',
  card: '#131b2e',
  cardBorder: '#1e293b',
  textPrimary: '#f8fafc',
  textSecondary: '#94a3b8',
  textMuted: '#64748b',
  primary: '#3b82f6',
  primaryHover: '#60a5fa',
  primaryText: '#ffffff',
  border: '#1e293b',
  inputBg: '#0f172a',
  inputBorder: '#334155',
  accent: '#60a5fa',
  voteActiveBg: '#1e3a8a',
  voteActiveText: '#93c5fd',
  voteInactiveBg: '#1e293b',
  voteInactiveText: '#94a3b8',
  chipBg: '#1e293b',
  chipText: '#cbd5e1',
  divider: '#1e293b',
};

export const midnightTheme: ThemeColors = {
  ...darkTheme,
  background: '#030712',
  card: '#0f172a',
  cardBorder: '#1f293d',
  primary: '#6366f1',
  primaryHover: '#818cf8',
  voteActiveBg: '#312e81',
  voteActiveText: '#c7d2fe',
};

export const oceanTheme: ThemeColors = {
  background: '#f0fdfa',
  card: '#ffffff',
  cardBorder: '#ccfbf1',
  textPrimary: '#134e4a',
  textSecondary: '#115e59',
  textMuted: '#5eead4',
  primary: '#0d9488',
  primaryHover: '#0f766e',
  primaryText: '#ffffff',
  border: '#ccfbf1',
  inputBg: '#ffffff',
  inputBorder: '#99f6e4',
  accent: '#14b8a6',
  voteActiveBg: '#ccfbf1',
  voteActiveText: '#0f766e',
  voteInactiveBg: '#f0fdfa',
  voteInactiveText: '#115e59',
  chipBg: '#e6fffa',
  chipText: '#0d9488',
  divider: '#ccfbf1',
};

export const forestTheme: ThemeColors = {
  background: '#f7fee7',
  card: '#ffffff',
  cardBorder: '#d9f99d',
  textPrimary: '#365314',
  textSecondary: '#4d7c0f',
  textMuted: '#84cc16',
  primary: '#65a30d',
  primaryHover: '#4d7c0f',
  primaryText: '#ffffff',
  border: '#d9f99d',
  inputBg: '#ffffff',
  inputBorder: '#bef264',
  accent: '#84cc16',
  voteActiveBg: '#ecfccb',
  voteActiveText: '#4d7c0f',
  voteInactiveBg: '#f7fee7',
  voteInactiveText: '#4d7c0f',
  chipBg: '#f7fee7',
  chipText: '#365314',
  divider: '#d9f99d',
};

export const sunsetTheme: ThemeColors = {
  background: '#fff7ed',
  card: '#ffffff',
  cardBorder: '#ffedd5',
  textPrimary: '#7c2d12',
  textSecondary: '#9a3412',
  textMuted: '#fdba74',
  primary: '#ea580c',
  primaryHover: '#c2410c',
  primaryText: '#ffffff',
  border: '#fed7aa',
  inputBg: '#ffffff',
  inputBorder: '#fdba74',
  accent: '#f97316',
  voteActiveBg: '#ffedd5',
  voteActiveText: '#c2410c',
  voteInactiveBg: '#fff7ed',
  voteInactiveText: '#9a3412',
  chipBg: '#ffedd5',
  chipText: '#7c2d12',
  divider: '#fed7aa',
};

export const candyTheme: ThemeColors = {
  background: '#fdf4ff',
  card: '#ffffff',
  cardBorder: '#fae8ff',
  textPrimary: '#701a75',
  textSecondary: '#86198f',
  textMuted: '#f0abfc',
  primary: '#c026d3',
  primaryHover: '#a21caf',
  primaryText: '#ffffff',
  border: '#f5d0fe',
  inputBg: '#ffffff',
  inputBorder: '#f0abfc',
  accent: '#d946ef',
  voteActiveBg: '#fae8ff',
  voteActiveText: '#a21caf',
  voteInactiveBg: '#fdf4ff',
  voteInactiveText: '#86198f',
  chipBg: '#fae8ff',
  chipText: '#701a75',
  divider: '#f5d0fe',
};

export function getThemeColors(theme: SdkTheme, isDarkMode: boolean = false): ThemeColors {
  switch (theme) {
    case 'light':
      return lightTheme;
    case 'dark':
      return darkTheme;
    case 'midnight':
      return midnightTheme;
    case 'ocean':
      return oceanTheme;
    case 'forest':
      return forestTheme;
    case 'sunset':
      return sunsetTheme;
    case 'candy':
      return candyTheme;
    case 'system':
    default:
      return isDarkMode ? darkTheme : lightTheme;
  }
}
