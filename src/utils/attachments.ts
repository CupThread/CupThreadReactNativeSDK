import type { FeedbackAttachment } from '../types';
import type { UploadAttachmentOptions } from '../client/FeedbackClient';

/**
 * A single attachment descriptor returned by a host attachment picker:
 * either a pre-uploaded {@link FeedbackAttachment} reference or a raw
 * {@link UploadAttachmentOptions} payload that still needs uploading.
 */
export type PickedAttachment = FeedbackAttachment | UploadAttachmentOptions;

/**
 * Legacy attachment shape from earlier README revisions: a picker result that
 * carries a local file URI (and optional metadata) instead of the `file`
 * payload. Accepted for backwards compatibility and normalized into
 * {@link UploadAttachmentOptions} during classification.
 */
export interface FileUriAttachment {
  /**
   * Local file URI (e.g. `'file:///var/mobile/.../screenshot.png'`).
   */
  fileUri: string;

  /**
   * Optional file name; defaults to the base name of {@link FileUriAttachment.fileUri}.
   */
  filename?: string;

  /**
   * Optional MIME type; defaults to `'application/octet-stream'`.
   */
  mimeType?: string;

  /**
   * Optional storage routing hint mapped to `preferredKind`.
   */
  kind?: 'image' | 'r2';

  /**
   * Optional declared byte size, forwarded to {@link UploadAttachmentOptions.size}.
   * Required for this shape to upload: the session API reserves quota from the
   * size and rejects an undeclared one.
   */
  size?: number;
}

/**
 * Everything a host picker may hand back to the composer: the two supported
 * shapes plus the legacy {@link FileUriAttachment} alias.
 */
export type PickedAttachmentInput = PickedAttachment | FileUriAttachment;

/**
 * One picker item whose upload failed, kept alongside the original item so
 * callers can report the failure count or offer a retry.
 */
export interface AttachmentBatchFailure {
  item: unknown;
  error: unknown;
}

/**
 * Outcome of processing a batch of picked attachments. Successes and failures
 * are independent: a batch that partially fails still reports every attachment
 * that made it through, so callers can commit those instead of discarding them.
 */
export interface AttachmentBatchResult {
  succeeded: FeedbackAttachment[];
  failed: AttachmentBatchFailure[];

  /**
   * Items matching no known attachment shape (e.g. malformed picker output).
   * These never reach an upload and get their own bucket so callers can show
   * an accurate message instead of blaming the upload pipeline.
   */
  unsupported: unknown[];
}

/**
 * Upload seam for {@link processPickedAttachments}. Implementations receive the
 * picker's raw options (e.g. to merge in a user token) and resolve to the
 * uploaded attachment reference returned by the server.
 */
export interface ProcessPickedAttachmentsOptions {
  upload: (options: UploadAttachmentOptions) => Promise<FeedbackAttachment>;

  /**
   * Optional batch upload seam. When provided, every pending item is handed to
   * this function in one call so the uploader can reserve a single session for
   * the whole pick; results are matched back to their items by position.
   *
   * Implementations must return one {@link AttachmentBatchOutcome} per item,
   * aligned with `batch`. When it throws, every item in the batch is reported
   * as failed.
   */
  uploadBatch?: (
    batch: readonly UploadAttachmentOptions[]
  ) => Promise<AttachmentBatchOutcome[]>;
}

/**
 * Per-item outcome of a batch upload, matched to the item by position.
 */
export type AttachmentBatchOutcome =
  | { ok: true; attachment: FeedbackAttachment }
  | { ok: false; error: unknown };

/**
 * Classification of a single picker item, extracted as a pure helper so the
 * composer's acceptance rules are directly unit-testable.
 */
export type PickedAttachmentClassification =
  | { type: 'uploaded'; attachment: FeedbackAttachment }
  | { type: 'pending'; options: UploadAttachmentOptions }
  | { type: 'unsupported'; item: unknown };

/**
 * Narrows a picked attachment to a pre-uploaded {@link FeedbackAttachment} descriptor.
 *
 * `key` is the discriminator: upload-session descriptors carry it, while a raw
 * {@link UploadAttachmentOptions} payload is keyed by `file`/`filename`. `url`
 * is no longer required, because private attachments carry no public delivery
 * URL; when an object also carries `url`, the legacy descriptor precedence is
 * preserved so a picker that shipped both shapes keeps its previous meaning.
 */
export function isFeedbackAttachment(item: unknown): item is FeedbackAttachment {
  if (typeof item !== 'object' || item === null) return false;
  const key = (item as { key?: unknown }).key;
  if (typeof key !== 'string' || key.length === 0) return false;
  return 'url' in item || !('file' in item);
}

/**
 * Narrows a picked attachment to a raw {@link UploadAttachmentOptions} payload.
 */
export function isUploadAttachmentOptions(item: unknown): item is UploadAttachmentOptions {
  return typeof item === 'object' && item !== null && 'file' in item && 'filename' in item;
}

