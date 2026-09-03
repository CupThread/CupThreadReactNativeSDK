#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="${1:-"${ROOT_DIR}/docs-site"}"

echo "==> Building CupThread React Native SDK documentation..."
cd "${ROOT_DIR}"

npx typedoc --out "${OUTPUT_DIR}"

if find "${ROOT_DIR}/assets/screenshots" -maxdepth 1 -name '*.png' -print -quit 2>/dev/null | grep -q .; then
  mkdir -p "${OUTPUT_DIR}/assets/screenshots"
  cp "${ROOT_DIR}"/assets/screenshots/*.png "${OUTPUT_DIR}/assets/screenshots/"
fi

echo "==> Documentation built successfully at: ${OUTPUT_DIR}"
