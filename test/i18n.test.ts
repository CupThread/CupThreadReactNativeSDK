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

test('i18n handles singular and plural quantities properly across locales', () => {
  assert.equal(deStrings.common.daysAgo(1), 'vor 1 Tag');
  assert.equal(deStrings.common.daysAgo(3), 'vor 3 Tagen');
  assert.equal(deStrings.roadmap.upvotesCount(1), '1 Stimme');
  assert.equal(deStrings.roadmap.upvotesCount(5), '5 Stimmen');

  assert.equal(esStrings.roadmap.upvotesCount(1), '1 voto');
  assert.equal(esStrings.roadmap.upvotesCount(3), '3 votos');

  assert.equal(frStrings.roadmap.upvotesCount(0), '0 vote');
  assert.equal(frStrings.roadmap.upvotesCount(1), '1 vote');
  assert.equal(frStrings.roadmap.upvotesCount(2), '2 votes');

  assert.equal(itStrings.common.hoursAgo(1), '1 ora fa');
  assert.equal(itStrings.common.hoursAgo(2), '2 ore fa');
  assert.equal(itStrings.common.daysAgo(1), '1 giorno fa');
  assert.equal(itStrings.common.daysAgo(4), '4 giorni fa');
  assert.equal(itStrings.roadmap.upvotesCount(1), '1 voto');
  assert.equal(itStrings.roadmap.upvotesCount(2), '2 voti');

  assert.equal(ptStrings.common.daysAgo(1), 'Há 1 dia');
  assert.equal(ptStrings.common.daysAgo(2), 'Há 2 dias');
  assert.equal(ptStrings.roadmap.upvotesCount(1), '1 voto');
  assert.equal(ptStrings.roadmap.upvotesCount(2), '2 votos');

  assert.equal(noStrings.common.daysAgo(1), '1 dag siden');
  assert.equal(noStrings.common.daysAgo(2), '2 dager siden');
  assert.equal(noStrings.roadmap.upvotesCount(1), '1 stemme');
  assert.equal(noStrings.roadmap.upvotesCount(2), '2 stemmer');

  assert.equal(plStrings.common.daysAgo(1), '1 dzień temu');
  assert.equal(plStrings.common.daysAgo(2), '2 dni temu');
  assert.equal(plStrings.roadmap.upvotesCount(1), '1 głos');
  assert.equal(plStrings.roadmap.upvotesCount(2), '2 głosy');
  assert.equal(plStrings.roadmap.upvotesCount(5), '5 głosów');
  assert.equal(plStrings.roadmap.upvotesCount(21), '21 głosów');
  assert.equal(plStrings.roadmap.upvotesCount(22), '22 głosy');
});

test('i18n grammatical gender agreement and UI polish', () => {
  assert.equal(frStrings.featureRequestDetail.proposedBy, 'Proposée par');
  assert.equal(frStrings.featureRequestDetail.releasedIn, 'Publiée dans');

  assert.equal(itStrings.featureRequestDetail.proposedBy, 'Proposta da');
  assert.equal(itStrings.featureRequestDetail.releasedIn, 'Rilasciata in');

  assert.equal(ptStrings.featureRequestDetail.proposedBy, 'Proposta por');
  assert.equal(ptStrings.featureRequestDetail.releasedIn, 'Lançada em');

  assert.equal(esStrings.featureRequestDetail.releasedIn, 'Publicada en');

  assert.equal(jaStrings.changelog.continueButton, '次へ');
  assert.equal(koStrings.featureRequests.upvoted, '추천됨');
});

