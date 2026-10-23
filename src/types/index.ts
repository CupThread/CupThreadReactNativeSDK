/**
 * Supported client operating systems and target environments in the CupThread API.
 *
 * @remarks
 * Used for platform-specific filtering, reporting, and asset targeting across
 * CupThread services.
 *
 * @example
 * ```ts
 * const platform: FeedbackPlatform = 'ios';
 * ```
 */
export type FeedbackPlatform = 'ios' | 'macos' | 'android' | 'universal' | 'web';

/**
 * Configuration parameters required to instantiate a {@link FeedbackClient}.
 *
 * @example
 * ```ts
 * import { FeedbackClientConfig } from '@cupthread/react-native';
 *
 * const config: FeedbackClientConfig = {
 *   baseUrl: 'https://api.cupthread.com',
 *   appKey: 'app_live_abc123',
 *   defaultPlatform: 'ios',
 * };
 * ```
 */
export interface FeedbackClientConfig {
  /**
   * Root API URL of the CupThread backend instance (e.g., `"https://api.cupthread.com"`).
   * Trailing slashes are automatically normalized and stripped.
   *
   * @remarks
   * Must use `https://` unless {@link FeedbackClientConfig.allowInsecureBaseUrl}
   * is explicitly enabled, because every request carries bearer-like values
   * (the `X-User-Token` header, signed unsubscribe tokens, feedback drafts).
   * A cleartext base URL throws {@link InsecureBaseUrlException} at construction.
   */
  baseUrl: string;

  /**
   * Permit an `http://` (or otherwise non-HTTPS) `baseUrl`.
   *
   * @remarks
   * Off by default so tokens and user content cannot travel in cleartext on
   * runtimes that allow HTTP. Enable this only for a local or self-hosted
   * backend on a network you control, such as `http://localhost:3000` during
   * development. It has no effect on an `https://` base URL.
   *
   * @defaultValue false
   */
  allowInsecureBaseUrl?: boolean;

  /**
   * Unique application key generated in the CupThread Developer Console.
   * Typically starts with the `"app_"` prefix.
   */
  appKey: string;

  /**
   * Per-app SDK signing secret generated in the CupThread Developer Console
   * (*App Access → App Credentials → SDK signing secret*).
   *
   * @remarks
   * Required to sign payment-attribute reports (`isPaying`, `plan`, `mrr`,
   * `currency`) on `PUT /api/v1/public/apps/{appKey}/user`; the server rejects
   * unsigned payment attributes. Requests without payment attributes are
   * unaffected.
   *
   * An embedded secret is not tamper-resistant: anyone who installs the app
   * can extract it and forge verified payment attributes for arbitrary end
   * users. Prefer {@link FeedbackClientConfig.userAttributesSigner}, which
   * keeps the secret on your backend. When neither is configured, the report
   * is sent unsigned and rejected by the server with HTTP 422.
   */
  signingSecret?: string;

  /**
   * Backend-delegated signer for payment-attribute reports.
   *
   * @remarks
   * The SDK builds the canonical string (including a device-clock timestamp)
   * and hands it to this provider. Send it to your backend, HMAC-SHA256 it
   * with the app's SDK signing secret there, and return the signature and the
   * timestamp embedded in the string. This provider takes precedence over
   * {@link FeedbackClientConfig.signingSecret}.
   */
  userAttributesSigner?: UserAttributesSigner;

  /**
   * Default platform reported on feedback submissions and requests when
   * not explicitly overridden by the caller.
   *
   * Note: Platform validation against the application's configured allowlist
   * (`PublicAppConfig.allowedPlatforms`) is enforced at the composer layer
   * (such as {@link FeedbackComposer}) via {@link resolveAllowedPlatform}.
   * Direct calls to `client.submit` forward the draft or client default platform
   * directly to the intake endpoint.
   *
   * @defaultValue Auto-detected at runtime via React Native `Platform.OS`
   */
  defaultPlatform?: FeedbackPlatform;

  /**
   * Request timeout in milliseconds for API (JSON) operations.
   * If elapsed before the request settles, a {@link RequestTimeoutException} is thrown.
   *
   * Attachment uploads use a separate budget; see {@link FeedbackClientConfig.uploadTimeoutMs}.
   *
   * @defaultValue 15000 (15 seconds)
   */
  timeoutMs?: number;

  /**
   * Completion budget in milliseconds for attachment uploads
   * ({@link FeedbackClient.uploadAttachment}). Screenshots and diagnostic
   * archives routinely need longer than the JSON request budget on mobile
   * uplinks, so uploads default to a dedicated, larger value. A per-call
   * `timeoutMs` override on `uploadAttachment` still takes precedence.
   *
   * The budget covers the entire call — session creation plus every file in a
   * batch — so a multi-file pick cannot outlive it one file at a time.
   *
   * @defaultValue 60000 (60 seconds)
   */
  uploadTimeoutMs?: number;

  /**
   * Optional async provider resolving a Cloudflare Turnstile token for
   * protected intake endpoints (`POST /api/v1/feedback`,
   * `POST /api/v1/feature-requests`).
   *
   * @remarks
   * The production CupThread API enforces human verification on intake and
   * responds with HTTP 403 / {@link TurnstileRequiredException} when the
   * submission carries no (or an invalid) `turnstileToken`. When this provider
   * is configured, {@link FeedbackClient.submit} and
   * {@link FeedbackClient.submitFeatureRequest} call it before every intake
   * submission and attach the resolved token to the JSON body. A
   * `turnstileToken` set directly on the draft always takes precedence.
   * Synchronous return values are also accepted. Return `undefined` to omit
   * the field (e.g. when the host knows the endpoint is exempt).
   */
  turnstileTokenProvider?: () => string | undefined | Promise<string | undefined>;

