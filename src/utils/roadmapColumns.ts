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
 * Splits roadmap requests into per-visible-column membership and orphans.
 *
 * A request matches a visible column when its `columnId` equals the column
 * id, or (legacy shape) when it has no `columnId` and its `status` equals the
 * column slug. Everything else — hidden/unknown column ids included — is an
 * orphan so the board can surface it under an "Other" tab instead of
 * dropping it.
 */
export function groupRoadmapRequests(
  columns: BoardColumn[],
  requests: FeatureRequestItem[]
): RoadmapColumnGrouping {
  const visible = columns.filter((c) => c.isVisible);
  const orphanRequests = requests.filter(
    (r) => !visible.some((c) => r.columnId === c.id || (!r.columnId && r.status === c.slug))
  );
  return { columns: visible, orphanRequests };
}

/**
 * Synthetic tab id for the "Other" fallback bucket rendered by
 * `RoadmapBoardScreen` when {@link RoadmapColumnGrouping.orphanRequests} is
 * non-empty. Chosen to never collide with server-generated column ids.
 */
export const ROADMAP_OTHER_COLUMN_ID = '__cupthread_other__';
