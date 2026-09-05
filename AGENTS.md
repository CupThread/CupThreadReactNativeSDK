# AGENTS.md — CupThread React Native SDK

## Repository Purpose
`CupThreadReactNativeSDK` is the official React Native & Expo SDK for [CupThread.com](https://cupthread.com) (TypeScript, React Native 0.70+, Expo compatible).

## Multi-Repo Ecosystem
- **CupThread Platform**: [`CupThread.com`](https://cupthread.com) (Main SaaS website & backend API)
- **Apple SDK**: [`CupThread/CupThreadSwiftSDK`](https://github.com/CupThread/CupThreadSwiftSDK) (SwiftUI / SPM / XCFramework)
- **Android SDK**: [`CupThread/CupThreadAndroidSDK`](https://github.com/CupThread/CupThreadAndroidSDK) (Kotlin + Jetpack Compose)
- **React Native SDK**: [`CupThread/CupThreadReactNativeSDK`](https://github.com/CupThread/CupThreadReactNativeSDK) (TypeScript + React Native)
- **Flutter SDK**: [`CupThread/CupThreadFlutterSDK`](https://github.com/CupThread/CupThreadFlutterSDK) (Dart + Flutter)
- **Agentic Coding & CLI**: [`CupThread/CupThreadAgenticCoding`](https://github.com/CupThread/CupThreadAgenticCoding) (AI Skills, CLI tools)

## Agentic Coding Friendly
This repository is optimized for autonomous agents and LLM pair programmers. AI Skills, CLI integrations, and agent workflows for working across CupThread repositories are available at [`CupThread/CupThreadAgenticCoding`](https://github.com/CupThread/CupThreadAgenticCoding).

## Architecture & API Contract
- Public endpoints live under `/api/v1/public/*` and `/api/v1/*` on `https://api.cupthread.com`:
  - `GET /api/v1/public/config/:appKey` — App configuration, theme, allowed platforms, changelog copy.
  - `GET /api/v1/public/columns/:appKey` — Kanban board columns for roadmap.
  - `GET /api/v1/public/versions/:appKey` — App release versions.
  - `GET /api/v1/public/apps/:appKey/changelog` — Published release notes & changelog entries.
  - `POST /api/v1/public/apps/:appKey/changelog/subscribe` — Email subscription.
  - `POST /api/v1/public/apps/:appKey/changelog/unsubscribe` — Unsubscribe from updates.
  - `PUT /api/v1/public/apps/:appKey/user` — Report user attributes (paying status, MRR).
  - `GET /api/v1/feature-requests` — Feature requests list, search (`q`), and pagination (`limit`, `offset`, `versionId`).
  - `POST /api/v1/feature-requests` — Submit new feature request.
  - `POST /api/v1/feature-requests/:id/vote` — Toggle vote on a feature request.
  - `GET /api/v1/feature-requests/:id/comments` — List discussion comments on a feature request.
  - `POST /api/v1/feature-requests/:id/comments` — Post a comment or reply on a feature request.
  - `GET /api/v1/users/:userId/profile` — Public developer profile, authored apps, and recent comments.
  - `POST /api/v1/feedback` — Submit feedback draft with attachments.
  - `POST /api/v1/uploads/images` & `POST /api/v1/uploads/r2` — Media and log attachment uploads.

## Quality Rules
1. Zero native binary dependencies — pure TypeScript and core React Native components.
2. Expo and bare React Native compatible.
3. Maintain strict type and contract consistency with CupThread Public API schema.
