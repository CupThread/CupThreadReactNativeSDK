import test from 'node:test';
import assert from 'node:assert/strict';

// Package-root surface probe (issue #147): every attachment type referenced by
// the public `FeedbackComposerProps` — and the batch-upload helper family the
// composer docs direct hosts toward — must be nameable from the package root,
// not only via deep imports. All imports of '../src' here are `import type`,
// which the test runner erases (the full root graph pulls in react-native and
// cannot execute under Node); `npm run typecheck` compiles them for real, so a
// missing root re-export fails `tsc --noEmit`.
import type {
  AttachmentBatchFailure,
  AttachmentBatchOutcome,
  AttachmentBatchRejection,
  AttachmentBatchResult,
  FeedbackAttachment,
  FileUriAttachment,
  PickedAttachment,
  PickedAttachmentClassification,
  PickedAttachmentInput,
  ProcessPickedAttachmentsOptions,
  SessionChunkedUploadSeams,
  UploadAttachmentOptions,
} from '../src';

// The runtime bindings live in `./utils/attachments`, which `src/index.ts`
// star-re-exports (asserted statically in packaging.test.ts). This deep import
// is Node-safe and pins the exact set of runtime bindings the root surface
// must carry.
import {
  classifyPickedAttachment,
  isFeedbackAttachment,
  isUploadAttachmentOptions,
  processPickedAttachments,
  resolveDeclaredAttachmentSize,
  uploadInSessionChunks,
} from '../src/utils/attachments';

const descriptor: FeedbackAttachment = {
  kind: 'image',
  key: 'upload-1',
  url: 'https://cdn.example.com/shot.png',
  filename: 'shot.png',
  mimeType: 'image/png',
};

test('attachment batch helpers expose the bindings the root surface re-exports', async () => {
  assert.equal(typeof processPickedAttachments, 'function');
  assert.equal(typeof classifyPickedAttachment, 'function');
  assert.equal(typeof isFeedbackAttachment, 'function');
  assert.equal(typeof isUploadAttachmentOptions, 'function');
  assert.equal(typeof resolveDeclaredAttachmentSize, 'function');
  assert.equal(typeof uploadInSessionChunks, 'function');

  // Every exported attachment type participates in a real binding below; a
  // root-surface regression surfaces as a compile error in `npm run typecheck`.
  const legacy: FileUriAttachment = { fileUri: 'file:///tmp/shot.png', size: 2048 };
  const picked: PickedAttachmentInput = legacy;
  const uploadOptions: UploadAttachmentOptions = {
    file: { uri: 'file:///tmp/shot.png' },
    filename: 'shot.png',
    mimeType: 'image/png',
    size: 2048,
  };
  const pending: PickedAttachment = uploadOptions;

  const classification: PickedAttachmentClassification = classifyPickedAttachment(picked);
  assert.equal(classification.type, 'pending');

  const failure: AttachmentBatchFailure = { item: picked, error: new Error('boom') };
  const rejection: AttachmentBatchRejection = {
    item: picked,
    reason: 'too-large',
    size: 4096,
    maxBytes: 2048,
  };
  const outcome: AttachmentBatchOutcome = { ok: true, attachment: descriptor };
  const result: AttachmentBatchResult = {
    succeeded: [descriptor],
    failed: [failure],
    unsupported: [],
    rejected: [rejection],
  };

  const seams: SessionChunkedUploadSeams = {
    uploadBatch: async (batch) => batch.map(() => descriptor),
    upload: async () => descriptor,
    chunkSize: 8,
  };
  const options: ProcessPickedAttachmentsOptions = { upload: async () => descriptor };

  const processed = await processPickedAttachments([pending], options);
  assert.equal(processed.succeeded.length, 1);
  assert.equal(result.failed.length, 1);
  assert.equal(outcome.ok, true);
  assert.equal(resolveDeclaredAttachmentSize(uploadOptions), 2048);
  assert.equal((await uploadInSessionChunks([uploadOptions], seams))[0].ok, true);
  assert.equal(isFeedbackAttachment(descriptor), true);
  assert.equal(isUploadAttachmentOptions(uploadOptions), true);
});
