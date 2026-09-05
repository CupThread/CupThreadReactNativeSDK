/**
 * Common recurring UI text strings across CupThread SDK views.
 */
export interface CommonStrings {
  back: string;
  close: string;
  cancel: string;
  confirm: string;
  loading: string;
  loadingMore: string;
  submitting: string;
  error: string;
  retry: string;
  optional: string;
  required: string;
  anonymous: string;
  invalidEmail: string;
  submitFailed: string;
  justNow: string;
  minutesAgo: (m: number) => string;
  hoursAgo: (h: number) => string;
  daysAgo: (d: number) => string;
}

/**
 * Localized strings for the FeedbackComposer component.
 */
export interface FeedbackComposerStrings {
  title: string;
  titleLabel: string;
  titlePlaceholder: string;
  detailsLabel: string;
  detailsPlaceholder: string;
  nameLabel: string;
  namePlaceholder: string;
  emailLabel: string;
  emailPlaceholder: string;
  submitButton: string;
  successTitle: string;
  successMessage: string;
  titleMinLengthError: string;
  descriptionMinLengthError: string;
  addAttachment: string;
  uploadingAttachment: string;
  removeAttachment: string;
  attachmentsHeader: string;
  uploadFailed: string;
  submitFailed: string;
}

/**
 * Localized strings for the FeatureRequestsScreen component.
 */
export interface FeatureRequestsStrings {
  screenTitle: string;
  newButton: string;
  searchPlaceholder: string;
  allVersions: string;
  emptyTitle: string;
  emptySubtitle: string;
  proposeButton: string;
  moreCommenters: string;
  upvoted: string;
  upvote: string;
  loadingMore: string;
}

/**
 * Localized strings for the FeatureRequestComposeSheet modal.
 */
export interface FeatureRequestComposeStrings {
  modalTitle: string;
  titleLabel: string;
  titlePlaceholder: string;
  descriptionLabel: string;
  descriptionPlaceholder: string;
  nameLabel: string;
  namePlaceholder: string;
  submitButton: string;
  successTitle: string;
  successMessage: string;
  moderationNotice: string;
  titleMinLengthError: string;
  descriptionMinLengthError: string;
  submitFailed: string;
}

/**
 * Localized strings for the RoadmapBoardScreen component.
 */
export interface RoadmapStrings {
  screenTitle: string;
  searchPlaceholder: string;
  emptyColumn: string;
  upvotesCount: (count: number) => string;
  loadingMore: string;
  loadMore: string;
  showingCount: (shown: number, total: number) => string;
}

/**
 * Localized strings for the FeatureRequestDetail view.
 */
export interface FeatureRequestDetailStrings {
  title: string;
  proposedBy: string;
  releasedIn: string;
  underReview: string;
  discussionHeader: string;
}

/**
 * Localized strings for the CommentsSection component.
 */
export interface CommentsStrings {
  commentsCount: (count: number) => string;
  emptyComments: string;
  inputPlaceholder: string;
  namePlaceholder: string;
  postButton: string;
  postingButton: string;
  replyButton: string;
  replyingTo: (name: string) => string;
  cancelReply: string;
  postFailed: string;
}

/**
 * Localized strings for Changelog and What's-New views.
 */
export interface ChangelogStrings {
  overlayTitle: string;
  continueButton: string;
  closeButton: string;
  emptyChangelog: string;
  subscribeTitle: string;
  subscribeSubtitle: string;
  subscribeButton: string;
  subscribing: string;
  emailPlaceholder: string;
  subscribedSuccess: string;
  unsubscribeButton: string;
  subscribeFailed: string;
}

/**
 * Localized strings for the UserProfileScreen component.
 */
export interface UserProfileStrings {
  screenTitle: string;
  activityTitle: string;
  noActivity: string;
  loadFailed: string;
  notFound: string;
  anonymous: string;
  recentComments: string;
  appsSection: (count: number) => string;
  requestCount: (count: number) => string;
  commentOn: (title: string) => string;
}

/**
 * Complete localization dictionary structure for CupThread SDK.
 */
export interface CupThreadStrings {
  common: CommonStrings;
  feedbackComposer: FeedbackComposerStrings;
  featureRequests: FeatureRequestsStrings;
  featureRequestCompose: FeatureRequestComposeStrings;
  roadmap: RoadmapStrings;
  featureRequestDetail: FeatureRequestDetailStrings;
  comments: CommentsStrings;
  changelog: ChangelogStrings;
  userProfile: UserProfileStrings;
}

/**
 * Recursive partial helper allowing callers to override individual strings.
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object
    ? T[P] extends (...args: any[]) => any
      ? T[P]
      : DeepPartial<T[P]>
    : T[P];
};