  /**
   * Strategy for transmitting the user identity token on `GET /api/v1/feature-requests`.
   *
   * - `'header'` (default): Sends the token via the `X-User-Token` HTTP header only.
   *   Prevents token leakage into access logs, reverse proxies, and browser history (CWE-598).
   * - `'both'`: Sends the token in both the `X-User-Token` header and the `userToken` query parameter.
   *   Provided for transition compatibility during backend deployments.
   * - `'query'`: Sends the token via the `userToken` query parameter only (legacy behavior, deprecated).
   *
   * @defaultValue 'header'
   */
  tokenTransport?: 'query' | 'header' | 'both';
}

/**
 * Options for customizing individual API requests with cancellation and timeout overrides.
 */
export interface RequestOptions {
  /**
   * Optional AbortSignal to cancel the in-flight request.
   */
  signal?: AbortSignal;

  /**
   * Optional request timeout override in milliseconds for this operation.
   */
  timeoutMs?: number;
}

/**
 * The values that produced a payment-attribute canonical string.
 *
 * @remarks
 * `undefined` means the field is absent and signs as `unset`; an explicit
 * `null` clears the stored value and signs as `null`. String fields are
 * signed exactly as they are sent in the request body.
 */
export interface UserAttributesCanonicalArguments {
  /** Public app key that scopes the report. */
  appKey: string;

  /** Resolved end-user token (the `X-User-Token` identity of the request). */
  userToken: string;

  /** Paying-user status. */
  isPaying?: boolean | null;

  /** Host-app plan name, signed as sent. */
  plan?: string | null;

  /** Monthly recurring revenue, signed with `toFixed(2)` canonicalization. */
  mrr?: number | null;

  /** ISO 4217 currency code, signed as sent. */
  currency?: string | null;

  /** Unix epoch seconds embedded in the canonical string. */
  timestamp: number;
}

/**
 * The signing material passed to a {@link UserAttributesSigner} provider.
 *
 * @remarks
 * `canonicalString` is the exact UTF-8 byte sequence to HMAC-SHA256 with the
 * app's SDK signing secret. The last line is the signature timestamp; the HMAC
 * must cover it as-is, and the returned
 * {@link UserAttributesSignature.timestamp} must be that same value.
 */
export interface UserAttributesSigningRequest {
  /** Exact canonical string to HMAC-SHA256. */
  canonicalString: string;

  /** Structured values that produced `canonicalString`. */
  arguments: UserAttributesCanonicalArguments;

  /**
   * Signal aborted when the caller cancels the report or its timeout expires.
   *
   * Forward it to the backend request that produces the signature so signing
   * is cancelled with the rest of the operation. The client settles the
   * operation even if the signer ignores this signal, but in-flight work is
   * only released when the signer observes it.
   */
  signal?: AbortSignal;
}

/**
 * A signature over a {@link UserAttributesSigningRequest.canonicalString}.
 */
export interface UserAttributesSignature {
  /** HMAC-SHA256 digest as exactly 64 hexadecimal characters. */
  signature: string;

  /** The epoch-seconds value embedded in the signed canonical string. */
  timestamp: number;
}

/**
 * Backend-delegated signer for payment-attribute reports.
 *
 * @remarks
 * Keeping the SDK signing secret on your own backend is the recommended
 * integration: HMAC-SHA256 the exact `canonicalString` bytes there, where
 * entitlement truth already lives (StoreKit server notifications, RevenueCat
 * webhooks, and similar), and return the signature and its timestamp. The
 * secret never ships inside the app binary.
 *
 * A provider takes precedence over {@link FeedbackClientConfig.signingSecret}.
 * Return `null` or `undefined` to decline and fall back to the embedded
 * secret. A returned signature must match `^[0-9a-fA-F]{64}$` and its
 * timestamp must equal the timestamp embedded in the canonical string, or the
 * client throws {@link InvalidUserAttributesSignatureException} before sending.
 */
export type UserAttributesSigner = (
  request: UserAttributesSigningRequest
) =>
  UserAttributesSignature | null | undefined | Promise<UserAttributesSignature | null | undefined>;

/**
 * Options for reporting end-user attributes
 * ({@link FeedbackClient.updateUserAttributes}).
 *
 * @remarks
 * Reports that include any of `isPaying`, `plan`, `mrr`, or `currency` are
 * payment attributes and are HMAC-SHA256 signed. Identity-only reports are
 * sent unsigned.
 */
export interface UpdateUserAttributesOptions extends RequestOptions {
  /** End-user token sent as `X-User-Token`. */
  userToken: string;

  /** Paying-user status. `null` clears the stored value. */
  isPaying?: boolean | null;

  /** Host-app plan name. Trimmed before sending; `null` clears the stored value. */
  plan?: string | null;

  /** Monthly recurring revenue (0…1,000,000). `null` clears the stored value. */
  mrr?: number | null;

  /** ISO 4217 currency code. Trimmed before sending; `null` clears the stored value. */
  currency?: string | null;

  /**
   * Per-call SDK signing secret override.
   *
   * Consulted only when no {@link FeedbackClientConfig.userAttributesSigner}
   * provider is configured. An embedded secret is not tamper-resistant;
   * prefer the backend-delegated signer.
   */
  signingSecret?: string;

  /**
   * Unix epoch seconds for this signature. Defaults to the current device
   * clock. Primarily useful for deterministic tests; the server rejects
   * signatures outside a ±300-second freshness window.
   */
  timestamp?: number;
}

/**
 * Options for customizing a feature request vote request ({@link FeedbackClient.castVote}).
 */
export interface CastVoteOptions extends RequestOptions {
  /**
   * Optional email address (max 254 characters) to enroll in double-opt-in
   * ship notifications when the feature request ships. Trimmed before sending;
   * omitted from the JSON body when empty or undefined.
   *
   * On a board that requires sign-in, the address must be one of the signed-in
   * session's verified addresses. Otherwise the vote is still recorded and
   * {@link VoteResult.warning} carries `code: 'email_not_verified'` — no
   * consent is stored and no confirmation email is sent.
   */
  shipNotifyEmail?: string;

  /**
   * Optional Cloudflare Turnstile token for human verification on anonymous
   * votes or ship-notification opt-ins.
   */
  turnstileToken?: string;
}

/**
 * Options for fetching a public user profile ({@link FeedbackClient.fetchUserProfile}).
 */
