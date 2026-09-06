import type { FeedbackAttachment } from '../types';
import type { UploadAttachmentOptions } from '../client/FeedbackClient';

/**
 * A single attachment descriptor returned by a host attachment picker:
 * either a pre-uploaded {@link FeedbackAttachment} reference or a raw
 * {@link UploadAttachmentOptions} payload that still needs uploading.
 */
export type PickedAttachment = FeedbackAttachment | UploadAttachmentOptions;

/**
 * One picker item whose upload failed, kept alongside the original item so
 * callers can report the failure count or offer a retry.
 */
export interface AttachmentBatchFailure {
  item: PickedAttachment;
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
 * Narrows a picked attachment to a pre-uploaded {@link FeedbackAttachment} descriptor.
 */
export function isFeedbackAttachment(item: PickedAttachment): item is FeedbackAttachment {
  return 'url' in item && 'key' in item;
}

/**
 * Narrows a picked attachment to a raw {@link UploadAttachmentOptions} payload.
 */
export function isUploadAttachmentOptions(item: PickedAttachment): item is UploadAttachmentOptions {
  return 'file' in item && 'filename' in item;
}

/**
 * Processes a batch of picked attachments with per-item error isolation.
 *
 * Pre-uploaded descriptors pass through untouched; raw payloads are uploaded
 * one at a time in pick order. A failure only affects its own item — the
 * batch never throws, and everything that succeeded (including descriptors
 * collected before a failing item) is returned in {@link AttachmentBatchResult.succeeded}.
 * Items matching neither shape (e.g. malformed picker output) are skipped
 * without counting as a failure.
 */
export async function processPickedAttachments(
  items: readonly PickedAttachment[],
  options: ProcessPickedAttachmentsOptions
): Promise<AttachmentBatchResult> {
  const succeeded: FeedbackAttachment[] = [];
  const failed: AttachmentBatchFailure[] = [];

  for (const item of items) {
    try {
      if (isFeedbackAttachment(item)) {
        succeeded.push(item);
      } else if (isUploadAttachmentOptions(item)) {
        succeeded.push(await options.upload(item));
      }
    } catch (error) {
      failed.push({ item, error });
    }
  }

  return { succeeded, failed };
}
