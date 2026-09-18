import type { FeedbackAttachment, FeedbackDraft, FeatureRequestDraft } from '../types';

/**
 * Internal form state for {@link FeedbackComposer}.
 */
export interface FeedbackComposerState {
  title: string;
  description: string;
  reporterName: string;
  reporterEmail: string;
  attachments: FeedbackAttachment[];
  isUploadingAttachment: boolean;
  isSubmitting: boolean;
  errorMessage: string | null;
}

/**
 * Creates a clean initial state for {@link FeedbackComposer} derived from optional initial draft.
 */
export function createFeedbackComposerState(
  initialDraft?: Partial<FeedbackDraft>
): FeedbackComposerState {
  return {
    title: initialDraft?.title ?? '',
    description: initialDraft?.description ?? '',
    reporterName: initialDraft?.reporterName ?? '',
    reporterEmail: initialDraft?.reporterEmail ?? '',
    attachments: initialDraft?.attachments ? [...initialDraft.attachments] : [],
    isUploadingAttachment: false,
    isSubmitting: false,
    errorMessage: null,
  };
}

/**
 * Resets {@link FeedbackComposer} state back to clean defaults derived from the initial draft.
 */
export function resetFeedbackComposerState(
  initialDraft?: Partial<FeedbackDraft>
): FeedbackComposerState {
  return createFeedbackComposerState(initialDraft);
}

/**
 * Internal form state for {@link FeatureRequestComposeSheet}.
 */
export interface FeatureRequestComposeState {
  title: string;
  description: string;
  requesterName: string;
  isSubmitting: boolean;
  errorMessage: string | null;
}

/**
 * Creates a clean initial state for {@link FeatureRequestComposeSheet} derived from optional initial draft.
 */
export function createFeatureRequestComposeState(
  initialDraft?: Partial<FeatureRequestDraft>
): FeatureRequestComposeState {
  return {
    title: initialDraft?.title ?? '',
    description: initialDraft?.description ?? '',
    requesterName: initialDraft?.requesterName ?? '',
    isSubmitting: false,
    errorMessage: null,
  };
}

/**
 * Resets {@link FeatureRequestComposeSheet} state back to clean defaults derived from the initial draft.
 */
export function resetFeatureRequestComposeState(
  initialDraft?: Partial<FeatureRequestDraft>
): FeatureRequestComposeState {
  return createFeatureRequestComposeState(initialDraft);
}

/**
 * Options controlling how a composer state is updated when reopened.
 */
export interface ResolveReopenedStateOptions<TDraft> {
  /**
   * If true, user-typed drafts are retained across close and reopen without submission.
   * Stale error messages and in-flight flags are always cleared on reopen.
   *
   * @defaultValue `false`
   */
  preserveDraftOnClose?: boolean;

  /**
   * Whether the form was successfully submitted during the previous open session.
   * When true, the form is ALWAYS reset to clean defaults regardless of `preserveDraftOnClose`.
   */
  hasSubmitted?: boolean;

  /**
   * Current initialDraft prop passed by the host.
   */
  initialDraft?: Partial<TDraft>;

  /**
   * Previous initialDraft prop held by the component.
   */
  previousInitialDraft?: Partial<TDraft>;
}

/**
 * Resolves the state for {@link FeedbackComposer} when reopened (visible false -> true).
 */
export function resolveReopenedFeedbackComposerState(
  currentState: FeedbackComposerState,
  options?: ResolveReopenedStateOptions<FeedbackDraft>
): FeedbackComposerState {
  const preserve = options?.preserveDraftOnClose ?? false;
  const hasSubmitted = options?.hasSubmitted ?? false;
  const initialDraftChanged =
    options?.initialDraft !== undefined &&
    options?.previousInitialDraft !== undefined &&
    options.initialDraft !== options.previousInitialDraft;

  if (hasSubmitted || !preserve || initialDraftChanged) {
    return resetFeedbackComposerState(options?.initialDraft);
  }

  return {
    ...currentState,
    errorMessage: null,
    isUploadingAttachment: false,
    isSubmitting: false,
  };
}

/**
 * Resolves the state for {@link FeatureRequestComposeSheet} when reopened (visible false -> true).
 */
export function resolveReopenedFeatureRequestComposeState(
  currentState: FeatureRequestComposeState,
  options?: ResolveReopenedStateOptions<FeatureRequestDraft>
): FeatureRequestComposeState {
  const preserve = options?.preserveDraftOnClose ?? false;
  const hasSubmitted = options?.hasSubmitted ?? false;
  const initialDraftChanged =
    options?.initialDraft !== undefined &&
    options?.previousInitialDraft !== undefined &&
    options.initialDraft !== options.previousInitialDraft;

  if (hasSubmitted || !preserve || initialDraftChanged) {
    return resetFeatureRequestComposeState(options?.initialDraft);
  }

  return {
    ...currentState,
    errorMessage: null,
    isSubmitting: false,
  };
}

// Canonical aliases matching issue naming
export const createComposerState = createFeedbackComposerState;
export const resetComposerState = resetFeedbackComposerState;
