# Online Update Release

MarkFlow uses the official Tauri updater from version `0.3.5`. The installed app checks this URL on startup:

`https://github.com/PanJitao/MarkFlow/releases/latest/download/latest.json`

Only publish a newer version after its NSIS updater package has been signed. The private key is local-only and must not be committed:

`C:\Users\wuhu\.exchangemd\updater.key`

The key folder keeps its original name so existing installations can continue updating after the product rename.

## Build

Run from `rebuild`:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content "$env:USERPROFILE\.exchangemd\updater.key" -Raw).Trim()
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ''
npm run tauri -- build --bundles nsis,msi
```

The build produces the NSIS installer and its `.sig` file under `src-tauri\target\release\bundle\nsis`. Upload both to the GitHub Release. The MSI is for manual installation only; the online updater uses the signed NSIS installer.

## Release Metadata

Create `latest.json` from the generated NSIS installer signature, then upload it to the same GitHub Release. Replace all placeholder values below with the generated artifact name, complete `.sig` text, release date, and release notes:

```json
{
  "version": "0.3.26",
  "notes": "Release notes",
  "pub_date": "2026-08-21T00:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "CONTENTS_OF_THE_NSIS_SIG_FILE",
      "url": "https://github.com/PanJitao/MarkFlow/releases/download/v0.3.26/MarkFlow_0.3.26_x64-setup.exe"
    }
  }
}
```

For the next release, keep all identifiers aligned:

- Git tag: `v0.3.26`
- Application version: `0.3.26`
- Release title: `0.3.26`

`latest.json` is fetched from GitHub's `releases/latest/download` URL, so mark the new release as the latest release and do not mark it as a prerelease.
