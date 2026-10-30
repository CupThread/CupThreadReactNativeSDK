import test from 'node:test';
import assert from 'node:assert/strict';
import {
  processPickedAttachments,
  classifyPickedAttachment,
  isFeedbackAttachment,
  isUploadAttachmentOptions,
  uploadInSessionChunks,
  type PickedAttachment,
} from '../src/utils/attachments';
import type { FeedbackAttachment } from '../src/types';
import { MAX_UPLOAD_FILES, type UploadAttachmentOptions } from '../src/client/FeedbackClient';

function makeDescriptor(name: string): FeedbackAttachment {
  return {
    kind: 'image',
    key: `key-${name}`,
    url: `https://cdn.example.com/${name}.png`,
    filename: `${name}.png`,
    mimeType: 'image/png',
  };
}

function makeUploadOptions(name: string): UploadAttachmentOptions {
  return {
    file: { uri: `file:///tmp/${name}.png` },
    filename: `${name}.png`,
    mimeType: 'image/png',
  };
}

function makeSizedUploadOptions(name: string, size: number): UploadAttachmentOptions {
  return { ...makeUploadOptions(name), size };
}

function makeUploadFn(failOn: (name: string) => boolean = () => false) {
  const uploadedNames: string[] = [];
  return {
    uploadedNames,
    upload: async (options: UploadAttachmentOptions): Promise<FeedbackAttachment> => {
      if (failOn(options.filename)) {
        throw new Error(`upload exploded for ${options.filename}`);
      }
      uploadedNames.push(options.filename);
      return makeDescriptor(options.filename.replace('.png', ''));
    },
  };
}

test('all items succeed: passthrough descriptors and uploads are returned in pick order', async () => {
  const descriptor = makeDescriptor('already-uploaded');
  const { uploadedNames, upload } = makeUploadFn();

  const result = await processPickedAttachments(
    [descriptor, makeUploadOptions('first'), makeUploadOptions('second')],
    { upload }
  );

  assert.deepEqual(result.succeeded, [
    descriptor,
    makeDescriptor('first'),
    makeDescriptor('second'),
  ]);
  assert.deepEqual(uploadedNames, ['first.png', 'second.png']);
  assert.equal(result.failed.length, 0);
  assert.equal(result.unsupported.length, 0);
});

test('mid-batch failure: later items still upload and no exception escapes', async () => {
  const { upload } = makeUploadFn((name) => name === 'second.png');
  const items = [
    makeUploadOptions('first'),
    makeUploadOptions('second'),
    makeUploadOptions('third'),
  ];

  const result = await processPickedAttachments(items, { upload });

  assert.deepEqual(result.succeeded, [makeDescriptor('first'), makeDescriptor('third')]);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].item, items[1]);
  assert.ok(result.failed[0].error instanceof Error);
  assert.equal((result.failed[0].error as Error).message, 'upload exploded for second.png');
  assert.equal(result.unsupported.length, 0);
});

test('passthrough descriptor before a failing upload is retained', async () => {
  const descriptor = makeDescriptor('attached-earlier');
  const { upload } = makeUploadFn(() => true);

  const result = await processPickedAttachments([descriptor, makeUploadOptions('doomed')], {
    upload,
  });

  assert.deepEqual(result.succeeded, [descriptor]);
  assert.equal(result.failed.length, 1);
});

test('all items fail: empty success list, one failure per item', async () => {
  const { upload } = makeUploadFn(() => true);
  const items = [makeUploadOptions('a'), makeUploadOptions('b'), makeUploadOptions('c')];

  const result = await processPickedAttachments(items, { upload });

  assert.deepEqual(result.succeeded, []);
  assert.equal(result.failed.length, 3);
  assert.deepEqual(
    result.failed.map((f) => f.item),
    items
  );
});

test('succeeded and failed are independent: a partial batch reports both (composer commit contract)', async () => {
  const { upload } = makeUploadFn((name) => name === 'second.png');

  const result = await processPickedAttachments(
    [makeUploadOptions('first'), makeUploadOptions('second')],
    { upload }
  );

  assert.ok(
    result.succeeded.length > 0 && result.failed.length > 0,
    'the composer must be able to commit successes while reporting failures'
  );
});

