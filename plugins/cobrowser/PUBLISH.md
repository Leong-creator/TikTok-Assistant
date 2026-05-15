# CoBrowser Publish Notes

## Release Artifact

Run from the plugin root:

```powershell
npm run package
```

This creates:

```text
dist/cobrowser-<version>.zip
dist/cobrowser-<version>.tar.gz
dist/SHA256SUMS.txt
dist/cobrowser-<version>-manifest.json
```

The package includes plugin source, manifest, skills, scripts, assets,
installer, license, and docs. It excludes `dist/`, `node_modules/`, `.git/`,
temporary files, and any CoBrowser runtime state under `~/.codex-cobrowser`.

## Portable Install Test

1. Extract `dist/cobrowser-<version>.zip` on another machine.
2. Run `scripts/install.ps1` from the extracted `cobrowser` folder.
3. Restart Codex.
4. Run `node "$env:USERPROFILE\plugins\cobrowser\scripts\cobrowser.mjs" doctor --launch true --mode headless`.
5. Use `login` once for sites that require a persisted login.

## Public Submission Checklist

- Replace placeholder homepage, repository, privacy policy, and terms URLs in `.codex-plugin/plugin.json`.
- Confirm publisher contact details for Leong.
- Verify the release archive on a clean Windows machine.
- Do not include `~/.codex-cobrowser`, `node_modules`, browser profiles, downloads, screenshots, tokens, cookies, or local logs.
