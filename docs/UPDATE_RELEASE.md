# Online Update Release

MarkFlow uses the official Tauri updater from version `0.3.5`. The installed app checks this URL on startup:

`https://github.com/PanJitao/MarkFlow/releases/latest/download/latest.json`

Only publish a newer version after its NSIS updater package has been signed. The private key is local-only and must not be committed:

`C:\Users\wuhu\.exchangemd\updater.key`

The key folder keeps its original name so existing installations can continue updating after the product rename.

## Publishing Conventions (read first)

1. **Every release MUST ship a detailed release note.** The GitHub Release page is the update channel users actually read; a placeholder body such as "MarkFlow x.y.z（详细说明见仓库 README）" is forbidden.
2. **`.github/release-notes/<version>.md` is the single source of truth** for that version's release notes. It must be created (or updated) in the same commit that bumps the version, and must describe the release in detail — grouped sections such as new features / performance / fixes / other changes, with concrete, user-visible bullet points.
3. **Keep the inline `releaseBody` in `.github/workflows/release.yml` in sync** with the release-notes file. The workflow matrix reads the inline body when tauri-action *creates* a new Release; the `gh api` PATCH step updates the body when the Release already exists (tauri-action itself never updates an existing Release's body).
4. Tag must be semantic `vX.Y.Z` — the workflow validates this and fails otherwise.

## Release Procedure (CI-driven)

1. **Bump the version in all three places** and keep them aligned: `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` (plus `package-lock.json` and `Cargo.lock`).
2. **Create `.github/release-notes/<version>.md`** with the detailed release notes, and **update the inline `releaseBody`** in `.github/workflows/release.yml` to match.
3. Commit and push to `main`.
4. Create the tag and push it — this triggers the release workflow:

   ```powershell
   git tag v0.4.1
   git push origin v0.4.1
   ```

   Re-publishing the same version (fixing a broken release): force-update the tag instead:

   ```powershell
   git tag -f v0.4.1
   git push origin --force v0.4.1
   ```

5. **The `release` workflow** (`.github/workflows/release.yml`) then runs automatically:

   | Job | What it does |
   | --- | --- |
   | `validate release version` | Checks tag format `vX.Y.Z`; reads `.github/release-notes/<version>.md` and **PATCHes the existing Release body** (via `gh api`), or skips when the Release does not exist yet |
   | `quality gate` | `tsc --noEmit` + `smoke-convert.mjs` (32 cases) + `cargo test` (12 cases). No publish if any fail |
   | `publish` | Builds Windows (NSIS), macOS Intel/ARM via `tauri-action`; creates the Release (with the inline body) if missing; uploads artifacts; generates signed `latest.json` |

6. **Verify on GitHub**: open the Release page, confirm the body shows the detailed notes, all platform artifacts are present, and `latest.json` points to the new version.

## Release Metadata

`latest.json` is generated and signed automatically by `tauri-action` during the publish job — it no longer needs manual maintenance. It is downloaded from GitHub's `releases/latest/download` URL, so keep the new release marked as latest and not a prerelease.

For the next release, keep all identifiers aligned:

- Git tag: `v0.4.1`
- Application version: `0.4.1`
- Release title: `MarkFlow 0.4.1`

## Build (local, optional)

Local packaging is only for manual testing; the official channel is the CI workflow above. When signing locally, the `.sig` step may hang in the tauri CLI on Windows — the installer is complete regardless; CI produces the signed artifacts reliably.

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content "$env:USERPROFILE\.exchangemd\updater.key" -Raw).Trim()
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ''
npm run tauri -- build --bundles nsis,msi
```

The build produces the NSIS installer and its `.sig` file under `src-tauri\target\release\bundle\nsis`. The MSI is for manual installation only; the online updater uses the signed NSIS installer.

## Troubleshooting

- **CI fails in a step with `Matching delimiter not found`** — do not reintroduce multi-line heredocs (`<<EOF`) into `$GITHUB_OUTPUT`; they are unreliable on this repository's runner. Use single-line values or read the file directly with `gh api`.
- **Release body did not change after re-publishing** — expected: `tauri-action` only uploads assets to an existing Release. The `gh api` PATCH step in `release_metadata` handles the body; make sure the tag really points at the commit containing the updated notes.