test('upload callback receives the original picker options object', async () => {
  const seen: UploadAttachmentOptions[] = [];
  const options = makeUploadOptions('probe');

  await processPickedAttachments([options], {
    upload: async (received) => {
      seen.push(received);
      return makeDescriptor('probe');
    },
  });

  assert.equal(seen.length, 1);
  assert.equal(seen[0], options);
});

test('type guards classify shapes exactly like the composer discriminator', () => {
  const descriptor: PickedAttachment = makeDescriptor('d');
  const options: PickedAttachment = makeUploadOptions('o');
  const ambiguous = { url: 'https://x', key: 'k', file: {}, filename: 'f' } as any;

  assert.equal(isFeedbackAttachment(descriptor), true);
  assert.equal(isUploadAttachmentOptions(descriptor), false);
  assert.equal(isFeedbackAttachment(options), false);
  assert.equal(isUploadAttachmentOptions(options), true);
  assert.equal(isFeedbackAttachment(ambiguous), true, 'url+key wins, matching legacy behavior');
});

test('type guards stay safe on null and primitive inputs', () => {
  assert.equal(isFeedbackAttachment(null), false);
  assert.equal(isUploadAttachmentOptions(null), false);
  assert.equal(isFeedbackAttachment('file:///tmp/a.png'), false);
  assert.equal(isUploadAttachmentOptions(42), false);
  assert.equal(isFeedbackAttachment(undefined), false);
  assert.equal(isUploadAttachmentOptions(undefined), false);
});

test('classifyPickedAttachment: pre-uploaded descriptor passes through as uploaded', () => {
  const descriptor = makeDescriptor('done');

  const classification = classifyPickedAttachment(descriptor);

  assert.equal(classification.type, 'uploaded');
  assert.equal(
    classification.type === 'uploaded' && classification.attachment,
    descriptor,
    'the original object must be preserved, not copied'
  );
});

test('classifyPickedAttachment: upload payload classifies as pending with payload preserved', () => {
  const options = makeUploadOptions('raw');

  const classification = classifyPickedAttachment(options);

  assert.equal(classification.type, 'pending');
  assert.equal(classification.type === 'pending' && classification.options, options);
});

test('classifyPickedAttachment: README legacy fileUri shape is accepted as pending', () => {
  // Verbatim shape from the README example that used to be silently dropped.
  const legacy = {
    kind: 'image',
    filename: 'screenshot.png',
    mimeType: 'image/png',
    fileUri: 'file:///var/mobile/screenshot.png',
  };

  const classification = classifyPickedAttachment(legacy);

  assert.equal(classification.type, 'pending', 'the README shape must upload, never vanish');
  if (classification.type !== 'pending') return;
  assert.deepEqual(classification.options.file, { uri: 'file:///var/mobile/screenshot.png' });
  assert.equal(classification.options.filename, 'screenshot.png');
  assert.equal(classification.options.mimeType, 'image/png');
  assert.equal(classification.options.preferredKind, 'image', 'kind maps to preferredKind');
});

test('classifyPickedAttachment: fileUri alias fills filename and mimeType defaults', () => {
  const classification = classifyPickedAttachment({ fileUri: 'file:///tmp/logs/crash-log.txt' });

  assert.equal(classification.type, 'pending');
  if (classification.type !== 'pending') return;
  assert.equal(classification.options.filename, 'crash-log.txt');
  assert.equal(classification.options.mimeType, 'application/octet-stream');
  assert.equal(classification.options.preferredKind, undefined);
});

test('classifyPickedAttachment: fileUri alias ignores non-routing kind values', () => {
  const classification = classifyPickedAttachment({
    kind: 'gallery',
    fileUri: 'file:///tmp/a.png',
    filename: 'a.png',
    mimeType: 'image/png',
  });

  assert.equal(classification.type, 'pending');
  if (classification.type !== 'pending') return;
  assert.equal(classification.options.preferredKind, undefined);
});

