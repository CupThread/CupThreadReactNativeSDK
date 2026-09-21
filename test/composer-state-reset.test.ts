import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createComposerState,
  resetComposerState,
  createFeedbackComposerState,
  resetFeedbackComposerState,
  resolveReopenedFeedbackComposerState,
  createFeatureRequestComposeState,
  resetFeatureRequestComposeState,
  resolveReopenedFeatureRequestComposeState,
  type FeedbackComposerState,
  type FeatureRequestComposeState,
} from '../src/utils/composer-state';
import type { FeedbackAttachment, FeedbackDraft, FeatureRequestDraft } from '../src/types';

function makeAttachment(name: string): FeedbackAttachment {
  return {
    kind: 'image',
    key: `key-${name}`,
    url: `https://cdn.example.com/${name}.png`,
    filename: `${name}.png`,
    mimeType: 'image/png',
  };
}

// ---------------------------------------------------------------------------
// FeedbackComposer Pure State Tests (Requirements 1, 2, 3)
// ---------------------------------------------------------------------------

test('Requirement 1: resetComposerState returns clean initialDraft-derived defaults with empty attachments and null error', () => {
  // When no initialDraft is supplied:
  const stateNoDraft = resetComposerState();
  assert.deepEqual(stateNoDraft, {
    title: '',
    description: '',
    reporterName: '',
    reporterEmail: '',
    attachments: [],
    isUploadingAttachment: false,
    isSubmitting: false,
    errorMessage: null,
  });

  // When initialDraft is provided:
  const initialDraft: FeedbackDraft = {
    title: 'Pre-filled bug title',
    description: 'Pre-filled repro steps',
    reporterName: 'Alice',
    reporterEmail: 'alice@example.com',
    attachments: [makeAttachment('pre-attached')],
  };

  const stateWithDraft = resetComposerState(initialDraft);
  assert.equal(stateWithDraft.title, 'Pre-filled bug title');
  assert.equal(stateWithDraft.description, 'Pre-filled repro steps');
  assert.equal(stateWithDraft.reporterName, 'Alice');
  assert.equal(stateWithDraft.reporterEmail, 'alice@example.com');
  assert.deepEqual(stateWithDraft.attachments, [makeAttachment('pre-attached')]);
  assert.equal(stateWithDraft.isUploadingAttachment, false);
  assert.equal(stateWithDraft.isSubmitting, false);
  assert.equal(stateWithDraft.errorMessage, null);

  // Defensive copy check: mutating returned attachments does not mutate initialDraft
  stateWithDraft.attachments.push(makeAttachment('mutated'));
  assert.equal(initialDraft.attachments?.length, 1);
});

test('Requirement 1 (alias consistency): createFeedbackComposerState matches resetFeedbackComposerState and createComposerState', () => {
  const draft: Partial<FeedbackDraft> = {
    title: 'Login fails on iOS',
    description: 'Cannot press submit',
  };

  const created = createFeedbackComposerState(draft);
  const reset = resetFeedbackComposerState(draft);
  const aliasCreated = createComposerState(draft);

  assert.deepEqual(created, reset);
  assert.deepEqual(created, aliasCreated);
  assert.equal(created.title, 'Login fails on iOS');
  assert.equal(created.description, 'Cannot press submit');
  assert.equal(created.attachments.length, 0);
  assert.equal(created.errorMessage, null);
});

test('Requirement 2: reopening with a changed initialDraft re-initializes state from the new values', () => {
  const dirtyState: FeedbackComposerState = {
    title: 'Dirty title typed by user on screen A',
    description: 'Dirty description',
    reporterName: 'Alice',
    reporterEmail: 'alice@example.com',
    attachments: [makeAttachment('screenshot-screen-a')],
    isUploadingAttachment: false,
    isSubmitting: false,
    errorMessage: 'Something went wrong',
  };

  const draftA: Partial<FeedbackDraft> = { title: 'Context A' };
  const draftB: Partial<FeedbackDraft> = { title: 'Context B', description: 'Screen B details' };

  // Reopening with draftB when previous was draftA:
  const reopened = resolveReopenedFeedbackComposerState(dirtyState, {
    preserveDraftOnClose: true, // Even if preserveDraftOnClose was requested, prop change takes precedence
    initialDraft: draftB,
    previousInitialDraft: draftA,
  });

  assert.equal(reopened.title, 'Context B');
  assert.equal(reopened.description, 'Screen B details');
  assert.deepEqual(reopened.attachments, []);
  assert.equal(reopened.errorMessage, null);
  assert.equal(reopened.isSubmitting, false);
});

