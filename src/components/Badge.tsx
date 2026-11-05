import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useCupThreadTheme } from '../theme/CupThreadThemeProvider';

/**
 * Props for configuring the {@link Badge} pill/chip component.
 *
 * @example
 * ```tsx
 * <Badge label="In Progress" color="#3b82f6" variant="subtle" />
 * ```
 */
export interface BadgeProps {
  /**
   * Text label displayed inside the badge pill.
   */
  label: string;

  /**
   * Custom hex or CSS color for the text and background tint (e.g. `"#3b82f6"`).
   */
  color?: string | null;

  /**
   * Visual presentation style:
   * - `'subtle'`: Semi-transparent background with colored text (default).
   * - `'outline'`: Transparent background with colored border.
   * - `'default'`: Solid background chip.
   *
   * @defaultValue `'subtle'`
   */
  variant?: 'default' | 'outline' | 'subtle';
}

/**
 * Normalizes 3-character, 4-character, 6-character, or 8-character hex color codes
 * into standard 6-character `#rrggbb` format. Returns `null` if the input is not a hex color.
 */
function parseHexColor(input: string): string | null {
  const trimmed = input.trim();
  const hex3 = /^#([0-9a-fA-F]{3})$/;
  const hex4 = /^#([0-9a-fA-F]{4})$/;
  const hex6 = /^#([0-9a-fA-F]{6})$/;
  const hex8 = /^#([0-9a-fA-F]{8})$/;

  const m3 = trimmed.match(hex3);
  if (m3) {
    const [r, g, b] = m3[1];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  const m4 = trimmed.match(hex4);
  if (m4) {
    const [r, g, b] = m4[1];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  const m6 = trimmed.match(hex6);
  if (m6) {
    return `#${m6[1]}`.toLowerCase();
  }
  const m8 = trimmed.match(hex8);
  if (m8) {
    return `#${m8[1].slice(0, 6)}`.toLowerCase();
  }
  return null;
}

/**
 * Computes standard W3C relative luminance from a hex color string to pick
 * the best contrasting text color (`darkText` vs `lightText`).
 */
function getContrastingTextColor(
  hexColor: string | null,
  lightText: string,
  darkText: string
): string {
  if (!hexColor) {
    return lightText;
  }
  const hex = parseHexColor(hexColor);
  if (!hex) {
    return lightText;
  }
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const toLinear = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const luminance = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);

  return luminance > 0.45 ? darkText : lightText;
}

/**
 * Compact pill tag used to indicate status, milestone versions, or categories.
 *
 * @param props - {@link BadgeProps} containing label, color, and variant.
 *
 * @example
 * ```tsx
 * import React from 'react';
 * import { Badge } from '@cupthread/react-native';
 *
 * export function StatusRow() {
 *   return (
 *     <Badge label="v2.1.0" variant="outline" />
 *   );
 * }
 * ```
 */
export function Badge({ label, color, variant = 'subtle' }: BadgeProps) {
  const { colors } = useCupThreadTheme();

  const trimmedLabel =
    typeof label === 'string' ? label.trim() : typeof label === 'number' ? String(label) : '';
  if (!trimmedLabel) {
    return null;
  }

  const rawColor = color?.trim() || null;
  const hex6 = rawColor ? parseHexColor(rawColor) : null;
  const effectiveColor = hex6 || (rawColor && !rawColor.startsWith('#') ? rawColor : null);

  let backgroundColor: string;
  let textColor: string;
  let borderColor: string;
  let borderWidth: number;

  if (variant === 'outline') {
    backgroundColor = 'transparent';
    textColor = effectiveColor || colors.chipText;
    borderColor = effectiveColor || colors.border;
    borderWidth = 1;
  } else if (variant === 'default') {
    backgroundColor = effectiveColor || colors.primary;
    textColor = getContrastingTextColor(hex6, colors.primaryText, colors.textPrimary);
    borderColor = effectiveColor || colors.primary;
    borderWidth = 0;
  } else {
    // 'subtle' (default)
    backgroundColor = hex6 ? `${hex6}20` : colors.chipBg;
    textColor = effectiveColor || colors.chipText;
    borderColor = effectiveColor || colors.border;
    borderWidth = 0;
  }

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor,
          borderColor,
          borderWidth,
        },
      ]}
    >
      <Text style={[styles.text, { color: textColor }]}>{trimmedLabel}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    alignSelf: 'flex-start',
    marginRight: 6,
  },
  text: {
    fontSize: 11,
    fontWeight: '600',
  },
});