test('classifyPickedAttachment: empty-string fileUri is unsupported, not a doomed upload', () => {
  const classification = classifyPickedAttachment({ fileUri: '', filename: 'a.png' });

  assert.equal(classification.type, 'unsupported');
});

test('classifyPickedAttachment: null, primitives, and shapeless objects are unsupported', () => {
  for (const item of [null, undefined, 42, 'file:///tmp/a.png', {}, { filename: 'only' }]) {
    const classification = classifyPickedAttachment(item);
    assert.equal(
      classification.type,
      'unsupported',
      `expected unsupported for ${JSON.stringify(item)}`
    );
    assert.equal(classification.type === 'unsupported' && classification.item, item);
  }
});

test('unsupported items get their own bucket and never count as upload failures', async () => {
  const { upload } = makeUploadFn();
  const garbage = { oops: true };

  const result = await processPickedAttachments(
    [makeUploadOptions('valid'), garbage, makeDescriptor('passthrough')],
    { upload }
  );

  assert.equal(result.failed.length, 0, 'skipped picks are not upload failures');
  assert.deepEqual(result.unsupported, [garbage]);
  assert.deepEqual(result.succeeded, [makeDescriptor('valid'), makeDescriptor('passthrough')]);
});

test('mixed batch: valid uploads commit, failures and unsupported coexist', async () => {
  const { uploadedNames, upload } = makeUploadFn((name) => name === 'doomed.png');

  const result = await processPickedAttachments(
    [
      makeUploadOptions('healthy'),
      makeUploadOptions('doomed'),
      null,
      {
        kind: 'image',
        filename: 'legacy.png',
        mimeType: 'image/png',
        fileUri: 'file:///tmp/legacy.png',
      },
    ],
    { upload }
  );

  assert.deepEqual(result.succeeded, [makeDescriptor('healthy'), makeDescriptor('legacy')]);
  assert.equal(result.failed.length, 1);
  assert.equal(result.unsupported.length, 1);
  assert.equal(result.unsupported[0], null);
  assert.deepEqual(
    uploadedNames,
    ['healthy.png', 'legacy.png'],
    'the legacy fileUri item must reach the upload pipeline with its normalized name'
  );
});

test('legacy fileUri upload failure keeps the original picker item in failed', async () => {
  const { upload } = makeUploadFn((name) => name === 'legacy.png');
  const legacy = {
    kind: 'image',
    filename: 'legacy.png',
    mimeType: 'image/png',
    fileUri: 'file:///tmp/legacy.png',
  };

  const result = await processPickedAttachments([legacy], { upload });

  assert.deepEqual(result.succeeded, []);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].item, legacy, 'the raw item is preserved for host-side debugging');
});

// ---------------------------------------------------------------------------
// Issue #115 — one upload session per pick
// ---------------------------------------------------------------------------

test('uploadBatch reserves the whole pick in one call and keeps pick order', async () => {
  const batches: string[][] = [];
  const result = await processPickedAttachments(
    [makeUploadOptions('first'), makeDescriptor('already'), makeUploadOptions('second')],
    {
      upload: async () => {
        throw new Error('the single-item seam must not run when uploadBatch is provided');
      },
      uploadBatch: async (batch) => {
        batches.push(batch.map((options) => options.filename));
        return batch.map((options) => ({
          ok: true as const,
          attachment: makeDescriptor(options.filename.replace('.png', '')),
        }));
      },
    }
  );

  assert.deepEqual(batches, [['first.png', 'second.png']], 'one batch for the pending items');
  assert.deepEqual(result.succeeded, [
    makeDescriptor('first'),
    makeDescriptor('already'),
    makeDescriptor('second'),
  ]);
  assert.equal(result.failed.length, 0);
});

test('uploadBatch reports per-item failures without discarding the successes', async () => {
  const result = await processPickedAttachments(
    [makeUploadOptions('good'), makeUploadOptions('bad')],
    {
      upload: async () => {
        throw new Error('unused');
      },
      uploadBatch: async (batch) =>
        batch.map((options, index) =>
          index === 1
            ? { ok: false as const, error: new Error('rejected by the server') }
            : { ok: true as const, attachment: makeDescriptor('good') }
        ),
    }
  );

  assert.deepEqual(result.succeeded, [makeDescriptor('good')]);
  assert.equal(result.failed.length, 1);
  assert.equal((result.failed[0].error as Error).message, 'rejected by the server');
});

