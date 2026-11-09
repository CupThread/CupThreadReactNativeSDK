import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { useCupThreadTheme } from '../theme/CupThreadThemeProvider';

/**
 * Props for the {@link Avatar} component.
 *
 * @example
 * ```tsx
 * <Avatar
 *   url="https://images.example.com/profiles/taylor.jpg"
 *   name="Taylor Swift"
 *   size={36}
 * />
 * ```
 */
export interface AvatarProps {
  /**
   * Remote image URL for the avatar picture.
   */
  url?: string | null;

  /**
   * Display name used to compute single-character fallback initial when `url` is absent.
   */
  name?: string | null;

  /**
   * Diameter of the circular avatar in density-independent pixels.
   *
   * Clamped to a positive finite number, defaulting to `32` if non-positive, NaN, or invalid.
   *
   * @defaultValue 32
   */
  size?: number;

  /**
   * Optional custom accessibility label announced by assistive technologies.
   *
   * When omitted or empty, defaults to `"${name}'s avatar"` if `name` is provided,
   * or `"User avatar"` otherwise.
   */
  accessibilityLabel?: string;
}

/**
 * Circular user avatar component rendering a remote image with an initial-based letter fallback.
 *
 * @param props - {@link AvatarProps} containing URL, name, size, and accessibility attributes.
 *
 * @example
 * ```tsx
 * import React from 'react';
 * import { Avatar } from '@cupthread/react-native';
 *
 * export function CommentAuthorHeader() {
 *   return (
 *     <Avatar
 *       url="https://images.example.com/avatar.png"
 *       name="Alex Morgan"
 *       size={40}
 *     />
 *   );
 * }
 * ```
 */
export function Avatar({
  url,
  name,
  size = 32,
  accessibilityLabel: customAccessibilityLabel,
}: AvatarProps) {
  const { colors } = useCupThreadTheme();

  const safeSize = typeof size === 'number' && Number.isFinite(size) && size > 0 ? size : 32;

  const trimmedName = typeof name === 'string' ? name.trim() : '';
  const initial = (trimmedName || '?').charAt(0).toUpperCase();

  const trimmedCustomA11yLabel =
    typeof customAccessibilityLabel === 'string' ? customAccessibilityLabel.trim() : '';
  const defaultA11yLabel = trimmedName ? `${trimmedName}'s avatar` : 'User avatar';
  const resolvedAccessibilityLabel = trimmedCustomA11yLabel || defaultA11yLabel;

  const trimmedUrl = typeof url === 'string' ? url.trim() : '';
  if (trimmedUrl) {
    return (
      <Image
        source={{ uri: trimmedUrl }}
        accessibilityRole="image"
        accessibilityLabel={resolvedAccessibilityLabel}
        style={{
          width: safeSize,
          height: safeSize,
          borderRadius: safeSize / 2,
          backgroundColor: colors.chipBg,
        }}
      />
    );
  }

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={resolvedAccessibilityLabel}
      style={[
        styles.fallback,
        {
          width: safeSize,
          height: safeSize,
          borderRadius: safeSize / 2,
          backgroundColor: colors.chipBg,
        },
      ]}
    >
      <Text
        style={[styles.initialText, { fontSize: safeSize * 0.45, color: colors.textSecondary }]}
      >
        {initial}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  initialText: {
    fontWeight: '600',
  },
});
