import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { useCupThreadTheme } from '../theme/CupThreadThemeProvider.tsx';

export interface AvatarProps {
  url?: string | null;
  name?: string | null;
  size?: number;
}

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
