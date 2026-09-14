import test from 'node:test';
import assert from 'node:assert/strict';
import {
  processPickedAttachments,
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

test('items matching neither known shape are skipped without counting as failures', async () => {
  const { upload } = makeUploadFn();
  const unrecognized = { fileUri: 'file:///tmp/picked.png', name: 'picked.png' } as any;

  const result = await processPickedAttachments(
    [makeUploadOptions('valid'), unrecognized, makeUploadOptions('also-valid')],
    { upload }
  );

  assert.deepEqual(result.succeeded, [makeDescriptor('valid'), makeDescriptor('also-valid')]);
  assert.equal(result.failed.length, 0);
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
