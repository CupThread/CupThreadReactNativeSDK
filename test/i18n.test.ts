import test from 'node:test';
import assert from 'node:assert/strict';
import { getLocaleStrings, enStrings, zhHansStrings } from '../src/i18n';
import { formatDate, formatFileSize } from '../src/utils/formatters';

test('i18n default returns English strings', () => {
  const strings = getLocaleStrings('en');
  assert.equal(strings.feedbackComposer.title, 'Send Feedback');
  assert.equal(strings.featureRequests.screenTitle, 'Feature Requests');
  assert.equal(strings.common.back, 'Back');
});

test('i18n zh-Hans returns Simplified Chinese strings', () => {
  const strings = getLocaleStrings('zh-Hans');
  assert.equal(strings.feedbackComposer.title, '提供反馈');
  assert.equal(strings.featureRequests.screenTitle, '需求墙');
  assert.equal(strings.common.back, '返回');
  assert.equal(strings.featureRequestCompose.modalTitle, '提出新需求');
});

test('i18n aliases (zh, zh-CN) map to zh-Hans', () => {
  const stringsZh = getLocaleStrings('zh');
  assert.equal(stringsZh.featureRequests.screenTitle, '需求墙');

  const stringsZhCn = getLocaleStrings('zh-CN');
  assert.equal(stringsZhCn.featureRequests.screenTitle, '需求墙');
});

test('i18n custom overrides deeply merge on top of base locale', () => {
  const strings = getLocaleStrings('zh-Hans', {
    featureRequests: {
      screenTitle: '功能期望池',
    },
    common: {
      back: '返回上一步',
    },
  });

  // Overridden
  assert.equal(strings.featureRequests.screenTitle, '功能期望池');
  assert.equal(strings.common.back, '返回上一步');

  // Retained from base
  assert.equal(strings.feedbackComposer.title, '提供反馈');
  assert.equal(strings.featureRequests.newButton, '+ 提需求');
});

test('formatDate supports localized strings', () => {
  const nowIso = new Date().toISOString();
  const zhStrings = getLocaleStrings('zh-Hans');

  assert.equal(formatDate(nowIso, zhStrings.common), '刚刚');
  assert.equal(formatDate(nowIso, enStrings.common), 'Just now');

  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  assert.equal(formatDate(fiveMinAgo, zhStrings.common), '5 分钟前');
  assert.equal(formatDate(fiveMinAgo, enStrings.common), '5m ago');
});

test('formatFileSize formats byte units properly', () => {
  assert.equal(formatFileSize(0), '0 B');
  assert.equal(formatFileSize(500), '500 B');
  assert.equal(formatFileSize(1024), '1.0 KB');
  assert.equal(formatFileSize(1024 * 1024 * 2.5), '2.5 MB');
});
