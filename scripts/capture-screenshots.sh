#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SHOWCASE_DIR="$ROOT_DIR/example"
SCREENSHOTS_DIR="$ROOT_DIR/assets/screenshots"
SIMULATOR_UDID="${SIMULATOR_UDID:-$(xcrun simctl list devices available | awk -F '[()]' '/iPhone/ { print $2; exit }')}"
BUNDLE_ID="com.cupthread.reactnativeshowcase"
RUN_IOS_PID=""

command -v axe >/dev/null || {
  echo "AXe is required. Install it with: brew install steipete/tap/axe"
  exit 1
}

[ -n "$SIMULATOR_UDID" ] || {
  echo "No available iPhone simulator was found." >&2
  exit 1
}

cleanup() {
  xcrun simctl terminate "$SIMULATOR_UDID" "$BUNDLE_ID" >/dev/null 2>&1 || true
  if [ -n "$RUN_IOS_PID" ]; then
    kill "$RUN_IOS_PID" >/dev/null 2>&1 || true
    wait "$RUN_IOS_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

xcrun simctl boot "$SIMULATOR_UDID" 2>/dev/null || true
xcrun simctl bootstatus "$SIMULATOR_UDID" -b
# Expo Go registers itself as a fallback handler for custom URL schemes and will
# otherwise prompt "Open in Expo Go?" instead of opening our own showcase app.
xcrun simctl uninstall "$SIMULATOR_UDID" host.exp.Exponent 2>/dev/null || true

mkdir -p "$SCREENSHOTS_DIR"
rm -f "$SCREENSHOTS_DIR"/*.png

echo "==> Preparing the deterministic Expo showcase..."
(
  cd "$SHOWCASE_DIR"
  npm ci
  env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy npx expo prebuild --platform ios --clean
)

# The showcase app is an Expo dev-client build, so it always needs a live Metro
# connection to load its JS bundle -- a static "release, no bundler" build never
# finishes registering AppRegistry and crashes on launch. `expo run:ios` builds a
# Debug binary and starts/attaches Metro for us in one step, which is the flow
# Expo actually supports here.
echo "==> Building, launching and bundling the showcase app (Debug, live Metro)..."
(
  cd "$SHOWCASE_DIR"
  env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy npx expo run:ios --device "$SIMULATOR_UDID"
) &
RUN_IOS_PID=$!

for attempt in {1..60}; do
  if curl -sf "http://localhost:8081/status" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
sleep 5

echo "==> Capturing core SDK surfaces..."
capture() {
  local name="$1"
  local url="$2"
  local ready_text="$3"
  local attempt

  xcrun simctl openurl "$SIMULATOR_UDID" "$url"
  for attempt in {1..30}; do
    if axe describe-ui --udid "$SIMULATOR_UDID" | grep -Fq "$ready_text"; then
      sleep 0.5
      axe screenshot --udid "$SIMULATOR_UDID" --output "$SCREENSHOTS_DIR/$name.png"
      return
    fi
    sleep 0.5
  done

  echo "Timed out waiting for \"$ready_text\" while capturing $name" >&2
  exit 1
}

# Taps the center of the first element whose AXLabel exactly matches $1.
# `axe tap --label` fails when a label matches more than one element (e.g. a
# button and its text child both expose the same label), so we resolve
# coordinates ourselves from `axe describe-ui` instead.
tap_label() {
  local label="$1"
  axe describe-ui --udid "$SIMULATOR_UDID" | python3 -c "
import json, sys
target = sys.argv[1]
data = json.load(sys.stdin)
root = data[0] if isinstance(data, list) else data
found = []
def walk(n):
    if n.get('AXLabel') == target:
        found.append(n.get('frame'))
    for c in n.get('children', []):
        walk(c)
walk(root)
if not found:
    sys.exit(1)
f = found[0]
print(f['x'] + f['width'] / 2, f['y'] + f['height'] / 2)
" "$label" | { read -r x y; axe tap --udid "$SIMULATOR_UDID" -x "$x" -y "$y"; }
}

capture "roadmap" "cupthread-showcase://?screen=roadmap" "Roadmap"
capture "feature-requests" "cupthread-showcase://?screen=requests" "Feature Requests"

# The compose sheet is only reachable by tapping "+ New" -- there's no deep-link
# param for it -- so open the Requests list first, then drive the tap with AXe.
xcrun simctl openurl "$SIMULATOR_UDID" "cupthread-showcase://?screen=requests"
for attempt in {1..30}; do
  if axe describe-ui --udid "$SIMULATOR_UDID" | grep -Fq "Feature Requests"; then break; fi
  sleep 0.5
done
tap_label "+ New"
for attempt in {1..30}; do
  if axe describe-ui --udid "$SIMULATOR_UDID" | grep -Fq "Propose Feature"; then
    sleep 0.5
    axe screenshot --udid "$SIMULATOR_UDID" --output "$SCREENSHOTS_DIR/submit-request.png"
    break
  fi
  sleep 0.5
done
# Close the compose sheet explicitly -- relying on the screen-switch unmount to
# dismiss it races with the next modal's presentation and can leave UIKit in a
# broken "view is not in the window hierarchy" state.
tap_label "✕"
sleep 1

capture "whats-new" "cupthread-showcase://?screen=whats-new" "What's New"
capture "changelog-overlay" "cupthread-showcase://?screen=whats-new&overlay=changelog" "What's new in CupThread"
tap_label "Got it"
sleep 1

capture "feedback-composer" "cupthread-showcase://?screen=feedback" "Send Feedback"

echo "==> Screenshots written to $SCREENSHOTS_DIR"
