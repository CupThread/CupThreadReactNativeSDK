import type {
  AppVersion,
  BoardColumn,
  CastVoteOptions,
  ChangelogEntry,
  ChangelogSubscriptionResult,
  ChangelogUnsubscribeResult,
  CommentDraft,
  DigestUnsubscribeResult,
  FeatureRequestComment,
  FeatureRequestDraft,
  FeatureRequestSubmissionResult,
  FeedbackAttachment,
  FeedbackClientConfig,
  FeedbackDraft,
  FeedbackSubmissionResult,
  FetchUserProfileOptions,
  ListFeatureRequestsResult,
  ListPublicChangelogResult,
  PublicAppConfig,
  PublicUserProfileResult,
  RequestOptions,
  SdkAppearance,
  UploadSession,
  UploadSessionFileSpec,
  UploadSessionSlot,
  UserAttributesUpdateResult,
  VoteResult,
} from '../types';
import {
  AuthenticationRequiredException,
  InactiveSubscriptionException,
  InsecureBaseUrlException,
  InvalidResponseException,
  MissingUnsubscribeTokenException,
  PaymentRequiredException,
  QuotaExceededException,
  RateLimitedException,
  RequestTimeoutException,
  TurnstileRequiredException,
  UnexpectedStatusException,
  UnreadableUploadResponseException,
  UploadRejectedException,
  UploadValidationException,
} from './FeedbackException';
import { getRuntimePlatform } from '../utils/platform';
import { iso8601Now } from '../utils/formatters';
import { UserTokenStore } from './UserTokenStore';

/**
 * Default timeout for API (JSON) requests in milliseconds (15 seconds).
 */
export const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Default completion budget for attachment uploads in milliseconds (60 seconds).
 * Uploads of screenshots and diagnostic archives routinely exceed the 15s JSON
 * budget on mobile uplinks, so they get their own, larger default.
 */
export const DEFAULT_UPLOAD_TIMEOUT_MS = 60000;

/**
 * Server-side default (and maximum) page size for the public changelog endpoint.
 */
export const DEFAULT_CHANGELOG_PAGE_SIZE = 100;

/**
 * Maximum number of files one upload session may reserve (API limit).
 */
export const MAX_UPLOAD_FILES = 8;

/**
 * Response shape of `POST /api/v1/uploads/sessions` for the fields this client
 * consumes. Kept private: callers get the normalized {@link UploadSession}.
 */
interface CreateUploadSessionResponse {
  session?: {
    sessionId: string;
    sessionToken: string;
    expiresAt: string;
    maxFileSizeBytes: number;
    maxFiles: number;
  };
  files?: Array<{
    clientFileId: string;
    uploadId: string;
    uploadUrl?: string;
    maxSizeBytes: number;
  }>;
}

/**
 * One file entry on the session-creation wire format.
 *
 * The published contract names the MIME field `contentType` and the size field
 * `sizeBytes`; the SDK's public option is the more familiar `mimeType`.
 */
interface UploadSessionFileWire {
  clientFileId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
}

/**
 * Response shape of `PUT /api/v1/uploads/{uploadId}`.
 */
interface UploadedFileResponse {
  uploadId?: string;
  filename?: string;
  contentType?: string;
  sizeBytes?: number;
  downloadUrl?: string | null;
}

/**
 * One validated upload, paired with the bytes to send to its reserved slot.
 */
interface UploadDeclaration {
  spec: Required<UploadSessionFileSpec>;
  size: number;
  kind: 'image' | 'r2';
  file: any;
  filename: string;
  mimeType: string;
}

/**
 * Reads a declared byte size from the upload payload: an explicit `size` wins,
 * then a `File`/`Blob`-shaped `.size`. A React Native `{ uri }` pick exposes
 * neither, so it resolves to `undefined` and fails validation instead of
 * guessing (quota is reserved from this number server-side).
 */
function resolveDeclaredSize(option: UploadAttachmentOptions): number | undefined {
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
 * Options for {@link FeedbackClient.createUploadSession}.
 */
export interface CreateUploadSessionOptions extends RequestOptions {
  /**
   * Anonymous end-user token (`X-User-Token`). Defaults to
   * {@link UserTokenStore.shared}; the same identity must submit the feedback.
   */
  userToken?: string;

  /**
   * Cloudflare Turnstile token for apps that gate uploads. Falls back to the
   * client's `turnstileTokenProvider`.
   */
  turnstileToken?: string;
}

/**
 * Upper bound on pages {@link FeedbackClient.fetchChangelog} will follow before
 * returning, guarding against a server that never clears `hasMore`.
 */
export const MAX_CHANGELOG_PAGES = 100;

/**
 * Converts a `Retry-After` response header into milliseconds. Accepts both the
 * delta-seconds form (`"30"`) and the HTTP-date form; returns `null` when the
 * header is absent or unparseable.
 */
export function parseRetryAfterMs(headerValue: string | null | undefined): number | null {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();
  if (!trimmed) return null;
  const seconds = Number(trimmed);
  if (trimmed.length > 0 && Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }
  return null;
}

function extractSignal(optionsOrSignal?: RequestOptions | AbortSignal): AbortSignal | undefined {
  if (!optionsOrSignal) return undefined;
  if (
    'aborted' in optionsOrSignal &&
    typeof (optionsOrSignal as AbortSignal).aborted === 'boolean'
  ) {
    return optionsOrSignal as AbortSignal;
  }
  if (typeof optionsOrSignal === 'object' && 'signal' in optionsOrSignal) {
    return (optionsOrSignal as RequestOptions).signal;
  }
  return undefined;
}

function extractTimeoutMs(optionsOrSignal?: RequestOptions | AbortSignal): number | undefined {
  if (!optionsOrSignal) return undefined;
  if (typeof optionsOrSignal === 'object' && 'timeoutMs' in optionsOrSignal) {
    return (optionsOrSignal as RequestOptions).timeoutMs;
  }
  return undefined;
}

/**
 * Trims a request timer to the time left before a shared deadline, never below
 * one millisecond. Returns `timeoutMs` untouched when no deadline applies or the
 * budget disables timeouts (non-positive / non-finite), so single-request
 * callers keep their exact timer.
 */
function clampToDeadline(timeoutMs: number, deadlineAt?: number): number {
  if (deadlineAt === undefined) {
    return timeoutMs;
  }
  const remaining = deadlineAt - Date.now();
  const cap =
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(timeoutMs, remaining) : remaining;
  return Math.max(1, Math.ceil(cap));
}

interface TimeoutContext {
  signal: AbortSignal;
  race<R>(promise: Promise<R>): Promise<R>;
  rethrowIfTimeoutOrAbort(err?: any): void;
}

interface ExecuteWithTimeoutOptions {
  /** Time the operation may actually run, in milliseconds. */
  timeoutMs: number;
  /**
   * Completion budget reported on {@link RequestTimeoutException}. Differs from
   * `timeoutMs` when a shared deadline (a batched upload) trims the timer while
   * the error should still name the budget the caller configured.
   */
  reportedTimeoutMs?: number;
  signal?: AbortSignal;
  timeoutMessage: string;
}

/**
 * Shared helper that wraps an asynchronous network operation with timeout and AbortSignal support.
 *
 * Automatically:
 * - Checks if the caller's signal is pre-aborted and throws AbortError
 * - Ties the caller signal to an internal AbortController
 * - Sets up a timeout timer that marks timeout and aborts the internal controller
 * - Exposes `race()` to race response body reads (or other promises) against the remaining timeout and abort signals
 * - Cleans up listeners and timers in `finally`
 */
async function executeWithTimeout<T>(
  options: ExecuteWithTimeoutOptions,
  fn: (context: TimeoutContext) => Promise<T>
): Promise<T> {
  const { timeoutMs, signal: callerSignal, timeoutMessage } = options;
  const reportedTimeoutMs = options.reportedTimeoutMs ?? timeoutMs;

  if (callerSignal?.aborted) {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    throw abortError;
  }

  const startTime = Date.now();
  const controller = new AbortController();
  let didTimeout = false;
  let timeoutId: any = undefined;

  if (timeoutMs > 0 && Number.isFinite(timeoutMs)) {
    timeoutId = setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, timeoutMs);
  }

  const onCallerAbort = () => {
    controller.abort();
  };

  if (callerSignal) {
    callerSignal.addEventListener('abort', onCallerAbort, { once: true });
  }

  const isTimeout = (): boolean => {
    if (didTimeout) return true;
    if (timeoutMs > 0 && Number.isFinite(timeoutMs) && Date.now() - startTime >= timeoutMs) {
      didTimeout = true;
      controller.abort();
      return true;
    }
    return false;
  };

  const rethrowIfTimeoutOrAbort = (err?: any): void => {
    if (err instanceof RequestTimeoutException) {
      throw err;
    }
    if (isTimeout()) {
      throw new RequestTimeoutException(reportedTimeoutMs, timeoutMessage);
    }
    if (callerSignal?.aborted || err?.name === 'AbortError' || controller.signal.aborted) {
      const abortErr = err?.name === 'AbortError' ? err : new Error('The operation was aborted');
      abortErr.name = 'AbortError';
      throw abortErr;
    }
  };

  const race = <R>(promise: Promise<R>): Promise<R> => {
    if (isTimeout()) {
      throw new RequestTimeoutException(reportedTimeoutMs, timeoutMessage);
    }
    if (callerSignal?.aborted || controller.signal.aborted) {
      const abortErr = new Error('The operation was aborted');
      abortErr.name = 'AbortError';
      throw abortErr;
    }

    return new Promise<R>((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        controller.signal.removeEventListener('abort', onAbort);
      };

      const onAbort = () => {
        if (settled) return;
        settled = true;
        cleanup();
        if (isTimeout()) {
          reject(new RequestTimeoutException(reportedTimeoutMs, timeoutMessage));
        } else {
          const abortErr = new Error('The operation was aborted');
          abortErr.name = 'AbortError';
          reject(abortErr);
        }
      };

      controller.signal.addEventListener('abort', onAbort, { once: true });

      promise.then(
        (res) => {
          if (settled) return;
          settled = true;
          cleanup();
          if (isTimeout()) {
            reject(new RequestTimeoutException(reportedTimeoutMs, timeoutMessage));
          } else {
            resolve(res);
          }
        },
        (err) => {
          if (settled) return;
          settled = true;
          cleanup();
          if (isTimeout()) {
            reject(new RequestTimeoutException(reportedTimeoutMs, timeoutMessage));
          } else if (
            callerSignal?.aborted ||
            err?.name === 'AbortError' ||
            controller.signal.aborted
          ) {
            const abortErr =
              err?.name === 'AbortError' ? err : new Error('The operation was aborted');
            abortErr.name = 'AbortError';
            reject(abortErr);
          } else {
            reject(err);
          }
        }
      );
    });
  };

  try {
    return await fn({
      signal: controller.signal,
      race,
      rethrowIfTimeoutOrAbort,
    });
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
    if (callerSignal) {
      callerSignal.removeEventListener('abort', onCallerAbort);
    }
  }
}