export interface FetchUserProfileOptions extends RequestOptions {
  /**
   * Public app key used to resolve an app-scoped `u_<hex>` user id.
   *
   * Defaults to the client's configured `appKey`. Override it when the profile
   * was reached from a different app's board or comment, since those ids are
   * only meaningful within the app that minted them.
   */
  appKey?: string;
}

/**
 * Metadata describing an uploaded media or log file attachment.
 *
 * @remarks
 * Attachments are uploaded via {@link FeedbackClient.uploadAttachment} prior
 * to submitting a feedback draft. Uploads run through the governed
 * upload-session flow, so the descriptor carries the `uploadId` the intake
 * endpoint references; raw storage keys and URLs are rejected server-side
 * (`direct_attachment_forbidden`).
 *
 * @example
 * ```ts
 * const attachment: FeedbackAttachment = {
 *   kind: 'image',
 *   uploadId: 'upl_8f2c1d',
 *   key: 'upl_8f2c1d',
 *   filename: 'screen-01.png',
 *   mimeType: 'image/png',
 *   size: 204800,
 * };
 * ```
 */
export interface FeedbackAttachment {
  /**
   * Classification label for the attachment:
   * - `'image'`: an image file.
   * - `'r2'`: a diagnostic, log, or archive file.
   *
   * Attachments are stored privately regardless of kind; the server chooses
   * storage handling from the declared MIME type.
   */
  kind: 'image' | 'r2';

  /**
   * Upload-session file id that submits this attachment's bytes.
   *
   * Sent to the intake endpoint as `uploadIds`. Descriptors created before the
   * upload-session flow (or by a host that only has a legacy storage
   * reference) omit it and are not submitted.
   */
  uploadId?: string;

  /**
   * Server-assigned identifier for the upload; equals {@link FeedbackAttachment.uploadId}
   * for session uploads and is kept as a display/fallback key.
   */
  key: string;

  /**
   * Authorized download URL when the server issued one, otherwise the
   * session's opaque slot upload URL.
   *
   * Attachments are stored privately: this is never a publicly fetchable
   * asset, and the server returns no delivery URL until the feedback
   * submission finalizes. The fallback can be a server-relative path
   * (`/api/v1/uploads/…`), so treat the value as opaque and never assume it is
   * absolute or fetchable.
   *
   * @deprecated the intake endpoint no longer accepts this value; submit
   * `uploadId` instead. Kept for display fallbacks on existing descriptors.
   */
  url?: string;

  /**
   * Original file name as reported by the client filesystem or picker.
   */
  filename?: string;

  /**
   * MIME content type of the file (e.g., `'image/png'`, `'text/plain'`).
   */
  mimeType?: string;

  /**
   * File payload size in bytes.
   */
  size?: number;
}

/**
 * One file to pre-allocate in an upload session.
 *
 * @example
 * ```ts
 * const spec: UploadSessionFileSpec = {
 *   filename: 'crash.log',
 *   mimeType: 'text/plain',
 *   sizeBytes: 20480,
 * };
 * ```
 */
export interface UploadSessionFileSpec {
  /**
   * Name recorded on the reserved slot, including its extension. The server
   * screens executable extensions (`.exe`, `.sh`, `.php`, …) and rejects them.
   */
  filename: string;

  /**
   * MIME type declared for the slot. PNG, JPEG, WebP, and GIF are accepted for
   * images; diagnostic text and archive types are accepted for `r2` uploads.
   */
  mimeType: string;

  /**
   * Exact byte size of the file, in bytes (must be positive).
   *
   * The value is load-bearing: the API reserves daily quota from it and
   * rejects an undeclared size with `400 file_size_required`. React Native
   * pickers report it as `fileSize`; `File`/`Blob` inputs expose `.size`.
   */
  sizeBytes: number;

  /**
   * Optional client-side correlation id echoed back on the reserved slot.
   * Defaults to the `filename`; duplicates within one session are disambiguated
   * with a `#n` suffix so two same-named files never share a slot id.
   */
  clientFileId?: string;
}

/**
 * A slot reserved by {@link FeedbackClient.createUploadSession}, addressed by
 * the returned session token when the bytes are sent.
 */
export interface UploadSessionSlot {
  /**
   * Client-side correlation id, echoed from {@link UploadSessionFileSpec.clientFileId}
   * (defaults to the filename).
   */
  clientFileId: string;

  /**
   * Server-assigned upload id for this slot; the resulting
   * {@link FeedbackAttachment.uploadId}.
   */
  uploadId: string;

  /**
   * Session-scoped upload target (`/api/v1/uploads/{uploadId}`).
   */
  uploadUrl: string;

  /**
   * Maximum number of bytes the slot accepts, as reserved by the server.
   */
  maxSizeBytes: number;
}

/**
 * A created upload session: the bearer token that authorizes slot uploads plus
 * one reserved slot per file.
 *
 * @example
 * ```ts
 * const session = await client.createUploadSession([
 *   { filename: 'crash.log', mimeType: 'text/plain', sizeBytes: 20480 },
 * ]);
 * console.log(`Upload slots: ${session.files.length}`);
 * ```
 */
export interface UploadSession {
  /**
   * Upload session id (`ups_…`).
   */
  sessionId: string;

  /**
   * Bearer token authorizing `PUT /api/v1/uploads/{uploadId}`. Treat it as a
   * credential and never log it.
   */
  sessionToken: string;

  /**
   * ISO 8601 timestamp after which the session and its slots are rejected.
   */
  expiresAt: string;

  /**
   * Per-file size ceiling the server applies to every slot in this session.
   */
  maxFileSizeBytes: number;

  /**
   * Maximum number of files a session may reserve.
   */
  maxFiles: number;

  /**
   * Reserved slots, in the order the files were submitted.
   */
  files: UploadSessionSlot[];
}

