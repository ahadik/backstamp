#!/bin/bash
set -e

BUMP_ARG="${1:-}"
CURRENT_VERSION=$(node -p "require('./package.json').version")

# ── Optional version bump ─────────────────────────────────────────────────────

if [ -n "$BUMP_ARG" ]; then
  case "$BUMP_ARG" in
    patch|minor|major)
      NEW_VERSION=$(node -e "
        const [maj, min, pat] = '$CURRENT_VERSION'.split('.').map(Number);
        const t = '$BUMP_ARG';
        if (t === 'patch') console.log([maj, min, pat + 1].join('.'));
        else if (t === 'minor') console.log([maj, min + 1, 0].join('.'));
        else console.log([maj + 1, 0, 0].join('.'));
      ")
      ;;
    *)
      if [[ "$BUMP_ARG" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        NEW_VERSION="$BUMP_ARG"
      else
        echo "Error: invalid version argument '$BUMP_ARG'."
        echo "Pass patch, minor, major, or an explicit X.Y.Z version."
        exit 1
      fi
      ;;
  esac

  if [ "$NEW_VERSION" = "$CURRENT_VERSION" ]; then
    echo "==> Version already at $CURRENT_VERSION; skipping bump."
  else
    echo "==> Bumping version: $CURRENT_VERSION -> $NEW_VERSION"

    node -e "
      const fs = require('fs');
      const pkg = require('./package.json');
      pkg.version = '$NEW_VERSION';
      fs.writeFileSync('./package.json', JSON.stringify(pkg, null, 2) + '\n');
    "

    node -e "
      const fs = require('fs');
      const path = './src-tauri/tauri.conf.json';
      const content = fs.readFileSync(path, 'utf8');
      const updated = content.replace(/(\"version\":\s*\")[^\"]+(\")/, '\$1$NEW_VERSION\$2');
      if (updated === content) {
        console.error('Error: failed to update version in tauri.conf.json');
        process.exit(1);
      }
      fs.writeFileSync(path, updated);
    "

    # Replace the first occurrence of `version = "..."` in Cargo.toml (the [package] version).
    perl -i -pe '
      if (!$done && /^version = "/) {
        s/^version = "[^"]+"/version = "'"$NEW_VERSION"'"/;
        $done = 1;
      }
    ' src-tauri/Cargo.toml

    echo "  Updated package.json, tauri.conf.json, src-tauri/Cargo.toml"
    echo ""
  fi
fi

# ── Version sync verification ─────────────────────────────────────────────────

PKG_VERSION=$(node -p "require('./package.json').version")
TAURI_VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")
CARGO_VERSION=$(grep '^version' src-tauri/Cargo.toml | head -1 | sed -E 's/version = "(.+)"/\1/')

echo "Versions:"
echo "  package.json         $PKG_VERSION"
echo "  tauri.conf.json      $TAURI_VERSION"
echo "  src-tauri/Cargo.toml $CARGO_VERSION"

if [ "$PKG_VERSION" != "$TAURI_VERSION" ] || [ "$PKG_VERSION" != "$CARGO_VERSION" ]; then
  echo "Error: versions out of sync. Pass a bump arg (patch|minor|major|X.Y.Z) to fix."
  exit 1
fi

# ── Bundled exiftool payload verification ─────────────────────────────────────
# The exiftool script, its Perl module tree (lib/), and exiftool.config are
# gitignored (installed manually per README), and tauri.conf.json bundles them
# by path. A fresh clone / CI / reimaged machine has none of them, and
# `tauri build` will happily ship a DMG missing the metadata engine — the exact
# class of failure that shipped in v0.2.0. Verify the payload exists AND runs
# before we spend minutes building an unshippable artifact.

echo ""
echo "==> Verifying bundled exiftool payload"

RES_DIR="src-tauri/resources"
MISSING=0
for f in "$RES_DIR/exiftool" "$RES_DIR/exiftool.config" "$RES_DIR/lib/Image/ExifTool.pm"; do
  if [ ! -e "$f" ]; then
    echo "  MISSING: $f"
    MISSING=1
  fi
done

if [ "$MISSING" -ne 0 ]; then
  echo ""
  echo "Error: bundled exiftool payload is incomplete. These files are gitignored"
  echo "and must be installed manually (see README). Building now would ship a DMG"
  echo "whose metadata engine is missing or broken."
  exit 1
fi

# Confirm the script actually runs with its module tree next to it. This catches
# a truncated/partial install that the existence checks above would pass.
if [ -x /usr/bin/perl ]; then
  ET_VER=$(/usr/bin/perl "$RES_DIR/exiftool" -ver 2>&1) || {
    echo ""
    echo "Error: bundled exiftool failed to run:"
    echo "$ET_VER" | sed 's/^/    /'
    echo "The lib/ module tree is likely incomplete. Reinstall it (see README)."
    exit 1
  }
  echo "  exiftool $ET_VER OK (script + lib/ + config present)"
else
  echo "  Warning: /usr/bin/perl not found; skipped runtime check (files present)."
fi

# ── Release notes stub ────────────────────────────────────────────────────────

NOTES_FILE="release-notes/v${PKG_VERSION}.md"
mkdir -p release-notes
if [ ! -f "$NOTES_FILE" ]; then
  cat > "$NOTES_FILE" <<EOF
# v${PKG_VERSION}

## Added

## Changed

## Fixed

EOF
  echo ""
  echo "Created $NOTES_FILE — fill in before running release:publish."
else
  echo ""
  echo "Release notes already exist at $NOTES_FILE — leaving untouched."
fi

# ── Checks ────────────────────────────────────────────────────────────────────

echo ""
echo "==> Typecheck"
npx tsc --noEmit

echo ""
echo "==> Frontend tests"
npm test

echo ""
echo "==> Rust release check"
(cd src-tauri && cargo check --release)

echo ""
echo "==> Rust tests"
(cd src-tauri && cargo test)

echo ""
echo "Pre-build checks passed for v$PKG_VERSION."
