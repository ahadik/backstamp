# Releasing Backstamp

Backstamp ships as a signed + notarized macOS DMG via GitHub Releases. Builds are produced locally on Apple Silicon. CI is out of scope for now — see "Future work" at the bottom.

Code signing prerequisites (Developer ID cert, app-specific password, `.env.release`, `tauri.conf.json` settings) are a one-time setup documented in the **Code Signing & Notarization** section of [README.md](README.md). Make sure that setup is complete before your first signed release.

## Per-release checklist

### 1. Bump version + run pre-build checks

```sh
npm run release:pre-build -- patch     # or: minor | major | 0.2.0
```

This:

1. Bumps the version in all three required files (`package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`).
2. Creates `release-notes/v<version>.md` from a blank template if it doesn't already exist.
3. Runs the typecheck, frontend tests, Rust release check, and Rust tests. Aborts on any failure.

Re-running after fixing a failure: pass no argument to skip the bump and just re-verify (`npm run release:pre-build`). Existing release notes are never overwritten.

### 2. Fill in release notes

Edit `release-notes/v<version>.md` with a markdown summary of changes. This becomes the body of the GitHub release.

### 3. Build the DMG

```sh
source .env.release
npm run release:build
```

The script:

1. Runs `tauri build` — produces the signed `.app`, notarizes and staples it, then wraps it in a DMG. (~1–5 min for the notary round-trip.)
2. Submits the resulting DMG to `notarytool` for its own ticket and staples that to the DMG. (~1–3 min — Apple has already inspected the payload.)

On success, prints the DMG path:

```
src-tauri/target/release/bundle/dmg/backstamp_<version>_aarch64.dmg
```

If `.env.release` is not sourced (or any of `APPLE_SIGNING_IDENTITY` / `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` is unset), Tauri silently skips notarization and the script skips DMG-stapling — the resulting DMG triggers a Gatekeeper warning for users. Verify the signature before publishing — see step 4.

### 4. Smoke-test the built artifact

First, verify signing + notarization:

```sh
stapler validate src-tauri/target/release/bundle/dmg/backstamp_<version>_aarch64.dmg
spctl --assess --type execute --verbose=4 \
  src-tauri/target/release/bundle/macos/Backstamp.app
# Expect: "accepted, source=Notarized Developer ID"
```

Then simulate the end-user download experience (locally-built DMGs lack the `com.apple.quarantine` attribute, so they always open without warning):

```sh
xattr -w com.apple.quarantine "0083;$(date +%s);Safari;" \
  src-tauri/target/release/bundle/dmg/backstamp_<version>_aarch64.dmg
```

Then run the functional smoke test:

1. Mount the DMG, drag the app to `/Applications`, launch it. No Gatekeeper warning should appear.
2. Verify the golden path: import a photo, edit metadata, **Apply**, confirm the change persists on disk.
3. Verify **Roll Back** restores the previous state on disk.
4. Quit + relaunch → session restores.

Do **not** publish if anything in this list is broken.

### 5. Commit the version bump

```sh
git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock release-notes/v<version>.md
git commit -m "Release v<version>"
git push
```

The publish step tags `HEAD` — make sure the commit you want tagged is the one currently checked out.

### 6. Publish

```sh
npm run release:publish
```

This will:

1. Verify the DMG and `release-notes/v<version>.md` exist
2. Verify `gh` is authenticated and the tag is not already used
3. Create the `v<version>` git tag, push it
4. Create the GitHub release with the DMG attached and the notes file as the body
5. Print the asset download URL

## Tracking downloads

Per-asset counts come from the GitHub API:

```sh
gh api repos/<owner>/backstamp/releases/tags/v<version> \
  --jq '.assets[] | {name, download_count}'
```

For aggregate counts across all releases:

```sh
gh api repos/<owner>/backstamp/releases \
  --jq '[.[] | .assets[] | .download_count] | add'
```

## Recovering from a failed publish

- **Tag exists locally but release didn't get created:** `git tag -d v<version>` and rerun `release:publish`.
- **Tag pushed but release failed:** `git push origin :refs/tags/v<version>` to delete the remote tag, `git tag -d v<version>` locally, then rerun.
- **Release created but DMG broken:** `gh release delete v<version> --yes`, delete the tag as above, rebuild, rerun.

## Future work (not done yet)

- **Universal binary** — current builds are Apple Silicon only. For x86_64 support: `rustup target add x86_64-apple-darwin`, then `npm run tauri build -- --target universal-apple-darwin`.
- **CI release on tag push** — [tauri-apps/tauri-action](https://github.com/tauri-apps/tauri-action) on a macOS GitHub Actions runner. Worth adding once releases happen more than ~monthly.
