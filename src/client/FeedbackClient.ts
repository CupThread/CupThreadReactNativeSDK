import type {
  AppVersion,
  BoardColumn,
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
  ListFeatureRequestsResult,
  PublicAppConfig,
  PublicUserProfileResult,
  RequestOptions,
  SdkAppearance,
  UserAttributesUpdateResult,
  VoteResult,
} from '../types';
import {
  AuthenticationRequiredException,
  InvalidResponseException,
  RequestTimeoutException,
  UnexpectedStatusException,
  UnreadableUploadResponseException,
} from './FeedbackException';
import { getRuntimePlatform } from '../utils/platform';
import { iso8601Now } from '../utils/formatters';
import { UserTokenStore } from './UserTokenStore';

/**
 * Default timeout for requests and file uploads in milliseconds (15 seconds).
 */
export const DEFAULT_TIMEOUT_MS = 15000;

function extractSignal(
  optionsOrSignal?: RequestOptions | AbortSignal
): AbortSignal | undefined {
  if (!optionsOrSignal) return undefined;
  if ('aborted' in optionsOrSignal && typeof (optionsOrSignal as AbortSignal).aborted === 'boolean') {
    return optionsOrSignal as AbortSignal;
  }
  if (typeof optionsOrSignal === 'object' && 'signal' in optionsOrSignal) {
    return (optionsOrSignal as RequestOptions).signal;
  }
  return undefined;
}

