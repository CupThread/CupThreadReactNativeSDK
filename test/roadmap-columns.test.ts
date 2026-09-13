import test from 'node:test';
import assert from 'node:assert/strict';
import { groupRoadmapRequests, ROADMAP_OTHER_COLUMN_ID } from '../src/utils/roadmapColumns';
import type { BoardColumn, FeatureRequestItem } from '../src/types';
import { enStrings, zhHansStrings } from '../src/i18n';

function makeColumn(overrides: Partial<BoardColumn> & { id: string }): BoardColumn {
  return {
    appId: 'app_1',
    name: `Column ${overrides.id}`,
    slug: overrides.id,
    position: 0,
    isVisible: true,
    isSystem: false,
    kind: 'normal',
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as BoardColumn;
}

function makeRequest(overrides: Partial<FeatureRequestItem> & { id: string }): FeatureRequestItem {
  return {
    appId: 'app_1',
    title: `Request ${overrides.id}`,
    description: 'A request body',
    status: '',
    voteCount: 0,
    hasVoted: false,
    isOwnRequest: false,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as FeatureRequestItem;
}

const visibleA = makeColumn({ id: 'col_a', name: 'Planned', slug: 'planned', isVisible: true });
const visibleB = makeColumn({ id: 'col_b', name: 'Shipped', slug: 'shipped', isVisible: true });
const hiddenC = makeColumn({ id: 'col_c', name: 'Internal', slug: 'internal', isVisible: false });

test('groupRoadmapRequests keeps requests whose columnId matches a visible column', () => {
  const requests = [makeRequest({ id: 'r1', columnId: 'col_a' })];
  const { columns, orphanRequests } = groupRoadmapRequests([visibleA, visibleB], requests);
  assert.deepEqual(
    columns.map((c) => c.id),
    ['col_a', 'col_b']
  );
  assert.deepEqual(orphanRequests, []);
});

test('groupRoadmapRequests flags requests referencing a hidden column as orphans', () => {
  const requests = [makeRequest({ id: 'r1', columnId: 'col_c' })];
  const { orphanRequests } = groupRoadmapRequests([visibleA, visibleB, hiddenC], requests);
  assert.deepEqual(
    orphanRequests.map((r) => r.id),
    ['r1']
  );
});

test('groupRoadmapRequests flags requests referencing an unknown column as orphans', () => {
  const requests = [makeRequest({ id: 'r1', columnId: 'col_deleted' })];
  const { orphanRequests } = groupRoadmapRequests([visibleA], requests);
  assert.equal(orphanRequests.length, 1);
});

test('groupRoadmapRequests matches null-columnId requests by visible column slug', () => {
  const requests = [
    makeRequest({ id: 'r1', columnId: null, status: 'planned' }),
    makeRequest({ id: 'r2', columnId: null, status: 'internal' }),
    makeRequest({ id: 'r3', columnId: null, status: 'no-such-slug' }),
  ];
  const { orphanRequests } = groupRoadmapRequests([visibleA, visibleB, hiddenC], requests);
  // 'planned' matches a visible slug; 'internal' matches only a hidden
  // column's slug; the unknown slug matches nothing.
  assert.deepEqual(
    orphanRequests.map((r) => r.id),
    ['r2', 'r3']
  );
});

test('groupRoadmapRequests excludes hidden columns from the visible set', () => {
  const { columns } = groupRoadmapRequests([visibleA, hiddenC], []);
  assert.deepEqual(
    columns.map((c) => c.id),
    ['col_a']
  );
});

test('groupRoadmapRequests preserves legacy flat-list behavior with zero visible columns', () => {
  // With no visible columns the screen renders every request flat; the helper
  // must not silently reclassify anything there.
  const requests = [makeRequest({ id: 'r1', columnId: 'col_x' })];
  const { columns, orphanRequests } = groupRoadmapRequests([], requests);
  assert.equal(columns.length, 0);
  assert.equal(orphanRequests.length, 1);
});

test('ROADMAP_OTHER_COLUMN_ID never collides with server column ids', () => {
  assert.ok(ROADMAP_OTHER_COLUMN_ID.startsWith('__cupthread_'));
});

test('otherColumn fallback copy exists in shipped locales', () => {
  assert.equal(enStrings.roadmap.otherColumn, 'Other');
  assert.equal(zhHansStrings.roadmap.otherColumn, '其他');
});
