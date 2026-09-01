import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { useCupThreadTheme } from '../theme/CupThreadThemeProvider.tsx';

export interface VoteButtonProps {
  voteCount: number;
  hasVoted: boolean;
  onPress: () => void;
  disabled?: boolean;
}

export function VoteButton({ voteCount, hasVoted, onPress, disabled }: VoteButtonProps) {
  const { colors } = useCupThreadTheme();

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        {
          backgroundColor: hasVoted ? colors.voteActiveBg : colors.voteInactiveBg,
          borderColor: hasVoted ? colors.primary : colors.border,
        },
      ]}
    >
      <Text
        style={[
          styles.arrow,
          { color: hasVoted ? colors.voteActiveText : colors.voteInactiveText },
        ]}
      >
        ▲
      </Text>
      <Text
        style={[
          styles.count,
          { color: hasVoted ? colors.voteActiveText : colors.voteInactiveText },
        ]}
      >
        {voteCount}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    minWidth: 44,
  },
  arrow: {
    fontSize: 10,
    lineHeight: 12,
  },
  count: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 2,
  },
});