test('Requirement 3: explicit assertion of manual-close semantics (preserveDraftOnClose false vs true)', () => {
  const userTypedState: FeedbackComposerState = {
    title: 'In-progress draft that user typed',
    description: 'User had a typo and closed the sheet',
    reporterName: 'Bob',
    reporterEmail: 'bob@example.com',
    attachments: [makeAttachment('draft-pic')],
    isUploadingAttachment: false,
    isSubmitting: false,
    errorMessage: 'Network failed earlier',
  };

  const initialDraft: Partial<FeedbackDraft> = { title: 'Initial' };

  // Case 3a: Default behavior (preserveDraftOnClose: false)
  // Reopening yields a clean form reset to initialDraft, discarding typed state and error.
  const resetOnReopen = resolveReopenedFeedbackComposerState(userTypedState, {
    preserveDraftOnClose: false,
    initialDraft,
    previousInitialDraft: initialDraft,
  });
  assert.equal(resetOnReopen.title, 'Initial');
  assert.equal(resetOnReopen.description, '');
  assert.deepEqual(resetOnReopen.attachments, []);
  assert.equal(resetOnReopen.errorMessage, null);

  // Case 3b: Opt-in behavior (preserveDraftOnClose: true) without prior submission
  // Reopening preserves user's typed title, description, attachments, but clears transient errorMessage.
  const preservedOnReopen = resolveReopenedFeedbackComposerState(userTypedState, {
    preserveDraftOnClose: true,
    initialDraft,
    previousInitialDraft: initialDraft,
    hasSubmitted: false,
  });
  assert.equal(preservedOnReopen.title, 'In-progress draft that user typed');
  assert.equal(preservedOnReopen.description, 'User had a typo and closed the sheet');
  assert.deepEqual(preservedOnReopen.attachments, [makeAttachment('draft-pic')]);
  assert.equal(
    preservedOnReopen.errorMessage,
    null,
    'transient error message must be cleared on reopen'
  );

  // Case 3c: Successful submission always resets, even if preserveDraftOnClose: true
  const postSubmitReopen = resolveReopenedFeedbackComposerState(userTypedState, {
    preserveDraftOnClose: true,
    hasSubmitted: true,
    initialDraft,
    previousInitialDraft: initialDraft,
  });
  assert.equal(postSubmitReopen.title, 'Initial');
  assert.equal(postSubmitReopen.description, '');
  assert.deepEqual(postSubmitReopen.attachments, []);
  assert.equal(postSubmitReopen.errorMessage, null);
});

// ---------------------------------------------------------------------------
// FeatureRequestComposeSheet Pure State Tests
// ---------------------------------------------------------------------------

test('FeatureRequestComposeSheet: createFeatureRequestComposeState and resetFeatureRequestComposeState', () => {
  const emptyState = resetFeatureRequestComposeState();
  assert.deepEqual(emptyState, {
    title: '',
    description: '',
    requesterName: '',
    isSubmitting: false,
    errorMessage: null,
  });

  const initialDraft: FeatureRequestDraft = {
    title: 'Dark mode widgets',
    description: 'Provide OLED dark mode theme',
    requesterName: 'Carol',
  };

  const populated = createFeatureRequestComposeState(initialDraft);
  assert.equal(populated.title, 'Dark mode widgets');
  assert.equal(populated.description, 'Provide OLED dark mode theme');
  assert.equal(populated.requesterName, 'Carol');
  assert.equal(populated.isSubmitting, false);
  assert.equal(populated.errorMessage, null);
});

test('FeatureRequestComposeSheet: resolveReopenedFeatureRequestComposeState handles submission, prop change, and close semantics', () => {
  const dirtyState: FeatureRequestComposeState = {
    title: 'Typed proposal',
    description: 'Some long proposal description',
    requesterName: 'Dave',
    isSubmitting: false,
    errorMessage: 'Server 500 error',
  };

  // 1. Post-submit reopen: always clean
  const cleanPostSubmit = resolveReopenedFeatureRequestComposeState(dirtyState, {
    hasSubmitted: true,
    preserveDraftOnClose: true,
  });
  assert.equal(cleanPostSubmit.title, '');
  assert.equal(cleanPostSubmit.description, '');
  assert.equal(cleanPostSubmit.requesterName, '');
  assert.equal(cleanPostSubmit.errorMessage, null);

  // 2. Changed initialDraft: adopts new values
  const changedDraft = resolveReopenedFeatureRequestComposeState(dirtyState, {
    initialDraft: { title: 'New Category proposal' },
    previousInitialDraft: { title: 'Old Category proposal' },
    preserveDraftOnClose: true,
  });
  assert.equal(changedDraft.title, 'New Category proposal');
  assert.equal(changedDraft.description, '');

  // 3. preserveDraftOnClose false (default): resets
  const defaultReset = resolveReopenedFeatureRequestComposeState(dirtyState, {
    preserveDraftOnClose: false,
  });
  assert.equal(defaultReset.title, '');
  assert.equal(defaultReset.errorMessage, null);

  // 4. preserveDraftOnClose true without submission: preserves fields, clears error
  const preserved = resolveReopenedFeatureRequestComposeState(dirtyState, {
    preserveDraftOnClose: true,
    hasSubmitted: false,
  });
  assert.equal(preserved.title, 'Typed proposal');
  assert.equal(preserved.description, 'Some long proposal description');
  assert.equal(preserved.requesterName, 'Dave');
  assert.equal(preserved.errorMessage, null);
});