/**
 * Payload submitted by the user when submitting bug reports, suggestions, or feedback.
 *
 * @example
 * ```ts
 * const draft: FeedbackDraft = {
 *   title: 'Audio stutter during bluetooth reconnection',
 *   description: 'When reconnecting AirPods Pro 2 while a track is playing, audio glitches for 2 seconds.',
 *   reporterName: 'Jordan Doe',
 *   reporterEmail: 'jordan@example.com',
 *   appVersion: '2.4.0',
 *   buildNumber: '108',
 *   metadata: {
 *     audioCodec: 'AAC-ELD',
 *     deviceModel: 'iPhone 16 Pro',
 *   },
 * };
 * ```
 */
export interface FeedbackDraft {
  /**
   * Concise summary of the feedback or issue (minimum 3 characters).
   */
  title: string;

  /**
   * In-depth description detailing reproduction steps, expected behavior, or context (minimum 5 characters).
   */
  description: string;

  /**
   * Optional full or display name of the submitting user.
   */
  reporterName?: string;

  /**
   * Optional email address for follow-up responses and status updates.
   */
  reporterEmail?: string;

  /**
   * Target platform for the report. Defaults to runtime OS if omitted.
   */
  platform?: FeedbackPlatform;

  /**
   * Semantic version string of the host application (e.g., `"1.2.0"`).
   */
  appVersion?: string;

  /**
   * Internal build number of the host application (e.g., `"42"`).
   */
  buildNumber?: string;

  /**
   * Custom key-value dictionary for environment variables, user flags, or device diagnostics.
   */
  metadata?: Record<string, string>;

  /**
   * Array of previously uploaded file attachments to associate with this submission.
   *
   * Only attachments carrying an {@link FeedbackAttachment.uploadId} are sent;
   * the intake endpoint references their reserved session slots and rejects
   * raw storage keys or URLs (`direct_attachment_forbidden`).
   */
  attachments?: FeedbackAttachment[];

  /**
   * Optional Cloudflare Turnstile token satisfying the human-verification gate
   * the production API enforces on intake endpoints. When omitted, the client
   * falls back to `FeedbackClientConfig.turnstileTokenProvider` (if configured).
   */
  turnstileToken?: string;
}

/**
 * Server response returned after successfully recording a feedback submission.
 *
 * @example
 * ```ts
 * const result: FeedbackSubmissionResult = {
 *   submissionId: 'sub_99af2810',
 *   forwardedToGithub: true,
 *   githubDiscussionId: 'D_kwDO...',
 *   githubDiscussionUrl: 'https://github.com/org/repo/discussions/42',
 * };
 * ```
 */
export interface FeedbackSubmissionResult {
  /**
   * Unique identifier assigned to the submission.
   */
  submissionId: string;

  /**
   * Whether the submission was automatically synchronized to a linked GitHub Repository/Discussion.
   */
  forwardedToGithub: boolean;

  /**
   * GitHub Discussion node ID if GitHub integration is enabled for the app.
   */
  githubDiscussionId?: string;

  /**
   * Direct web URL to the created GitHub Discussion if applicable.
   */
  githubDiscussionUrl?: string;

  /**
   * Non-fatal warning message from the server if processing encountered partial issues.
   */
  warning?: string;

  /**
   * Machine-readable warning code from the server, when present.
   */
  warningCode?: string;
}

/**
 * Built-in visual themes supported across the CupThread design system and console.
 *
 * @remarks
 * - `'system'`: Automatically tracks light or dark appearance based on device settings.
 * - `'light'`: Clean white and slate aesthetic.
 * - `'dark'`: Slate-tinted dark mode.
 * - `'midnight'`: Deep indigo/black OLED dark mode.
 * - `'ocean'`: Teal and aquatic accents.
 * - `'forest'`: Organic lime and emerald tones.
 * - `'sunset'`: Warm amber and terracotta palette.
 * - `'candy'`: Playful fuchsia and purple palette.
 */
export type SdkTheme =
  'system' | 'light' | 'dark' | 'midnight' | 'ocean' | 'forest' | 'sunset' | 'candy';

/**
 * Feature flag switches for user-facing SDK surfaces.
 *
 * @example
 * ```ts
 * const features: SdkFeatures = {
 *   feedback: true,
 *   featureRequests: true,
 *   roadmap: true,
 *   changelog: true,
 * };
 * ```
 */
export interface SdkFeatures {
  /**
   * Enables in-app feedback dialogs and submissions.
   */
  feedback: boolean;

  /**
   * Enables the feature request board and community voting.
   */
  featureRequests: boolean;

  /**
   * Enables the multi-column public roadmap board.
   */
  roadmap: boolean;

  /**
   * Enables release notes, changelog listings, and email subscriptions.
   */
  changelog: boolean;
}

/**
 * Visual and behavioral settings for the modal What's-New changelog overlay.
 *
 * @example
 * ```ts
 * const overlayConfig: ChangelogOverlayConfig = {
 *   title: "What's New in v2.0",
 *   subtitle: 'Discover our latest improvements',
 *   entryCount: 3,
 *   primaryButton: 'Got it',
 *   closeButton: 'Dismiss',
 * };
 * ```
 */
export interface ChangelogOverlayConfig {
  /**
   * Primary title displayed at the top of the modal sheet.
   */
  title: string;

  /**
   * Optional explanatory subtitle displayed below the title.
   */
  subtitle?: string;

  /**
   * Maximum number of recent changelog entries to render (clamped between 1 and 10).
   */
  entryCount: number;

  /**
   * Label text for the primary confirmation button.
   */
  primaryButton: string;

  /**
   * Label text for the secondary close/dismiss button.
   */
  closeButton: string;
}

/**
 * Developer console-configured visual appearance and feature toggles for SDK views.
 */
export interface SdkAppearance {
  /**
   * Active visual theme palette.
   */
  theme: SdkTheme;

  /**
   * Enabled SDK functional surfaces.
   */
  features: SdkFeatures;

  /**
   * Configuration for the What's-New modal popup.
   */
  changelogOverlay: ChangelogOverlayConfig;
}

/**
 * Public application metadata returned by `GET /api/v1/public/config/:appKey`.
 *
 * @example
 * ```ts
 * const config = await client.fetchAppConfig();
 * console.log(`Config loaded for app: ${config.name}`);
 * ```
 */