/**
 * Maps the legacy `{ fileUri, filename?, mimeType?, kind?, size? }` shape onto
 * {@link UploadAttachmentOptions}. Returns `null` for objects without a
 * usable `fileUri` string so they can be classified as unsupported instead.
 */
function normalizeFileUriAttachment(item: object): UploadAttachmentOptions | null {
  const { fileUri, filename, mimeType, kind, size } = item as FileUriAttachment;
  if (typeof fileUri !== 'string' || fileUri.length === 0) {
    return null;
  }

  const options: UploadAttachmentOptions = {
    file: { uri: fileUri },
    filename:
      typeof filename === 'string' && filename.length > 0 ? filename : baseNameFromFileUri(fileUri),
    mimeType:
      typeof mimeType === 'string' && mimeType.length > 0 ? mimeType : 'application/octet-stream',
  };
  if (kind === 'image' || kind === 'r2') {
    options.preferredKind = kind;
  }
  if (typeof size === 'number' && Number.isFinite(size) && size > 0) {
    options.size = size;
  }
  return options;
}

function baseNameFromFileUri(fileUri: string): string {
  const withoutQuery = fileUri.split(/[?#]/, 1)[0];
  const segments = withoutQuery.split(/[\\/]/).filter(Boolean);
  const last = segments[segments.length - 1];
  return last && last.length > 0 ? last : 'attachment';
}

/**
 * Classifies one picker item into exactly one of three outcomes. Items that
 * match neither the pre-uploaded descriptor, the upload payload, nor the
 * legacy `fileUri` alias come back as `unsupported` — callers must surface
 * them to the user rather than silently dropping them.
 */
export function classifyPickedAttachment(item: unknown): PickedAttachmentClassification {
  if (isFeedbackAttachment(item)) {
    return { type: 'uploaded', attachment: item };
  }
  if (isUploadAttachmentOptions(item)) {
    return { type: 'pending', options: item };
  }
  if (typeof item === 'object' && item !== null) {
    const legacy = normalizeFileUriAttachment(item);
    if (legacy) {
      return { type: 'pending', options: legacy };
    }
  }
  return { type: 'unsupported', item };
}

/**
 * Processes a batch of picked attachments with per-item error isolation.
 *
 * Pre-uploaded descriptors pass through untouched; raw payloads (including the
 * legacy `fileUri` alias) are uploaded in pick order. When
 * {@link ProcessPickedAttachmentsOptions.uploadBatch} is supplied, every
 * pending item goes through one batched call so a multi-file pick reserves a
 * single upload session; otherwise items fall back to the single-item
 * {@link ProcessPickedAttachmentsOptions.upload} seam.
 *
 * A failure only affects its own item — the batch never throws, and everything
 * that succeeded (including descriptors collected before a failing item) is
 * returned in {@link AttachmentBatchResult.succeeded}. Items matching no known
 * shape are reported in {@link AttachmentBatchResult.unsupported} so callers
 * can warn.
 */
export async function processPickedAttachments(
  items: readonly unknown[],
  options: ProcessPickedAttachmentsOptions
): Promise<AttachmentBatchResult> {
  const failed: AttachmentBatchFailure[] = [];
  const unsupported: unknown[] = [];

  // One slot per picked item, so uploads run batch-first while `succeeded`
  // still reports descriptors in pick order.
  const results: Array<FeedbackAttachment | undefined> = new Array(items.length).fill(undefined);

  // Every pending item keeps its original object and index so a failed upload
  // can be reported against the pick the host handed in.
  const pending: Array<{
    item: unknown;
    options: UploadAttachmentOptions;
    index: number;
  }> = [];

  items.forEach((item, index) => {
    const classification = classifyPickedAttachment(item);
    if (classification.type === 'unsupported') {
      unsupported.push(item);
      return;
    }
    if (classification.type === 'uploaded') {
      results[index] = classification.attachment;
      return;
    }
    pending.push({ item, options: classification.options, index });
  });

  if (options.uploadBatch && pending.length > 0) {
    try {
      const outcomes = await options.uploadBatch(pending.map((entry) => entry.options));
      pending.forEach((entry, position) => {
        const outcome = outcomes[position];
        if (outcome?.ok) {
          results[entry.index] = outcome.attachment;
          return;
        }
        failed.push({
          item: entry.item,
          error: outcome ? outcome.error : new Error('Batch upload returned no result'),
        });
      });
    } catch (error) {
      // A session-level failure (quota, identity, rejected file) dooms the
      // whole pick: report each item independently so the caller can surface an
      // accurate count.
      for (const entry of pending) {
        failed.push({ item: entry.item, error });
      }
    }
  } else {
    for (const entry of pending) {
      try {
        results[entry.index] = await options.upload(entry.options);
      } catch (error) {
        failed.push({ item: entry.item, error });
      }
    }
  }

  const succeeded = results.filter(
    (attachment): attachment is FeedbackAttachment => attachment !== undefined
  );

  return { succeeded, failed, unsupported };
}
