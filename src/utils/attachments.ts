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
 * One picker item rejected during the local pre-flight, before any network
 * call. Kept separate from {@link AttachmentBatchFailure} so callers can
 * explain the configured limit instead of reporting a transport failure.
 */
export interface AttachmentBatchRejection {
  item: unknown;

  /** Why the item was rejected locally. */
  reason: 'too-large';

  /** Picker-reported byte size that exceeded the limit. */
  size: number;

  /** Configured limit, normally `PublicAppConfig.maxAttachmentBytes`. */
  maxBytes: number;
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

  /**
   * Items whose declared size exceeded {@link ProcessPickedAttachmentsOptions.maxBytes}.
   * They never reach an upload seam, so no bandwidth or upload budget is spent.
   */
  rejected: AttachmentBatchRejection[];
}

/**
 * Resolves the byte size a picker declared for an upload payload.
 *
 * Prefers an explicit `size` and falls back to a `File`/`Blob` payload's own
 * `size`. Invalid or non-positive values count as undeclared. The upload
 * session reserves quota from this number, so both the pre-flight check here
 * and {@link FeedbackClient.uploadAttachment} use the same ceiling.
 */
export function resolveDeclaredAttachmentSize(option: UploadAttachmentOptions): number | undefined {
  const explicit = option.size;
  if (typeof explicit === 'number' && Number.isFinite(explicit) && explicit > 0) {
    return Math.ceil(explicit);
  }
  const payloadSize = option.file?.size;
  if (typeof payloadSize === 'number' && Number.isFinite(payloadSize) && payloadSize > 0) {
    return Math.ceil(payloadSize);
  }
  return undefined;
}

/**
 * Upload seam for {@link processPickedAttachments}. Implementations receive the
 * picker's raw options (e.g. to merge in a user token) and resolve to the
 * uploaded attachment reference returned by the server.
 */
export interface ProcessPickedAttachmentsOptions {
  upload: (options: UploadAttachmentOptions) => Promise<FeedbackAttachment>;

  /**
   * Maximum accepted attachment size in bytes, normally
   * `PublicAppConfig.maxAttachmentBytes`. A pending item whose picker-reported
   * size is above the limit is rejected locally, before any upload request.
   *
   * Items that report no size skip this pre-flight and reach the upload seam,
   * where `uploadAttachment` still rejects a bare `{ uri }` payload with
   * `file_size_required` before a request. Hosts should forward the picker's
   * `fileSize` so both checks can run.
   */
  maxBytes?: number;

  /**
   * Optional batch upload seam. When provided, every pending item is handed to
   * this function in one call so the uploader can reserve a single session for
   * the whole pick; results are matched back to their items by position.
   *
   * Implementations must return one {@link AttachmentBatchOutcome} per item,
   * aligned with `batch`. When it throws, every item in the batch is reported
   * as failed.
   */
  uploadBatch?: (batch: readonly UploadAttachmentOptions[]) => Promise<AttachmentBatchOutcome[]>;
}

/**
 * Per-item outcome of a batch upload, matched to the item by position.
 */
export type AttachmentBatchOutcome =
  { ok: true; attachment: FeedbackAttachment } | { ok: false; error: unknown };

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
 * {@link ProcessPickedAttachmentsOptions.maxBytes} is set, a pending item whose
 * declared size exceeds it is rejected before any upload call.
 *
 * When {@link ProcessPickedAttachmentsOptions.uploadBatch} is supplied, every
 * pending item goes through one batched call so a multi-file pick reserves a
 * single upload session; otherwise items fall back to the single-item
 * {@link ProcessPickedAttachmentsOptions.upload} seam.
 *
 * A failure only affects its own item — the batch never throws, and everything
 * that succeeded (including descriptors collected before a failing item) is
 * returned in {@link AttachmentBatchResult.succeeded}. Items matching no known
 * shape are reported in {@link AttachmentBatchResult.unsupported}, and items
 * rejected by the size pre-flight in
 * {@link AttachmentBatchResult.rejected}, so callers can warn.
 */
