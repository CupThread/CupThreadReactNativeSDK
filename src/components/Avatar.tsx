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
   * @defaultValue 32
   */
  size?: number;
}

/**
 * Circular user avatar component rendering a remote image with an initial-based letter fallback.
 *
 * @param props - {@link AvatarProps} containing URL, name, and size.
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
export function Avatar({ url, name, size = 32 }: AvatarProps) {
  const { colors } = useCupThreadTheme();

  if (url) {
    return (
      <Image
        source={{ uri: url }}
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: colors.chipBg,
        }}
      />
    );
  }

  const initial = (name || '?').trim().charAt(0).toUpperCase();

  return (
    <View
      style={[
        styles.fallback,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: colors.chipBg,
        },
      ]}
    >
      <Text style={[styles.initialText, { fontSize: size * 0.45, color: colors.textSecondary }]}>
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
