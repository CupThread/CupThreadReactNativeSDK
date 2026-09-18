import test from 'node:test';
import assert from 'node:assert/strict';
import {
  processPickedAttachments,
  classifyPickedAttachment,
  isFeedbackAttachment,
  isUploadAttachmentOptions,
  type PickedAttachment,
} from '../src/utils/attachments';
import type { FeedbackAttachment } from '../src/types';
import type { UploadAttachmentOptions } from '../src/client/FeedbackClient';

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