function extractTimeoutMs(
  optionsOrSignal?: RequestOptions | AbortSignal
): number | undefined {
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
          } else if (callerSignal?.aborted || err?.name === 'AbortError' || controller.signal.aborted) {
            const abortErr = err?.name === 'AbortError' ? err : new Error('The operation was aborted');
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
   * Optional request timeout override in milliseconds for this upload.
   */
  timeoutMs?: number;
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
    };
  }

  /**
   * Submits a user feedback draft, bug report, or feature inquiry.
   *
   * @param draft - The feedback payload including title, description, and optional attachments.
   * @param userToken - Optional persistent anonymous or authenticated user token.
   * @returns A promise resolving to the submission result metadata.
   * @throws {@link UnexpectedStatusException} If the server returns a non-2xx status code.
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
   * @param options - Attachment file payload, filename, and MIME type options.
   * @returns The uploaded attachment descriptor ready to attach to {@link FeedbackDraft.attachments}.
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
   * });
   * ```
   */
  public async uploadAttachment(options: UploadAttachmentOptions): Promise<FeedbackAttachment> {
    const kind =
      options.preferredKind || (options.mimeType.startsWith('image/') ? 'image' : 'r2');
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

    const url = `${this.config.baseUrl}${path}`;
    const timeoutMs = options.timeoutMs ?? this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const callerSignal = options.signal;

    return executeWithTimeout(
      {
        timeoutMs,
        signal: callerSignal,
        timeoutMessage: `Upload timed out after ${timeoutMs}ms`,
      },
      async (context) => {
        let response: Response;
        try {
          response = await fetch(url, {
            method: 'POST',
            body: formData,
            signal: context.signal,
          });
        } catch (err: any) {
          context.rethrowIfTimeoutOrAbort(err);
          throw new InvalidResponseException('Network failure while uploading attachment', err);
        }

        if (response.status !== 200 && response.status !== 201) {
          let text = '';
          try {
            text = await context.race(response.text());
          } catch (err: any) {
            context.rethrowIfTimeoutOrAbort(err);
          }
          throw new UnexpectedStatusException(response.status, text);
        }

        try {
          const json = await context.race(response.json());
          return {
            kind: json.kind || kind,
            key: json.key || json.id,
            url: json.url,
            filename: json.filename || options.filename,
            mimeType: json.mimeType || options.mimeType,
            size: json.size,
          };
        } catch (err: any) {
          context.rethrowIfTimeoutOrAbort(err);
          throw new UnreadableUploadResponseException();
        }
      }
    );
  }

  /**
   * Retrieves public application settings, features, and styling configuration.
   *
   * @returns Application metadata and visual theme configuration.
   * @throws {@link UnexpectedStatusException} If the app key is invalid or unpublished.
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
      path: `/api/v1/public/config/${this.config.appKey}`,
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
      path: `/api/v1/public/columns/${this.config.appKey}`,
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
      path: `/api/v1/public/versions/${this.config.appKey}`,
      signal: extractSignal(options),
      timeoutMs: extractTimeoutMs(options),
    });
    return (res.versions || []).sort((a, b) => a.position - b.position);
  }

  /**
   * Fetches paginated feature requests with optional milestone filtering and keyword search.
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
  }): Promise<ListFeatureRequestsResult> {
    const params = new URLSearchParams({
      appKey: this.config.appKey,
      userToken: options.userToken,
      limit: String(options.limit ?? 50),
      offset: String(options.offset ?? 0),
    });
    if (options.versionId) params.append('versionId', options.versionId);
    if (options.query) params.append('q', options.query);

    return this.request<ListFeatureRequestsResult>({
      method: 'GET',
      path: `/api/v1/feature-requests?${params.toString()}`,
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
    return this.request<FeatureRequestSubmissionResult>({
      method: 'POST',
      path: '/api/v1/feature-requests',
      body: {
        appKey: this.config.appKey,
        title: draft.title.trim(),
        description: draft.description.trim(),
        requesterName: draft.requesterName?.trim() || undefined,
        requesterToken: userToken,
      },
      accepted: [200, 201],
      signal: extractSignal(options),
      timeoutMs: extractTimeoutMs(options),
    });
  }

  /**
   * Toggles an upvote on a specified feature request for the given user token.
   *
   * @param featureRequestId - ID of the target feature request.
   * @param userToken - User token performing the vote.
   * @returns Updated vote status and total vote count.
   *
   * @example
   * ```ts
   * const vote = await client.toggleVote('fr_123', userToken);
   * console.log(`Voted: ${vote.voted}, New count: ${vote.voteCount}`);
   * ```
   */
  public async toggleVote(
    featureRequestId: string,
    userToken: string,
    options?: RequestOptions | AbortSignal
  ): Promise<VoteResult> {
    return this.request<VoteResult>({
      method: 'POST',
      path: `/api/v1/feature-requests/${featureRequestId}/vote`,
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
      path: `/api/v1/feature-requests/${featureRequestId}/comments`,
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
      path: `/api/v1/feature-requests/${featureRequestId}/comments`,
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
   * Retrieves published changelog entries and release notes sorted by publication date descending.
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
    const res = await this.request<{ entries: ChangelogEntry[] }>({
      method: 'GET',
      path: `/api/v1/public/apps/${this.config.appKey}/changelog`,
      signal: extractSignal(options),
      timeoutMs: extractTimeoutMs(options),
    });
    return (res.entries || []).sort(
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
    const all = await this.fetchChangelog({ signal, timeoutMs });
    const entries = all.slice(0, limit);
    if (entries.length === 0) return null;

    const latest = entries[0];
    const latestKey = latest.versionLabel || latest.id;

    if (options?.onlyIfUnseen) {
      const store = options.tokenStore || UserTokenStore.shared;
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
      path: `/api/v1/public/apps/${this.config.appKey}/changelog/subscribe`,
      body: { email: email.trim() },
      userToken,
      accepted: [200, 201],
      signal: extractSignal(options),
      timeoutMs: extractTimeoutMs(options),
    });
  }

  /**
   * Unsubscribes an email address from changelog notification emails.
   *
   * @param email - Email address to remove.
   * @returns Confirmation result.
   *
   * @example
   * ```ts
   * await client.unsubscribeFromChangelog('user@example.com');
   * ```
   */
  public async unsubscribeFromChangelog(
    email: string,
    options?: RequestOptions | AbortSignal
  ): Promise<ChangelogUnsubscribeResult> {
    return this.request<ChangelogUnsubscribeResult>({
      method: 'POST',
      path: `/api/v1/public/apps/${this.config.appKey}/changelog/unsubscribe`,
      body: { email: email.trim() },
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
      path: `/api/v1/public/apps/${this.config.appKey}/user`,
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
   * @param userId - Target user or developer identifier.
   * @returns Public profile details.
   *
   * @example
   * ```ts
   * const profile = await client.fetchUserProfile('usr_42');
   * console.log(`Developer: ${profile.profile.displayName}`);
   * ```
   */
  public async fetchUserProfile(
    userId: string,
    options?: RequestOptions | AbortSignal
  ): Promise<PublicUserProfileResult> {
    return this.request<PublicUserProfileResult>({
      method: 'GET',
      path: `/api/v1/users/${userId}/profile`,
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
    accepted?: number[];
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<T> {
    const url = `${this.config.baseUrl}${options.path}`;
    const headers: Record<string, string> = {};

    if (options.body) {
      headers['Content-Type'] = 'application/json';
    }
    if (options.userToken) {
      headers['X-User-Token'] = options.userToken;
    }

    const timeoutMs = options.timeoutMs ?? this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const callerSignal = options.signal;

    return executeWithTimeout<T>(
      {
        timeoutMs,
        signal: callerSignal,
        timeoutMessage: `Request timed out after ${timeoutMs}ms`,
      },
      async (context) => {
        let response: Response;
        try {
          response = await fetch(url, {
            method: options.method,
            headers,
            body: options.body ? JSON.stringify(options.body) : undefined,
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
          throw new UnexpectedStatusException(response.status, text);
        }

        if (!text) {
          return {} as T;
        }

        try {
          return JSON.parse(text) as T;
        } catch (err) {
          throw new InvalidResponseException(`Failed to parse JSON response from ${url}`, err);
        }
      }
    );
  }
}