/**
 * Options for uploading binary or media attachments via {@link FeedbackClient.uploadAttachment}.
 *
 * @remarks
 * Uploads run through the governed upload-session flow, which reserves daily
 * quota from the declared byte size — so a positive `size` (or a `File`/`Blob`
 * payload whose `.size` is read automatically) is required.
 *
 * @example
 * ```ts
 * const options: UploadAttachmentOptions = {
 *   file: { uri: 'file:///var/mobile/.../screenshot.png' },
 *   filename: 'screenshot.png',
 *   mimeType: 'image/png',
 *   size: 204800,
 *   preferredKind: 'image',
 * };
 * ```
 */
export interface UploadAttachmentOptions {
  /**
   * File payload to upload.
   * In React Native, this can be an object containing `{ uri, name, type }` or a standard Blob/File.
   */
  file: any;

  /**
   * Name of the file including file extension (e.g. `'crash-log.txt'`).
   */
  filename: string;

  /**
   * Content MIME type of the upload (e.g. `'image/png'`, `'text/plain'`).
   */
  mimeType: string;

  /**
   * Exact byte size of the file.
   *
   * Required for a bare `{ uri }` payload, which cannot expose a size without a
   * native filesystem dependency; `File`/`Blob` payloads fall back to their
   * `.size`. A blank or non-positive value fails locally with
   * {@link UploadValidationException} (`file_size_required`) before any request.
   */
  size?: number;

  /**
   * Classification label for the uploaded attachment:
   * - `'image'`: image file (drives the image icon in the composer).
   * - `'r2'`: diagnostic or archive file.
   *
   * Both kinds upload through the same governed session; the server derives
   * the actual storage handling from the declared MIME type.
   *
   * @defaultValue `'image'` if mimeType starts with `'image/'`, else `'r2'`
   */
  preferredKind?: 'image' | 'r2';

  /**
   * Optional Cloudflare Turnstile token for apps that gate uploads. When
   * omitted, the client's `turnstileTokenProvider` is used.
   */
  turnstileToken?: string;

  /**
   * Optional abort signal to cancel the upload operation.
   */
  signal?: AbortSignal;

  /**
   * Optional completion-budget override in milliseconds for this upload.
   * Falls back to `uploadTimeoutMs` from the client config, which defaults to
   * 60 seconds — uploads do not inherit the shorter JSON-request `timeoutMs`.
   * A batch bills session creation and every file against the same budget.
   */
  timeoutMs?: number;

  /**
   * Optional persistent user token sent as the `X-User-Token` header so the
   * upload can be attributed to the uploading user, matching every other
   * authenticated API call.
   *
   * Upload sessions are always bound to an uploader identity (SEC-28): an
   * anonymous caller must present a valid UUID token here, the same one the
   * later feedback submission presents, or session creation fails with
   * `uploader_identity_required`. When omitted, the client falls back to
   * {@link UserTokenStore.shared}.
   */
  userToken?: string;
}

/**
 * Options for evaluating and fetching entries for the What's-New changelog overlay.
 */
export interface PrepareChangelogOverlayOptions {
  /**
   * If `true`, returns `null` if the latest changelog entry has already been marked as seen by the user.
   *
   * @defaultValue `false`
   */
  onlyIfUnseen?: boolean;

  /**
   * Optional custom {@link UserTokenStore} instance used to query seen status from.
   * Defaults to {@link UserTokenStore.shared}.
   */
  tokenStore?: UserTokenStore;

  /**
   * Optional abort signal to cancel the overlay configuration and changelog fetching.
   */
  signal?: AbortSignal;

  /**
   * Optional request timeout override in milliseconds.
   */
  timeoutMs?: number;
}

/**
 * Primary API client for interacting with CupThread backend services.
 *
 * @remarks
 * The `FeedbackClient` manages network transport, serialization, user authentication tokens,
 * error mapping, and platform targeting across all CupThread API surfaces.
 *
 * @example
 * ```ts
 * import { FeedbackClient } from '@cupthread/react-native';
 *
 * const client = new FeedbackClient({
 *   baseUrl: 'https://api.cupthread.com',
 *   appKey: 'app_live_sample123',
 *   defaultPlatform: 'ios',
 * });
 *
 * // Submit feedback draft
 * const result = await client.submit({
 *   title: 'Crash on launch in offline mode',
 *   description: 'App freezes on splash screen when cellular data is disabled.',
 * });
 * console.log(`Feedback submitted: ${result.submissionId}`);
 * ```
 */
export class FeedbackClient {
  /**
   * Resolved client configuration.
   */
  public readonly config: FeedbackClientConfig;

  /**
   * Creates a new `FeedbackClient` instance.
   *
   * @param config - Initialization options including `baseUrl` and `appKey`.
   *
   * @example
   * ```ts
   * const client = new FeedbackClient({
   *   baseUrl: 'https://api.cupthread.com',
   *   appKey: 'app_prod_998877',
   * });
   * ```
   */
  constructor(config: FeedbackClientConfig) {
    const baseUrl = config.baseUrl.replace(/\/+$/, '');
    if (!config.allowInsecureBaseUrl && !/^https:\/\//i.test(baseUrl)) {
      throw new InsecureBaseUrlException();
    }

    this.config = {
      baseUrl,
      appKey: config.appKey,
      allowInsecureBaseUrl: config.allowInsecureBaseUrl ?? false,
      defaultPlatform: config.defaultPlatform || getRuntimePlatform(),
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      uploadTimeoutMs: config.uploadTimeoutMs ?? DEFAULT_UPLOAD_TIMEOUT_MS,
      turnstileTokenProvider: config.turnstileTokenProvider,
      tokenTransport: config.tokenTransport ?? 'header',
    };
  }

  /**
   * Encodes a value interpolated into a URL path segment so reserved
   * characters (`/`, `?`, `#`, `%`, whitespace, …) cannot alter the request
   * target. The server decodes path segments before matching, so values
   * without reserved characters produce byte-identical URLs.
   */
  private static encodeSegment(segment: string): string {
    return encodeURIComponent(segment);
  }

  /**
   * Detects the production API's Cloudflare Turnstile rejection on intake
   * endpoints. The gate responds with HTTP 403 and either a machine-readable
   * `code` (e.g. `turnstile_required` / `turnstile_verification_failed`) or a
   * plain `error` string mentioning Turnstile, so both shapes are matched.
   */
  private static isTurnstileChallenge(status: number, responseBody: string): boolean {
    if (status !== 403) return false;
    let parsed: any = null;
    try {
      parsed = JSON.parse(responseBody);
    } catch {
      parsed = null;
    }
    if (parsed && typeof parsed === 'object') {
      if (typeof parsed.code === 'string' && /turnstile/i.test(parsed.code)) return true;
      if (typeof parsed.error === 'string') return /turnstile/i.test(parsed.error);
    }
    return /turnstile/i.test(responseBody);
  }

  /**
   * Whether diagnostics should reach the console. React Native sets `__DEV__`;
   * outside a dev bundle (tests, web previews) it is undefined and the SDK
   * follows the composer's convention of treating that as development.
   */
  private static isDevelopment(): boolean {
    try {
      const flag = (globalThis as { __DEV__?: unknown }).__DEV__;
      return typeof flag === 'undefined' || Boolean(flag);
    } catch {
      return true;
    }
  }

