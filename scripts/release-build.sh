#!/bin/bash
set -e

PKG_VERSION=$(node -p "require('./package.json').version")
ARCH=$(uname -m)
case "$ARCH" in
  arm64) DMG_ARCH="aarch64" ;;
  x86_64) DMG_ARCH="x64" ;;
  *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

DMG_PATH="src-tauri/target/release/bundle/dmg/backstamp_${PKG_VERSION}_${DMG_ARCH}.dmg"

echo "==> Building backstamp v$PKG_VERSION ($DMG_ARCH)"
npm run tauri build

if [ ! -f "$DMG_PATH" ]; then
  echo "Error: expected DMG not found at $DMG_PATH"
  echo "Check src-tauri/target/release/bundle/dmg/ for the actual filename."
  exit 1
fi

DMG_SIZE=$(du -h "$DMG_PATH" | cut -f1)
echo ""
echo "Built: $DMG_PATH ($DMG_SIZE)"
echo ""
echo "Next: smoke-test the DMG, then 'npm run release:publish'."