test('a session-level uploadBatch failure marks every pending item failed', async () => {
  const doomed = [makeUploadOptions('a'), makeUploadOptions('b')];

  const result = await processPickedAttachments([doomed[0], makeDescriptor('kept'), doomed[1]], {
    upload: async () => {
      throw new Error('unused');
    },
    uploadBatch: async () => {
      throw new Error('daily quota exceeded');
    },
  });

  assert.deepEqual(result.succeeded, [makeDescriptor('kept')], 'descriptors still pass through');
  assert.equal(result.failed.length, 2);
  assert.equal((result.failed[0].error as Error).message, 'daily quota exceeded');
  assert.equal(result.failed[0].item, doomed[0]);
});

test('uploadBatch is skipped when nothing pending remains', async () => {
  let batchCalls = 0;

  const result = await processPickedAttachments([makeDescriptor('only')], {
    upload: async () => {
      throw new Error('unused');
    },
    uploadBatch: async () => {
      batchCalls += 1;
      return [];
    },
  });

  assert.equal(batchCalls, 0, 'a pick of only pre-uploaded descriptors opens no session');
  assert.deepEqual(result.succeeded, [makeDescriptor('only')]);
});

// ---------------------------------------------------------------------------
// Issue #77 — maxAttachmentBytes pre-flight
// ---------------------------------------------------------------------------

test('maxBytes rejects a sized item before the upload seam and uploads the rest', async () => {
  const oversized = makeSizedUploadOptions('oversized', 100);
  const accepted = makeSizedUploadOptions('accepted', 10);
  const { uploadedNames, upload } = makeUploadFn();

  const result = await processPickedAttachments([oversized, accepted], { upload, maxBytes: 50 });

  assert.deepEqual(uploadedNames, ['accepted.png'], 'the oversized item never reaches upload');
  assert.deepEqual(result.rejected, [
    { item: oversized, reason: 'too-large', size: 100, maxBytes: 50 },
  ]);
  assert.deepEqual(result.succeeded, [makeDescriptor('accepted')]);
  assert.equal(result.failed.length, 0);
});

test('maxBytes accepts an item exactly at the limit', async () => {
  const { uploadedNames, upload } = makeUploadFn();

  const result = await processPickedAttachments([makeSizedUploadOptions('exact', 50)], {
    upload,
    maxBytes: 50,
  });

  assert.deepEqual(uploadedNames, ['exact.png']);
  assert.equal(result.rejected.length, 0);
  assert.deepEqual(result.succeeded, [makeDescriptor('exact')]);
});

test('maxBytes leaves items without a declared size to the upload seam', async () => {
  const { uploadedNames, upload } = makeUploadFn();

  const result = await processPickedAttachments([makeUploadOptions('unknown-size')], {
    upload,
    maxBytes: 1,
  });

  assert.deepEqual(
    uploadedNames,
    ['unknown-size.png'],
    'the seam owns size validation for unsized items'
  );
  assert.equal(result.rejected.length, 0);
});

test('maxBytes reads the payload file size when size is absent', async () => {
  const options: UploadAttachmentOptions = {
    ...makeUploadOptions('blob'),
    file: { uri: 'file:///tmp/blob.png', size: 4096 },
  };
  const { uploadedNames, upload } = makeUploadFn();

  const result = await processPickedAttachments([options], { upload, maxBytes: 2048 });

  assert.deepEqual(uploadedNames, []);
  assert.deepEqual(result.rejected, [
    { item: options, reason: 'too-large', size: 4096, maxBytes: 2048 },
  ]);
});

test('maxBytes enforces the legacy fileUri size before normalization uploads', async () => {
  const legacy = {
    kind: 'image' as const,
    filename: 'legacy-big.png',
    mimeType: 'image/png',
    fileUri: 'file:///tmp/legacy-big.png',
    size: 500,
  };
  const { uploadedNames, upload } = makeUploadFn();

  const result = await processPickedAttachments([legacy], { upload, maxBytes: 50 });

  assert.deepEqual(uploadedNames, []);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].item, legacy, 'the raw picker item is preserved');
  assert.equal(result.rejected[0].size, 500);
});

