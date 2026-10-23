import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDate } from '../src/utils/formatters';
import { zhHansStrings } from '../src/i18n';

// ---------------------------------------------------------------------------
// Issue #60 — formatDate calendar branch honors the SDK locale
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

/** Mirrors the year rule in formatCalendarDate so expectations follow the clock. */
function calendarExpected(iso: string, locale?: string): string {
  const date = new Date(iso);
  const now = new Date();
  return date.toLocaleDateString(locale, {
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    month: 'short',
    day: 'numeric',
  });
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

test('formatDate renders old timestamps in the requested locale', () => {
  const iso = daysAgo(30);
  const german = formatDate(iso, undefined, 'de');

  assert.equal(german, calendarExpected(iso, 'de'));
  assert.notEqual(german, calendarExpected(iso, 'en-US'));
});

test('formatDate accepts region-qualified locales such as zh-Hans', () => {
  const iso = daysAgo(30);
  const chinese = formatDate(iso, zhHansStrings.common, 'zh-Hans');

  assert.equal(chinese, calendarExpected(iso, 'zh-Hans'));
  assert.notEqual(chinese, calendarExpected(iso, 'en-US'));
});

test('formatDate without a locale keeps the runtime-default calendar rendering', () => {
  const iso = daysAgo(30);

  assert.equal(formatDate(iso), calendarExpected(iso));
  assert.equal(formatDate(iso, undefined, undefined), calendarExpected(iso));
});

test('relative labels stay driven by commonStrings and ignore the locale argument', () => {
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  assert.equal(formatDate(fiveMinAgo, undefined, 'de'), '5m ago');
  assert.equal(formatDate(fiveMinAgo, zhHansStrings.common, 'de'), '5 分钟前');
});

test('far-future timestamps use the localized calendar branch', () => {
  const inThreeDays = new Date(Date.now() + 3 * DAY_MS).toISOString();

  assert.equal(formatDate(inThreeDays, undefined, 'de'), calendarExpected(inThreeDays, 'de'));
});

test('an invalid locale tag falls back to the runtime default instead of throwing', () => {
  const iso = daysAgo(30);

  assert.equal(formatDate(iso, undefined, 'not a locale!!'), calendarExpected(iso));
});

test('runtimes without Intl fall back to the runtime-default calendar rendering', () => {
  const iso = daysAgo(30);
  const expected = calendarExpected(iso);
  const originalIntl = (globalThis as { Intl?: typeof Intl }).Intl;

  try {
    (globalThis as { Intl?: typeof Intl }).Intl = undefined;
    assert.equal(formatDate(iso, undefined, 'de'), expected);
  } finally {
    (globalThis as { Intl?: typeof Intl }).Intl = originalIntl;
  }
});