export async function processPickedAttachments(
  items: readonly unknown[],
  options: ProcessPickedAttachmentsOptions
): Promise<AttachmentBatchResult> {
  const failed: AttachmentBatchFailure[] = [];
  const unsupported: unknown[] = [];
  const rejected: AttachmentBatchRejection[] = [];
  const limit =
    typeof options.maxBytes === 'number' &&
    Number.isFinite(options.maxBytes) &&
    options.maxBytes > 0
      ? Math.ceil(options.maxBytes)
      : undefined;

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
    if (limit !== undefined) {
      const size = resolveDeclaredAttachmentSize(classification.options);
      if (size !== undefined && size > limit) {
        rejected.push({ item, reason: 'too-large', size, maxBytes: limit });
        return;
      }
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

  return { succeeded, failed, unsupported, rejected };
}

/**
 * Seams {@link uploadInSessionChunks} needs to move a pending batch through
 * upload sessions: one batched session call, one single-item fallback, and the
 * per-session file ceiling.
 */
export interface SessionChunkedUploadSeams {
  /**
   * Uploads one chunk (at most {@link SessionChunkedUploadSeams.chunkSize}
   * items) through a single upload session, resolving to one descriptor per
   * item in chunk order. A rejection aborts the whole chunk and sends its
   * items to the per-item seam.
   */
  uploadBatch: (batch: readonly UploadAttachmentOptions[]) => Promise<FeedbackAttachment[]>;

  /**
   * Uploads a single item through its own session. Only consulted when a
   * chunk is rejected at the session level, so valid siblings keep their
   * descriptors and each item reports its own actionable error.
   */
  upload: (options: UploadAttachmentOptions) => Promise<FeedbackAttachment>;

  /**
   * Maximum number of files a single upload session accepts —
   * `MAX_UPLOAD_FILES` from `FeedbackClient`, passed in so this module keeps
   * no client dependency.
   */
  chunkSize: number;
}

/**
 * Uploads a pending batch through session-sized chunks with per-item
 * isolation for chunk-level rejections.
 *
 * The client's `uploadAttachments` is a single transactional session capped at
 * `MAX_UPLOAD_FILES` (8): a longer pick is rejected wholesale before any
 * request, and one file the session API rejects dooms every valid sibling.
 * This helper keeps the batching optimization but restores isolation:
 *
 * 1. The batch is split into chunks of {@link SessionChunkedUploadSeams.chunkSize}
 *    and each chunk goes through one `uploadBatch` call, sequentially, so a
 *    10-file pick succeeds as 8 + 2.
 * 2. When a chunk of two or more items is rejected at the session level
 *    (unsupported MIME type, prohibited extension, quota, identity, timeout),
 *    that chunk's items are retried one by one through
 *    {@link SessionChunkedUploadSeams.upload}, so only the genuinely bad file
 *    fails and its valid siblings keep their descriptors instead of being
 *    reported — and re-uploaded on retry — as casualties of their neighbor.
 *    A lone item skips the retry: a 1-file session has no siblings to doom,
 *    so its session-level error is already the item's own actionable error
 *    and a retry would only re-send identical bytes to an identical session.
 *
 * Descriptors always come back aligned to the input: exactly one outcome per
 * item, in pick order, so `processPickedAttachments`' positional matching
 * stays correct across chunks. A batch seam that resolves fewer descriptors
 * than it was given items yields a failure outcome for the shortfall instead
 * of shifting every later position.
 *
 * Errors thrown by the seams themselves (e.g. a host cancellation guard) are
 * reported per item by the fallback, never escalated past this helper —
 * callers that must abort outright should enforce that inside their seams
 * before any request is sent.
 */
export async function uploadInSessionChunks(
  batch: readonly UploadAttachmentOptions[],
  seams: SessionChunkedUploadSeams
): Promise<AttachmentBatchOutcome[]> {
  const chunkSize =
    Number.isFinite(seams.chunkSize) && seams.chunkSize >= 1 ? Math.floor(seams.chunkSize) : 1;
  const outcomes: AttachmentBatchOutcome[] = [];

  for (let start = 0; start < batch.length; start += chunkSize) {
    const chunk = batch.slice(start, start + chunkSize);
    let uploaded: FeedbackAttachment[];
    try {
      uploaded = await seams.uploadBatch(chunk);
    } catch (error) {
      if (chunk.length === 1) {
        // A single-item chunk has no siblings to doom: its session-level
        // rejection is already the item's own actionable error, so the
        // per-item retry would only re-send identical bytes to an identical
        // session and fail identically.
        outcomes.push({ ok: false, error });
        continue;
      }
      // The session for this chunk was rejected wholesale. Retry its items
      // one by one so each file gets its own session and its own actionable
      // error, and valid siblings keep their descriptors.
      for (const options of chunk) {
        try {
          outcomes.push({ ok: true, attachment: await seams.upload(options) });
        } catch (itemError) {
          outcomes.push({ ok: false, error: itemError });
        }
      }
      continue;
    }
    // One outcome per chunk item, positionally — an under-delivering batch
    // seam must not shift the positions of later chunks.
    outcomes.push(
      ...chunk.map((_, position): AttachmentBatchOutcome => {
        const attachment = uploaded[position];
        return attachment !== undefined
          ? { ok: true, attachment }
          : { ok: false, error: new Error('Batch upload returned no result') };
      })
    );
  }

  return outcomes;
}
