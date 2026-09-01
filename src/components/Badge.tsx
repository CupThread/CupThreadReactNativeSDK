import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useCupThreadTheme } from '../theme/CupThreadThemeProvider.tsx';

export interface BadgeProps {
  label: string;
  color?: string | null;
  variant?: 'default' | 'outline' | 'subtle';
}

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
