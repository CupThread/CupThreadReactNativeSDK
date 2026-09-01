#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="${1:-"${ROOT_DIR}/docs-site"}"

echo "==> Building CupThread React Native SDK documentation..."
cd "${ROOT_DIR}"

npx typedoc --out "${OUTPUT_DIR}"

echo "==> Documentation built successfully at: ${OUTPUT_DIR}"
