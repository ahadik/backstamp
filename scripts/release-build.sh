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

if [ -z "$APPLE_ID" ] || [ -z "$APPLE_PASSWORD" ] || [ -z "$APPLE_TEAM_ID" ]; then
  # Hard-fail rather than warn: a silently un-notarized DMG is Gatekeeper-blocked
  # on every user's machine (the v0.2.0 failure class). Sourcing .env.release is
  # the normal path. Intentional un-notarized local builds must opt in explicitly.
  if [ "$ALLOW_UNNOTARIZED" = "1" ]; then
    echo ""
    echo "Warning: APPLE_ID / APPLE_PASSWORD / APPLE_TEAM_ID not all set, but"
    echo "ALLOW_UNNOTARIZED=1 — producing an UN-NOTARIZED DMG for local testing only."
    echo "Do NOT publish this build; users will hit a Gatekeeper block on mount."
  else
    echo ""
    echo "Error: APPLE_ID / APPLE_PASSWORD / APPLE_TEAM_ID not all set."
    echo "Refusing to build an un-notarized DMG that users cannot open."
    echo "  - Source .env.release, then re-run, to produce a notarized DMG, or"
    echo "  - set ALLOW_UNNOTARIZED=1 to build a local-testing-only DMG."
    exit 1
  fi
else
  echo ""
  echo "==> Submitting DMG to Apple notary service"
  xcrun notarytool submit "$DMG_PATH" \
    --apple-id "$APPLE_ID" \
    --password "$APPLE_PASSWORD" \
    --team-id "$APPLE_TEAM_ID" \
    --wait

  echo ""
  echo "==> Stapling notarization ticket to DMG"
  xcrun stapler staple "$DMG_PATH"
  xcrun stapler validate "$DMG_PATH"
fi

echo ""
echo "Next: smoke-test the DMG, then 'npm run release:publish'."
