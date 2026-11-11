import type { BoardColumn, FeatureRequestItem } from '../types';

/**
 * Result of grouping feature requests against the visible roadmap columns.
 */
export interface RoadmapColumnGrouping {
  /**
   * Columns visible to end users (`isVisible === true`), in server order.
   */
  columns: BoardColumn[];

  /**
   * Requests that belong to no visible column: a `columnId` referencing a
   * hidden or unknown column, or no `columnId` at all with a `status` that
   * matches no visible column slug. These would silently disappear from the
   * board without the "Other" fallback tab.
   */
  orphanRequests: FeatureRequestItem[];
}

/**
 * Whether a request belongs to a column. `columnId` values are compared after
 * trimming (the client trims column ids), and the legacy `status`/`slug`
 * fallback applies only when the request has no usable `columnId`.
 */
export function requestBelongsToColumn(request: FeatureRequestItem, column: BoardColumn): boolean {
  const columnId = typeof column.id === 'string' ? column.id.trim() : '';
  const requestColumnId = typeof request.columnId === 'string' ? request.columnId.trim() : '';
  if (requestColumnId) return Boolean(columnId) && requestColumnId === columnId;
  return Boolean(request.status && column.slug && request.status === column.slug);
}

/**
 * Splits roadmap requests into per-visible-column membership and orphans.
 *
 * A request matches a visible column when its `columnId` equals the column
 * id, or (legacy shape) when it has no `columnId` and its `status` equals the
 * column slug. Everything else — hidden/unknown column ids included — is an
 * orphan so the board can surface it under an "Other" tab instead of
 * dropping it.
 */
export function groupRoadmapRequests(
  columns?: readonly BoardColumn[] | null,
  requests?: readonly FeatureRequestItem[] | null
): RoadmapColumnGrouping {
  const safeColumns = Array.isArray(columns)
    ? columns.filter((c): c is BoardColumn => c !== null && typeof c === 'object')
    : [];
  const safeRequests = Array.isArray(requests)
    ? requests.filter((r): r is FeatureRequestItem => r !== null && typeof r === 'object')
    : [];

  const visible = safeColumns.filter((c) => Boolean(c.isVisible));
  const orphanRequests = safeRequests.filter(
    (r) => !visible.some((c) => requestBelongsToColumn(r, c))
  );
  return { columns: visible, orphanRequests };
}

/**
 * Synthetic tab id for the "Other" fallback bucket rendered by
 * `RoadmapBoardScreen` when {@link RoadmapColumnGrouping.orphanRequests} is
 * non-empty. Chosen to never collide with server-generated column ids.
 */
export const ROADMAP_OTHER_COLUMN_ID = '__cupthread_other__';

/**
 * Renders a roadmap column tab's request count as a user-facing label.
 *
 * Tab counts are computed from the pages loaded so far, so while the
 * underlying list still has unloaded pages (`hasMore`) the number is only a
 * lower bound of the column's real total. Appending `+` keeps the badge
 * honest (`0+` instead of a bare `0`) until every page has been fetched and
 * the exact count can be asserted.
 */
export function formatColumnTabCount(count: number, hasMore: boolean): string {
  const safeCount =
    typeof count === 'number' && Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  return hasMore ? `${safeCount}+` : `${safeCount}`;
}
