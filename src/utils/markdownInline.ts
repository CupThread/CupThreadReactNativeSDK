/**
 * Token representation for inline Markdown formatting elements.
 */
export type MarkdownInlineToken =
  | { type: 'text'; content: string }
  | { type: 'bold'; content: string }
  | { type: 'italic'; content: string }
  | { type: 'code'; content: string }
  | { type: 'link'; text: string; url: string; title?: string };

/**
 * Regular expression matching inline markdown constructs:
 * - Bold: `**bold**`
 * - Italic: `*italic*`
 * - Inline code: `` `code` ``
 * - Inline link: `[label](url "optional title")` or `[label](<url> "optional title")`
 *
 * Supports one level of balanced parentheses in the URL destination
 * (e.g. `https://en.wikipedia.org/wiki/Foo_(bar)`), and discards optional
 * CommonMark link titles so only the clean destination URL is passed to handlers.
 */
export const INLINE_MARKDOWN_REGEX =
  /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(\s*(?:<([^>\n]+)>|((?:[^()\s]|\([^()\s]*\))+))(?:\s+(?:"([^"]*)"|'([^']*)'))?\s*\))/g;

/**
 * Tokenizes an inline markdown string into an array of structured {@link MarkdownInlineToken} objects.
 *
 * @param text - The raw text line or segment to tokenize.
 * @returns Array of inline tokens.
 */
export function tokenizeMarkdownInline(text: string): MarkdownInlineToken[] {
  if (!text) return [];

  const tokens: MarkdownInlineToken[] = [];
  const regex = new RegExp(INLINE_MARKDOWN_REGEX.source, 'g');
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({
        type: 'text',
        content: text.substring(lastIndex, match.index),
      });
    }

    if (match[2] !== undefined) {
      tokens.push({ type: 'bold', content: match[2] });
    } else if (match[3] !== undefined) {
      tokens.push({ type: 'italic', content: match[3] });
    } else if (match[4] !== undefined) {
      tokens.push({ type: 'code', content: match[4] });
    } else if (match[5] !== undefined && (match[6] !== undefined || match[7] !== undefined)) {
      const url = match[6] !== undefined ? match[6] : match[7];
      const title = match[8] !== undefined ? match[8] : match[9];
      tokens.push({
        type: 'link',
        text: match[5],
        url,
        ...(title !== undefined ? { title } : {}),
      });
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    tokens.push({
      type: 'text',
      content: text.substring(lastIndex),
    });
  }

  return tokens;
}
