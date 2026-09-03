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

  const customBg = color ? `${color}20` : colors.chipBg;
  const customText = color || colors.chipText;

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: variant === 'outline' ? 'transparent' : customBg,
          borderColor: color || colors.border,
          borderWidth: variant === 'outline' ? 1 : 0,
        },
      ]}
    >
      <Text style={[styles.text, { color: customText }]}>{label}</Text>
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