test('i18n userProfile strings are localized across locales', () => {
  assert.equal(enStrings.userProfile.screenTitle, 'User Profile');
  assert.equal(enStrings.userProfile.notFound, 'User not found');
  assert.equal(enStrings.userProfile.anonymous, 'Anonymous Developer');
  assert.equal(enStrings.userProfile.recentComments, 'Recent Comments');
  assert.equal(enStrings.userProfile.loadFailed, 'Failed to load profile');
  assert.equal(enStrings.userProfile.appsSection(3), 'Apps (3)');
  assert.equal(enStrings.userProfile.requestCount(1), '1 public feature request');
  assert.equal(enStrings.userProfile.requestCount(3), '3 public feature requests');
  assert.equal(enStrings.userProfile.commentOn('Dark Mode'), 'on Dark Mode');

  assert.equal(zhHansStrings.userProfile.notFound, '用户不存在');
  assert.equal(zhHansStrings.userProfile.anonymous, '匿名开发者');
  assert.equal(zhHansStrings.userProfile.recentComments, '最近评论');
  assert.equal(zhHansStrings.userProfile.loadFailed, '加载个人主页失败');
  assert.equal(zhHansStrings.userProfile.appsSection(2), '应用 (2)');
  assert.equal(zhHansStrings.userProfile.requestCount(5), '5 个公开需求提案');
  assert.equal(zhHansStrings.userProfile.commentOn('深色模式'), '评论于 深色模式');

  assert.equal(zhHantStrings.userProfile.notFound, '找不到使用者');
  assert.equal(zhHantStrings.userProfile.anonymous, '匿名開發者');
  assert.equal(zhHantStrings.userProfile.recentComments, '最近留言');
  assert.equal(zhHantStrings.userProfile.appsSection(2), '應用程式 (2)');
  assert.equal(zhHantStrings.userProfile.commentOn('深色模式'), '留言於 深色模式');

  assert.equal(jaStrings.userProfile.notFound, 'ユーザーが見つかりません');
  assert.equal(jaStrings.userProfile.anonymous, '匿名の開発者');
  assert.equal(jaStrings.userProfile.recentComments, '最近のコメント');
  assert.equal(jaStrings.userProfile.loadFailed, 'プロフィールの読み込みに失敗しました');
  assert.equal(jaStrings.userProfile.appsSection(1), 'アプリ（1）');
  assert.equal(jaStrings.userProfile.requestCount(4), '4件の公開機能リクエスト');
  assert.equal(jaStrings.userProfile.commentOn('ダークモード'), '「ダークモード」へのコメント');

  assert.equal(deStrings.userProfile.notFound, 'Benutzer nicht gefunden');
  assert.equal(deStrings.userProfile.anonymous, 'Anonymer Entwickler');
  assert.equal(deStrings.userProfile.appsSection(2), 'Apps (2)');
  assert.equal(deStrings.userProfile.requestCount(1), '1 öffentlicher Feature-Request');
  assert.equal(deStrings.userProfile.requestCount(2), '2 öffentliche Feature-Requests');
  assert.equal(deStrings.userProfile.commentOn('Dark Mode'), 'zu Dark Mode');

  assert.equal(frStrings.userProfile.notFound, 'Utilisateur introuvable');
  assert.equal(frStrings.userProfile.anonymous, 'Développeur anonyme');
  assert.equal(frStrings.userProfile.appsSection(3), 'Applications (3)');
  assert.equal(frStrings.userProfile.requestCount(1), '1 suggestion publique');
  assert.equal(frStrings.userProfile.requestCount(2), '2 suggestions publiques');
  assert.equal(frStrings.userProfile.commentOn('Mode sombre'), 'sur Mode sombre');

  assert.equal(esStrings.userProfile.notFound, 'Usuario no encontrado');
  assert.equal(esStrings.userProfile.anonymous, 'Desarrollador anónimo');
  assert.equal(esStrings.userProfile.appsSection(1), 'Aplicaciones (1)');
  assert.equal(esStrings.userProfile.requestCount(1), '1 solicitud de función pública');
  assert.equal(esStrings.userProfile.requestCount(3), '3 solicitudes de función públicas');
  assert.equal(esStrings.userProfile.commentOn('Modo oscuro'), 'en Modo oscuro');

  assert.equal(itStrings.userProfile.notFound, 'Utente non trovato');
  assert.equal(itStrings.userProfile.anonymous, 'Sviluppatore anonimo');
  assert.equal(itStrings.userProfile.appsSection(1), 'App (1)');
  assert.equal(itStrings.userProfile.requestCount(1), '1 richiesta di funzionalità pubblica');
  assert.equal(itStrings.userProfile.requestCount(2), '2 richieste di funzionalità pubbliche');
  assert.equal(itStrings.userProfile.commentOn('Tema scuro'), 'su Tema scuro');

  assert.equal(ptStrings.userProfile.notFound, 'Usuário não encontrado');
  assert.equal(ptStrings.userProfile.anonymous, 'Desenvolvedor anônimo');
  assert.equal(ptStrings.userProfile.appsSection(2), 'Aplicativos (2)');
  assert.equal(ptStrings.userProfile.requestCount(1), '1 solicitação de recurso pública');
  assert.equal(ptStrings.userProfile.requestCount(2), '2 solicitações de recurso públicas');
  assert.equal(ptStrings.userProfile.commentOn('Modo escuro'), 'em Modo escuro');

  assert.equal(noStrings.userProfile.notFound, 'Bruker ikke funnet');
  assert.equal(noStrings.userProfile.anonymous, 'Anonym utvikler');
  assert.equal(noStrings.userProfile.appsSection(1), 'Apper (1)');
  assert.equal(noStrings.userProfile.requestCount(1), '1 offentlig funksjonsforslag');
  assert.equal(noStrings.userProfile.requestCount(2), '2 offentlige funksjonsforslag');
  assert.equal(noStrings.userProfile.commentOn('Mørk modus'), 'på Mørk modus');

  assert.equal(plStrings.userProfile.notFound, 'Nie znaleziono użytkownika');
  assert.equal(plStrings.userProfile.anonymous, 'Anonimowy programista');
  assert.equal(plStrings.userProfile.appsSection(3), 'Aplikacje (3)');
  assert.equal(plStrings.userProfile.requestCount(1), '1 publiczna propozycja funkcji');
  assert.equal(plStrings.userProfile.requestCount(2), '2 publiczne propozycje funkcji');
  assert.equal(plStrings.userProfile.requestCount(5), '5 publicznych propozycji funkcji');
  assert.equal(plStrings.userProfile.commentOn('Tryb ciemny'), 'w Tryb ciemny');

  assert.equal(koStrings.userProfile.notFound, '사용자를 찾을 수 없습니다');
  assert.equal(koStrings.userProfile.anonymous, '익명 개발자');
  assert.equal(koStrings.userProfile.appsSection(2), '앱 (2)');
  assert.equal(koStrings.userProfile.requestCount(3), '3개의 공개 기능 제안');
  assert.equal(koStrings.userProfile.commentOn('다크 모드'), '다크 모드에 남긴 댓글');

  assert.equal(trStrings.userProfile.notFound, 'Kullanıcı bulunamadı');
  assert.equal(trStrings.userProfile.anonymous, 'Anonim Geliştirici');
  assert.equal(trStrings.userProfile.appsSection(2), 'Uygulamalar (2)');
  assert.equal(trStrings.userProfile.requestCount(3), '3 herkese açık özellik önerisi');
  assert.equal(trStrings.userProfile.commentOn('Karanlık mod'), 'Karanlık mod üzerinde');

  assert.equal(viStrings.userProfile.notFound, 'Không tìm thấy người dùng');
  assert.equal(viStrings.userProfile.anonymous, 'Nhà phát triển ẩn danh');
  assert.equal(viStrings.userProfile.appsSection(2), 'Ứng dụng (2)');
  assert.equal(viStrings.userProfile.requestCount(3), '3 đề xuất tính năng công khai');
  assert.equal(viStrings.userProfile.commentOn('Chế độ tối'), 'trong Chế độ tối');
});

