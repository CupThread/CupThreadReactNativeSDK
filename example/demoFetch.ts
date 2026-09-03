const now = '2026-09-01T12:00:00.000Z';

const config = {
  appId: 'app_showcase',
  appKey: 'app_showcase',
  slug: 'cupthread-showcase',
  name: 'CupThread Showcase',
  storeUrl: null,
  storeKind: null,
  iconUrl: null,
  allowPublic: true,
  allowedPlatforms: ['ios', 'android', 'web'],
  maxAttachmentBytes: 10_000_000,
  allowAnonymousRoadmap: true,
  allowAnonymousVote: true,
  allowAnonymousFeedback: true,
  allowAnonymousChangelog: true,
  sdk: {
    theme: 'ocean',
    features: { feedback: true, featureRequests: true, roadmap: true, changelog: true },
    changelogOverlay: {
      title: "What's new in CupThread",
      subtitle: 'A clearer way to listen, prioritize, and ship.',
      entryCount: 2,
      primaryButton: 'Got it',
      closeButton: 'Close',
    },
  },
};

const columns = [
  { id: 'col-review', appId: 'app_showcase', name: 'Under Review', slug: 'under-review', position: 1, isVisible: true, isSystem: false, kind: 'pending_review', color: '#f59e0b', createdAt: now, updatedAt: now },
  { id: 'col-progress', appId: 'app_showcase', name: 'In Progress', slug: 'in-progress', position: 2, isVisible: true, isSystem: false, kind: 'normal', color: '#0d9488', createdAt: now, updatedAt: now },
  { id: 'col-shipped', appId: 'app_showcase', name: 'Shipped', slug: 'shipped', position: 3, isVisible: true, isSystem: false, kind: 'done', color: '#2563eb', createdAt: now, updatedAt: now },
];

const requests = [
  { id: 'fr-export', appId: 'app_showcase', title: 'Export roadmap updates as CSV', description: 'Create a shareable report for weekly product reviews and stakeholder updates.', status: 'in-progress', columnId: 'col-progress', columnSlug: 'in-progress', columnName: 'In Progress', columnColor: '#0d9488', versionId: 'ver-2', versionLabel: '2.4.0', releasedVersion: null, requesterName: 'Mina Chen', requesterAvatarUrl: null, requesterClerkId: null, approved: true, voteCount: 48, hasVoted: false, isOwnRequest: false, recentCommenters: [], hasMoreCommenters: false, createdAt: now, updatedAt: now },
  { id: 'fr-digest', appId: 'app_showcase', title: 'Weekly feedback digest', description: 'Send a concise summary of votes, requests, and status changes to the product team.', status: 'under-review', columnId: 'col-review', columnSlug: 'under-review', columnName: 'Under Review', columnColor: '#f59e0b', versionId: null, versionLabel: null, releasedVersion: null, requesterName: 'Jordan Lee', requesterAvatarUrl: null, requesterClerkId: null, approved: true, voteCount: 31, hasVoted: true, isOwnRequest: false, recentCommenters: [], hasMoreCommenters: false, createdAt: now, updatedAt: now },
  { id: 'fr-sso', appId: 'app_showcase', title: 'Single sign-on for larger teams', description: 'Support SAML-based sign-in and centralized team management.', status: 'shipped', columnId: 'col-shipped', columnSlug: 'shipped', columnName: 'Shipped', columnColor: '#2563eb', versionId: 'ver-1', versionLabel: '2.3.0', releasedVersion: '2.3.0', requesterName: 'Taylor Kim', requesterAvatarUrl: null, requesterClerkId: null, approved: true, voteCount: 76, hasVoted: false, isOwnRequest: false, recentCommenters: [], hasMoreCommenters: false, createdAt: now, updatedAt: now },
];

const entries = [
  { id: 'change-24', title: 'Faster roadmap triage', body: 'New status filters make it easier to turn customer feedback into a focused plan.', versionLabel: '2.4.0', publishedAt: now, linkedRequests: [{ id: 'fr-export', title: 'Export roadmap updates as CSV' }] },
  { id: 'change-23', title: 'Team feedback workspace', body: 'Share, discuss, and prioritize feature requests with your team in one place.', versionLabel: '2.3.0', publishedAt: '2026-08-15T12:00:00.000Z', linkedRequests: [{ id: 'fr-sso', title: 'Single sign-on for larger teams' }] },
];

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

export function installDemoFetch(): void {
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === 'string' ? input : input.toString());
    const { pathname } = url;
    if (pathname.includes('/public/config/')) return response(config);
    if (pathname.includes('/public/columns/')) return response({ columns });
    if (pathname.includes('/public/versions/')) return response({ versions: [
      { id: 'ver-2', appId: 'app_showcase', label: '2.4.0', position: 1, released: false, releasedAt: null, description: null, createdAt: now, updatedAt: now },
      { id: 'ver-1', appId: 'app_showcase', label: '2.3.0', position: 2, released: true, releasedAt: now, description: null, createdAt: now, updatedAt: now },
    ] });
    if (pathname.endsWith('/changelog')) return response({ entries });
    if (pathname.endsWith('/changelog/subscribe')) return response({ subscribed: true, alreadySubscribed: false });
    if (pathname.includes('/feature-requests/') && pathname.endsWith('/vote')) return response({ voted: true, voteCount: 49 });
    if (pathname.endsWith('/feature-requests')) return response({ items: requests, total: requests.length, limit: 50, offset: 0 });
    if (pathname.endsWith('/feedback')) return response({ submissionId: 'submission-showcase', forwardedToGithub: false });
    return response({});
  };
}
