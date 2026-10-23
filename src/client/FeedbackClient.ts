import type {
  AppVersion,
  BoardColumn,
  CastVoteOptions,
  ChangelogEntry,
  ChangelogSubscriptionResult,
  ChangelogUnsubscribeResult,
  CommentDraft,
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
  UserAttributesUpdateResult,
  VoteResult,
} from '../types';
import {
  AuthenticationRequiredException,
  InactiveSubscriptionException,
  InvalidResponseException,
  MissingUnsubscribeTokenException,
  PaymentRequiredException,
  QuotaExceededException,
  RateLimitedException,
  RequestTimeoutException,
  TurnstileRequiredException,
  UnexpectedStatusException,
  UnreadableUploadResponseException,
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

interface TimeoutContext {
  signal: AbortSignal;
  race<R>(promise: Promise<R>): Promise<R>;
  rethrowIfTimeoutOrAbort(err?: any): void;
}

interface ExecuteWithTimeoutOptions {
  timeoutMs: number;
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
      throw new RequestTimeoutException(timeoutMs, timeoutMessage);
    }
    if (callerSignal?.aborted || err?.name === 'AbortError' || controller.signal.aborted) {
      const abortErr = err?.name === 'AbortError' ? err : new Error('The operation was aborted');
      abortErr.name = 'AbortError';
      throw abortErr;
    }
  };

  const race = <R>(promise: Promise<R>): Promise<R> => {
    if (isTimeout()) {
      throw new RequestTimeoutException(timeoutMs, timeoutMessage);
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
          reject(new RequestTimeoutException(timeoutMs, timeoutMessage));
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
            reject(new RequestTimeoutException(timeoutMs, timeoutMessage));
          } else {
            resolve(res);
          }
        },
        (err) => {
          if (settled) return;
          settled = true;
          cleanup();
          if (isTimeout()) {
            reject(new RequestTimeoutException(timeoutMs, timeoutMessage));
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
 * @example
 * ```ts
 * const options: UploadAttachmentOptions = {
 *   file: { uri: 'file:///var/mobile/.../screenshot.png' },
 *   filename: 'screenshot.png',
 *   mimeType: 'image/png',
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
   * Preferred storage destination:
   * - `'image'`: Routed to optimized image processing pipeline.
   * - `'r2'`: Routed to Cloudflare R2 object storage for logs or diagnostic archives.
   *
   * @defaultValue `'image'` if mimeType starts with `'image/'`, else `'r2'`
   */
  preferredKind?: 'image' | 'r2';

  /**
   * Optional abort signal to cancel the upload operation.
   */
  signal?: AbortSignal;

  /**
   * Optional completion-budget override in milliseconds for this upload.
   * Falls back to `uploadTimeoutMs` from the client config, which defaults to
   * 60 seconds — uploads do not inherit the shorter JSON-request `timeoutMs`.
   */
  timeoutMs?: number;

  /**
   * Optional persistent user token sent as the `X-User-Token` header so the
   * upload can be attributed to the uploading user, matching every other
   * authenticated API call.
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
    this.config = {
      baseUrl: config.baseUrl.replace(/\/+$/, ''),
      appKey: config.appKey,
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
      attachments: draft.attachments || [],
      ...(turnstileToken ? { turnstileToken } : {}),
    };

    return this.request<FeedbackSubmissionResult>({
      method: 'POST',
      path: '/api/v1/feedback',
      body: payload,
      userToken: resolvedUserToken,
      accepted: [200, 201, 202],
      signal: extractSignal(resolvedOptions),
      timeoutMs: extractTimeoutMs(resolvedOptions),
    });
  }

  /**
   * Uploads a file, image, or log attachment to CupThread storage.
   *
   * @remarks
   * Direct callers of `uploadAttachment` should supply `options.userToken`
   * (e.g. from {@link useCupThreadUserToken}) so uploads are properly attributed
   * to the user's session and authenticated via the `X-User-Token` header.
   *
   * @param options - Attachment file payload, filename, MIME type, and optional user token options.
   * @returns The uploaded attachment descriptor ready to attach to {@link FeedbackDraft.attachments}.
   * @throws {@link AuthenticationRequiredException} If the request is rejected as unauthenticated (401).
   * @throws {@link RequestTimeoutException} If upload times out.
   * @throws {@link UnexpectedStatusException} If upload endpoint responds with an error.
   * @throws {@link UnreadableUploadResponseException} If response body is malformed.
   * @throws {@link InvalidResponseException} If network transport fails.
   *
   * @example
   * ```ts
   * const attachment = await client.uploadAttachment({
   *   file: { uri: 'file:///path/to/screenshot.jpg' },
   *   filename: 'screenshot.jpg',
   *   mimeType: 'image/jpeg',
   *   userToken,
   * });
   * ```
   */
  public async uploadAttachment(options: UploadAttachmentOptions): Promise<FeedbackAttachment> {
    const kind = options.preferredKind || (options.mimeType.startsWith('image/') ? 'image' : 'r2');
    const path = kind === 'image' ? '/api/v1/uploads/images' : '/api/v1/uploads/r2';

    const formData = new FormData();
    formData.append('appKey', this.config.appKey);

    if (options.file && typeof options.file === 'object' && 'uri' in options.file) {
      formData.append('file', {
        uri: options.file.uri,
        name: options.filename,
        type: options.mimeType,
      } as any);
    } else {
      formData.append('file', options.file, options.filename);
    }

    // Uploads use the dedicated upload budget: an explicit global `timeoutMs`
    // tuned for fail-fast JSON calls must not clamp large attachment uploads.
    const timeoutMs = options.timeoutMs ?? this.config.uploadTimeoutMs ?? DEFAULT_UPLOAD_TIMEOUT_MS;

    const json = await this.request<Record<string, any>>({
      method: 'POST',
      path,
      body: formData,
      userToken: options.userToken,
      accepted: [200, 201, 202],
      uploadResponse: true,
      signal: options.signal,
      timeoutMs,
      timeoutMessage: `Upload timed out after ${timeoutMs}ms`,
    });

    return {
      kind: json.kind || kind,
      key: json.key || json.id,
      url: json.url,
      filename: json.filename || options.filename,
      mimeType: json.mimeType || options.mimeType,
      size: json.size,
    };
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
    uploadResponse?: boolean;
  }): Promise<T> {
    const url = `${this.config.baseUrl}${options.path}`;
    const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
    const headers: Record<string, string> = {};

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

    return executeWithTimeout<T>(
      {
        timeoutMs,
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
