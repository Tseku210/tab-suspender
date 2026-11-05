#!/usr/bin/env bash
# The product principle, enforced: minimal and small is THE differentiator.
# README brags about measured numbers, so growth past these limits is a product
# decision, not a code review nit — raise the number only deliberately.
set -euo pipefail
cd "$(dirname "$0")/.."

version=$(node -p "JSON.parse(require('fs').readFileSync('manifest.json','utf8')).version")
zip="store/tab-suspender-v${version}.zip"
budget=15360 # 15 KB

[[ -f $zip ]] || { echo "FAIL: $zip missing — run scripts/package.sh first" >&2; exit 1; }

size=$(wc -c < "$zip" | tr -d ' ')
if (( size > budget )); then
  echo "FAIL: $zip is ${size} bytes, budget is ${budget} (15 KB)" >&2
  exit 1
fi

# Zero dependencies: nothing to install, ever.
if [[ -f package.json || -d node_modules ]]; then
  echo "FAIL: package.json/node_modules present — the extension has no dependencies" >&2
  exit 1
fi

# No background service worker: the extension does nothing while you aren't using it.
if node -e "process.exit('background' in JSON.parse(require('fs').readFileSync('manifest.json','utf8')) ? 1 : 0)"; then
  :
else
  echo "FAIL: manifest.json declares a background worker" >&2
  exit 1
fi

echo "OK: ${size}/${budget} bytes, zero deps, no background worker"
