import test from 'node:test';
import assert from 'node:assert/strict';
import { getThemeColors } from '../src/theme/SdkTheme';
import type { SdkTheme } from '../src/types';
import { formatDate } from '../src/utils/formatters';

const ALL_THEMES: SdkTheme[] = ['light', 'dark', 'midnight', 'ocean', 'forest', 'sunset', 'candy'];
const HEX_COLOR = /^#[0-9a-f]{6}$/;

test('getThemeColors returns matching colors for each theme', () => {
  const light = getThemeColors('light');
  assert.equal(light.primary, '#2563eb');

  const dark = getThemeColors('dark');
  assert.equal(dark.background, '#090d16');

  const ocean = getThemeColors('ocean');
  assert.equal(ocean.primary, '#0d9488');
});

test('every palette defines danger, dangerBg, and dangerBorder tokens', () => {
  for (const theme of ALL_THEMES) {
    const colors = getThemeColors(theme);
    assert.match(colors.danger, HEX_COLOR, `${theme}.danger`);
    assert.match(colors.dangerBg, HEX_COLOR, `${theme}.dangerBg`);
    assert.match(colors.dangerBorder, HEX_COLOR, `${theme}.dangerBorder`);
  }
});

test('danger tokens use a light-mode palette on light themes and a dark-mode palette on dark themes', () => {
  for (const theme of ['light', 'ocean', 'forest', 'sunset', 'candy'] as SdkTheme[]) {
    const colors = getThemeColors(theme);
    assert.equal(colors.danger, '#b91c1c', `${theme}.danger`);
    assert.equal(colors.dangerBg, '#fef2f2', `${theme}.dangerBg`);
    assert.equal(colors.dangerBorder, '#fca5a5', `${theme}.dangerBorder`);
  }

  for (const theme of ['dark', 'midnight'] as SdkTheme[]) {
    const colors = getThemeColors(theme);
    assert.equal(colors.danger, '#f87171', `${theme}.danger`);
    assert.equal(colors.dangerBg, '#450a0a', `${theme}.dangerBg`);
    assert.equal(colors.dangerBorder, '#7f1d1d', `${theme}.dangerBorder`);
  }
});

test('system theme resolves danger tokens from the active light/dark palette', () => {
  assert.equal(getThemeColors('system', false).dangerBg, '#fef2f2');
  assert.equal(getThemeColors('system', true).dangerBg, '#450a0a');
});

test('formatDate formats relative time correctly', () => {
  const nowIso = new Date().toISOString();
  assert.equal(formatDate(nowIso), 'Just now');

  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  assert.equal(formatDate(tenMinAgo), '10m ago');

  const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  assert.equal(formatDate(twoHoursAgo), '2h ago');
});