export interface PublicAppConfig {
  /**
   * Internal database ID for the application.
   */
  appId: string;

  /**
   * Public application key.
   */
  appKey: string;

  /**
   * URL-friendly slug identifier for the application.
   */
  slug: string;

  /**
   * Display name of the application.
   */
  name: string;

  /**
   * Store listing link (App Store, Google Play, or Website) if configured.
   */
  storeUrl?: string | null;

  /**
   * Store classification (e.g., `'app_store'`, `'play_store'`).
   */
  storeKind?: string | null;

  /**
   * CDN URL for the application logo/icon.
   */
  iconUrl?: string | null;

  /**
   * Whether public board access is enabled.
   *
   * As of the September 2026 API sync, public config endpoints (`GET /api/v1/public/config/:appKey`
   * and `GET /api/v1/public/workspaces/:workspaceSlug/apps/:appSlug/config`) answer private
   * applications (`allowPublic = false`) with HTTP 404 `{"error": "App not found"}` rather than
   * returning an HTTP 200 payload with `allowPublic: false`. A successfully fetched
   * {@link PublicAppConfig} will therefore always carry `allowPublic: true`. This property is
   * retained for API schema parity with the server's PublicAppConfig model.
   */
  allowPublic: boolean;

  /**
   * Target platforms enabled for this application.
   */
  allowedPlatforms: FeedbackPlatform[];

  /**
   * Maximum allowable size for file attachment uploads in bytes.
   */
  maxAttachmentBytes: number;

  /**
   * Whether unauthenticated visitors can view the roadmap board.
   */
  allowAnonymousRoadmap: boolean;

  /**
   * Whether unauthenticated visitors can cast votes on feature requests.
   */
  allowAnonymousVote: boolean;

  /**
   * Whether unauthenticated visitors can submit feedback drafts.
   */
  allowAnonymousFeedback: boolean;

  /**
   * Whether unauthenticated visitors can view changelogs and release notes.
   */
  allowAnonymousChangelog: boolean;

  /**
   * SDK visual styling and surface feature toggles.
   */
  sdk: SdkAppearance;
}

/**
 * Semantic lifecycle stage for a roadmap column.
 *
 * @remarks
 * - `'pending_review'`: Community submissions awaiting moderator review.
 * - `'normal'`: Active stages such as "Under Consideration", "Planned", or "In Progress".
 * - `'done'`: Shipped and completed features.
 */
export type BoardColumnKind = 'pending_review' | 'normal' | 'done';

/**
 * Column definition on the public Kanban roadmap board.
 *
 * @example
 * ```ts
 * const column: BoardColumn = {
 *   id: 'col_123',
 *   appId: 'app_abc',
 *   name: 'In Progress',
 *   slug: 'in-progress',
 *   position: 2,
 *   isVisible: true,
 *   isSystem: false,
 *   kind: 'normal',
 *   color: '#3b82f6',
 *   createdAt: '2026-01-01T00:00:00.000Z',
 *   updatedAt: '2026-01-15T00:00:00.000Z',
 * };
 * ```
 */
export interface BoardColumn {
  /**
   * Unique column ID.
   */
  id: string;

  /**
   * Application ID that owns this column.
   */
  appId: string;

  /**
   * Column display title (e.g., `"Under Consideration"`, `"In Progress"`).
   */
  name: string;

  /**
   * URL and identifier slug (e.g., `"in-progress"`).
   */
  slug: string;

  /**
   * Display sorting order position index.
   */
  position: number;

  /**
   * Whether this column is visible to end users.
   */
  isVisible: boolean;

  /**
   * Whether this is a default system column created on app initialization.
   */
  isSystem: boolean;

  /**
   * Semantic classification of the column stage.
   */
  kind: BoardColumnKind;

  /**
   * Optional custom hex or CSS color representing this stage.
   */
  color?: string | null;

  /**
   * ISO 8601 creation timestamp.
   */
  createdAt: string;

  /**
   * ISO 8601 last update timestamp.
   */
  updatedAt: string;
}

/**
 * Version release milestone of the application.
 *
 * @example
 * ```ts
 * const version: AppVersion = {
 *   id: 'ver_01',
 *   appId: 'app_abc',
 *   label: '2.1.0',
 *   position: 1,
 *   released: true,
 *   releasedAt: '2026-08-15T12:00:00.000Z',
 *   description: 'Major performance and UI refresh release',
 *   createdAt: '2026-08-01T00:00:00.000Z',
 *   updatedAt: '2026-08-15T12:00:00.000Z',
 * };
 * ```
 */
export interface AppVersion {
  /**
   * Unique version ID.
   */
  id: string;

  /**
   * Application ID that owns this milestone.
   */
  appId: string;

  /**
   * Version release tag or label (e.g., `"2.1.0"`, `"v3.0-beta"`).
   */
  label: string;

  /**
   * Sorting order position index.
   */
  position: number;

  /**
   * Whether this version has been officially shipped.
   */
  released: boolean;

  /**
   * ISO 8601 timestamp when this version was published, if released.
   */
  releasedAt?: string | null;

  /**
   * Optional release summary notes or description.
   */
  description?: string | null;

  /**
   * ISO 8601 creation timestamp.
   */
  createdAt: string;

  /**
   * ISO 8601 last update timestamp.
   */
  updatedAt: string;
}

/**
 * Profile preview of a user who recently participated in a feature request discussion.
 *
 * @example
 * ```ts
 * const commenter: RecentCommenter = {
 *   authorName: 'Sarah Connor',
 *   avatarUrl: 'https://images.example.com/avatar.jpg',
 * };
 * ```
 */
export interface RecentCommenter {
  /**
   * Display name of the commenter.
   */
  authorName?: string | null;

  /**
   * Clerk user ID of the commenter if authenticated.
   */
  clerkUserId?: string | null;

  /**
   * Direct URL to commenter's avatar image.
   */
  avatarUrl?: string | null;
}