test('maxBytes filters oversized items out of the batch and still uses one session', async () => {
  const oversized = makeSizedUploadOptions('oversized', 500);
  const small = makeSizedUploadOptions('small', 10);
  const batches: string[][] = [];

  const result = await processPickedAttachments([oversized, small], {
    maxBytes: 50,
    upload: async () => {
      throw new Error('the single-item seam must not run when uploadBatch is provided');
    },
    uploadBatch: async (batch) => {
      batches.push(batch.map((options) => options.filename));
      return batch.map((options) => ({
        ok: true as const,
        attachment: makeDescriptor(options.filename.replace('.png', '')),
      }));
    },
  });

  assert.deepEqual(batches, [['small.png']], 'the rejected item never consumes a session slot');
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].item, oversized);
  assert.deepEqual(result.succeeded, [makeDescriptor('small')]);
});

test('maxBytes ignores non-positive and non-finite limits', async () => {
  const { uploadedNames, upload } = makeUploadFn();

  for (const maxBytes of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    uploadedNames.length = 0;
    const result = await processPickedAttachments([makeSizedUploadOptions('huge', 1_000_000)], {
      upload,
      maxBytes,
    });
    assert.deepEqual(uploadedNames, ['huge.png'], `maxBytes=${String(maxBytes)} is not a limit`);
    assert.equal(result.rejected.length, 0);
  }
});

// ---------------------------------------------------------------------------
// Issue #138 — session chunking with per-item isolation at the batch seam
// ---------------------------------------------------------------------------

function makeOutcomeNames(outcomes: Awaited<ReturnType<typeof uploadInSessionChunks>>): string[] {
  return outcomes.map((outcome) =>
    outcome.ok ? (outcome.attachment.filename ?? '<unnamed>') : `<failed>`
  );
}

test('uploadInSessionChunks splits a 10-file pick into 8 + 2 sessions in pick order', async () => {
  const items = Array.from({ length: 10 }, (_, index) => makeUploadOptions(`file${index}`));
  const chunkSizes: number[] = [];

  const outcomes = await uploadInSessionChunks(items, {
    chunkSize: MAX_UPLOAD_FILES,
    uploadBatch: async (chunk) => {
      chunkSizes.push(chunk.length);
      return chunk.map((options) => makeDescriptor(options.filename.replace('.png', '')));
    },
    upload: async () => {
      throw new Error('the per-item seam must not run when every chunk session succeeds');
    },
  });

  assert.deepEqual(chunkSizes, [8, 2], 'a 10-file pick opens one 8-file and one 2-file session');
  assert.equal(outcomes.length, 10);
  assert.deepEqual(
    makeOutcomeNames(outcomes),
    items.map((options) => options.filename),
    'descriptors come back one per item, in pick order'
  );
});

test('uploadInSessionChunks retries a session-rejected chunk item by item', async () => {
  const items = [makeUploadOptions('good1'), makeUploadOptions('bad'), makeUploadOptions('good2')];
  const sessionRejection = new Error('executable_extension_prohibited');
  let batchCalls = 0;
  const perItem: string[] = [];

  const outcomes = await uploadInSessionChunks(items, {
    chunkSize: MAX_UPLOAD_FILES,
    uploadBatch: async () => {
      batchCalls += 1;
      throw sessionRejection;
    },
    upload: async (options) => {
      perItem.push(options.filename);
      if (options.filename === 'bad.png') {
        throw new Error('unsupported_mime_type');
      }
      return makeDescriptor(options.filename.replace('.png', ''));
    },
  });

  assert.equal(batchCalls, 1, 'one chunk-level attempt before the fallback');
  assert.deepEqual(
    perItem,
    ['good1.png', 'bad.png', 'good2.png'],
    'every chunk item is retried through its own session'
  );
  assert.deepEqual(makeOutcomeNames(outcomes), ['good1.png', '<failed>', 'good2.png']);
  assert.equal(outcomes[1].ok, false);
  assert.equal(
    outcomes[1].ok ? null : (outcomes[1].error as Error).message,
    'unsupported_mime_type',
    'the bad file carries its own actionable error, not the chunk-level one'
  );
});