  /**
   * Maps an upload-session rejection to a deterministic exception carrying the
   * API's machine-readable `code`.
   *
   * The upload routes answer with codes a host can act on — a too-large file,
   * an unsupported MIME type, a prohibited executable extension, a missing or
   * mismatched uploader identity, or a session that expired mid-upload — and
   * flattening them into a generic status error would leave the caller unable
   * to tell a retryable expiry from a file the server will never accept.
   *
   * Returns `null` for statuses the shared pipeline already maps (402 quota,
   * 429 rate limit, 403 Turnstile, 401 sign-in) and for responses without a
   * code, so an unclassified server failure still surfaces as
   * {@link UnexpectedStatusException}.
   */
  private static mapUploadRejection(
    status: number,
    responseBody: string
  ): UploadRejectedException | null {
    if (status === 402 || status === 429) {
      return null;
    }
    let code: string | undefined;
    try {
      const parsed = JSON.parse(responseBody);
      if (parsed && typeof parsed === 'object' && typeof parsed.code === 'string') {
        code = parsed.code;
      }
    } catch {
      code = undefined;
    }
    if (status === 403 && (!code || /turnstile/i.test(code))) {
      // The Turnstile gate keeps its dedicated exception (and its retry
      // contract) rather than becoming a generic upload rejection.
      return null;
    }
    if (status === 401 && (!code || code === 'authentication_required')) {
      // Sign-in gating applies to the whole app surface, not to this file, so
      // it keeps AuthenticationRequiredException. A session-scoped 401 (the
      // token expired mid-upload) does carry a code and stays an upload
      // rejection the host can retry.
      return null;
    }
    if (!code && status !== 413) {
      return null;
    }
    return new UploadRejectedException(status, code, responseBody);
  }

  /**
   * Resolves the Turnstile token to attach to an intake submission: a
   * draft-level `turnstileToken` wins over the configured provider so hosts can
   * force a specific token per submission.
   */
  private async resolveTurnstileToken(explicit?: string): Promise<string | undefined> {
    const trimmed = explicit?.trim();
    if (trimmed) return trimmed;
    const provider = this.config.turnstileTokenProvider;
    if (!provider) return undefined;
    const token = await provider();
    return token?.trim() || undefined;
  }

  /**
   * Submits a user feedback draft, bug report, or feature inquiry.
   *
   * Note: Platform allowlist enforcement against `PublicAppConfig.allowedPlatforms`
   * happens at the composer layer (such as {@link FeedbackComposer}) via
   * {@link resolveAllowedPlatform}. Direct client calls forward the draft's
   * platform or client `defaultPlatform` directly to the intake endpoint.
   *
   * @param draft - The feedback payload including title, description, and optional attachments.
   * @param userToken - Optional persistent anonymous or authenticated user token.
   * @returns A promise resolving to the submission result metadata.
   * @throws {@link QuotaExceededException} If the workspace has reached its monthly submission quota (402).
   * @throws {@link InactiveSubscriptionException} If the workspace subscription is inactive or canceled (402).
   * @throws {@link PaymentRequiredException} If the intake endpoint responds with HTTP 402 Payment Required.
   * @throws {@link UnexpectedStatusException} If the server returns a non-2xx status code.
   * @throws {@link TurnstileRequiredException} If the intake endpoint demands Cloudflare Turnstile verification and no valid `turnstileToken` was supplied.
   * @throws {@link InvalidResponseException} If a network failure occurs or JSON parsing fails.
   *
   * @example
   * ```ts
   * const result = await client.submit({
   *   title: 'Dark mode contrast issue',
   *   description: 'Secondary text on settings screen is hard to read in dark mode.',
   *   reporterEmail: 'user@example.com',
   * });
   * ```
   */
  public async submit(
    draft: FeedbackDraft,
    userToken?: string,
    options?: RequestOptions | AbortSignal
  ): Promise<FeedbackSubmissionResult> {
    let resolvedUserToken = userToken;
    let resolvedOptions = options;
    if (typeof userToken === 'object' && userToken !== null) {
      resolvedOptions = userToken as any;
      resolvedUserToken = undefined;
    }

    const platform = draft.platform || this.config.defaultPlatform || getRuntimePlatform();
    const turnstileToken = await this.resolveTurnstileToken(draft.turnstileToken);
    // Only session uploads can be submitted: the intake endpoint rejects raw
    // storage keys and URLs (`direct_attachment_forbidden`), so legacy
    // descriptors without an uploadId are omitted instead of failing the whole
    // draft.
    const uploadIds = (draft.attachments || [])
      .map((attachment) => attachment.uploadId)
      .filter((uploadId): uploadId is string => typeof uploadId === 'string' && !!uploadId);
    // Descriptors without an uploadId predate the session flow and cannot be
    // sent (the API rejects raw keys/URLs). Say so in development instead of
    // submitting a silently attachment-less draft.
    const legacyCount = (draft.attachments || []).length - uploadIds.length;
    if (legacyCount > 0 && FeedbackClient.isDevelopment()) {
      console.warn(
        `[CupThread] ${legacyCount} attachment${legacyCount === 1 ? '' : 's'} without an uploadId ` +
          'were not submitted. Re-upload through uploadAttachment/uploadAttachments first.'
      );
    }
    // SEC-28: the intake endpoint finalizes uploads only for the identity that
    // created their session. When a draft carries session uploads and no token
    // was passed, fall back to the same store identity `uploadAttachment` uses
    // so a direct caller cannot trip `uploader_mismatch` by omission.
    const submissionToken =
      resolvedUserToken ||
      (uploadIds.length > 0 ? await UserTokenStore.shared.getToken() : undefined);
    const payload = {
      appKey: this.config.appKey,
      title: draft.title.trim(),
      description: draft.description.trim(),
      reporterName: draft.reporterName?.trim() || undefined,
      reporterEmail: draft.reporterEmail?.trim() || undefined,
      platform,
      appVersion: draft.appVersion?.trim() || undefined,
      buildNumber: draft.buildNumber?.trim() || undefined,
      metadata: {
        ...(draft.metadata || {}),
        sdk: 'cupthread-react-native',
        platform,
        submittedAt: iso8601Now(),
      },
      ...(uploadIds.length > 0 ? { uploadIds } : {}),
      ...(turnstileToken ? { turnstileToken } : {}),
    };

    return this.request<FeedbackSubmissionResult>({
      method: 'POST',
      path: '/api/v1/feedback',
      body: payload,
      userToken: submissionToken,
      accepted: [200, 201, 202],
      // Attachment submissions can be rejected for upload-specific reasons
      // (`uploader_mismatch`, `direct_attachment_forbidden`,
      // `already_finalized`, `scan_rejected`); keep those codes actionable.
      uploadRequest: uploadIds.length > 0,
      signal: extractSignal(resolvedOptions),
      timeoutMs: extractTimeoutMs(resolvedOptions),
    });
  }

  /**
   * Creates an upload session that reserves one slot per file.
   *
   * @remarks
   * The governed upload flow replaced both legacy direct-upload endpoints. A
   * session reserves daily workspace quota from the declared byte sizes, so
   * every file must declare a positive {@link UploadSessionFileSpec.sizeBytes};
   * an undeclared size would otherwise be rejected by the API with
   * `400 file_size_required`.
   *
   * Anonymous callers must be bound to an identity: pass `options.userToken`
   * (the same UUID the later feedback submission presents) or configure
   * {@link UserTokenStore.shared}. Without one the API answers
   * `400 uploader_identity_required`, and a later submission carrying a
   * different identity fails with `uploader_mismatch` (SEC-28).
   *
   * @param files - Between 1 and 8 file specifications.
   * @param options - Optional identity, Turnstile token, signal, and timeout overrides.
   * @returns The session token plus one reserved slot per file, in order.
   * @throws {@link UploadValidationException} If `files` is empty, longer than 8 entries, or declares a blank filename/MIME type or a non-positive size.
   * @throws {@link UploadRejectedException} If the API rejects the session (oversized file, unsupported MIME type, prohibited extension, missing identity, or exceeded storage quota).
   * @throws {@link AuthenticationRequiredException} If sign-in is required for uploads and no identity was presented (401).
   * @throws {@link RateLimitedException} If the upload rate limit or daily storage quota is exceeded (429).
   * @throws {@link TurnstileRequiredException} If human verification is required and no valid token was supplied (403).
   * @throws {@link RequestTimeoutException} If session creation times out.
   *
   * @example
   * ```ts
   * const session = await client.createUploadSession(
   *   [{ filename: 'crash.log', mimeType: 'text/plain', sizeBytes: 20480 }],
   *   { userToken }
   * );
   * ```
   */
  public async createUploadSession(
    files: readonly UploadSessionFileSpec[],
    options: CreateUploadSessionOptions = {}
  ): Promise<UploadSession> {
    return this.openUploadSession(files, options);
  }

