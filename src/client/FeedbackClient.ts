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
  SdkAppearance,
  UserAttributesUpdateResult,
  VoteResult,
} from '../types/index.ts';
import {
  AuthenticationRequiredException,
  InvalidResponseException,
  UnexpectedStatusException,
  UnreadableUploadResponseException,
} from './FeedbackException.ts';
import { getRuntimePlatform } from '../utils/platform.ts';
import { iso8601Now } from '../utils/formatters.ts';

export interface UploadAttachmentOptions {
  file: any;
  filename: string;
  mimeType: string;
  preferredKind?: 'image' | 'r2';
}

export class FeedbackClient {
  public readonly config: FeedbackClientConfig;

  constructor(config: FeedbackClientConfig) {
    this.config = {
      baseUrl: config.baseUrl.replace(/\/+$/, ''),
      appKey: config.appKey,
      defaultPlatform: config.defaultPlatform || getRuntimePlatform(),
    };
  }

  public async submit(draft: FeedbackDraft, userToken?: string): Promise<FeedbackSubmissionResult> {
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
      userToken,
      accepted: [200, 201, 202],
    });
  }

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
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        body: formData,
      });
    } catch (err) {
      throw new InvalidResponseException('Network failure while uploading attachment', err);
    }

    if (response.status !== 200 && response.status !== 201) {
      const text = await response.text().catch(() => '');
      throw new UnexpectedStatusException(response.status, text);
    }

    try {
      const json = await response.json();
      return {
        kind: json.kind || kind,
        key: json.key || json.id,
        url: json.url,
        filename: json.filename || options.filename,
        mimeType: json.mimeType || options.mimeType,
        size: json.size,
      };
    } catch {
      throw new UnreadableUploadResponseException();
    }
  }

  public async fetchAppConfig(): Promise<PublicAppConfig> {
    return this.request<PublicAppConfig>({
      method: 'GET',
      path: `/api/v1/public/config/${this.config.appKey}`,
    });
  }

  public async fetchColumns(): Promise<BoardColumn[]> {
    const res = await this.request<{ columns: BoardColumn[] }>({
      method: 'GET',
      path: `/api/v1/public/columns/${this.config.appKey}`,
    });
    return (res.columns || []).sort((a, b) => a.position - b.position);
  }

  public async fetchVersions(): Promise<AppVersion[]> {
    const res = await this.request<{ versions: AppVersion[] }>({
      method: 'GET',
      path: `/api/v1/public/versions/${this.config.appKey}`,
    });
    return (res.versions || []).sort((a, b) => a.position - b.position);
  }

  public async fetchFeatureRequests(options: {
    userToken: string;
    limit?: number;
    offset?: number;
    versionId?: string;
    query?: string;
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
    });
  }

  public async submitFeatureRequest(
    draft: FeatureRequestDraft,
    userToken: string
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
    });
  }

  public async toggleVote(featureRequestId: string, userToken: string): Promise<VoteResult> {
    return this.request<VoteResult>({
      method: 'POST',
      path: `/api/v1/feature-requests/${featureRequestId}/vote`,
      body: {
        appKey: this.config.appKey,
        userToken,
      },
      accepted: [200],
    });
  }

  public async fetchComments(featureRequestId: string): Promise<FeatureRequestComment[]> {
    const res = await this.request<{ comments: FeatureRequestComment[] }>({
      method: 'GET',
      path: `/api/v1/feature-requests/${featureRequestId}/comments`,
    });
    return res.comments || [];
  }

  public async postComment(
    featureRequestId: string,
    draft: CommentDraft,
    userToken: string
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
    });
  }

  public async fetchChangelog(): Promise<ChangelogEntry[]> {
    const res = await this.request<{ entries: ChangelogEntry[] }>({
      method: 'GET',
      path: `/api/v1/public/apps/${this.config.appKey}/changelog`,
    });
    return (res.entries || []).sort(
      (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
    );
  }

  public async prepareChangelogOverlay(): Promise<{
    entries: ChangelogEntry[];
    appearance: SdkAppearance;
  } | null> {
    const config = await this.fetchAppConfig();
    if (!config.sdk?.features?.changelog) return null;
    const limit = Math.min(Math.max(config.sdk.changelogOverlay?.entryCount || 3, 1), 10);
    const all = await this.fetchChangelog();
    const entries = all.slice(0, limit);
    if (entries.length === 0) return null;
    return {
      entries,
      appearance: config.sdk,
    };
  }

  public async subscribeToChangelog(
    email: string,
    userToken: string
  ): Promise<ChangelogSubscriptionResult> {
    return this.request<ChangelogSubscriptionResult>({
      method: 'POST',
      path: `/api/v1/public/apps/${this.config.appKey}/changelog/subscribe`,
      body: { email: email.trim() },
      userToken,
      accepted: [200, 201],
    });
  }

  public async unsubscribeFromChangelog(email: string): Promise<ChangelogUnsubscribeResult> {
    return this.request<ChangelogUnsubscribeResult>({
      method: 'POST',
      path: `/api/v1/public/apps/${this.config.appKey}/changelog/unsubscribe`,
      body: { email: email.trim() },
      accepted: [200],
    });
  }

  public async updateUserAttributes(options: {
    userToken: string;
    isPaying?: boolean;
    plan?: string;
    mrr?: number;
    currency?: string;
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
    });
  }

  public async fetchUserProfile(userId: string): Promise<PublicUserProfileResult> {
    return this.request<PublicUserProfileResult>({
      method: 'GET',
      path: `/api/v1/users/${userId}/profile`,
    });
  }

  private async request<T>(options: {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    path: string;
    body?: any;
    userToken?: string;
    accepted?: number[];
  }): Promise<T> {
    const url = `${this.config.baseUrl}${options.path}`;
    const headers: Record<string, string> = {};

    if (options.body) {
      headers['Content-Type'] = 'application/json';
    }
    if (options.userToken) {
      headers['X-User-Token'] = options.userToken;
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
    } catch (err) {
      throw new InvalidResponseException(`Network request failed for ${url}`, err);
    }

    const accepted = options.accepted || [200];
    if (!accepted.includes(response.status)) {
      if (response.status === 401) {
        throw new AuthenticationRequiredException();
      }
      const errText = await response.text().catch(() => '');
      throw new UnexpectedStatusException(response.status, errText);
    }

    const text = await response.text().catch(() => '');
    if (!text) {
      return {} as T;
    }

    try {
      return JSON.parse(text) as T;
    } catch (err) {
      throw new InvalidResponseException(`Failed to parse JSON response from ${url}`, err);
    }
  }
}