test('uploadInSessionChunks keeps earlier chunk descriptors when a later chunk fails everywhere', async () => {
  const items = Array.from({ length: 10 }, (_, index) => makeUploadOptions(`file${index}`));
  const quota = new Error('daily quota exceeded');

  const outcomes = await uploadInSessionChunks(items, {
    chunkSize: MAX_UPLOAD_FILES,
    uploadBatch: async (chunk) => {
      if (chunk.length === 2) {
        throw quota;
      }
      return chunk.map((options) => makeDescriptor(options.filename.replace('.png', '')));
    },
    upload: async () => {
      throw quota;
    },
  });

  const succeeded = outcomes.filter((outcome) => outcome.ok);
  const failed = outcomes.filter((outcome) => !outcome.ok);
  assert.equal(succeeded.length, 8, 'the first chunk stays committed');
  assert.deepEqual(
    succeeded.map((outcome) => (outcome.ok ? outcome.attachment.filename : '')),
    items.slice(0, 8).map((options) => options.filename),
    'earlier descriptors keep pick order, so a host retry never re-uploads them'
  );
  assert.deepEqual(
    failed.map((outcome) => (!outcome.ok ? outcome.error : '')),
    [quota, quota]
  );
});

test('uploadInSessionChunks reports every item failed when quota rejects both seams', async () => {
  const items = [makeUploadOptions('a'), makeUploadOptions('b'), makeUploadOptions('c')];
  const quota = new Error('daily quota exceeded');

  const outcomes = await uploadInSessionChunks(items, {
    chunkSize: MAX_UPLOAD_FILES,
    uploadBatch: async () => {
      throw quota;
    },
    upload: async () => {
      throw quota;
    },
  });

  assert.equal(outcomes.length, 3);
  assert.ok(
    outcomes.every((outcome) => !outcome.ok && outcome.error === quota),
    'a genuine session-level failure that also fails per item fails every item'
  );
});

test('uploadInSessionChunks keeps later chunks aligned when a batch seam under-delivers', async () => {
  const items = Array.from({ length: 10 }, (_, index) => makeUploadOptions(`file${index}`));

  const outcomes = await uploadInSessionChunks(items, {
    chunkSize: MAX_UPLOAD_FILES,
    uploadBatch: async (chunk) => {
      // Contract violation: the 8-item chunk resolves one descriptor short.
      const descriptors = chunk.map((options) =>
        makeDescriptor(options.filename.replace('.png', ''))
      );
      return chunk.length === 8 ? descriptors.slice(0, 7) : descriptors;
    },
    upload: async () => {
      throw new Error('unused');
    },
  });

  assert.deepEqual(
    makeOutcomeNames(outcomes),
    [
      'file0.png',
      'file1.png',
      'file2.png',
      'file3.png',
      'file4.png',
      'file5.png',
      'file6.png',
      '<failed>',
      'file8.png',
      'file9.png',
    ],
    'the shortfall fails its own position; chunk 2 must not shift into it'
  );
  assert.equal(
    outcomes[7].ok ? null : (outcomes[7].error as Error).message,
    'Batch upload returned no result'
  );
});

test('uploadInSessionChunks fails a lone item from its session error without retrying it', async () => {
  const items = [makeUploadOptions('single')];
  const sessionRejection = new Error('file_too_large');
  let perItemCalls = 0;

  const outcomes = await uploadInSessionChunks(items, {
    chunkSize: MAX_UPLOAD_FILES,
    uploadBatch: async () => {
      throw sessionRejection;
    },
    upload: async () => {
      perItemCalls += 1;
      return makeDescriptor('single');
    },
  });

  assert.equal(perItemCalls, 0, 'a 1-file session has no siblings; a retry is a duplicate request');
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].ok, false);
  assert.equal(outcomes[0].ok ? null : outcomes[0].error, sessionRejection);
});