/**
 * A feature request proposal item listed on the roadmap or feedback board.
 *
 * @example
 * ```ts
 * const item: FeatureRequestItem = {
 *   id: 'fr_101',
 *   appId: 'app_xyz',
 *   title: 'Support Dark Mode on Android widgets',
 *   description: 'Home screen widgets currently stay in light theme even when system dark mode is active.',
 *   status: 'planned',
 *   columnName: 'Planned',
 *   columnColor: '#3b82f6',
 *   approved: true,
 *   voteCount: 42,
 *   hasVoted: true,
 *   isOwnRequest: false,
 *   createdAt: '2026-07-20T10:00:00.000Z',
 *   updatedAt: '2026-08-01T15:30:00.000Z',
 * };
 * ```
 */
export interface FeatureRequestItem {
  /**
   * Unique feature request ID.
   */
  id: string;

  /**
   * Application ID that owns this request.
   */
  appId: string;

  /**
   * Title / summary of the proposed feature.
   */
  title: string;

  /**
   * Detailed description supporting markdown markup.
   */
  description: string;

  /**
   * Status slug corresponding to current column or state.
   */
  status: string;

  /**
   * Unique ID of the containing roadmap column if assigned.
   */
  columnId?: string | null;

  /**
   * Slug of the containing roadmap column if assigned.
   */
  columnSlug?: string | null;

  /**
   * Human-readable display name of the containing roadmap column.
   */
  columnName?: string | null;

  /**
   * Accent color of the column for badges and status indicators.
   */
  columnColor?: string | null;

  /**
   * Target milestone version ID if scheduled.
   */
  versionId?: string | null;

  /**
   * Target milestone version label (e.g. `"2.0.0"`).
   */
  versionLabel?: string | null;

  /**
   * Version label where this feature was released.
   */
  releasedVersion?: string | null;

  /**
   * Display name of the user who proposed this request.
   */
  requesterName?: string | null;

  /**
   * Avatar URL of the author.
   */
  requesterAvatarUrl?: string | null;

  /**
   * Clerk user ID of the author if authenticated.
   */
  requesterClerkId?: string | null;

  /**
   * Whether this item has been moderated and approved for public display.
   */
  approved: boolean;

  /**
   * Displayed total number of upvotes: votes cast in CupThread plus the
   * historical votes copied from the import source.
   *
   * {@link FeatureRequestItem.importedVotes} is already part of this number, so
   * render this value as-is and never add the imported portion on top of it.
   */
  voteCount: number;

  /**
   * Historical votes copied from the source provider at import time (GitHub
   * issues/discussions, Linear, Notion, Slack), already included in
   * {@link FeatureRequestItem.voteCount}.
   *
   * `0` for requests created in CupThread, and absent on payloads from before
   * the field was populated. Useful to label the historical portion of the
   * count (for example "124 votes · 120 imported").
   */
  importedVotes?: number;

  /**
   * Whether the currently active user/token has voted for this item.
   */
  hasVoted: boolean;

  /**
   * Whether the currently active user/token is the author of this request.
   */
  isOwnRequest: boolean;

  /**
   * Up to 3 recent discussion participants for avatar stack preview.
   */
  recentCommenters?: RecentCommenter[];

  /**
   * Whether additional commenters participated beyond the preview slice.
   */
  hasMoreCommenters?: boolean;

  /**
   * ISO 8601 creation timestamp.
   */
  createdAt: string;

  /**
   * ISO 8601 last update timestamp.
   */
  updatedAt: string;
}

/**
 * Draft payload for proposing a new feature request.
 *
 * @example
 * ```ts
 * const draft: FeatureRequestDraft = {
 *   title: 'Export data to CSV and JSON',
 *   description: 'Add an export button on the analytics screen to download raw metrics.',
 *   requesterName: 'Taylor',
 * };
 * ```
 */
export interface FeatureRequestDraft {
  /**
   * Proposed title (minimum 3 characters).
   */
  title: string;

  /**
   * Proposed description explaining use cases and benefits (minimum 5 characters).
   */
  description: string;

  /**
   * Optional author display name.
   */
  requesterName?: string;

  /**
   * Optional Cloudflare Turnstile token satisfying the human-verification gate
   * the production API enforces on intake endpoints. When omitted, the client
   * falls back to `FeedbackClientConfig.turnstileTokenProvider` (if configured).
   */
  turnstileToken?: string;
}

/**
 * Server response returned after creating a new feature request.
 *
 * @example
 * ```ts
 * const result: FeatureRequestSubmissionResult = {
 *   featureRequestId: 'fr_abc456',
 *   pending: false,
 * };
 * ```
 */
export interface FeatureRequestSubmissionResult {
  /**
   * Unique ID of the newly created feature request.
   */
  featureRequestId: string;

  /**
   * True if the request is queued for moderation before appearing publicly.
   */
  pending: boolean;
}

/**
 * Result returned after casting ({@link FeedbackClient.castVote}) or removing
 * ({@link FeedbackClient.removeVote}) an upvote on a feature request.
 *
 * @example
 * ```ts
 * const voteResult: VoteResult = {
 *   voted: true,
 *   voteCount: 15,
 * };
 * ```
 */
export interface VoteResult {
  /**
   * True if the user has an active vote after the operation; false if the vote was removed.
   */
  voted: boolean;

  /**
   * Displayed total after the toggle, using the same definition as
   * {@link FeatureRequestItem.voteCount}: in-app votes plus imported historical
   * votes.
   *
   * Treat it as the new total rather than a delta: removing a vote still leaves
   * the imported portion in place, and other votes may have landed since this
   * client last read the item.
   */
  voteCount: number;

  /**
   * Present when the vote was recorded but the optional ship-notification
   * opt-in was refused.
   *
   * On a board that requires sign-in, a `shipNotifyEmail` that is not one of
   * the session's verified addresses is discarded: the vote still counts, no
   * consent is stored, and no confirmation email is sent. Branch on
   * {@link VoteWarning.code} rather than the prose in `error`, and treat the
   * vote as saved.
   */
  warning?: VoteWarning;
}

