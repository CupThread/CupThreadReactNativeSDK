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
   */
  baseUrl: string;

  /**
   * Unique application key generated in the CupThread Developer Console.
   * Typically starts with the `"app_"` prefix.
   */
  appKey: string;

  /**
   * Default platform reported on feedback submissions and requests when
   * not explicitly overridden by the caller.
   *
   * @defaultValue Auto-detected at runtime via React Native `Platform.OS`
   */
  defaultPlatform?: FeedbackPlatform;
}

/**
 * Metadata describing an uploaded media or log file attachment.
 *
 * @remarks
 * Attachments are uploaded via {@link FeedbackClient.uploadAttachment} prior
 * to submitting a feedback draft.
 *
 * @example
 * ```ts
 * const attachment: FeedbackAttachment = {
 *   kind: 'image',
 *   key: 'uploads/2026/09/screen-01.png',
 *   url: 'https://cdn.cupthread.com/uploads/2026/09/screen-01.png',
 *   filename: 'screen-01.png',
 *   mimeType: 'image/png',
 *   size: 204800,
 * };
 * ```
 */
export interface FeedbackAttachment {
  /**
   * Storage backend driver kind:
   * - `'image'`: Standard image CDN optimization pipeline.
   * - `'r2'`: Cloudflare R2 object storage for logs, archives, and diagnostics.
   */
  kind: 'image' | 'r2';

  /**
   * Unique storage identifier or object key on the remote storage cluster.
   */
  key: string;

  /**
   * Direct, publicly-accessible URL for viewing or downloading the attachment.
   */
  url: string;

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
   */
  attachments?: FeedbackAttachment[];
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
  | 'system'
  | 'light'
  | 'dark'
  | 'midnight'
  | 'ocean'
  | 'forest'
  | 'sunset'
  | 'candy';

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
   * Total number of upvotes received.
   */
  voteCount: number;

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
 * Result returned after toggling an upvote on a feature request.
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
   * True if the vote was added; false if previously active vote was removed.
   */
  voted: boolean;

  /**
   * Updated total vote count for the feature request.
   */
  voteCount: number;
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
 * Response returned after unsubscribing an email address from changelog updates.
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
   * True if the email was successfully removed from the mailing list.
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
