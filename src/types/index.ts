/**
 * Supported platforms in CupThread API.
 */
export type FeedbackPlatform = 'ios' | 'macos' | 'android' | 'universal' | 'web';

/**
 * Configuration options for initializing FeedbackClient.
 */
export interface FeedbackClientConfig {
  /**
   * API root URL, e.g. "https://api.cupthread.com". Must not have trailing slash.
   */
  baseUrl: string;
  /**
   * App Key from CupThread Developer Console ("app_...").
   */
  appKey: string;
  /**
   * Default platform reported on feedback drafts if not specified.
   */
  defaultPlatform?: FeedbackPlatform;
}

/**
 * An uploaded attachment descriptor.
 */
export interface FeedbackAttachment {
  /**
   * Storage backend kind: "image" or "r2".
   */
  kind: 'image' | 'r2';
  /**
   * Server storage key.
   */
  key: string;
  /**
   * Public URL for viewing or downloading the attachment.
   */
  url: string;
  /**
   * Original file name if provided.
   */
  filename?: string;
  /**
   * MIME type if provided.
   */
  mimeType?: string;
  /**
   * Size in bytes if reported by the server.
   */
  size?: number;
}

/**
 * Draft content for submitting in-app user feedback.
 */
export interface FeedbackDraft {
  /**
   * Short feedback title / summary (min 3 characters).
   */
  title: string;
  /**
   * Detailed feedback description (min 5 characters).
   */
  description: string;
  /**
   * Optional display name of reporter.
   */
  reporterName?: string;
  /**
   * Optional reporter email address.
   */
  reporterEmail?: string;
  /**
   * Client platform (defaults to current OS or configured default).
   */
  platform?: FeedbackPlatform;
  /**
   * Host application version name (e.g. "1.2.0").
   */
  appVersion?: string;
  /**
   * Host application build number (e.g. "42").
   */
  buildNumber?: string;
  /**
   * Custom key-value metadata to attach to the submission.
   */
  metadata?: Record<string, string>;
  /**
   * Pre-uploaded file attachments.
   */
  attachments?: FeedbackAttachment[];
}

/**
 * Result returned after successful feedback submission.
 */
export interface FeedbackSubmissionResult {
  submissionId: string;
  forwardedToGithub: boolean;
  githubDiscussionId?: string;
  githubDiscussionUrl?: string;
  warning?: string;
}

/**
 * Theme names supported in CupThread console.
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
 */
export interface SdkFeatures {
  feedback: boolean;
  featureRequests: boolean;
  roadmap: boolean;
  changelog: boolean;
}

/**
 * Configuration for the in-app What's-New changelog overlay.
 */
export interface ChangelogOverlayConfig {
  title: string;
  subtitle?: string;
  entryCount: number;
  primaryButton: string;
  closeButton: string;
}

/**
 * Developer console-configured appearance for SDK surfaces.
 */
export interface SdkAppearance {
  theme: SdkTheme;
  features: SdkFeatures;
  changelogOverlay: ChangelogOverlayConfig;
}

/**
 * Public app configuration served by GET /api/v1/public/config/:appKey.
 */
export interface PublicAppConfig {
  appId: string;
  appKey: string;
  slug: string;
  name: string;
  storeUrl?: string | null;
  storeKind?: string | null;
  iconUrl?: string | null;
  allowPublic: boolean;
  allowedPlatforms: FeedbackPlatform[];
  maxAttachmentBytes: number;
  allowAnonymousRoadmap: boolean;
  allowAnonymousVote: boolean;
  allowAnonymousFeedback: boolean;
  allowAnonymousChangelog: boolean;
  sdk: SdkAppearance;
}

/**
 * Semantic kind of roadmap column.
 */
export type BoardColumnKind = 'pending_review' | 'normal' | 'done';

/**
 * Kanban board column on the roadmap.
 */