/**
 * Non-fatal warning attached to a successful vote.
 *
 * @example
 * ```ts
 * if (vote.warning?.code === 'email_not_verified') {
 *   // The vote counted; ship notifications were not requested.
 * }
 * ```
 */
export interface VoteWarning {
  /**
   * Stable machine-readable reason.
   *
   * - `'email_not_verified'`: the supplied `shipNotifyEmail` is not one of the
   *   signed-in session's verified addresses, so ship notifications were not
   *   requested for it.
   */
  code: 'email_not_verified';

  /**
   * Human-readable explanation from the server.
   */
  error: string;
}

/**
 * Paginated list response of feature requests.
 *
 * @example
 * ```ts
 * const result: ListFeatureRequestsResult = {
 *   requests: [...],
 *   total: 48,
 * };
 * ```
 */
export interface ListFeatureRequestsResult {
  /**
   * Array of feature request items for current page.
   */
  requests: FeatureRequestItem[];

  /**
   * Total number of matching items across all pages.
   */
  total: number;
}

/**
 * Comment entry in a feature request discussion thread.
 *
 * @example
 * ```ts
 * const comment: FeatureRequestComment = {
 *   id: 'cmt_001',
 *   featureRequestId: 'fr_101',
 *   authorName: 'DevTeam',
 *   body: 'We have started working on this for the next minor release!',
 *   createdAt: '2026-08-20T09:00:00.000Z',
 * };
 * ```
 */
export interface FeatureRequestComment {
  /**
   * Unique comment ID.
   */
  id: string;

  /**
   * Parent feature request ID.
   */
  featureRequestId: string;

  /**
   * Display name of the author.
   */
  authorName?: string | null;

  /**
   * Email address of the author if provided.
   */
  authorEmail?: string | null;

  /**
   * Avatar URL of the author.
   */
  authorAvatarUrl?: string | null;

  /**
   * Clerk user ID of the author if authenticated.
   */
  authorClerkId?: string | null;

  /**
   * Comment body content (supports markdown).
   */
  body: string;

  /**
   * ID of the parent comment if this is a nested reply.
   */
  parentId?: string | null;

  /**
   * Clerk user ID of the user being replied to.
   */
  replyToClerkId?: string | null;

  /**
   * Display name of the user being replied to.
   */
  replyToAuthorName?: string | null;

  /**
   * Whether this comment has been hidden by moderation.
   */
  isHidden?: boolean;

  /**
   * ISO 8601 creation timestamp.
   */
  createdAt: string;
}

/**
 * Draft payload for posting a new comment or reply in a discussion thread.
 *
 * @example
 * ```ts
 * const commentDraft: CommentDraft = {
 *   body: 'This would also be super useful for iPad Split View!',
 *   authorName: 'Alex',
 * };
 * ```
 */
export interface CommentDraft {
  /**
   * Comment body text (supports markdown).
   */
  body: string;

  /**
   * Optional author display name.
   */
  authorName?: string;

  /**
   * Optional author email address.
   */
  authorEmail?: string;

  /**
   * Optional author avatar image URL.
   */
  authorAvatarUrl?: string;

  /**
   * Parent comment ID if replying in a thread.
   */
  parentId?: string;

  /**
   * Clerk user ID of the person being replied to.
   */
  replyToClerkId?: string;

  /**
   * Display name of the person being replied to.
   */
  replyToAuthorName?: string;
}

/**
 * Summary reference to a feature request that was resolved in a changelog release.
 *
 * @example
 * ```ts
 * const linked: ChangelogLinkedRequest = {
 *   id: 'fr_101',
 *   title: 'Dark Mode support on Android widgets',
 * };
 * ```
 */
export interface ChangelogLinkedRequest {
  /**
   * Feature request ID.
   */
  id: string;

  /**
   * Feature request title.
   */
  title: string;
}

/**
 * A published release note or changelog article.
 *
 * @example
 * ```ts
 * const entry: ChangelogEntry = {
 *   id: 'chg_v2',
 *   title: 'Version 2.0: Complete Redesign & Offline Sync',
 *   body: '### Highlights\n- Offline caching\n- Real-time updates',
 *   versionLabel: '2.0.0',
 *   publishedAt: '2026-08-01T12:00:00.000Z',
 *   linkedRequests: [{ id: 'fr_1', title: 'Offline mode' }],
 * };
 * ```
 */
export interface ChangelogEntry {
  /**
   * Unique changelog entry ID.
   */
  id: string;

  /**
   * Headline title of the release note.
   */
  title: string;

  /**
   * Full markdown content of the release announcement.
   */
  body: string;

  /**
   * Associated application release version label (e.g., `"2.0.0"`).
   */
  versionLabel?: string | null;

  /**
   * ISO 8601 publication timestamp.
   */
  publishedAt: string;

  /**
   * Feature requests closed or resolved by this release.
   */
  linkedRequests: ChangelogLinkedRequest[];
}

/**
 * Paginated list response of published changelog entries.
 *
 * Pass `nextCursor` to {@link FeedbackClient.listChangelog} to fetch the next page.
 *
 * @example
 * ```ts
 * const result: ListPublicChangelogResult = {
 *   entries: [{ id: 'chg_v2', title: 'Version 2.0', body: '...', publishedAt: '...', linkedRequests: [] }],
 *   hasMore: true,
 *   nextCursor: 'MjAyNi0w...',
 * };
 * ```
 */
export interface ListPublicChangelogResult {
  /**
   * Changelog entries for the current page, newest first.
   */
  entries: ChangelogEntry[];

  /**
   * True when more entries are available beyond this page.
   */
  hasMore: boolean;

  /**
   * Opaque keyset cursor for the next page, or `null` on the last page.
   */
  nextCursor: string | null;
}

/**
 * Response returned after subscribing an email address to changelog notifications.
 *
 * @example
 * ```ts
 * const subResult: ChangelogSubscriptionResult = {
 *   subscribed: true,
 *   alreadySubscribed: false,
 * };
 * ```
 */
export interface ChangelogSubscriptionResult {
  /**
   * Whether the subscription is active.
   */
  subscribed: boolean;

