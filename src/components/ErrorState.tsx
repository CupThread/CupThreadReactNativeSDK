import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useCupThreadTheme } from '../theme/CupThreadThemeProvider';

/**
 * Props for configuring the {@link ErrorState} component.
 */
export interface ErrorStateProps {
  /**
   * Short localized error message, e.g. `strings.common.error`.
   */
  message: string;

  /**
   * Callback invoked when the user taps the retry button.
   */
  onRetry: () => void;

  /**
   * Label for the retry button, e.g. `strings.common.retry`.
   */
  retryLabel: string;

  /**
   * Renders a compact inline variant for embedding inside sections
   * (as opposed to the full-screen centered variant).
   *
   * @defaultValue false
   */
  compact?: boolean;

  /**
   * Whether the retry request is currently in flight. When `true` the retry
   * button is disabled.
   *
   * @defaultValue false
   */
  isRetrying?: boolean;
}

/**
 * Shared error-state view showing a localized failure message and a retry
 * button. Used by data-loading screens and sections so a failed fetch is
 * never rendered as a misleading empty state.
 *
 * @param props - {@link ErrorStateProps} configuring message, retry, and layout.
 *
 * @example
 * ```tsx
 * {loadError && !data ? (
 *   <ErrorState
 *     message={strings.common.error}
 *     retryLabel={strings.common.retry}
 *     onRetry={reload}
 *   />
 * ) : null}
 * ```
 */
export function ErrorState({
  message,
  onRetry,
  retryLabel,
  compact = false,
  isRetrying = false,
}: ErrorStateProps) {
  const { colors } = useCupThreadTheme();

  return (
    <View style={[compact ? styles.containerCompact : styles.container]}>
      <Text style={[styles.message, { color: colors.textPrimary }]}>{message}</Text>
      <TouchableOpacity
        onPress={onRetry}
        disabled={isRetrying}
        activeOpacity={0.8}
        style={[
          styles.retryButton,
          { backgroundColor: colors.primary, opacity: isRetrying ? 0.5 : 1 },
        ]}
      >
        <Text style={[styles.retryButtonText, { color: colors.primaryText }]}>
          {retryLabel}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  containerCompact: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
  },
  message: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 14,
    textAlign: 'center',
  },
  retryButton: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