  /**
   * Session creation with an optional shared deadline, so a batched upload can
   * bill the round trip against its own completion budget.
   *
   * @internal
   */
  private async openUploadSession(
    files: readonly UploadSessionFileSpec[],
    options: CreateUploadSessionOptions,
    deadlineAt?: number
  ): Promise<UploadSession> {
    const specs = this.normalizeUploadFileSpecs(files);
    const userToken = await this.resolveUploadUserToken(options.userToken);
    const turnstileToken = await this.resolveTurnstileToken(options.turnstileToken);
    const timeoutMs = options.timeoutMs ?? this.config.uploadTimeoutMs ?? DEFAULT_UPLOAD_TIMEOUT_MS;

    const json = await this.request<CreateUploadSessionResponse>({
      method: 'POST',
      path: '/api/v1/uploads/sessions',
      body: {
        appKey: this.config.appKey,
        purpose: 'feedback_attachment',
        files: specs,
        ...(turnstileToken ? { turnstileToken } : {}),
      },
      userToken,
      accepted: [200, 201],
      uploadRequest: true,
      signal: options.signal,
      timeoutMs,
      timeoutMessage: `Upload session creation timed out after ${timeoutMs}ms`,
      deadlineAt,
    });

    const session = json?.session;
    const slots = json?.files;
    if (
      !session ||
      typeof session.sessionToken !== 'string' ||
      !session.sessionToken ||
      !Array.isArray(slots)
    ) {
      throw new UnreadableUploadResponseException();
    }

    return {
      sessionId: session.sessionId,
      sessionToken: session.sessionToken,
      expiresAt: session.expiresAt,
      maxFileSizeBytes: session.maxFileSizeBytes,
      maxFiles: session.maxFiles,
      files: slots.map((slot) => ({
        clientFileId: slot.clientFileId,
        uploadId: slot.uploadId,
        uploadUrl: slot.uploadUrl || `/api/v1/uploads/${slot.uploadId}`,
        maxSizeBytes: slot.maxSizeBytes,
      })),
    };
  }

  /**
   * Uploads one attachment through the governed upload-session flow.
   *
   * @remarks
   * Creates a single-file session and streams the bytes to its reserved slot
   * with the session bearer token. Both images and diagnostic files use this
   * path: the legacy `POST /api/v1/uploads/images` route now requires a session
   * too, and `POST /api/v1/uploads/r2` is a `410 Gone` tombstone.
   *
   * `options.file` may be a React Native `{ uri, name, type }` pick or a
   * `Blob`/`File`. The declared byte size comes from `options.size`, or from the
   * payload's `.size` for `File`/`Blob` inputs; a bare `{ uri }` pick without a
   * size fails locally with {@link UploadValidationException} because no
   * native filesystem dependency is allowed to read it.
   *
   * Direct callers should supply `options.userToken` (e.g. from
   * {@link useCupThreadUserToken}) so the session is bound to the same identity
   * the feedback submission later presents.
   *
   * @param options - Attachment file payload, filename, MIME type, size, and optional user token options.
   * @returns The uploaded attachment descriptor, carrying the `uploadId` that {@link FeedbackDraft.attachments} submits.
   * @throws {@link UploadValidationException} If the file declares no positive size, or its filename/MIME type is blank.
   * @throws {@link UploadRejectedException} If the API rejects the session or the file bytes (size, MIME type, extension, identity, or an expired session).
   * @throws {@link AuthenticationRequiredException} If sign-in is required for uploads and no identity was presented (401).
   * @throws {@link RateLimitedException} If the upload rate limit or daily storage quota is exceeded (429).
   * @throws {@link TurnstileRequiredException} If human verification is required and no valid token was supplied (403).
   * @throws {@link RequestTimeoutException} If the upload times out.
   * @throws {@link UnreadableUploadResponseException} If a response body is malformed.
   * @throws {@link InvalidResponseException} If network transport fails.
   *
   * @example
   * ```ts
   * const attachment = await client.uploadAttachment({
   *   file: { uri: 'file:///path/to/screenshot.jpg' },
   *   filename: 'screenshot.jpg',
   *   mimeType: 'image/jpeg',
   *   size: asset.fileSize,
   *   userToken,
   * });
   * ```
   */
  public async uploadAttachment(options: UploadAttachmentOptions): Promise<FeedbackAttachment> {
    const [attachment] = await this.uploadAttachments([options]);
    return attachment;
  }

  /**
   * Uploads several attachments through one shared upload session.
   *
   * @remarks
   * Batching reserves every slot in a single session-creation round trip, so a
   * multi-file pick spends the upload budget once instead of per file. Files
   * are uploaded sequentially in pick order, which keeps a slow uplink from
   * saturating the connection and bounds memory to one file at a time.
   *
   * The completion budget (`timeoutMs`, falling back to
   * {@link FeedbackClientConfig.uploadTimeoutMs}) covers the whole call:
   * session creation and every slot draw from one deadline, and a slot that
   * starts with no budget left fails with {@link RequestTimeoutException}
   * without a request.
   *
   * The batch is transactional: the first failure aborts it and rejects with
   * that error, and the descriptors already returned for earlier slots are not
   * included in the rejection. Callers that need per-file isolation should use
   * {@link FeedbackClient.createUploadSession} and retry the failed slots.
   *
   * @param options - One entry per attachment (1–8 files per session).
   * @returns Uploaded descriptors in the same order as `options`.
   * @throws {@link UploadValidationException} If any entry declares no positive size or the batch is empty or longer than 8 entries.
   * @throws {@link UploadRejectedException} If the API rejects the session or any file.
   *
   * @example
   * ```ts
   * const attachments = await client.uploadAttachments([
   *   { file: { uri: shot.uri }, filename: 'shot.png', mimeType: 'image/png', size: shot.fileSize },
   *   { file: { uri: log.uri }, filename: 'crash.log', mimeType: 'text/plain', size: log.fileSize },
   * ], { userToken });
   * ```
   */
  public async uploadAttachments(
    options: readonly UploadAttachmentOptions[],
    shared: CreateUploadSessionOptions = {}
  ): Promise<FeedbackAttachment[]> {
    if (options.length === 0) {
      throw new UploadValidationException(
        'invalid_file_count',
        'At least one attachment is required for an upload.'
      );
    }
    if (options.length > MAX_UPLOAD_FILES) {
      throw new UploadValidationException(
        'invalid_file_count',
        `A single upload session accepts at most ${MAX_UPLOAD_FILES} attachments (received ${options.length}).`
      );
    }

    // Resolve every precondition before creating the session: a doomed file
    // must not consume a reserved slot or any of the daily quota.
    const declarations = options.map((option) => this.describeUpload(option));
    const explicitToken = shared.userToken ?? options.find((option) => option.userToken)?.userToken;
    const userToken = await this.resolveUploadUserToken(explicitToken);
    const signal = shared.signal ?? options.find((option) => option.signal)?.signal;
    const turnstileToken = shared.turnstileToken ?? options[0].turnstileToken;

    // The configured value is a completion budget for the whole call, not a
    // per-request allowance: session creation and every slot draw from one
    // deadline, so an eight-file pick cannot outlive it by nine budgets.
    const timeoutMs =
      shared.timeoutMs ??
      options.find((option) => option.timeoutMs)?.timeoutMs ??
      this.config.uploadTimeoutMs ??
      DEFAULT_UPLOAD_TIMEOUT_MS;
    const deadlineAt =
      Number.isFinite(timeoutMs) && timeoutMs > 0 ? Date.now() + timeoutMs : undefined;
    const assertUploadBudget = (): void => {
      if (deadlineAt !== undefined && deadlineAt - Date.now() <= 0) {
        // Fail before spending a request (and a reserved slot) on a call that
        // can no longer complete inside the budget.
        throw new RequestTimeoutException(timeoutMs, `Upload timed out after ${timeoutMs}ms`);
      }
    };

    const session = await this.openUploadSession(
      declarations.map((declaration) => declaration.spec),
      { userToken, turnstileToken, signal, timeoutMs },
      deadlineAt
    );

    const uploaded: FeedbackAttachment[] = [];
    for (let index = 0; index < declarations.length; index += 1) {
      const declaration = declarations[index];
      const slot = session.files[index];
      if (!slot) {
        throw new UnreadableUploadResponseException();
      }
      if (declaration.size > slot.maxSizeBytes) {
        // No server body exists for a rejection this client decided on, so
        // mirror the API's `{ error, code }` shape for `responseBody`.
        throw new UploadRejectedException(
          413,
          'file_too_large',
          JSON.stringify({
            error: `File "${declaration.spec.filename}" exceeds the ${slot.maxSizeBytes}-byte slot limit.`,
            code: 'file_too_large',
          })
        );
      }
      assertUploadBudget();
      uploaded.push(
        await this.putUploadSlot({
          slot,
          sessionToken: session.sessionToken,
          declaration,
          signal,
          timeoutMs,
          deadlineAt,
        })
      );
    }

    return uploaded;
  }

