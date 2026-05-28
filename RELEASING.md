# Releasing Backstamp

Backstamp ships as an unsigned macOS DMG via GitHub Releases. Builds are produced locally on Apple Silicon. Notarization and CI are out of scope for now — see "Future work" at the bottom.

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
npm run release:build
```

Runs `tauri build`. On success, prints the DMG path:

```
src-tauri/target/release/bundle/dmg/backstamp_<version>_aarch64.dmg
```

### 4. Smoke-test the built artifact

1. Mount the DMG, drag the app to `/Applications`, launch it.
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

- **Code signing + notarization** — requires a $99/yr Apple Developer ID. Removes the Gatekeeper warning for users. Tauri reads `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` from the environment and a `signingIdentity` in `tauri.conf.json` → `bundle.macOS`.
- **Universal binary** — current builds are Apple Silicon only. For x86_64 support: `rustup target add x86_64-apple-darwin`, then `npm run tauri build -- --target universal-apple-darwin`.
- **CI release on tag push** — [tauri-apps/tauri-action](https://github.com/tauri-apps/tauri-action) on a macOS GitHub Actions runner. Worth adding once releases happen more than ~monthly.
