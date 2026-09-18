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
}

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
 */
export function isFeedbackAttachment(item: unknown): item is FeedbackAttachment {
  return typeof item === 'object' && item !== null && 'url' in item && 'key' in item;
}

/**
 * Narrows a picked attachment to a raw {@link UploadAttachmentOptions} payload.
 */
export function isUploadAttachmentOptions(item: unknown): item is UploadAttachmentOptions {
  return typeof item === 'object' && item !== null && 'file' in item && 'filename' in item;
}

/**
 * Maps the legacy `{ fileUri, filename?, mimeType?, kind? }` shape onto
 * {@link UploadAttachmentOptions}. Returns `null` for objects without a
 * usable `fileUri` string so they can be classified as unsupported instead.
 */
function normalizeFileUriAttachment(item: object): UploadAttachmentOptions | null {
  const { fileUri, filename, mimeType, kind } = item as FileUriAttachment;
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
 * legacy `fileUri` alias) are uploaded one at a time in pick order. A failure
 * only affects its own item — the batch never throws, and everything that
 * succeeded (including descriptors collected before a failing item) is returned
 * in {@link AttachmentBatchResult.succeeded}. Items matching no known shape are
 * reported in {@link AttachmentBatchResult.unsupported} so callers can warn.
 */
export async function processPickedAttachments(
  items: readonly unknown[],
  options: ProcessPickedAttachmentsOptions
): Promise<AttachmentBatchResult> {
  const succeeded: FeedbackAttachment[] = [];
  const failed: AttachmentBatchFailure[] = [];
  const unsupported: unknown[] = [];

  for (const item of items) {
    const classification = classifyPickedAttachment(item);
    if (classification.type === 'unsupported') {
      unsupported.push(item);
      continue;
    }
    if (classification.type === 'uploaded') {
      succeeded.push(classification.attachment);
      continue;
    }
    try {
      succeeded.push(await options.upload(classification.options));
    } catch (error) {
      failed.push({ item, error });
    }
  }

  return { succeeded, failed, unsupported };
}
