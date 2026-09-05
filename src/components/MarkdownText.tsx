import React from 'react';
import { Text, View, StyleSheet, Linking, TextStyle } from 'react-native';
import { useCupThreadTheme } from '../theme/CupThreadThemeProvider';
import { isSafeLinkUrl, sanitizeSafeLinkUrl } from '../utils/linkUrl';

/**
 * Props for the {@link MarkdownText} lightweight renderer.
 *
 * @example
 * ```tsx
 * <MarkdownText
 *   content="### Release Highlights\n- **Faster sync**\n- See [Docs](https://cupthread.com)"
 *   style={{ fontSize: 15 }}
 * />
 * ```
 */
export interface MarkdownTextProps {
  /**
   * Markdown formatted string content supporting `#`, `##`, `###`, `- list`, `**bold**`, `*italic*`, `` `code` ``, and `[links](url)`.
   */
  content: string;

  /**
   * Optional custom text style overrides applied to rendered paragraph and header texts.
   */
  style?: TextStyle;

  /**
   * Optional link press interceptor invoked whenever a `[label](url)` link is tapped.
   *
   * Return `true` to mark the press as handled (or intentionally suppressed) and skip
   * the default opener — useful for routing through an in-app browser. Return `false`
   * or nothing to fall through to the default handler, which opens only `http:` and
   * `https:` URLs and silently ignores any other scheme.
   *
   * @warning **Security Notice**: The raw URL from untrusted user content is passed
   * directly to this callback. If your custom handler delegates to `Linking.openURL`,
   * a webview, or an external navigator, you MUST validate it against {@link isSafeLinkUrl}
   * (or {@link sanitizeSafeLinkUrl}) to protect users from malicious schemes like `tel:`,
   * `javascript:`, `sms:`, or unintended custom deep links.
   */
  onLinkPress?: (url: string) => boolean | void;
}

/**
 * Lightweight, zero-dependency Markdown renderer optimized for React Native release notes and comments.
 *
 * @param props - {@link MarkdownTextProps} containing markdown content and text style.
 *
 * @example
 * ```tsx
 * import React from 'react';
 * import { MarkdownText } from '@cupthread/react-native';
 *
 * export function FeatureDescription({ text }: { text: string }) {
 *   return <MarkdownText content={text} />;
 * }
 * ```
 */
export function MarkdownText({ content, style, onLinkPress }: MarkdownTextProps) {
  const { colors } = useCupThreadTheme();

  const handleLinkPress = (url: string) => {
    if (onLinkPress && onLinkPress(url) === true) return;
    const safeUrl = sanitizeSafeLinkUrl(url);
    if (safeUrl) {
      Linking.openURL(safeUrl).catch(() => {});
    }
  };

  if (!content) return null;

  const lines = content.split('\n');

  const parseInline = (text: string, baseKey: string) => {
    const regex = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g;
    const elements: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        elements.push(
          <Text key={`${baseKey}-txt-${lastIndex}`} style={{ color: colors.textPrimary }}>
            {text.substring(lastIndex, match.index)}
          </Text>
        );
      }

      if (match[2]) {
        elements.push(
          <Text key={`${baseKey}-b-${match.index}`} style={{ fontWeight: '700', color: colors.textPrimary }}>
            {match[2]}
          </Text>
        );
      } else if (match[3]) {
        elements.push(
          <Text key={`${baseKey}-i-${match.index}`} style={{ fontStyle: 'italic', color: colors.textPrimary }}>
            {match[3]}
          </Text>
        );
      } else if (match[4]) {
        elements.push(
          <Text
            key={`${baseKey}-c-${match.index}`}
            style={{
              fontFamily: 'Courier',
              backgroundColor: colors.chipBg,
              color: colors.primary,
              fontSize: 13,
            }}
          >
            {` ${match[4]} `}
          </Text>
        );
      } else if (match[5] && match[6]) {
        const url = match[6];
        // Links with disallowed schemes render as plain text unless the host app
        // supplies an onLinkPress interceptor that opts into handling them.
        const isPressable = Boolean(onLinkPress) || isSafeLinkUrl(url);
        elements.push(
          <Text
            key={`${baseKey}-a-${match.index}`}
            style={
              isPressable
                ? { color: colors.primary, textDecorationLine: 'underline' }
                : { color: colors.textPrimary }
            }
            onPress={isPressable ? () => handleLinkPress(url) : undefined}
          >
            {match[5]}
          </Text>
        );
      }

      lastIndex = regex.lastIndex;
    }

    if (lastIndex < text.length) {
      elements.push(
        <Text key={`${baseKey}-txt-end`} style={{ color: colors.textPrimary }}>
          {text.substring(lastIndex)}
        </Text>
      );
    }

    return elements;
  };

  return (
    <View style={styles.container}>
      {lines.map((line, idx) => {
        const trimmed = line.trim();
        if (trimmed === '') {
          return <View key={`spacer-${idx}`} style={styles.paragraphSpacer} />;
        }

        if (trimmed.startsWith('# ')) {
          return (
            <Text key={`h1-${idx}`} style={[styles.h1, { color: colors.textPrimary }, style]}>
              {parseInline(trimmed.substring(2), `h1-${idx}`)}
            </Text>
          );
        }
        if (trimmed.startsWith('## ')) {
          return (
            <Text key={`h2-${idx}`} style={[styles.h2, { color: colors.textPrimary }, style]}>
              {parseInline(trimmed.substring(3), `h2-${idx}`)}
            </Text>
          );
        }
        if (trimmed.startsWith('### ')) {
          return (
            <Text key={`h3-${idx}`} style={[styles.h3, { color: colors.textPrimary }, style]}>
              {parseInline(trimmed.substring(4), `h3-${idx}`)}
            </Text>
          );
        }
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          return (
            <View key={`li-${idx}`} style={styles.bulletRow}>
              <Text style={[styles.bullet, { color: colors.primary }]}>•</Text>
              <Text style={[styles.bulletText, { color: colors.textPrimary }, style]}>
                {parseInline(trimmed.substring(2), `li-${idx}`)}
              </Text>
            </View>
          );
        }

        return (
          <Text key={`p-${idx}`} style={[styles.paragraph, { color: colors.textSecondary }, style]}>
            {parseInline(line, `p-${idx}`)}
          </Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 4,
  },
  paragraphSpacer: {
    height: 8,
  },
  paragraph: {
    fontSize: 14,
    lineHeight: 20,
    marginVertical: 2,
  },
  h1: {
    fontSize: 20,
    fontWeight: '700',
    marginVertical: 6,
  },
  h2: {
    fontSize: 17,
    fontWeight: '600',
    marginVertical: 4,
  },
  h3: {
    fontSize: 15,
    fontWeight: '600',
    marginVertical: 3,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginVertical: 2,
    paddingLeft: 4,
  },
  bullet: {
    fontSize: 16,
    lineHeight: 20,
    marginRight: 6,
  },
  bulletText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
});
