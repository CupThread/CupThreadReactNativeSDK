import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getLocaleStrings,
  deStrings,
  enStrings,
  esStrings,
  frStrings,
  itStrings,
  jaStrings,
  koStrings,
  noStrings,
  plStrings,
  ptStrings,
  trStrings,
  viStrings,
  zhHantStrings,
  zhHansStrings,
} from '../src/i18n';
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

test('i18n Japanese locale returns Japanese strings', () => {
  const strings = getLocaleStrings('ja');
  assert.equal(strings.feedbackComposer.title, 'フィードバックを送る');
  assert.equal(strings.featureRequests.screenTitle, '機能リクエスト');
  assert.equal(strings.common.back, '戻る');
  assert.equal(strings.featureRequestCompose.modalTitle, '機能を提案');
  assert.equal(getLocaleStrings('ja-JP').roadmap.screenTitle, 'ロードマップ');
  assert.equal(getLocaleStrings('ja_JP').common.justNow, 'たった今');
  assert.equal(jaStrings.comments.commentsCount(2), 'コメント（2）');
});

test('i18n European and Portuguese locales return translated strings', () => {
  assert.equal(getLocaleStrings('fr').common.back, 'Retour');
  assert.equal(getLocaleStrings('es-ES').featureRequests.screenTitle, 'Solicitudes de funciones');
  assert.equal(getLocaleStrings('de-DE').roadmap.screenTitle, 'Roadmap');
  assert.equal(getLocaleStrings('it-IT').common.close, 'Chiudi');
  assert.equal(getLocaleStrings('pt-BR').featureRequestCompose.modalTitle, 'Propor um recurso');
  assert.equal(frStrings.comments.commentsCount(2), 'Commentaires (2)');
  assert.equal(esStrings.common.justNow, 'Ahora mismo');
  assert.equal(deStrings.common.justNow, 'Gerade eben');
  assert.equal(itStrings.common.justNow, 'Proprio ora');
  assert.equal(ptStrings.common.justNow, 'Agora mesmo');
});

test('i18n additional locales return translated strings', () => {
  assert.equal(getLocaleStrings('zh-Hant').featureRequests.screenTitle, '功能需求');
  assert.equal(getLocaleStrings('zh-TW').common.back, '返回');
  assert.equal(getLocaleStrings('ko-KR').roadmap.screenTitle, '로드맵');
  assert.equal(getLocaleStrings('pl-PL').common.close, 'Zamknij');
  assert.equal(getLocaleStrings('nb-NO').featureRequests.upvote, 'Stem');
  assert.equal(getLocaleStrings('tr-TR').common.cancel, 'İptal');
  assert.equal(zhHantStrings.common.justNow, '剛剛');
  assert.equal(koStrings.common.justNow, '방금');
  assert.equal(plStrings.common.justNow, 'Przed chwilą');
  assert.equal(noStrings.common.justNow, 'Akkurat nå');
  assert.equal(trStrings.common.justNow, 'Az önce');
  assert.equal(getLocaleStrings('vi-VN').featureRequests.screenTitle, 'Yêu cầu tính năng');
  assert.equal(viStrings.common.justNow, 'Vừa xong');
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
