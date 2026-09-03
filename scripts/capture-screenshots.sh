#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SHOWCASE_DIR="$ROOT_DIR/example"
SCREENSHOTS_DIR="$ROOT_DIR/assets/screenshots"
SIMULATOR_UDID="${SIMULATOR_UDID:-$(xcrun simctl list devices available | awk -F '[()]' '/iPhone/ { print $2; exit }')}"

command -v axe >/dev/null || {
  echo "AXe is required. Install it with: brew install steipete/tap/axe"
  exit 1
}

[ -n "$SIMULATOR_UDID" ] || {
  echo "No available iPhone simulator was found." >&2
  exit 1
}

xcrun simctl boot "$SIMULATOR_UDID" 2>/dev/null || true
xcrun simctl bootstatus "$SIMULATOR_UDID" -b

mkdir -p "$SCREENSHOTS_DIR"
rm -f "$SCREENSHOTS_DIR"/*.png

echo "==> Building and installing the deterministic Expo showcase..."
(
  cd "$SHOWCASE_DIR"
  npm ci
  env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy npx expo prebuild --platform ios --clean
  npx expo run:ios --device "$SIMULATOR_UDID" --configuration Release --no-bundler
)

echo "==> Capturing core SDK surfaces..."
capture() {
  local name="$1"
  local url="$2"
  local ready_text="$3"
  local attempt

  xcrun simctl openurl "$SIMULATOR_UDID" "$url"
  for attempt in {1..20}; do
    if axe describe-ui --udid "$SIMULATOR_UDID" | grep -Fq "$ready_text"; then
      axe screenshot --udid "$SIMULATOR_UDID" --output "$SCREENSHOTS_DIR/$name.png"
      return
    fi
    sleep 0.5
  done

  echo "Timed out waiting for \"$ready_text\" while capturing $name" >&2
  exit 1
}

capture "roadmap" "cupthread-showcase://?screen=roadmap" "Roadmap"
capture "feature-requests" "cupthread-showcase://?screen=requests" "Feature Requests"
capture "submit-request" "cupthread-showcase://?screen=requests&compose=feature-request" "Request a Feature"
capture "whats-new" "cupthread-showcase://?screen=whats-new" "What's New"
capture "changelog-overlay" "cupthread-showcase://?screen=whats-new&overlay=changelog" "What's new in CupThread"
capture "feedback-composer" "cupthread-showcase://?screen=feedback" "Send Feedback"

echo "==> Screenshots written to $SCREENSHOTS_DIR"
