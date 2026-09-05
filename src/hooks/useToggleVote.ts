import { useCallback, useRef, useState } from 'react';
import type { FeedbackClient } from '../client/FeedbackClient';
import type { FeatureRequestItem, VoteResult } from '../types';

/**
 * Applies the optimistic vote delta to an item: flips `hasVoted` and adjusts
 * `voteCount` by ±1, clamped at zero.
 */
export function withOptimisticVote(item: FeatureRequestItem): FeatureRequestItem {
  const nextVoted = !item.hasVoted;
  const nextCount = item.voteCount + (nextVoted ? 1 : -1);
  return { ...item, hasVoted: nextVoted, voteCount: Math.max(0, nextCount) };
}

/**
 * Reconciles an item with the server-returned vote truth.
 */
export function withServerVote(
  item: FeatureRequestItem,
  result: VoteResult
): FeatureRequestItem {
  return { ...item, hasVoted: result.voted, voteCount: result.voteCount };
}

/**
 * Snapshot of the vote fields captured at tap time, used for rollback.
 */
export type VoteStateSnapshot = Pick<FeatureRequestItem, 'hasVoted' | 'voteCount'>;

/**
 * Reverts the optimistic vote change by restoring only the two vote fields to
 * their pre-tap values on the item's *current* state, so any other fields that
 * changed since the tap survive and a clamped count is restored exactly.
 */
export function withVoteRollback(
  item: FeatureRequestItem,
  preVoteSnapshot: VoteStateSnapshot
): FeatureRequestItem {
  return {
    ...item,
    hasVoted: preVoteSnapshot.hasVoted,
    voteCount: preVoteSnapshot.voteCount,
  };
}

/**
 * Transform applied to the current item state whenever the vote flow changes it.
 */
export type VoteItemTransform = (item: FeatureRequestItem) => FeatureRequestItem;

/**
 * Applier supplied by the host component, typically mapping the transform over
 * its list state so the change always lands on the freshest item data.
 */
export type VoteChangeApplier = (itemId: string, transform: VoteItemTransform) => void;

/**
 * Result of {@link useToggleVote}.
 */
export interface UseToggleVoteResult {
  /**
   * Toggles the vote on a feature request with optimistic update, server
   * reconciliation, and delta-based rollback on failure. No-ops while the
   * same item already has a vote request in flight or for the user's own requests.
   */
  toggleVote: (item: FeatureRequestItem) => void;

  /**
   * Whether a vote toggle request is currently in flight for the given item.
   */
  isVoting: (itemId: string) => boolean;
}

/**
 * Single shared implementation of optimistic vote toggling used by the list,
 * board, and detail surfaces.
 *
 * @remarks
 * Guarantees:
 * - One in-flight request per item: rapid double-taps fire exactly one network call.
 * - Success applies the server truth (`voted` / `voteCount`) on top of current state.
 * - Failure reverts only the optimistic delta relative to current state, never a
 *   stale whole-item snapshot.
 *
 * @param client - {@link FeedbackClient} used to dispatch the toggle request.
 * @param userToken - Current user token; toggles are ignored while empty.
 * @param applyChange - Applier that persists a transform into the component's state.
 *
 * @example
 * ```tsx
 * const applyVoteChange = useCallback((itemId, transform) => {
 *   setItems((prev) => prev.map((i) => (i.id === itemId ? transform(i) : i)));
 * }, []);
 * const { toggleVote, isVoting } = useToggleVote(client, userToken, applyVoteChange);
 * ```
 */
export function useToggleVote(
  client: FeedbackClient,
  userToken: string,
  applyChange: VoteChangeApplier
): UseToggleVoteResult {
  const applyChangeRef = useRef(applyChange);
  applyChangeRef.current = applyChange;

  const pendingIdsRef = useRef<Set<string>>(new Set());
  const [pendingIds, setPendingIds] = useState<string[]>([]);

  const toggleVote = useCallback(
    (item: FeatureRequestItem) => {
      if (!item || item.isOwnRequest || !userToken) return;
      if (pendingIdsRef.current.has(item.id)) return;

      pendingIdsRef.current.add(item.id);
      setPendingIds(Array.from(pendingIdsRef.current));

      const preVoteSnapshot: VoteStateSnapshot = {
        hasVoted: item.hasVoted,
        voteCount: item.voteCount,
      };
      applyChangeRef.current(item.id, withOptimisticVote);

      client
        .toggleVote(item.id, userToken)
        .then((res) => {
          applyChangeRef.current(item.id, (current) => withServerVote(current, res));
        })
        .catch(() => {
          applyChangeRef.current(item.id, (current) => withVoteRollback(current, preVoteSnapshot));
        })
        .finally(() => {
          pendingIdsRef.current.delete(item.id);
          setPendingIds(Array.from(pendingIdsRef.current));
        });
    },
    [client, userToken]
  );

  const isVoting = useCallback(
    (itemId: string) => pendingIds.includes(itemId),
    [pendingIds]
  );

  return { toggleVote, isVoting };
}
