import test from 'node:test';
import assert from 'node:assert/strict';
import { getThemeColors } from '../src/theme/SdkTheme';
import { formatDate } from '../src/utils/formatters';

test('getThemeColors returns matching colors for each theme', () => {
  const light = getThemeColors('light');
  assert.equal(light.primary, '#2563eb');

  const dark = getThemeColors('dark');
  assert.equal(dark.background, '#090d16');

  const ocean = getThemeColors('ocean');
  assert.equal(ocean.primary, '#0d9488');
});

test('formatDate formats relative time correctly', () => {
  const nowIso = new Date().toISOString();
  assert.equal(formatDate(nowIso), 'Just now');

  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  assert.equal(formatDate(tenMinAgo), '10m ago');

  const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
  assert.equal(formatDate(twoHoursAgo), '2h ago');
});
