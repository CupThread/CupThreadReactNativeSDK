import type { SdkTheme } from '../types';

/**
 * Color design tokens used across all CupThread React Native components and screens.
 *
 * @example
 * ```ts
 * import { ThemeColors, lightTheme } from '@cupthread/react-native';
 *
 * const customColors: ThemeColors = {
 *   ...lightTheme,
 *   primary: '#6366f1',
 *   accent: '#818cf8',
 * };
 * ```
 */
export interface ThemeColors {
  /**
   * Main screen background color.
   */
  background: string;

  /**
   * Card, modal sheet, or container surface background color.
   */
  card: string;

  /**
   * Outline and divider color for cards and container surfaces.
   */
  cardBorder: string;

  /**
   * High-contrast primary text color for headers, titles, and body content.
   */
  textPrimary: string;

  /**
   * Medium-contrast secondary text color for subtitles and descriptions.
   */
  textSecondary: string;

  /**
   * Low-contrast muted text color for timestamps, counters, and placeholders.
   */
  textMuted: string;

  /**
   * Primary brand / call-to-action color for buttons, active tabs, and highlights.
   */
  primary: string;

  /**
   * Hover/press highlight tint for primary actions.
   */
  primaryHover: string;

  /**
   * Contrasting text color rendered on top of primary button backgrounds.
   */
  primaryText: string;

  /**
   * Generic hairline border and separator color.
   */
  border: string;

  /**
   * Background color for text input fields and text areas.
   */
  inputBg: string;

  /**
   * Border color for idle text input fields.
   */
  inputBorder: string;

  /**
   * Vibrant accent color for icons, indicators, and links.
   */
  accent: string;

  /**
   * Background fill for active/voted state on {@link VoteButton}.
   */
  voteActiveBg: string;

  /**
   * Text and arrow color for active/voted state on {@link VoteButton}.
   */
  voteActiveText: string;

  /**
   * Background fill for unvoted state on {@link VoteButton}.
   */
  voteInactiveBg: string;

  /**
   * Text and arrow color for unvoted state on {@link VoteButton}.
   */
  voteInactiveText: string;

  /**
   * Background color for category chips, tag pills, and badges.
   */
  chipBg: string;

  /**
   * Text color inside category chips, tag pills, and badges.
   */
  chipText: string;

  /**
   * Horizontal divider rule color.
   */
  divider: string;

  /**
   * High-contrast text or icon color representing destructive actions, validation errors, or critical alerts.
   */
  danger: string;

  /**
   * Background fill color for error alerts, warning banners, and danger badges.
   */
  dangerBg: string;

  /**
   * Border or outline color for error alerts and invalid form inputs.
   */
  dangerBorder: string;
}

/**
 * Standard crisp light theme palette (slate on white).
 */
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
  danger: '#b91c1c',
  dangerBg: '#fef2f2',
  dangerBorder: '#fca5a5',
};

/**
 * Modern dark slate theme palette.
 */
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
  danger: '#f87171',
  dangerBg: '#450a0a',
  dangerBorder: '#7f1d1d',
};

/**
 * Deep indigo/midnight dark palette optimized for OLED displays.
 */
export const midnightTheme: ThemeColors = {
  ...darkTheme,
  background: '#030712',
  card: '#0f172a',
  cardBorder: '#1f293d',
  primary: '#6366f1',
  primaryHover: '#818cf8',
  voteActiveBg: '#312e81',
  voteActiveText: '#c7d2fe',
  danger: '#f87171',
  dangerBg: '#450a0a',
  dangerBorder: '#7f1d1d',
};

/**
 * Teal and marine coastal theme palette.
 */
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
  danger: '#b91c1c',
  dangerBg: '#fef2f2',
  dangerBorder: '#fca5a5',
};

/**
 * Natural emerald and lime forest theme palette.
 */
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
  danger: '#b91c1c',
  dangerBg: '#fef2f2',
  dangerBorder: '#fca5a5',
};

/**
 * Warm amber and terracotta sunset theme palette.
 */
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
  danger: '#b91c1c',
  dangerBg: '#fef2f2',
  dangerBorder: '#fca5a5',
};

/**
 * Vibrant fuchsia and candy pink theme palette.
 */
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
  danger: '#b91c1c',
  dangerBg: '#fef2f2',
  dangerBorder: '#fca5a5',
};

/**
 * Resolves full {@link ThemeColors} for a given {@link SdkTheme} and dark mode state.
 *
 * @param theme - Selected theme identifier (e.g. `'system'`, `'ocean'`, `'dark'`).
 * @param isDarkMode - Boolean indicating if device system dark mode is active (used for `'system'`).
 * @returns Complete {@link ThemeColors} color token mapping.
 *
 * @example
 * ```ts
 * import { getThemeColors } from '@cupthread/react-native';
 *
 * const colors = getThemeColors('ocean');
 * console.log(`Primary color: ${colors.primary}`);
 * ```
 */
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