  /**
   * True if the email address was already subscribed prior to this call.
   */
  alreadySubscribed: boolean;
}

/**
 * Response returned after unsubscribing a changelog email subscription with a
 * signed token.
 *
 * @remarks
 * The response is uniform whether or not the subscription still existed, so a
 * `200` is final: a token that verifies for this app unsubscribes even after
 * its `exp` and even when the app has since disabled public surfaces. A
 * successful unsubscribe also revokes any ship-notification consent for the
 * same address, because those recipients receive the same changelog email.
 *
 * @example
 * ```ts
 * const unsubResult: ChangelogUnsubscribeResult = {
 *   unsubscribed: true,
 * };
 * ```
 */
export interface ChangelogUnsubscribeResult {
  /**
   * True if the address is no longer subscribed.
   */
  unsubscribed: boolean;
}

/**
 * Response returned after unsubscribing a workspace from the weekly digest
 * email with the signed token carried by that email.
 *
 * @remarks
 * The digest token is workspace-scoped, so this response belongs to the
 * workspace the token was minted for and not to an app key. A `200` is final:
 * the token is authenticated by signature, expiry, and workspace existence
 * only, so it keeps working after the owner's email changes or ownership is
 * transferred, and replaying it is idempotent. Only the workspace's
 * `weekly.digest` email event is cleared — inbox notifications are unchanged.
 *
 * @example
 * ```ts
 * const digestResult: DigestUnsubscribeResult = {
 *   unsubscribed: true,
 * };
 * ```
 */
export interface DigestUnsubscribeResult {
  /**
   * True if the workspace no longer receives the weekly digest email.
   */
  unsubscribed: boolean;
}

/**
 * Response returned after updating custom telemetry or business attributes for a user token.
 *
 * @example
 * ```ts
 * const attrResult: UserAttributesUpdateResult = {
 *   ok: true,
 *   updatedAt: '2026-09-01T10:00:00.000Z',
 * };
 * ```
 */
export interface UserAttributesUpdateResult {
  /**
   * True if user attributes were saved successfully.
   */
  ok: boolean;

  /**
   * ISO 8601 timestamp of the update.
   */
  updatedAt: string;
}

/**
 * Public developer or user profile details.
 *
 * @example
 * ```ts
 * const profile: PublicUserProfile = {
 *   clerkUserId: 'user_2xyz',
 *   displayName: 'Alice Engineer',
 *   bio: 'Building indie productivity apps.',
 *   websiteUrl: 'https://alice.dev',
 *   hideComments: false,
 *   createdAt: '2025-01-01T00:00:00.000Z',
 *   updatedAt: '2026-06-01T00:00:00.000Z',
 * };
 * ```
 */
export interface PublicUserProfile {
  /**
   * Clerk user ID of the profile subject.
   */
  clerkUserId: string;

  /**
   * Display name shown publicly.
   */
  displayName?: string | null;

  /**
   * Avatar image URL.
   */
  avatarUrl?: string | null;

  /**
   * Short user biography or tagline.
   */
  bio?: string | null;

  /**
   * Personal website or portfolio URL.
   */
  websiteUrl?: string | null;

  /**
   * Privacy setting indicating whether the user chooses to hide their comment history.
   */
  hideComments: boolean;

  /**
   * ISO 8601 creation timestamp.
   */
  createdAt: string;

  /**
   * ISO 8601 last update timestamp.
   */
  updatedAt: string;
}

/**
 * Summary representation of an application listed on a public user or developer profile.
 *
 * @example
 * ```ts
 * const app: PublicAppSummary = {
 *   id: 'app_1',
 *   name: 'Focus Timer Pro',
 *   slug: 'focus-timer-pro',
 *   description: 'Pomodoro timer with cloud sync',
 *   requestCount: 12,
 * };
 * ```
 */
export interface PublicAppSummary {
  /**
   * Application ID.
   */
  id: string;

  /**
   * Display name of the application.
   */
  name: string;

  /**
   * URL slug for the application.
   */
  slug: string;

  /**
   * CDN icon URL.
   */
  iconUrl?: string | null;

  /**
   * Short description of the application.
   */
  description?: string | null;

  /**
   * Total number of public feature requests for this application.
   */
  requestCount: number;
}

/**
 * Comment excerpt displayed in the public profile activity feed.
 *
 * @example
 * ```ts
 * const comment: UserProfileComment = {
 *   id: 'cmt_55',
 *   body: 'Agreed, native keyboard shortcuts are essential.',
 *   createdAt: '2026-08-10T14:00:00.000Z',
 *   featureRequestId: 'fr_101',
 *   featureRequestTitle: 'Custom Keybindings',
 *   appId: 'app_1',
 *   appName: 'Focus Timer Pro',
 * };
 * ```
 */
export interface UserProfileComment {
  /**
   * Unique comment ID.
   */
  id: string;

  /**
   * Comment text snippet.
   */
  body: string;

  /**
   * ISO 8601 timestamp when the comment was authored.
   */
  createdAt: string;

  /**
   * ID of the feature request where the comment was posted.
   */
  featureRequestId: string;

  /**
   * Title of the feature request where the comment was posted.
   */
  featureRequestTitle: string;

  /**
   * ID of the application owning the feature request.
   */
  appId: string;

  /**
   * Name of the application owning the feature request.
   */
  appName: string;
}

/**
 * Complete public profile payload including authored apps and recent public comments.
 *
 * @example
 * ```ts
 * const userProfile = await client.fetchUserProfile('user_abc123');
 * console.log(`User: ${userProfile.profile.displayName}, Apps: ${userProfile.apps.length}`);
 * ```
 */
export interface PublicUserProfileResult {
  /**
   * Profile core attributes (name, avatar, bio, website).
   */
  profile: PublicUserProfile;

  /**
   * List of public applications associated with this developer or team.
   */
  apps: PublicAppSummary[];

  /**
   * Recent public comments authored by this user across all apps.
   */
  recentComments: UserProfileComment[];

  /**
   * Whether the user has opted to hide recent comments on their public profile.
   */
  hideComments: boolean;
}
