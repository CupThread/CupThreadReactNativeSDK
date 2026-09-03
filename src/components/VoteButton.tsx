import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { useCupThreadTheme, useCupThreadStrings } from '../theme/CupThreadThemeProvider';

/**
 * Props for configuring the {@link VoteButton} upvote counter component.
 *
 * @example
 * ```tsx
 * <VoteButton
 *   voteCount={42}
 *   hasVoted={true}
 *   onPress={() => toggleVote(item.id)}
 *   disabled={false}
 * />
 * ```
 */
export interface VoteButtonProps {
  /**
   * Total number of upvotes currently recorded.
   */
  voteCount: number;

  /**
   * Whether the active user has cast an upvote on this item.
   */
  hasVoted: boolean;

  /**
   * Callback invoked when the vote button is tapped.
   */
  onPress: () => void;

  /**
   * Whether the button is disabled from user interactions (e.g. while submitting or for own requests).
   */
  disabled?: boolean;
}

export function VoteButton({ voteCount, hasVoted, onPress, disabled }: VoteButtonProps) {
  const { colors } = useCupThreadTheme();
  const strings = useCupThreadStrings();

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={hasVoted ? strings.featureRequests.upvoted : strings.featureRequests.upvote}
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