test('i18n all 14 locales define all newly added error and validation keys', () => {
  const allLocales = [
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
  ];

  for (const loc of allLocales) {
    // common
    assert.ok(typeof loc.common.invalidEmail === 'string' && loc.common.invalidEmail.length > 0);
    assert.ok(typeof loc.common.submitFailed === 'string' && loc.common.submitFailed.length > 0);

    // feedbackComposer
    assert.ok(typeof loc.feedbackComposer.uploadFailed === 'string' && loc.feedbackComposer.uploadFailed.length > 0);
    assert.ok(typeof loc.feedbackComposer.submitFailed === 'string' && loc.feedbackComposer.submitFailed.length > 0);

    // featureRequestCompose
    assert.ok(typeof loc.featureRequestCompose.submitFailed === 'string' && loc.featureRequestCompose.submitFailed.length > 0);

    // comments
    assert.ok(typeof loc.comments.postFailed === 'string' && loc.comments.postFailed.length > 0);

    // changelog
    assert.ok(typeof loc.changelog.subscribeFailed === 'string' && loc.changelog.subscribeFailed.length > 0);

    // userProfile
    assert.ok(typeof loc.userProfile.loadFailed === 'string' && loc.userProfile.loadFailed.length > 0);
    assert.ok(typeof loc.userProfile.notFound === 'string' && loc.userProfile.notFound.length > 0);
    assert.ok(typeof loc.userProfile.anonymous === 'string' && loc.userProfile.anonymous.length > 0);
    assert.ok(typeof loc.userProfile.recentComments === 'string' && loc.userProfile.recentComments.length > 0);
    assert.ok(typeof loc.userProfile.appsSection(2) === 'string' && loc.userProfile.appsSection(2).length > 0);
    assert.ok(typeof loc.userProfile.requestCount(3) === 'string' && loc.userProfile.requestCount(3).length > 0);
    assert.ok(typeof loc.userProfile.commentOn('Feature') === 'string' && loc.userProfile.commentOn('Feature').length > 0);
  }
});
