import { useCallback, useRef, useState } from 'react';
import { FeedbackClient } from '../client/FeedbackClient';
import type { FeatureRequestItem, VoteResult, VoteWarning } from '../types';

function dispatchVoteRequest(
  client: FeedbackClient,
  featureRequestId: string,
  userToken: string,
  wasVoted: boolean,
  shipNotifyEmail?: string
): Promise<VoteResult> {
  const proto = FeedbackClient?.prototype;
  const hasCustomToggleVote =
    typeof client.toggleVote === 'function' && client.toggleVote !== proto?.toggleVote;
  // Only the cast path carries the opt-in; removing a vote never requests
  // ship notifications.
  const castOptions = shipNotifyEmail ? { shipNotifyEmail } : undefined;

  if (wasVoted) {
    if (
      typeof client.removeVote === 'function' &&
      (!hasCustomToggleVote || client.removeVote !== proto?.removeVote)
    ) {
      return client.removeVote(featureRequestId, userToken);
    }
    return client.toggleVote(featureRequestId, userToken);
  }

  if (
    typeof client.castVote === 'function' &&
    (!hasCustomToggleVote || client.castVote !== proto?.castVote)
  ) {
    return client.castVote(featureRequestId, userToken, castOptions);
  }
  return client.toggleVote(featureRequestId, userToken, castOptions);
}

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
export function withServerVote(item: FeatureRequestItem, result: VoteResult): FeatureRequestItem {
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
 * Options for configuring {@link useToggleVote}.
 */
export interface UseToggleVoteOptions {
  /**
   * Optional callback invoked whenever a vote toggle request rejects.
   */
  onVoteError?: (error: unknown, item: FeatureRequestItem) => void;

  /**
   * Optional callback invoked when a vote succeeds but the server reports a
   * non-fatal warning, such as a refused ship-notification opt-in
   * (`warning.code === 'email_not_verified'`). The vote itself is saved.
   */
  onVoteWarning?: (warning: VoteWarning, item: FeatureRequestItem) => void;

  /**
   * Optional ship-notification email sent with a cast vote. On a board that
   * requires sign-in the address must belong to the session, otherwise the
   * server records the vote and returns `email_not_verified` in
   * {@link VoteResult.warning}.
   */
  shipNotifyEmail?: string;
}

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

  /**
   * Most recent vote error, or `null` if the last attempt succeeded or has been cleared.
   */
  voteError: Error | null;

  /**
   * Returns the error for a specific item, or `null` if none occurred or has been cleared.
   */
  getVoteError: (itemId: string) => Error | null;

  /**
   * Clears the active vote error state.
   */
  clearVoteError: (itemId?: string) => void;
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
 * - Surfaces vote errors via `voteError`, `getVoteError`, and `options.onVoteError`.
 * - Delivers non-fatal server warnings (a refused ship-notification opt-in) via
 *   `options.onVoteWarning`; the vote itself still applies.
 *
 * @param client - {@link FeedbackClient} used to dispatch the toggle request.
 * @param userToken - Current user token; toggles are ignored while empty.
 * @param applyChange - Applier that persists a transform into the component's state.
 * @param options - Optional configuration options such as error callbacks.
 *
 * @example
 * ```tsx
 * const applyVoteChange = useCallback((itemId, transform) => {
 *   setItems((prev) => prev.map((i) => (i.id === itemId ? transform(i) : i)));
 * }, []);
 * const { toggleVote, isVoting, voteError } = useToggleVote(client, userToken, applyVoteChange);
 * ```
 */
export function useToggleVote(
  client: FeedbackClient,
  userToken: string,
  applyChange: VoteChangeApplier,
  options?: UseToggleVoteOptions
): UseToggleVoteResult {
  const applyChangeRef = useRef(applyChange);
  applyChangeRef.current = applyChange;

  const onVoteErrorRef = useRef(options?.onVoteError);
  onVoteErrorRef.current = options?.onVoteError;

  const onVoteWarningRef = useRef(options?.onVoteWarning);
  onVoteWarningRef.current = options?.onVoteWarning;

  const shipNotifyEmail = options?.shipNotifyEmail?.trim() || undefined;

  const pendingIdsRef = useRef<Set<string>>(new Set());
  const [pendingIds, setPendingIds] = useState<string[]>([]);

  const [voteError, setVoteError] = useState<Error | null>(null);
  const [errorsByItemId, setErrorsByItemId] = useState<Record<string, Error>>({});

  const clearVoteError = useCallback((itemId?: string) => {
    if (itemId) {
      setErrorsByItemId((prev) => {
        if (!prev[itemId]) return prev;
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
      setVoteError((prev) => (prev ? null : null));
    } else {
      setErrorsByItemId({});
      setVoteError(null);
    }
  }, []);

  const getVoteError = useCallback(
    (itemId: string) => errorsByItemId[itemId] || null,
    [errorsByItemId]
  );

  const toggleVote = useCallback(
    (item: FeatureRequestItem) => {
      if (!item || item.isOwnRequest || !userToken) return;
      if (pendingIdsRef.current.has(item.id)) return;

      // Clear previous error on the same item at tap time
      setErrorsByItemId((prev) => {
        if (!prev[item.id]) return prev;
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
      setVoteError(null);

      pendingIdsRef.current.add(item.id);
      setPendingIds(Array.from(pendingIdsRef.current));

      const preVoteSnapshot: VoteStateSnapshot = {
        hasVoted: item.hasVoted,
        voteCount: item.voteCount,
      };
      applyChangeRef.current(item.id, withOptimisticVote);

      dispatchVoteRequest(client, item.id, userToken, preVoteSnapshot.hasVoted, shipNotifyEmail)
        .then((res) => {
          applyChangeRef.current(item.id, (current) => withServerVote(current, res));
          setErrorsByItemId((prev) => {
            if (!prev[item.id]) return prev;
            const next = { ...prev };
            delete next[item.id];
            return next;
          });
          setVoteError(null);
          // A warning means the vote was saved but an optional opt-in was
          // refused, so it must not be routed through the error path.
          if (res.warning) {
            onVoteWarningRef.current?.(res.warning, item);
          }
        })
        .catch((err: unknown) => {
          applyChangeRef.current(item.id, (current) => withVoteRollback(current, preVoteSnapshot));
          const errorObj = err instanceof Error ? err : new Error(String(err));
          setErrorsByItemId((prev) => ({ ...prev, [item.id]: errorObj }));
          setVoteError(errorObj);
          onVoteErrorRef.current?.(err, item);
        })
        .finally(() => {
          pendingIdsRef.current.delete(item.id);
          setPendingIds(Array.from(pendingIdsRef.current));
        });
    },
    [client, userToken, shipNotifyEmail]
  );

  const isVoting = useCallback(
    (itemId: string) => pendingIds.includes(itemId) || pendingIdsRef.current.has(itemId),
    [pendingIds]
  );

  return { toggleVote, isVoting, voteError, getVoteError, clearVoteError };
}
