#!/usr/bin/env bash
# Build Windows + macOS arm64, run the packaged 30s view-cycle smoke, publish only if it passes.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./package.json').version")"
TAG="v${VERSION}"
WIN="dist/Goldogram-Node-Setup-${VERSION}.exe"
MAC="dist/Goldogram-Node-${VERSION}-mac-arm64.zip"

echo "[release] version ${VERSION}"
echo "[release] npm test"
npm test

echo "[release] electron-builder --win --x64 --mac --arm64 --publish never"
npx electron-builder --win --x64 --mac --arm64 --publish never

if [[ ! -f "$WIN" ]]; then
  echo "[release] missing Windows installer $WIN" >&2
  exit 1
fi
if [[ ! -f "$MAC" ]]; then
  echo "[release] missing macOS zip $MAC" >&2
  exit 1
fi

echo "[release] packaged-app smoke (blocks publish on failure)"
node scripts/packaged_smoke.js

WIN_SHA="$(shasum -a 256 "$WIN" | awk '{print $1}')"
MAC_SHA="$(shasum -a 256 "$MAC" | awk '{print $1}')"
echo "[release] Windows SHA256 ${WIN_SHA}"
echo "[release] macOS arm64 SHA256 ${MAC_SHA}"

NOTES="$(cat <<EOF
Fixes the sync stop at 1,845,956. Nodes resume automatically after update. The bundled core accepts the known parent break at block 1,845,957 and keeps syncing through a depth-1 race at the tip.


| Artifact | SHA256 |
| --- | --- |
| Goldogram-Node-Setup-${VERSION}.exe | ${WIN_SHA} |
| Goldogram-Node-${VERSION}-mac-arm64.zip | ${MAC_SHA} |
EOF
)"

if gh release view "$TAG" >/dev/null 2>&1; then
  echo "[release] $TAG already exists on GitHub — not publishing over it" >&2
  exit 1
fi

echo "[release] gh release create ${TAG}"
gh release create "$TAG" \
  --title "Goldogram Node ${VERSION}" \
  --notes "$NOTES" \
  "$WIN" \
  "${WIN}.blockmap" \
  "$MAC" \
  "${MAC}.blockmap" \
  dist/latest.yml \
  dist/latest-mac.yml

echo "[release] published ${TAG}"
echo "[release] WIN_SHA256=${WIN_SHA}"
echo "[release] MAC_SHA256=${MAC_SHA}"