export interface BoardColumn {
  id: string;
  appId: string;
  name: string;
  slug: string;
  position: number;
  isVisible: boolean;
  isSystem: boolean;
  kind: BoardColumnKind;
  color?: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Release version of the application.
 */
export interface AppVersion {
  id: string;
  appId: string;
  label: string;
  position: number;
  released: boolean;
  releasedAt?: string | null;
  description?: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Recent commenter in feature request card avatar stack.
 */
export interface RecentCommenter {
  authorName?: string | null;
  clerkUserId?: string | null;
  avatarUrl?: string | null;
}

/**
 * Feature request item returned by list endpoints.
 */
export interface FeatureRequestItem {
  id: string;
  appId: string;
  title: string;
  description: string;
  status: string;
  columnId?: string | null;
  columnSlug?: string | null;
  columnName?: string | null;
  columnColor?: string | null;
  versionId?: string | null;
  versionLabel?: string | null;
  releasedVersion?: string | null;
  requesterName?: string | null;
  requesterAvatarUrl?: string | null;
  requesterClerkId?: string | null;
  approved: boolean;
  voteCount: number;
  hasVoted: boolean;
  isOwnRequest: boolean;
  recentCommenters?: RecentCommenter[];
  hasMoreCommenters?: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Draft content for proposing a new feature request.
 */
export interface FeatureRequestDraft {
  title: string;
  description: string;
  requesterName?: string;
}

/**
 * Result of submitting a feature request.
 */
export interface FeatureRequestSubmissionResult {
  featureRequestId: string;
  pending: boolean;
}

/**
 * Result of toggling an upvote on a feature request.
 */
export interface VoteResult {
  voted: boolean;
  voteCount: number;
}

/**
 * Paged list response for feature requests.
 */
export interface ListFeatureRequestsResult {
  requests: FeatureRequestItem[];
  total: number;
}

/**
 * Comment on a feature request.
 */
export interface FeatureRequestComment {
  id: string;
  featureRequestId: string;
  authorName?: string | null;
  authorEmail?: string | null;
  authorAvatarUrl?: string | null;
  authorClerkId?: string | null;
  body: string;
  parentId?: string | null;
  replyToClerkId?: string | null;
  replyToAuthorName?: string | null;
  isHidden?: boolean;
  createdAt: string;
}

/**
 * Draft for posting a new comment or reply.
 */
export interface CommentDraft {
  body: string;
  authorName?: string;
  authorEmail?: string;
  authorAvatarUrl?: string;
  parentId?: string;
  replyToClerkId?: string;
  replyToAuthorName?: string;
}

/**
 * Feature request linked to a changelog entry.
 */
export interface ChangelogLinkedRequest {
  id: string;
  title: string;
}

/**
 * A published changelog release note entry.
 */
export interface ChangelogEntry {
  id: string;
  title: string;
  body: string;
  versionLabel?: string | null;
  publishedAt: string;
  linkedRequests: ChangelogLinkedRequest[];
}

/**
 * Result of subscribing to changelog email updates.
 */
export interface ChangelogSubscriptionResult {
  subscribed: boolean;
  alreadySubscribed: boolean;
}

/**
 * Result of unsubscribing from changelog email updates.
 */
export interface ChangelogUnsubscribeResult {
  unsubscribed: boolean;
}

/**
 * Result of reporting user attributes.
 */
export interface UserAttributesUpdateResult {
  ok: boolean;
  updatedAt: string;
}

/**
 * Public profile of a user or app developer.
 */
export interface PublicUserProfile {
  clerkUserId: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  websiteUrl?: string | null;
  hideComments: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Summary of a public app shown on a profile page.
 */
export interface PublicAppSummary {
  id: string;
  name: string;
  slug: string;
  iconUrl?: string | null;
  description?: string | null;
  requestCount: number;
}

/**
 * Comment preview on a user profile.
 */
export interface UserProfileComment {
  id: string;
  body: string;
  createdAt: string;
  featureRequestId: string;
  featureRequestTitle: string;
  appId: string;
  appName: string;
}

/**
 * Full public user profile response.
 */
export interface PublicUserProfileResult {
  profile: PublicUserProfile;
  apps: PublicAppSummary[];
  recentComments: UserProfileComment[];
  hideComments: boolean;
}
