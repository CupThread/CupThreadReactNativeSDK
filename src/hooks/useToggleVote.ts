import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { FeedbackClient } from '../client/FeedbackClient';
import type { FeatureRequestItem, VoteResult, VoteWarning } from '../types';

declare const __DEV__: boolean | undefined;

const EMPTY_PENDING_IDS: string[] = [];
const EMPTY_ERRORS_BY_ITEM_ID: Record<string, Error> = {};

interface VoteSession {
  client: FeedbackClient;
  userToken: string;
  generation: number;
  pendingIds: Set<string>;
}

interface VoteSessionState {
  client: FeedbackClient;
  userToken: string;
  generation: number;
  pendingIds: string[];
  voteError: Error | null;
  errorsByItemId: Record<string, Error>;
}

/**
 * Emits a diagnostic warning to `console.warn` only in development environments.
 *
 * @param message - Diagnostic message describing the caught failure.
 * @param error - Optional caught error or exception details.
 */
function warnInDev(message: string, error?: unknown): void {
  const isDev =
    typeof (globalThis as any).__DEV__ !== 'undefined'
      ? Boolean((globalThis as any).__DEV__)
      : typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production';
  if (isDev) {
    if (error !== undefined) {
      console.warn(message, error);
    } else {
      console.warn(message);
    }
  }
}

function dispatchVoteRequest(
  client: FeedbackClient,
  featureRequestId: string,
  userToken: string,
  wasVoted: boolean,
  shipNotifyEmail?: string
): Promise<VoteResult> {
  const trimmedToken = typeof userToken === 'string' ? userToken.trim() : '';
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
      return client.removeVote(featureRequestId, trimmedToken);
    }
    return client.toggleVote(featureRequestId, trimmedToken);
  }

  if (
    typeof client.castVote === 'function' &&
    (!hasCustomToggleVote || client.castVote !== proto?.castVote)
  ) {
    return client.castVote(featureRequestId, trimmedToken, castOptions);
  }
  return client.toggleVote(featureRequestId, trimmedToken, castOptions);
}

/**
 * Applies the optimistic vote delta to an item: flips `hasVoted` and adjusts
 * `voteCount` by ±1, clamped at zero.
 *
 * `voteCount` is the displayed total and already contains the imported
 * historical portion, so the delta moves the whole number by one and every
 * other field (including `importedVotes`) is carried over untouched.
 */
export function withOptimisticVote(item: FeatureRequestItem): FeatureRequestItem {
  const currentCount =
    typeof item?.voteCount === 'number' && Number.isFinite(item.voteCount)
      ? Math.max(0, item.voteCount)
      : 0;
  const nextVoted = !item?.hasVoted;
  const nextCount = currentCount + (nextVoted ? 1 : -1);
  return { ...item, hasVoted: nextVoted, voteCount: Math.max(0, nextCount) };
}

/**
 * Reconciles an item with the server-returned vote truth.
 *
 * The server count is the displayed total (in-app votes plus imported historical
 * votes), so it replaces the optimistic ±1 rather than adjusting it, and the
 * imported portion stays visible because the item's other fields are preserved.
 */
export function withServerVote(item: FeatureRequestItem, result: VoteResult): FeatureRequestItem {
  const safeCount =
    result && typeof result.voteCount === 'number' && Number.isFinite(result.voteCount)
      ? Math.max(0, result.voteCount)
      : typeof item?.voteCount === 'number' && Number.isFinite(item.voteCount)
        ? Math.max(0, item.voteCount)
        : 0;
  return { ...item, hasVoted: Boolean(result?.voted), voteCount: safeCount };
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
  const safeCount =
    preVoteSnapshot &&
    typeof preVoteSnapshot.voteCount === 'number' &&
    Number.isFinite(preVoteSnapshot.voteCount)
      ? Math.max(0, preVoteSnapshot.voteCount)
      : typeof item?.voteCount === 'number' && Number.isFinite(item.voteCount)
        ? Math.max(0, item.voteCount)
        : 0;
  return {
    ...item,
    hasVoted: Boolean(preVoteSnapshot?.hasVoted),
    voteCount: safeCount,
  };
}

