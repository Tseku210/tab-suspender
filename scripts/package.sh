#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

version=$(node -p "JSON.parse(require('fs').readFileSync('manifest.json','utf8')).version")
out="store/tab-suspender-v${version}.zip"

rm -f "$out"
zip -q "$out" \
  manifest.json \
  popup.html \
  popup.js \
  icons/icon16.png \
  icons/icon48.png \
  icons/icon128.png

echo "Wrote $out"