  /**
   * Normalizes and validates the file specs sent to session creation.
   */
  private normalizeUploadFileSpecs(
    files: readonly UploadSessionFileSpec[]
  ): UploadSessionFileWire[] {
    if (files.length === 0) {
      throw new UploadValidationException(
        'invalid_file_count',
        'At least one file is required to create an upload session.'
      );
    }
    if (files.length > MAX_UPLOAD_FILES) {
      throw new UploadValidationException(
        'invalid_file_count',
        `An upload session accepts at most ${MAX_UPLOAD_FILES} files (received ${files.length}).`
      );
    }

    // Slot ids must be unique within one session: two screenshots named
    // `image.png` would otherwise share a correlation id and could shadow each
    // other server-side.
    const usedClientFileIds = new Set<string>();

    return files.map((file) => {
      const filename = typeof file.filename === 'string' ? file.filename.trim() : '';
      const mimeType = typeof file.mimeType === 'string' ? file.mimeType.trim() : '';
      if (!filename || !mimeType) {
        throw new UploadValidationException(
          'invalid_field',
          'Each upload file requires a filename and a MIME type.'
        );
      }
      if (!Number.isFinite(file.sizeBytes) || file.sizeBytes <= 0) {
        throw new UploadValidationException(
          'file_size_required',
          `File "${filename}" must declare its size in bytes (received ${String(file.sizeBytes)}).`
        );
      }

      const requested =
        typeof file.clientFileId === 'string' && file.clientFileId.trim()
          ? file.clientFileId.trim()
          : filename;
      let clientFileId = requested;
      let suffix = 2;
      while (usedClientFileIds.has(clientFileId)) {
        clientFileId = `${requested}#${suffix}`;
        suffix += 1;
      }
      usedClientFileIds.add(clientFileId);

      return {
        clientFileId,
        filename,
        contentType: mimeType,
        sizeBytes: Math.ceil(file.sizeBytes),
      };
    });
  }

  /**
   * Turns one upload option into the slot spec plus the payload the slot
   * upload later sends, failing locally when the size cannot be determined.
   */
  private describeUpload(option: UploadAttachmentOptions): UploadDeclaration {
    const filename = typeof option.filename === 'string' ? option.filename.trim() : '';
    const mimeType = typeof option.mimeType === 'string' ? option.mimeType.trim() : '';
    if (!filename || !mimeType) {
      throw new UploadValidationException(
        'invalid_field',
        'Each upload requires a filename and a MIME type.'
      );
    }

    const size = resolveDeclaredSize(option);
    if (size === undefined) {
      throw new UploadValidationException(
        'file_size_required',
        `File "${filename}" must declare its size: pass \`size\` (the picker's fileSize) for a { uri } payload.`
      );
    }

    const kind = option.preferredKind || (mimeType.startsWith('image/') ? 'image' : 'r2');
    return {
      spec: { filename, mimeType, sizeBytes: size, clientFileId: filename },
      size,
      kind,
      file: option.file,
      filename,
      mimeType,
    };
  }

  /**
   * Resolves the identity an upload session binds to. The API requires a
   * UUID for anonymous callers and rejects an unbound session, so the shared
   * store is the fallback that keeps a direct `uploadAttachment()` call and a
   * later `submit()` attributed to the same identity (SEC-28).
   */
  private async resolveUploadUserToken(explicit?: string): Promise<string | undefined> {
    const trimmed = typeof explicit === 'string' ? explicit.trim() : '';
    if (trimmed) return trimmed;
    return UserTokenStore.shared.getToken();
  }

  /**
   * Sends one attachment's bytes to its reserved slot.
   *
   * Uses the documented multipart twin of `PUT /api/v1/uploads/{uploadId}`,
   * which React Native's `FormData` can send for both a `{ uri }` pick and a
   * `Blob`; a raw-body PUT would need the bytes in memory and an explicit
   * file MIME `Content-Type`, neither of which the RN bridge offers for a
   * `{ uri }` pick.
   */
  private async putUploadSlot(params: {
    slot: UploadSessionSlot;
    sessionToken: string;
    declaration: UploadDeclaration;
    signal?: AbortSignal;
    timeoutMs: number;
    /** Shared completion deadline of the enclosing batch, when one applies. */
    deadlineAt?: number;
  }): Promise<FeedbackAttachment> {
    const { slot, sessionToken, declaration, timeoutMs } = params;
    const timeoutMessage = `Upload timed out after ${timeoutMs}ms`;

    const json = await this.request<UploadedFileResponse>({
      method: 'POST',
      path: `/api/v1/uploads/${FeedbackClient.encodeSegment(slot.uploadId)}`,
      body: this.uploadBody(declaration),
      headers: { Authorization: `Bearer ${sessionToken}` },
      uploadRequest: true,
      accepted: [200, 201],
      uploadResponse: true,
      signal: params.signal,
      timeoutMs,
      timeoutMessage,
      deadlineAt: params.deadlineAt,
    });

    return {
      kind: declaration.kind,
      uploadId: json?.uploadId || slot.uploadId,
      key: json?.uploadId || slot.uploadId,
      url: json?.downloadUrl || slot.uploadUrl,
      filename: json?.filename || declaration.filename,
      mimeType: json?.contentType || declaration.mimeType,
      size: json?.sizeBytes ?? declaration.size,
    };
  }

  /**
   * Builds the slot request body. React Native's `FormData` accepts a
   * `{ uri, name, type }` part and streams the file natively, while hosts that
   * hold real bytes send a `Blob`. `Content-Type` is left for fetch to set
   * with its multipart boundary.
   */
  private uploadBody(declaration: UploadDeclaration): any {
    const formData = new FormData();
    const { file, filename, mimeType } = declaration;
    if (file && typeof file === 'object' && 'uri' in file) {
      formData.append('file', {
        uri: (file as { uri: string }).uri,
        name: filename,
        type: mimeType,
      } as any);
    } else {
      formData.append('file', file, filename);
    }
    return formData;
  }

  /**
   * Retrieves public application settings, features, and styling configuration.
   *
   * As of the September 2026 API sync, the public config endpoints answer private
   * applications (`allowPublic = false`) with HTTP 404 `{"error": "App not found"}` identically
   * to unknown app keys, rather than returning a 200 body with `allowPublic: false`.
   *
   * @param options - Optional request options or an AbortSignal.
   * @returns Application metadata and visual theme configuration.
   * @throws {@link UnexpectedStatusException} If the app key is invalid, private/unpublished (HTTP 404), or the server returns an unexpected status code.
   *
   * @example
   * ```ts
   * const config = await client.fetchAppConfig();
   * console.log(`Loaded settings for ${config.name}, theme: ${config.sdk.theme}`);
   * ```
   */
  public async fetchAppConfig(options?: RequestOptions | AbortSignal): Promise<PublicAppConfig> {
    return this.request<PublicAppConfig>({
      method: 'GET',
      path: `/api/v1/public/config/${FeedbackClient.encodeSegment(this.config.appKey)}`,
      signal: extractSignal(options),
      timeoutMs: extractTimeoutMs(options),
    });
  }

  /**
   * Retrieves all Kanban roadmap columns configured for the application, sorted by position.
   *
   * @returns List of active roadmap columns in display order.
   *
   * @example
   * ```ts
   * const columns = await client.fetchColumns();
   * columns.forEach(c => console.log(`${c.name} (position: ${c.position})`));
   * ```
   */
  public async fetchColumns(options?: RequestOptions | AbortSignal): Promise<BoardColumn[]> {
    const res = await this.request<{ columns: BoardColumn[] }>({
      method: 'GET',
      path: `/api/v1/public/columns/${FeedbackClient.encodeSegment(this.config.appKey)}`,
      signal: extractSignal(options),
      timeoutMs: extractTimeoutMs(options),
    });
    return (res.columns || []).sort((a, b) => a.position - b.position);
  }

  /**
   * Retrieves all release version milestones for the application, sorted by position.
   *
   * @returns Array of version milestones.
   *
   * @example
   * ```ts
   * const versions = await client.fetchVersions();
   * const shipped = versions.filter(v => v.released);
   * ```
   */
  public async fetchVersions(options?: RequestOptions | AbortSignal): Promise<AppVersion[]> {
    const res = await this.request<{ versions: AppVersion[] }>({
      method: 'GET',
      path: `/api/v1/public/versions/${FeedbackClient.encodeSegment(this.config.appKey)}`,
      signal: extractSignal(options),
      timeoutMs: extractTimeoutMs(options),
    });
    return (res.versions || []).sort((a, b) => a.position - b.position);
  }