/**
 * Transform applied to the current item state whenever the vote flow changes it.
 */
export type VoteItemTransform = (item: FeatureRequestItem) => FeatureRequestItem;

/**
 * Metadata describing which vote-lifecycle phase produced a change.
 */
export interface VoteChangeMeta {
  /**
   * `true` when the transform reverts a failed vote attempt. A rollback ends
   * the optimistic-vote lifecycle, so a host that guards in-flight optimistic
   * rows against fresher server snapshots must release the item alongside
   * applying the revert — otherwise the rolled-back snapshot would be treated
   * as a live optimistic vote forever and pin the row over every later
   * refresh (#139).
   */
  isRollback?: boolean;

  /**
   * `true` when the transform applies the server-confirmed result of a
   * successful vote. Settlement is the terminal phase of the optimistic-vote
   * lifecycle: a host that keeps a pending mutation for the item must release
   * it alongside applying the result. Retaining a settled snapshot would pin
   * a full row copy for the hook's lifetime and could replay a pre-identity
   * snapshot over fresher server data after a login/identity switch (#184).
   */
  isFinal?: boolean;

  /**
   * The user identity the vote was dispatched under, captured at tap time.
   * A vote can settle after the host switched identities (login/logout
   * re-resolving the provider token); appliers that scope their state by
   * identity — such as {@link useFeatureRequests}' `applyItemChange` — use
   * this to drop the change instead of writing the old identity's result
   * onto the new identity's rows.
   */
  userToken?: string;
}

/**
 * Applier supplied by the host component, typically mapping the transform over
 * its list state so the change always lands on the freshest item data.
 */
