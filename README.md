# CupThread React Native & Expo SDK

Official TypeScript SDK for React Native and Expo apps (iOS, Android, and Web).

Part of the [CupThread.com](https://cupthread.com) platform.

## CupThread Ecosystem
- 🌐 [CupThread.com](https://cupthread.com) — Feedback SaaS platform, developer console, and API.
- 🍏 [CupThread/CupThreadSwiftSDK](https://github.com/CupThread/CupThreadSwiftSDK) — Apple platform SDK (SwiftUI / SPM / XCFramework).
- 🤖 [CupThread/CupThreadAndroidSDK](https://github.com/CupThread/CupThreadAndroidSDK) — Android SDK (Jetpack Compose / Maven).
- ⚛️ [CupThread/CupThreadReactNativeSDK](https://github.com/CupThread/CupThreadReactNativeSDK) — React Native & Expo SDK (TypeScript).
- 💙 [CupThread/CupThreadFlutterSDK](https://github.com/CupThread/CupThreadFlutterSDK) — Flutter SDK (Dart).
- 🧠 [CupThread/CupThreadAgenticCoding](https://github.com/CupThread/CupThreadAgenticCoding) — AI-friendly CLI & Skills for pair programming.

## 🤖 Agentic Coding Friendly

This repository is designed from the ground up to be **Agentic Coding friendly** for LLMs, coding agents, and pair programmers:
- **Zero native binary dependencies**: Pure TypeScript / React Native component tree that runs deterministically across bare React Native and Expo without native rebuilds or pod linking.
- **Strict type consistency**: Full alignment with CupThread Public API schemas.
- **Comprehensive documentation**: JSDoc symbol docs, clean props, and usage examples.
- **AI skills & pair programming tooling**: Companion skills, CLI tools, and agent workflows are maintained in [CupThread/CupThreadAgenticCoding](https://github.com/CupThread/CupThreadAgenticCoding).

---

## Installation

```sh
# npm
npm install @cupthread/react-native

# yarn
yarn add @cupthread/react-native

# pnpm
pnpm add @cupthread/react-native

# expo
npx expo install @cupthread/react-native
```

---

## Quick Start

```tsx
import React from 'react';
import {
  FeedbackClient,
  CupThreadProvider,
  RoadmapBoardScreen,
  FeatureRequestsScreen,
  WhatsNewScreen,
  ChangelogOverlay,
} from '@cupthread/react-native';

const client = new FeedbackClient({
  baseUrl: 'https://api.cupthread.com',
  appKey: 'app_xxx', // from your CupThread Developer Console
});

export default function App() {
  return (
    <CupThreadProvider client={client}>
      <RoadmapBoardScreen />
    </CupThreadProvider>
  );
}
```

---

## Ready-Made React Native Screens & Components

Wrap your app or screen in `<CupThreadProvider client={client}>` to automatically inherit developer console appearance settings, color palette, and anonymous user token.

- **`<RoadmapBoardScreen />`**: Kanban roadmap board grouped by public columns with vote counts and stage badges.
- **`<FeatureRequestsScreen />`**: Searchable feature requests list with optimistic upvoting, version filter chips, and propose feature modal.
- **`<WhatsNewScreen />`**: Interactive release notes / changelog with Markdown formatting and email subscription.
- **`<ChangelogOverlay visible={...} onClose={...} />`**: In-app modal announcement sheet for the latest release notes.
- **`<FeedbackComposer visible={...} onClose={...} />`**: Structured feedback form with attachment uploads.
- **`<UserProfileScreen userId={...} />`**: Public user/developer profile screen.

### Example: Presenting Latest Changelog on Launch

```tsx
import React, { useState } from 'react';
import { View, Button } from 'react-native';
import { CupThreadProvider, ChangelogOverlay, FeedbackClient } from '@cupthread/react-native';

const client = new FeedbackClient({
  baseUrl: 'https://api.cupthread.com',
  appKey: 'app_xxx',
});

export function MainScreen() {
  const [showChangelog, setShowChangelog] = useState(false);

  return (
    <CupThreadProvider client={client}>
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <Button title="What's New" onPress={() => setShowChangelog(true)} />
        <ChangelogOverlay visible={showChangelog} onClose={() => setShowChangelog(false)} />
      </View>
    </CupThreadProvider>
  );
}
```

---

## API Client Surface

| Method | Endpoint | Description |
| ------ | -------- | ----------- |
| `submit(draft, userToken?)` | `POST /api/v1/feedback` | Submit feedback draft with metadata and attachments |
| `uploadAttachment(options)` | `POST /api/v1/uploads/{images,r2}` | Upload screenshot or log attachment |
| `fetchAppConfig()` | `GET /api/v1/public/config/{appKey}` | Fetch app branding, appearance, and public settings |
| `fetchColumns()` | `GET /api/v1/public/columns/{appKey}` | Fetch Kanban board columns for roadmap |
| `fetchVersions()` | `GET /api/v1/public/versions/{appKey}` | Fetch release versions |
| `fetchFeatureRequests(options)` | `GET /api/v1/feature-requests` | List and search public feature requests |
| `submitFeatureRequest(draft, userToken)` | `POST /api/v1/feature-requests` | Propose a new feature request |
| `toggleVote(featureRequestId, userToken)` | `POST /api/v1/feature-requests/{id}/vote` | Upvote or remove upvote |
| `fetchComments(featureRequestId)` | `GET /api/v1/feature-requests/{id}/comments` | Fetch discussion comments |
| `postComment(featureRequestId, draft, userToken)` | `POST /api/v1/feature-requests/{id}/comments` | Post a comment or reply |
| `fetchChangelog()` | `GET /api/v1/public/apps/{appKey}/changelog` | Fetch published release notes |
| `subscribeToChangelog(email, userToken)` | `POST /api/v1/public/apps/{appKey}/changelog/subscribe` | Subscribe email to changelog |
| `unsubscribeFromChangelog(email)` | `POST /api/v1/public/apps/{appKey}/changelog/unsubscribe` | Unsubscribe email from changelog |
| `updateUserAttributes(options)` | `PUT /api/v1/public/apps/{appKey}/user` | Report user attributes (paying, plan, MRR) |
| `fetchUserProfile(userId)` | `GET /api/v1/users/{userId}/profile` | Fetch public user profile |

---

## Development & Testing

```sh
# Typecheck TypeScript
npm run typecheck

# Run unit tests
npm test

# Build package
npm run build
```

## License
MIT
