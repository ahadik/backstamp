#!/bin/bash
set -e

PKG_VERSION=$(node -p "require('./package.json').version")
TAG="v$PKG_VERSION"
ARCH=$(uname -m)
case "$ARCH" in
  arm64) DMG_ARCH="aarch64" ;;
  x86_64) DMG_ARCH="x64" ;;
  *) echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

DMG_PATH="src-tauri/target/release/bundle/dmg/backstamp_${PKG_VERSION}_${DMG_ARCH}.dmg"
NOTES_FILE="release-notes/${TAG}.md"

echo "==> Pre-flight checks for $TAG"

if [ ! -f "$DMG_PATH" ]; then
  echo "Error: DMG not found at $DMG_PATH. Run 'npm run release:build' first."
  exit 1
fi

if [ ! -f "$NOTES_FILE" ]; then
  echo "Error: release notes not found at $NOTES_FILE."
  echo "Create it with a markdown summary of changes in this version."
  exit 1
fi

# Refuse to publish a DMG that isn't notarized + stapled. Without this, an
# un-notarized build (e.g. one produced with ALLOW_UNNOTARIZED=1, or before
# .env.release was sourced) could be tagged and shipped, and every user would
# hit a Gatekeeper block — the v0.2.0 failure class. stapler validate checks the
# ticket is present and embedded in the DMG.
if ! xcrun stapler validate "$DMG_PATH" >/dev/null 2>&1; then
  echo "Error: $DMG_PATH is not notarized/stapled."
  echo "Users would hit a Gatekeeper block. Rebuild with .env.release sourced"
  echo "(see 'npm run release:build') before publishing."
  exit 1
fi
echo "  Notarization: stapled ticket valid"

if ! gh auth status >/dev/null 2>&1; then
  echo "Error: gh CLI is not authenticated. Run 'gh auth login'."
  exit 1
fi

if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Error: tag $TAG already exists locally."
  exit 1
fi

if gh release view "$TAG" >/dev/null 2>&1; then
  echo "Error: GitHub release $TAG already exists."
  exit 1
fi

echo "  DMG:    $DMG_PATH"
echo "  Notes:  $NOTES_FILE"
echo "  Tag:    $TAG"
echo ""

echo "==> Tagging and pushing"
git tag "$TAG"
git push origin "$TAG"

echo ""
echo "==> Creating GitHub release"
gh release create "$TAG" "$DMG_PATH" \
  --title "$TAG" \
  --notes-file "$NOTES_FILE"

echo ""
echo "Released $TAG."
echo "Download URL:"
gh release view "$TAG" --json assets --jq '.assets[].url'
