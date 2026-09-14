import test from 'node:test';
import assert from 'node:assert/strict';
import {
  candyTheme,
  darkTheme,
  forestTheme,
  lightTheme,
  midnightTheme,
  oceanTheme,
  sunsetTheme,
  type ThemeColors,
} from '../src/theme/SdkTheme';

/**
 * WCAG 2.1 SC 1.4.3 relative luminance of an sRGB `#rrggbb` color.
 */
function relativeLuminance(hex: string): number {
  assert.match(hex, /^#[0-9a-f]{6}$/, `expected a #rrggbb color, got "${hex}"`);
  const [r, g, b] = [0, 2, 4].map((offset) => {
    const channel = parseInt(hex.slice(offset + 1, offset + 3), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * WCAG 2.1 contrast ratio between two sRGB colors, from 1:1 (identical) to 21:1 (black on white).
 */
function contrastRatio(foreground: string, background: string): number {
  const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)].sort(
    (a, b) => b - a,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

const WCAG_AA_NORMAL_TEXT = 4.5;

// Every pair the SDK renders as normal-size text: body text on surfaces,
// placeholders on inputs, and text drawn on filled surfaces (buttons, chips,
// vote pills, alerts).
const CONTRAST_PAIRS: ReadonlyArray<{
  foreground: keyof ThemeColors;
  background: keyof ThemeColors;
}> = [
  { foreground: 'textPrimary', background: 'card' },
  { foreground: 'textPrimary', background: 'background' },
  { foreground: 'textSecondary', background: 'card' },
  { foreground: 'textMuted', background: 'card' },
  { foreground: 'textMuted', background: 'background' },
  { foreground: 'textMuted', background: 'inputBg' },
  { foreground: 'chipText', background: 'chipBg' },
  { foreground: 'primaryText', background: 'primary' },
  { foreground: 'voteActiveText', background: 'voteActiveBg' },
  { foreground: 'voteInactiveText', background: 'voteInactiveBg' },
  { foreground: 'danger', background: 'dangerBg' },
  { foreground: 'danger', background: 'background' },
];

const PALETTES: ReadonlyArray<readonly [name: string, palette: ThemeColors]> = [
  ['light', lightTheme],
  ['dark', darkTheme],
  ['midnight', midnightTheme],
  ['ocean', oceanTheme],
  ['forest', forestTheme],
  ['sunset', sunsetTheme],
  ['candy', candyTheme],
];

test('every text token pair meets WCAG AA contrast (4.5:1) in every palette', () => {
  for (const [name, palette] of PALETTES) {
    for (const { foreground, background } of CONTRAST_PAIRS) {
      const ratio = contrastRatio(palette[foreground], palette[background]);
      assert.ok(
        ratio >= WCAG_AA_NORMAL_TEXT,
        `${name}.${foreground} on ${background}: expected ≥${WCAG_AA_NORMAL_TEXT}, got ${ratio.toFixed(2)}`,
      );
    }
  }
});

test('muted text stays perceptually closer to the background than secondary and primary text', () => {
  for (const [name, palette] of PALETTES) {
    const distanceFromBackground = (token: keyof ThemeColors) =>
      Math.abs(relativeLuminance(palette[token]) - relativeLuminance(palette.background));
    const muted = distanceFromBackground('textMuted');
    const secondary = distanceFromBackground('textSecondary');
    const primary = distanceFromBackground('textPrimary');
    assert.ok(
      muted < secondary && secondary < primary,
      `${name}: expected textMuted < textSecondary < textPrimary emphasis, got ${muted.toFixed(3)} / ${secondary.toFixed(3)} / ${primary.toFixed(3)}`,
    );
  }
});
