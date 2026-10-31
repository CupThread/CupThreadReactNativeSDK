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
  assert.equal(ocean.primary, '#0f766e');
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

test('SdkFeatures and SdkAppearance remain in sync with public API schema', () => {
  const features: import('../src/types').SdkFeatures = {
    feedback: true,
    featureRequests: false,
    roadmap: true,
    changelog: false,
  };
  assert.equal(typeof features.feedback, 'boolean');
  assert.equal(typeof features.featureRequests, 'boolean');
  assert.equal(typeof features.roadmap, 'boolean');
  assert.equal(typeof features.changelog, 'boolean');

  const appearance: import('../src/types').SdkAppearance = {
    theme: 'system',
    features,
    changelogOverlay: {
      title: "What's New",
      entryCount: 3,
      primaryButton: 'Got it',
      closeButton: 'Dismiss',
    },
  };
  assert.equal(appearance.theme, 'system');
  assert.equal(appearance.features.featureRequests, false);
  assert.equal(appearance.changelogOverlay.entryCount, 3);
});

test('PublicAppConfig carries the fields the published OpenAPI schema serves', () => {
  // Compile-time probe: indexed access fails to compile (TS2339) if any of
  // these spec fields is dropped from PublicAppConfig again (issue #175).
  type SpecFieldProbe = [
    import('../src/types').PublicAppConfig['workspaceSlug'],
    import('../src/types').PublicAppConfig['hideSiteBranding'],
    import('../src/types').PublicAppConfig['requireAnonymousVoteTurnstile'],
    import('../src/types').PublicAppConfig['turnstile'],
    import('../src/types').PublicAppConfig['allowedEmbedOrigins'],
    import('../src/types').PublicAppConfig['appStoreUrl'],
    import('../src/types').PublicAppConfig['googlePlayUrl'],
    import('../src/types').PublicAppConfig['websiteUrl'],
  ];
  const _specFieldProbe: SpecFieldProbe = [
    'ws',
    false,
    false,
    undefined,
    undefined,
    null,
    null,
    null,
  ];
  void _specFieldProbe;

  // Runtime fixture: assigning this to PublicAppConfig fails to compile when a
  // spec-required field is missing.
  const config: import('../src/types').PublicAppConfig = {
    appId: 'app_123',
    appKey: 'app_key_123',
    workspaceSlug: 'test-workspace',
    slug: 'test-app',
    name: 'Test App',
    storeUrl: 'https://example.com',
    storeKind: 'app_store',
    appStoreUrl: 'https://apps.apple.com/app/id123',
    googlePlayUrl: null,
    websiteUrl: 'https://example.com',
    iconUrl: 'https://cdn.example.com/icon.png',
    allowPublic: true,
    hideSiteBranding: false,
    allowedPlatforms: ['ios', 'macos', 'android', 'universal'],
    allowedEmbedOrigins: ['https://example.com'],
    maxAttachmentBytes: 10485760,
    allowAnonymousRoadmap: true,
    allowAnonymousVote: true,
    allowAnonymousFeedback: true,
    allowAnonymousChangelog: true,
    requireAnonymousVoteTurnstile: true,
    turnstile: { siteKey: '0x4AAAAAAA_test_site_key' },
    sdk: {
      theme: 'system',
      features: { feedback: true, featureRequests: true, roadmap: true, changelog: true },
      changelogOverlay: {
        title: "What's New",
        entryCount: 3,
        primaryButton: 'Got it',
        closeButton: 'Dismiss',
      },
    },
  };

  assert.equal(typeof config.workspaceSlug, 'string');
  assert.equal(typeof config.hideSiteBranding, 'boolean');
  assert.equal(typeof config.requireAnonymousVoteTurnstile, 'boolean');
  assert.equal(config.turnstile?.siteKey, '0x4AAAAAAA_test_site_key');
  assert.deepEqual(config.allowedEmbedOrigins, ['https://example.com']);
  assert.equal(config.appStoreUrl, 'https://apps.apple.com/app/id123');
  assert.equal(config.googlePlayUrl, null);
  assert.equal(config.websiteUrl, 'https://example.com');
});

test('FeatureRequestComment carries the fields the published OpenAPI schema serves', () => {
  // Compile-time probe: indexed access fails to compile (TS2339) if any of
  // these spec fields is dropped from FeatureRequestComment again (issue #176).
  type SpecFieldProbe = [
    import('../src/types').FeatureRequestComment['appId'],
    import('../src/types').FeatureRequestComment['updatedAt'],
  ];
  const _specFieldProbe: SpecFieldProbe = ['app_123', '2026-08-21T10:00:00.000Z'];
  void _specFieldProbe;

  // Runtime fixture: assigning this to FeatureRequestComment fails to compile
  // when a spec-required field is missing.
  const comment: import('../src/types').FeatureRequestComment = {
    id: 'cmt_001',
    featureRequestId: 'fr_101',
    appId: 'app_123',
    authorName: 'DevTeam',
    body: 'We have started working on this for the next minor release!',
    createdAt: '2026-08-20T09:00:00.000Z',
    updatedAt: '2026-08-21T10:00:00.000Z',
  };
  assert.equal(comment.appId, 'app_123');
  assert.equal(comment.updatedAt, '2026-08-21T10:00:00.000Z');

  // Minimal schema-required fixture: omits optional fields (`featureRequestId`,
  // `appId`, `updatedAt`) to ensure they remain optional.
  const legacyComment: import('../src/types').FeatureRequestComment = {
    id: 'cmt_002',
    authorName: 'DevTeam',
    body: 'Legacy comment',
    createdAt: '2026-08-20T09:00:00.000Z',
  };
  assert.equal(legacyComment.featureRequestId, undefined);
  assert.equal(legacyComment.appId, undefined);
  assert.equal(legacyComment.updatedAt, undefined);

  // Compile-time negative probe: `authorEmail` is no longer part of the
  // record — the server strips author identity fields and never serves one
  // back (issue #176). This fails to compile ("unused '@ts-expect-error'")
  // the moment the field returns to the record type. The draft type keeps
  // its documented source-compatibility field.
  const leaked: import('../src/types').FeatureRequestComment = {
    ...comment,
    // @ts-expect-error authorEmail is never served on comment records
    authorEmail: 'nobody@example.com',
  };
  void leaked;
});