  /**
   * Fetches paginated feature requests with optional milestone filtering and keyword search.
   *
   * By default, the caller's identity token is sent via the `X-User-Token` HTTP header
   * rather than as a URL query parameter to prevent credential leakage into server access logs,
   * reverse proxies, CDNs, and browser history (CWE-598).
   *
   * @param options - Query parameters including `userToken`, `limit`, `offset`, `versionId`, and `query`.
   * @returns Paginated list of feature request items.
   *
   * @example
   * ```ts
   * const result = await client.fetchFeatureRequests({
   *   userToken: 'usr_token_abc',
   *   query: 'widgets',
   *   limit: 20,
   * });
   * console.log(`Found ${result.total} matching requests.`);
   * ```
   */
  public async fetchFeatureRequests(options: {
    /**
     * Unique user token to evaluate `hasVoted` and `isOwnRequest` states.
     */
    userToken: string;
    /**
     * Maximum number of items to return per page (default: 50).
     */
    limit?: number;
    /**
     * Page offset index (default: 0).
     */
    offset?: number;
    /**
     * Optional version ID filter.
     */
    versionId?: string;
    /**
     * Optional search query string.
     */
    query?: string;
    /**
     * Optional abort signal to cancel the request.
     */
    signal?: AbortSignal;
    /**
     * Optional timeout in milliseconds for this request.
     */
    timeoutMs?: number;
    /**
     * Optional token transport override for this call (`'header' | 'both' | 'query'`).
     * Defaults to the client configuration's `tokenTransport` (or `'header'`).
     */
    tokenTransport?: 'query' | 'header' | 'both';
  }): Promise<ListFeatureRequestsResult> {
    const transport = options.tokenTransport ?? this.config.tokenTransport ?? 'header';
    const params = new URLSearchParams({
      appKey: this.config.appKey,
      limit: String(options.limit ?? 50),
      offset: String(options.offset ?? 0),
    });

    if (transport === 'query' || transport === 'both') {
      if (options.userToken) {
        params.append('userToken', options.userToken);
      }
    }

    if (options.versionId) params.append('versionId', options.versionId);
    if (options.query) params.append('q', options.query);

    const sendHeader = (transport === 'header' || transport === 'both') && !!options.userToken;

    return this.request<ListFeatureRequestsResult>({
      method: 'GET',
      path: `/api/v1/feature-requests?${params.toString()}`,
      userToken: sendHeader ? options.userToken : undefined,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
  }

  /**
   * Proposes a new public feature request.
   *
   * @param draft - Feature request proposal details (title, description, requesterName).
   * @param userToken - Current user identifier token.
   * @returns Submission confirmation and moderation pending status.
   * @throws {@link QuotaExceededException} If the workspace has reached its monthly submission quota (402).
   * @throws {@link InactiveSubscriptionException} If the workspace subscription is inactive or canceled (402).
   * @throws {@link PaymentRequiredException} If the intake endpoint responds with HTTP 402 Payment Required.
   * @throws {@link TurnstileRequiredException} If the intake endpoint demands Cloudflare Turnstile verification and no valid `turnstileToken` was supplied.
   *
   * @example
   * ```ts
   * const result = await client.submitFeatureRequest({
   *   title: 'Apple Watch Complications support',
   *   description: 'Provide circular and rectangular lock screen complications.',
   * }, userToken);
   * ```
   */
  public async submitFeatureRequest(
    draft: FeatureRequestDraft,
    userToken: string,
    options?: RequestOptions | AbortSignal
  ): Promise<FeatureRequestSubmissionResult> {
    const turnstileToken = await this.resolveTurnstileToken(draft.turnstileToken);
    return this.request<FeatureRequestSubmissionResult>({
      method: 'POST',
      path: '/api/v1/feature-requests',
      body: {
        appKey: this.config.appKey,
        title: draft.title.trim(),
        description: draft.description.trim(),
        requesterName: draft.requesterName?.trim() || undefined,
        requesterToken: userToken,
        ...(turnstileToken ? { turnstileToken } : {}),
      },
      accepted: [200, 201],
      signal: extractSignal(options),
      timeoutMs: extractTimeoutMs(options),
    });
  }

  /**
   * Casts an upvote on a specified feature request for the given user token.
   *
   * The endpoint (`POST /api/v1/feature-requests/{id}/vote`) is insert-only and
   * idempotent: repeating the request leaves an existing vote in place and
   * returns `{ voted: true, voteCount }`. To remove an existing vote, call
   * {@link FeedbackClient.removeVote}.
   *
   * @param featureRequestId - ID of the target feature request.
   * @param userToken - User token performing the vote.
   * @param options - Optional request options (including `shipNotifyEmail`, `turnstileToken`, `signal`, and `timeoutMs`) or an `AbortSignal`.
   * @returns Updated vote status (`voted: true`) and total vote count.
   *
   * @example
   * ```ts
   * const vote = await client.castVote('fr_123', userToken);
   * console.log(`Voted: ${vote.voted}, New count: ${vote.voteCount}`);
   * ```
   */
  public async castVote(
    featureRequestId: string,
    userToken: string,
    options?: CastVoteOptions | AbortSignal
  ): Promise<VoteResult> {
    const isOptionsObject =
      options &&
      typeof options === 'object' &&
      !('aborted' in options && typeof (options as AbortSignal).aborted === 'boolean');
    const castOpts = isOptionsObject ? (options as CastVoteOptions) : undefined;
    const shipNotifyEmail = castOpts?.shipNotifyEmail?.trim() || undefined;
    const turnstileToken = castOpts?.turnstileToken?.trim() || undefined;

    return this.request<VoteResult>({
      method: 'POST',
      path: `/api/v1/feature-requests/${FeedbackClient.encodeSegment(featureRequestId)}/vote`,
      body: {
        appKey: this.config.appKey,
        userToken,
        ...(shipNotifyEmail ? { shipNotifyEmail } : {}),
        ...(turnstileToken ? { turnstileToken } : {}),
      },
      accepted: [200],
      signal: extractSignal(options),
      timeoutMs: extractTimeoutMs(options),
    });
  }

  /**
   * Removes the given user token's upvote from a specified feature request.
   *
   * The endpoint (`DELETE /api/v1/feature-requests/{id}/vote`) is idempotent:
   * removing a vote that is not present returns `{ voted: false, voteCount }`
   * with HTTP 200 rather than an error.
   *
   * @param featureRequestId - ID of the target feature request.
   * @param userToken - User token removing the vote.
   * @param options - Optional request options or an `AbortSignal`.
   * @returns Updated vote status (`voted: false`) and total vote count.
   *
   * @example
   * ```ts
   * const vote = await client.removeVote('fr_123', userToken);
   * console.log(`Voted: ${vote.voted}, New count: ${vote.voteCount}`);
   * ```
   */
  public async removeVote(
    featureRequestId: string,
    userToken: string,
    options?: RequestOptions | AbortSignal
  ): Promise<VoteResult> {
    return this.request<VoteResult>({
      method: 'DELETE',
      path: `/api/v1/feature-requests/${FeedbackClient.encodeSegment(featureRequestId)}/vote`,
      body: {
        appKey: this.config.appKey,
        userToken,
      },
      accepted: [200],
      signal: extractSignal(options),
      timeoutMs: extractTimeoutMs(options),
    });
  }

  /**
   * Casts an upvote on a specified feature request (legacy compatibility wrapper).
   *
   * The backend `POST /api/v1/feature-requests/{id}/vote` endpoint is insert-only
   * and no longer toggles. Use {@link FeedbackClient.castVote} to cast a vote
   * and {@link FeedbackClient.removeVote} to remove a vote.
   *
   * @deprecated Use {@link FeedbackClient.castVote} or {@link FeedbackClient.removeVote} instead.
   * `POST /api/v1/feature-requests/{id}/vote` is insert-only and no longer toggles.
   * @param featureRequestId - ID of the target feature request.
   * @param userToken - User token performing the vote.
   * @param options - Optional request options or an `AbortSignal`.
   * @returns Updated vote status and total vote count.
   */
  public async toggleVote(
    featureRequestId: string,
    userToken: string,
    options?: CastVoteOptions | AbortSignal
  ): Promise<VoteResult> {
    return this.castVote(featureRequestId, userToken, options);
  }

  /**
   * Retrieves all discussion comments for a feature request.
   *
   * @param featureRequestId - ID of the feature request.
   * @returns List of discussion comments.
   *
   * @example
   * ```ts
   * const comments = await client.fetchComments('fr_123');
   * console.log(`Loaded ${comments.length} comments.`);
   * ```
   */
  public async fetchComments(
    featureRequestId: string,
    options?: RequestOptions | AbortSignal
  ): Promise<FeatureRequestComment[]> {
    const res = await this.request<{ comments: FeatureRequestComment[] }>({
      method: 'GET',
      path: `/api/v1/feature-requests/${FeedbackClient.encodeSegment(featureRequestId)}/comments`,
      signal: extractSignal(options),
      timeoutMs: extractTimeoutMs(options),
    });
    return res.comments || [];
  }

  /**
   * Posts a new discussion comment or reply on a feature request.
   *
   * @param featureRequestId - ID of the target feature request.
   * @param draft - Comment message content, author info, and optional reply pointers.
   * @param userToken - User token of the commenter.
   * @returns The created comment record.
   *
   * @example
   * ```ts
   * const comment = await client.postComment('fr_123', {
   *   body: 'We are targeting release in version 2.2!',
   *   authorName: 'Alex',
   * }, userToken);
   * ```
   */
  public async postComment(
    featureRequestId: string,
    draft: CommentDraft,
    userToken: string,
    options?: RequestOptions | AbortSignal
  ): Promise<FeatureRequestComment> {
    return this.request<FeatureRequestComment>({
      method: 'POST',
      path: `/api/v1/feature-requests/${FeedbackClient.encodeSegment(featureRequestId)}/comments`,
      body: {
        body: draft.body.trim(),
        authorName: draft.authorName?.trim() || undefined,
        authorEmail: draft.authorEmail?.trim() || undefined,
        authorAvatarUrl: draft.authorAvatarUrl?.trim() || undefined,
        parentId: draft.parentId || undefined,
        replyToClerkId: draft.replyToClerkId || undefined,
        replyToAuthorName: draft.replyToAuthorName?.trim() || undefined,
      },
      userToken,
      accepted: [200, 201],
      signal: extractSignal(options),
      timeoutMs: extractTimeoutMs(options),
    });
  }

  /**
   * Retrieves one page of published changelog entries with cursor pagination.
   *
   * The page cursor is opaque: pass a previous response's `nextCursor` back as
   * `cursor` to read the following page. Servers that predate pagination do not
   * return `hasMore`, which resolves to a single page of at most 100 entries.
   *
   * @param options - Page size (`limit`, clamped to 1–100), opaque `cursor`, and request options.
   * @returns Page entries sorted newest first, plus pagination metadata.
   *
   * @example
   * ```ts
   * const page = await client.listChangelog({ limit: 20 });
   * if (page.hasMore && page.nextCursor) {
   *   const next = await client.listChangelog({ limit: 20, cursor: page.nextCursor });
   * }
   * ```
   */
  public async listChangelog(options?: {
    /**
     * Maximum number of entries to return per page (default: 100, clamped to 1–100).
     */
    limit?: number;
    /**
     * Opaque keyset cursor from a previous response's `nextCursor`.
     */
    cursor?: string;
    /**
     * Optional abort signal to cancel the request.
     */
    signal?: AbortSignal;
    /**
     * Optional timeout in milliseconds for this request.
     */
    timeoutMs?: number;
  }): Promise<ListPublicChangelogResult> {
    const limit = Math.min(Math.max(options?.limit ?? DEFAULT_CHANGELOG_PAGE_SIZE, 1), 100);
    const params = new URLSearchParams({ limit: String(limit) });
    if (options?.cursor) params.append('cursor', options.cursor);

    const res = await this.request<Partial<ListPublicChangelogResult>>({
      method: 'GET',
      path: `/api/v1/public/apps/${FeedbackClient.encodeSegment(
        this.config.appKey
      )}/changelog?${params.toString()}`,
      signal: options?.signal,
      timeoutMs: options?.timeoutMs,
    });

    const entries = (res.entries || []).sort(
      (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    );
    return {
      entries,
      hasMore: res.hasMore === true,
      nextCursor: typeof res.nextCursor === 'string' ? res.nextCursor : null,
    };
  }

  /**
   * Retrieves published changelog entries and release notes sorted by publication date descending.
   *
   * Follows the endpoint's cursor pagination until every page has been read, so
   * apps with more entries than one page's worth still resolve their full history
   * (older deployments silently capped the result at the server's page size).
   *
   * @returns Chronological list of release notes.
   *
   * @example
   * ```ts
   * const entries = await client.fetchChangelog();
   * console.log(`Latest release: ${entries[0]?.title}`);
   * ```
   */
  public async fetchChangelog(options?: RequestOptions | AbortSignal): Promise<ChangelogEntry[]> {
    const signal = extractSignal(options);
    const timeoutMs = extractTimeoutMs(options);

    const all: ChangelogEntry[] = [];
    let cursor: string | undefined;
    // Defensive page cap: a misbehaving server that always reports `hasMore`
    // must not turn this into an unbounded request loop.
    for (let page = 0; page < MAX_CHANGELOG_PAGES; page += 1) {
      const res = await this.listChangelog({ cursor, signal, timeoutMs });
      all.push(...res.entries);
      if (!res.hasMore || !res.nextCursor) break;
      cursor = res.nextCursor;
    }
    return all.sort(
      (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    );
  }

  /**
   * Evaluates app configuration and fetches entries for the What's-New modal sheet.
   *
   * @param options - Optional filtering settings including `onlyIfUnseen`.
   * @returns Overlay payload or `null` if changelog feature is disabled, empty, or already seen.
   *
   * @example
   * ```ts
   * const overlayData = await client.prepareChangelogOverlay({ onlyIfUnseen: true });
   * if (overlayData) {
   *   console.log(`Ready to show ${overlayData.entries.length} release highlights.`);
   * }
   * ```
   */
  public async prepareChangelogOverlay(options?: PrepareChangelogOverlayOptions): Promise<{
    entries: ChangelogEntry[];
    appearance: SdkAppearance;
    latestKey: string;
  } | null> {
    const signal = options?.signal;
    const timeoutMs = options?.timeoutMs;
    const config = await this.fetchAppConfig({ signal, timeoutMs });
    if (!config.sdk?.features?.changelog) return null;
    const limit = Math.min(Math.max(config.sdk.changelogOverlay?.entryCount || 3, 1), 10);
    // The overlay only ever displays `limit` entries, so request exactly that
    // page instead of pulling the full history.
    const page = await this.listChangelog({ limit, signal, timeoutMs });
    const entries = page.entries.slice(0, limit);
    if (entries.length === 0) return null;

    const latest = entries[0];
    const latestKey = latest.versionLabel || latest.id;

    if (options?.onlyIfUnseen) {
      const store = options.tokenStore || UserTokenStore.shared;
      if (!store.isPersistent) {
        store.warnUnpersistedChangelogSeen();
      }
      const seen = await store.hasSeenChangelog(latestKey);
      if (seen) {
        return null;
      }
    }

    return {
      entries,
      appearance: config.sdk,
      latestKey,
    };
  }

  /**
   * Subscribes an email address to future changelog and release note announcements.
   *
   * @param email - Target email address to subscribe.
   * @param userToken - Current user token.
   * @returns Subscription status confirmation.
   *
   * @example
   * ```ts
   * const sub = await client.subscribeToChangelog('user@example.com', userToken);
   * if (sub.subscribed) {
   *   console.log('Successfully subscribed to release notes.');
   * }
   * ```
   */
  public async subscribeToChangelog(
    email: string,
    userToken: string,
    options?: RequestOptions | AbortSignal
  ): Promise<ChangelogSubscriptionResult> {
    return this.request<ChangelogSubscriptionResult>({
      method: 'POST',
      path: `/api/v1/public/apps/${FeedbackClient.encodeSegment(this.config.appKey)}/changelog/subscribe`,
      body: { email: email.trim() },
      userToken,
      accepted: [200, 201],
      signal: extractSignal(options),
      timeoutMs: extractTimeoutMs(options),
    });
  }

  /**
   * Unsubscribes a changelog email subscription using the per-subscriber token
   * from the unsubscribe link in a changelog or confirmation email.
   *
   * @remarks
   * `POST /api/v1/public/apps/{appKey}/changelog/unsubscribe` is token-gated:
   * the former bare-email payload was removed (SEC-14), because an
   * unauthenticated destructive call keyed on an address was both a
   * membership oracle and a way to unsubscribe anyone. The token travels in
   * the JSON body, and `Accept: application/json` is pinned so the endpoint
   * answers JSON instead of its browser HTML landing page.
   *
   * A token whose signature verifies for this app unsubscribes even after its
   * `exp` and even when the app has since disabled public surfaces, so a `200`
   * is final in both cases. A blank token has no signature to verify and is
   * rejected locally before any network round trip.
   *
   * @param token - Signed unsubscribe token from the email footer.
   * @returns Confirmation result.
   * @throws {@link MissingUnsubscribeTokenException} If `token` is blank.
   *
   * @example
   * ```ts
   * // `token` comes from the unsubscribe link: .../changelog/unsubscribe?token=...
   * await client.unsubscribeFromChangelog(tokenFromEmail);
   * ```
   */
  public async unsubscribeFromChangelog(
    token: string,
    options?: RequestOptions | AbortSignal
  ): Promise<ChangelogUnsubscribeResult> {
    const trimmed = typeof token === 'string' ? token.trim() : '';
    if (!trimmed) {
      throw new MissingUnsubscribeTokenException();
    }

    return this.request<ChangelogUnsubscribeResult>({
      method: 'POST',
      path: `/api/v1/public/apps/${FeedbackClient.encodeSegment(this.config.appKey)}/changelog/unsubscribe`,
      body: { token: trimmed },
      accept: 'application/json',
      accepted: [200],
      signal: extractSignal(options),
      timeoutMs: extractTimeoutMs(options),
    });
  }

  /**
   * Unsubscribes the workspace from its weekly digest email using the signed
   * token carried by that email's footer link and `List-Unsubscribe` header.
   *
   * @remarks
   * `POST /api/v1/public/digest/unsubscribe` is the only mutating digest path.
   * Its `GET` twin renders an interstitial confirmation page and never changes
   * preferences, so mail-gateway scanners that prefetch the footer link cause
   * no side effect. The token travels in the JSON body and
   * `Accept: application/json` is pinned so the endpoint answers JSON instead
   * of that HTML landing page, exactly like the changelog unsubscribe.
   *
   * The token is workspace-scoped rather than app-scoped: the request carries
   * no `appKey` path segment, and a token authenticated by signature, expiry,
   * and workspace existence keeps working after the owner's email changes or
   * ownership is transferred. A `200` is therefore final and clears only the
   * workspace's `weekly.digest` email event — inbox notifications are
   * unchanged — while replaying the same token stays idempotent. A blank token
   * has no signature to verify and is rejected locally before any network
   * round trip.
   *
   * @param token - Signed token from the weekly digest email footer or its `List-Unsubscribe` header.
   * @param options - Optional request options or an AbortSignal.
   * @returns Confirmation result.
   * @throws {@link MissingUnsubscribeTokenException} If `token` is blank.
   * @throws {@link UnexpectedStatusException} If the token is missing, invalid, or expired (HTTP 400).
   * @throws {@link RateLimitedException} If the per-IP unsubscribe budget is spent (HTTP 429).
   *
   * @example
   * ```ts
   * // `token` comes from the digest email footer: .../digest/unsubscribe?token=...
   * await client.unsubscribeFromDigest(tokenFromDigestEmail);
   * ```
   */
  public async unsubscribeFromDigest(
    token: string,
    options?: RequestOptions | AbortSignal
  ): Promise<DigestUnsubscribeResult> {
    const trimmed = typeof token === 'string' ? token.trim() : '';
    if (!trimmed) {
      throw new MissingUnsubscribeTokenException();
    }

    return this.request<DigestUnsubscribeResult>({
      method: 'POST',
      path: '/api/v1/public/digest/unsubscribe',
      body: { token: trimmed },
      accept: 'application/json',
      accepted: [200],
      signal: extractSignal(options),
      timeoutMs: extractTimeoutMs(options),
    });
  }

  /**
   * Reports customer tier, subscription plan, or revenue metrics for a user token.
   *
   * @param options - User attributes including subscription status, plan name, and MRR.
   * @returns Update confirmation.
   *
   * @example
   * ```ts
   * await client.updateUserAttributes({
   *   userToken: 'usr_token_abc',
   *   isPaying: true,
   *   plan: 'Pro Annual',
   *   mrr: 29.99,
   *   currency: 'USD',
   * });
   * ```
   */
  public async updateUserAttributes(options: {
    userToken: string;
    isPaying?: boolean;
    plan?: string;
    mrr?: number;
    currency?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<UserAttributesUpdateResult> {
    return this.request<UserAttributesUpdateResult>({
      method: 'PUT',
      path: `/api/v1/public/apps/${FeedbackClient.encodeSegment(this.config.appKey)}/user`,
      body: {
        isPaying: options.isPaying,
        plan: options.plan?.trim(),
        mrr: options.mrr,
        currency: options.currency?.trim(),
      },
      userToken: options.userToken,
      accepted: [200],
      signal: options.signal,
      timeoutMs: options.timeoutMs,
    });
  }

  /**
   * Retrieves the public developer profile, authored applications, and recent comment history.
   *
   * @remarks
   * Board and comment payloads carry app-scoped public ids (`u_<hex>`). The
   * API resolves those within the app named by the `appKey` query parameter,
   * so this method always sends the client's configured app key; pass
   * `appKey` to override it when rendering a profile from another app's board.
   * Raw Clerk ids (`user_*`) resolve without an app key but still accept one.
   *
   * The endpoint is rate limited per client IP and answers `429` when the
   * budget is spent, which surfaces as {@link RateLimitedException} with the
   * `Retry-After` hint. An unknown `u_*` id, or a `u_*` id with no app key to
   * resolve against, answers `404`.
   *
   * @param userId - App-scoped public id (`u_<hex>`) or a Clerk user id.
   * @param options - Optional request options (including an `appKey` override), or an `AbortSignal`.
   * @returns Public profile details.
   * @throws {@link RateLimitedException} If the per-IP profile budget is spent.
   * @throws {@link UnexpectedStatusException} If the profile is unknown (404).
   *
   * @example
   * ```ts
   * const profile = await client.fetchUserProfile(comment.authorClerkId);
   * console.log(`Developer: ${profile.profile.displayName}`);
   * ```
   */
  public async fetchUserProfile(
    userId: string,
    options?: FetchUserProfileOptions | AbortSignal
  ): Promise<PublicUserProfileResult> {
    const isOptionsObject =
      options &&
      typeof options === 'object' &&
      !('aborted' in options && typeof (options as AbortSignal).aborted === 'boolean');
    const profileOptions = isOptionsObject ? (options as FetchUserProfileOptions) : undefined;

    const params = new URLSearchParams();
    const appKey = profileOptions?.appKey?.trim() || this.config.appKey;
    if (appKey) params.append('appKey', appKey);
    const query = params.toString();

    return this.request<PublicUserProfileResult>({
      method: 'GET',
      path: `/api/v1/users/${FeedbackClient.encodeSegment(userId)}/profile${
        query ? `?${query}` : ''
      }`,
      signal: extractSignal(options),
      timeoutMs: extractTimeoutMs(options),
    });
  }

  /**
   * Internal generic HTTP request dispatcher handling JSON serialization, custom headers, and error mapping.
   *
   * @internal
   */
  private async request<T>(options: {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    path: string;
    body?: any;
    userToken?: string;
    accept?: string;
    accepted?: number[];
    signal?: AbortSignal;
    timeoutMs?: number;
    timeoutMessage?: string;
    /**
     * Absolute epoch-ms deadline shared by a multi-request operation (the
     * batched upload flow). The timer is trimmed to the time left before it, so
     * a batch cannot outlive its completion budget.
     */
    deadlineAt?: number;
    uploadResponse?: boolean;
    /**
     * Extra request headers. Session slot uploads add their bearer token here.
     */
    headers?: Record<string, string>;
    /**
     * Marks the request as an upload surface so a rejected response keeps the
     * API's machine-readable `code` (see {@link UploadRejectedException}).
     */
    uploadRequest?: boolean;
  }): Promise<T> {
    const url = `${this.config.baseUrl}${options.path}`;
    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
    const headers: Record<string, string> = { ...(options.headers || {}) };

    // FormData bodies must not carry an explicit Content-Type: the fetch
    // implementation sets the multipart boundary header itself.
    if (options.body && !isFormData) {
      headers['Content-Type'] = 'application/json';
    }
    if (options.userToken) {
      headers['X-User-Token'] = options.userToken;
    }
    // Some public endpoints content-negotiate: the changelog unsubscribe route
    // renders an HTML landing page for browsers unless JSON is requested.
    if (options.accept) {
      headers['Accept'] = options.accept;
    }

    const timeoutMs = options.timeoutMs ?? this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const callerSignal = options.signal;
    const effectiveTimeoutMs = clampToDeadline(timeoutMs, options.deadlineAt);

    return executeWithTimeout<T>(
      {
        timeoutMs: effectiveTimeoutMs,
        reportedTimeoutMs: timeoutMs,
        signal: callerSignal,
        timeoutMessage: options.timeoutMessage ?? `Request timed out after ${timeoutMs}ms`,
      },
      async (context) => {
        let response: Response;
        try {
          response = await fetch(url, {
            method: options.method,
            headers,
            body: options.body
              ? isFormData
                ? (options.body as FormData)
                : JSON.stringify(options.body)
              : undefined,
            signal: context.signal,
          });
        } catch (err: any) {
          context.rethrowIfTimeoutOrAbort(err);
          throw new InvalidResponseException(`Network request failed for ${url}`, err);
        }

        let text = '';
        try {
          text = await context.race(response.text());
        } catch (err: any) {
          context.rethrowIfTimeoutOrAbort(err);
          throw new InvalidResponseException(`Failed to read response body from ${url}`, err);
        }

        const accepted = options.accepted || [200];
        if (!accepted.includes(response.status)) {
          if (options.uploadRequest) {
            const uploadError = FeedbackClient.mapUploadRejection(response.status, text);
            if (uploadError) {
              throw uploadError;
            }
          }
          if (response.status === 401) {
            throw new AuthenticationRequiredException();
          }
          if (response.status === 402) {
            let parsed: any = null;
            try {
              parsed = JSON.parse(text);
            } catch {
              parsed = null;
            }
            const code =
              parsed && typeof parsed === 'object' && typeof parsed.code === 'string'
                ? parsed.code
                : undefined;
            const errorMsg =
              parsed && typeof parsed === 'object' && typeof parsed.error === 'string'
                ? parsed.error
                : undefined;

            if (code === 'tier_limit_submissions') {
              throw new QuotaExceededException(
                errorMsg || 'Monthly submission quota reached for this workspace.',
                text
              );
            }
            if (code === 'subscription_inactive') {
              throw new InactiveSubscriptionException(
                errorMsg || 'Workspace subscription is inactive or canceled.',
                text
              );
            }
            throw new PaymentRequiredException(
              errorMsg || 'CupThread API responded with HTTP 402: Payment Required',
              code,
              text
            );
          }
          if (response.status === 429) {
            throw new RateLimitedException(
              parseRetryAfterMs(response.headers.get('retry-after')),
              text
            );
          }
          if (FeedbackClient.isTurnstileChallenge(response.status, text)) {
            throw new TurnstileRequiredException(response.status, text);
          }
          throw new UnexpectedStatusException(response.status, text);
        }

        if (!text) {
          if (options.uploadResponse) {
            throw new UnreadableUploadResponseException();
          }
          return {} as T;
        }

        try {
          return JSON.parse(text) as T;
        } catch (err) {
          if (options.uploadResponse) {
            throw new UnreadableUploadResponseException();
          }
          throw new InvalidResponseException(`Failed to parse JSON response from ${url}`, err);
        }
      }
    );
  }
}