export type VoteChangeApplier = (
  itemId: string,
  transform: VoteItemTransform,
  meta?: VoteChangeMeta
) => void;

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
   * Clears the active vote error state. With an `itemId`, clears only that
   * item's error; the global `voteError` is untouched because it reports the
   * most recent failure, which may belong to a different row. Without an
   * argument, clears every per-item error and the global `voteError`.
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
 * - Success applies the server truth (`voted` / `voteCount`) on top of current state
 *   and releases the item's pending mutation, closing the optimistic lifecycle.
 * - Failure reverts only the optimistic delta relative to current state, never a
 *   stale whole-item snapshot.
 * - Surfaces vote errors via `voteError`, `getVoteError`, and `options.onVoteError`.
 * - Delivers non-fatal server warnings (a refused ship-notification opt-in) via
 *   `options.onVoteWarning`; the vote itself still applies.
 *
 * @param client - {@link FeedbackClient} used to dispatch the toggle request.
 * @param userToken - Current user token; toggles are ignored while empty or whitespace-only.
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
  const onVoteError = options?.onVoteError;
  const onVoteWarning = options?.onVoteWarning;

  const applyChangeRef = useRef(applyChange);
  const onVoteErrorRef = useRef(onVoteError);
  const onVoteWarningRef = useRef(onVoteWarning);

  const shipNotifyEmail =
    typeof options?.shipNotifyEmail === 'string'
      ? options.shipNotifyEmail.trim() || undefined
      : undefined;

  const normalizedUserToken = typeof userToken === 'string' ? userToken.trim() : '';

  // Most recently committed (client, normalizedUserToken) pair, read by stable
  // callbacks and async continuations so committed session switches invalidate
  // stale in-flight settlements immediately without leaking uncommitted
  // suspended renders (#459).
  const latestSessionPropsRef = useRef({ client, userToken: normalizedUserToken });

  // Monotonic epochs let a callback prove it belongs to the newest identity
  // without publishing session identity during render. Descendant layout
  // effects run before this hook's layout effect on an identity swap, so a
  // fresh callback stays usable there even though `latestSessionPropsRef`
  // still holds the outgoing client (#479).
  const renderEpochRef = useRef(0);
  const committedEpochRef = useRef(0);
  const lastRenderedIdentityRef = useRef<{ client: FeedbackClient; userToken: string } | null>(
    null
  );
  if (
    !lastRenderedIdentityRef.current ||
    lastRenderedIdentityRef.current.client !== client ||
    lastRenderedIdentityRef.current.userToken !== normalizedUserToken
  ) {
    lastRenderedIdentityRef.current = { client, userToken: normalizedUserToken };
    renderEpochRef.current += 1;
  }
  const callbackEpoch = renderEpochRef.current;

  const sessionRef = useRef<VoteSession | null>(null);
  if (sessionRef.current === null) {
    sessionRef.current = {
      client,
      userToken: normalizedUserToken,
      generation: 0,
      pendingIds: new Set(),
    };
  }

  const [sessionState, setSessionState] = useState<VoteSessionState>(() => ({
    client,
    userToken: normalizedUserToken,
    generation: 0,
    pendingIds: EMPTY_PENDING_IDS,
    voteError: null,
    errorsByItemId: EMPTY_ERRORS_BY_ITEM_ID,
  }));

  const resolveActiveSession = useCallback((): VoteSession => {
    const current = sessionRef.current!;
    if (current.client !== client || current.userToken !== normalizedUserToken) {
      const next: VoteSession = {
        client,
        userToken: normalizedUserToken,
        generation: current.generation + 1,
        pendingIds: new Set(),
      };
      sessionRef.current = next;
      return next;
    }
    return current;
  }, [client, normalizedUserToken]);

  // Publish callback refs and the active session identity synchronously on
  // commit rather than during render: a concurrent/suspended render for a new
  // token must not clobber the still-committed session's in-flight settlement.
  useLayoutEffect(() => {
    applyChangeRef.current = applyChange;
    onVoteErrorRef.current = onVoteError;
    onVoteWarningRef.current = onVoteWarning;
  }, [applyChange, onVoteError, onVoteWarning]);

  useLayoutEffect(() => {
    latestSessionPropsRef.current = { client, userToken: normalizedUserToken };
    committedEpochRef.current = renderEpochRef.current;

    const current = sessionRef.current!;
    if (current.client !== client || current.userToken !== normalizedUserToken) {
      const next = resolveActiveSession();
      setSessionState({
        client,
        userToken: normalizedUserToken,
        generation: next.generation,
        pendingIds: EMPTY_PENDING_IDS,
        voteError: null,
        errorsByItemId: EMPTY_ERRORS_BY_ITEM_ID,
      });
    }
  }, [client, normalizedUserToken, resolveActiveSession]);

  const isStateForCurrentProps =
    sessionState.client === client &&
    sessionState.userToken === normalizedUserToken &&
    sessionState.generation === sessionRef.current.generation;
  const pendingIds = isStateForCurrentProps ? sessionState.pendingIds : EMPTY_PENDING_IDS;
  const voteError = isStateForCurrentProps ? sessionState.voteError : null;
  const errorsByItemId = isStateForCurrentProps
    ? sessionState.errorsByItemId
    : EMPTY_ERRORS_BY_ITEM_ID;

  const clearVoteError = useCallback((itemId?: string) => {
    const active = sessionRef.current!;
    const props = latestSessionPropsRef.current;
    if (active.client !== props.client || active.userToken !== props.userToken) {
      return;
    }
    // Any supplied id — including an empty string — takes the per-item branch:
    // an id the hook never recorded is simply absent from the map, so the
    // call is a no-op and neither error state changes.
    if (itemId !== undefined) {
      setSessionState((prev) => {
        if (
          prev.generation !== active.generation ||
          prev.client !== active.client ||
          prev.userToken !== active.userToken ||
          !prev.errorsByItemId[itemId]
        ) {
          return prev;
        }
        const nextErrors = { ...prev.errorsByItemId };
        delete nextErrors[itemId];
        return { ...prev, errorsByItemId: nextErrors };
      });
      // The global voteError intentionally stays untouched: it reports the
      // most recent failure, which may belong to a different row (#163).
      // Only a new attempt or an explicit global clear resets it.
    } else {
      setSessionState((prev) => {
        if (
          prev.generation !== active.generation ||
          prev.client !== active.client ||
          prev.userToken !== active.userToken
        ) {
          return prev;
        }
        if (prev.voteError === null && Object.keys(prev.errorsByItemId).length === 0) {
          return prev;
        }
        return {
          ...prev,
          voteError: null,
          errorsByItemId: EMPTY_ERRORS_BY_ITEM_ID,
        };
      });
    }
  }, []);

  const getVoteError = useCallback(
    (itemId: string) => errorsByItemId[itemId] || null,
    [errorsByItemId]
  );

  const toggleVote = useCallback(
    (item: FeatureRequestItem) => {
      if (!item || item.isOwnRequest || !normalizedUserToken) return;

      // A callback retained from an identity that has already committed has a
      // lower epoch and must not activate a session or dispatch a vote (#479).
      // A callback from the incoming render keeps the higher epoch, so it stays
      // usable in descendant layout effects that run before this hook's own
      // layout effect publishes the new identity.
      if (callbackEpoch < committedEpochRef.current) return;

      const tapSession = resolveActiveSession();
      if (
        tapSession.client !== client ||
        tapSession.userToken !== normalizedUserToken ||
        tapSession.pendingIds.has(item.id)
      )
        return;

      tapSession.pendingIds.add(item.id);
      const nextPendingIds = Array.from(tapSession.pendingIds);

      // Clear previous error on the same item and global voteError at tap time,
      // and publish the updated pendingIds for this session (#459).
      setSessionState((prev) => {
        const sameSession =
          prev.generation === tapSession.generation &&
          prev.client === tapSession.client &&
          prev.userToken === tapSession.userToken;
        let nextErrors = sameSession ? prev.errorsByItemId : EMPTY_ERRORS_BY_ITEM_ID;
        if (nextErrors[item.id]) {
          nextErrors = { ...nextErrors };
          delete nextErrors[item.id];
        }
        return {
          client: tapSession.client,
          userToken: tapSession.userToken,
          generation: tapSession.generation,
          pendingIds: nextPendingIds,
          voteError: null,
          errorsByItemId: nextErrors,
        };
      });

      const preVoteSnapshot: VoteStateSnapshot = {
        hasVoted: Boolean(item?.hasVoted),
        voteCount:
          typeof item?.voteCount === 'number' && Number.isFinite(item.voteCount)
            ? Math.max(0, item.voteCount)
            : 0,
      };
      try {
        applyChangeRef.current(item.id, withOptimisticVote);
      } catch (optimisticErr) {
        warnInDev(
          '[CupThread] useToggleVote: applyChange threw during optimistic update:',
          optimisticErr
        );
      }

      const isTapSessionCurrent = (): boolean =>
        sessionRef.current === tapSession &&
        latestSessionPropsRef.current.client === tapSession.client &&
        latestSessionPropsRef.current.userToken === tapSession.userToken;

      dispatchVoteRequest(
        client,
        item.id,
        normalizedUserToken,
        preVoteSnapshot.hasVoted,
        shipNotifyEmail
      )
        .then(
          (res) => {
            if (!isTapSessionCurrent()) return;

            // The server-confirmed result settles the optimistic-vote
            // lifecycle: release the pending mutation along with the update
            // (see VoteChangeMeta.isFinal) so later server snapshots win for
            // the row again and settled snapshots cannot accumulate (#184).
            // The tap-time identity rides along so a settlement landing after
            // an identity switch is dropped instead of rewritten onto the new
            // identity's rows.
            try {
              applyChangeRef.current(item.id, (current) => withServerVote(current, res), {
                isFinal: true,
                userToken: normalizedUserToken,
              });
            } catch (applyErr) {
              warnInDev(
                '[CupThread] useToggleVote: applyChange threw during success settlement:',
                applyErr
              );
            }

            if (!isTapSessionCurrent()) return;

            setSessionState((prev) => {
              if (prev.generation !== tapSession.generation) return prev;
              let nextErrors = prev.errorsByItemId;
              if (nextErrors[item.id]) {
                nextErrors = { ...nextErrors };
                delete nextErrors[item.id];
              }
              if (nextErrors === prev.errorsByItemId && prev.voteError === null) {
                return prev;
              }
              return {
                ...prev,
                voteError: null,
                errorsByItemId: nextErrors,
              };
            });

            // A warning means the vote was saved but an optional opt-in was
            // refused, so it must not be routed through the error path.
            if (res?.warning) {
              try {
                onVoteWarningRef.current?.(res.warning, item);
              } catch (warningErr) {
                warnInDev('[CupThread] useToggleVote: onVoteWarning callback threw:', warningErr);
              }
            }
          },
          (err: unknown) => {
            // Stale-session rejections are ignored so they cannot surface errors
            // or overwrite rows in a newer session; `useFeatureRequests` retires
            // token-tagged pending entries on commit whenever `userToken` or
            // `client` changes so an A -> B -> A roundtrip never keeps a
            // rejected A optimistic entry alive (#459).
            if (!isTapSessionCurrent()) return;

            // The rollback also ends the optimistic-vote lifecycle: hosts that
            // keep a pending mutation for the item (so an in-flight vote
            // survives concurrent refreshes) must release it here, or the
            // rolled-back snapshot would pin the row over every later server
            // snapshot (#139). The tap-time identity rides along so a rollback
            // landing after an identity switch cannot restore guest-era vote
            // fields onto the new identity's row.
            try {
              applyChangeRef.current(
                item.id,
                (current) => withVoteRollback(current, preVoteSnapshot),
                {
                  isRollback: true,
                  userToken: normalizedUserToken,
                }
              );
            } catch (applyErr) {
              warnInDev('[CupThread] useToggleVote: applyChange threw during rollback:', applyErr);
            }

            if (!isTapSessionCurrent()) return;

            const errorObj = err instanceof Error ? err : new Error(String(err));
            setSessionState((prev) => {
              if (prev.generation !== tapSession.generation) return prev;
              return {
                ...prev,
                voteError: errorObj,
                errorsByItemId: { ...prev.errorsByItemId, [item.id]: errorObj },
              };
            });

            try {
              onVoteErrorRef.current?.(err, item);
            } catch (errorCallbackErr) {
              warnInDev('[CupThread] useToggleVote: onVoteError callback threw:', errorCallbackErr);
            }
          }
        )
        .finally(() => {
          tapSession.pendingIds.delete(item.id);
          if (!isTapSessionCurrent()) return;
          const remainingPendingIds = Array.from(tapSession.pendingIds);
          setSessionState((prev) => {
            if (prev.generation !== tapSession.generation) return prev;
            return {
              ...prev,
              pendingIds: remainingPendingIds,
            };
          });
        })
        .catch((unexpectedErr: unknown) => {
          warnInDev('[CupThread] useToggleVote: unexpected error in vote handler:', unexpectedErr);
        });
    },
    [client, normalizedUserToken, resolveActiveSession, shipNotifyEmail, callbackEpoch]
  );

  const isVoting = useCallback(
    (itemId: string) => {
      const active = sessionRef.current!;
      const refMatchesProps = active.client === client && active.userToken === normalizedUserToken;
      return pendingIds.includes(itemId) || (refMatchesProps && active.pendingIds.has(itemId));
    },
    [client, normalizedUserToken, pendingIds]
  );

  return { toggleVote, isVoting, voteError, getVoteError, clearVoteError };
}
