# Repository Agent Rules

This repository is the standalone VS Code extension `applicate2628.vscode-s2p-preview`.
Keep agent work narrow, evidence-based, and release-safe.

## Scope Discipline

- Work only in this extension repository unless the user explicitly names another repository.
- Do not modify `vscode-folder-file-filter` from this repository task unless the user asks for both extensions.
- Preserve unrelated local changes. If the working tree is dirty, inspect scope before staging.
- Keep feature fixes in the owner module under `src/`; avoid broad refactors for small behavior changes.
- Use tests for behavior changes. Prefer a focused regression test before production code when feasible.
- For UI behavior in the webview, add a lightweight regression test where possible and run a visual/manual check when the change is layout-sensitive.

## Product Scope

- This extension previews Touchstone S-parameter files: `.s1p`, `.s2p`, `.s3p`, and `.s4p`.
- Current major capabilities include Touchstone parsing, N-port S-parameter matrices, passband presets, overlays, Z0 renormalization, PNG export, auto-refresh on file changes, and webview chart rendering.
- Do not introduce non-S parameter families such as Y/Z/G/H unless the user explicitly reopens that scope.
- Keep Smith chart work out of scope unless the user explicitly asks for it again.
- Preserve user-scoped passband presets and settings behavior. Do not reintroduce file-scoped preset persistence.
- Preserve both overlay paths: selected files from Explorer and the in-webview overlay picker. Overlay data must be drawn in the existing preview, not in a separate empty editor.
- Keep visible S-parameter matrix controls available for S2P and N-port files. Avoid layout jumps that hide Z0 renormalization or matrix controls at narrow widths.
- PNG export should be publication-quality and should capture the chart content at high resolution, not a low-quality viewport copy.

## Marketplace And Discovery

- `package.json` is the source of truth for Marketplace and Open VSX metadata.
- `README.marketplace.md` is the Marketplace/Open VSX readme. The package command must keep using `vsce package --readme-path README.marketplace.md`.
- `README.md` is the GitHub/development readme and may include local build and release workflow details that do not belong in Marketplace copy.
- Before marketing or discovery changes, check `displayName`, `description`, `categories`, `keywords`, `galleryBanner`, `icon`, `repository`, `homepage`, `bugs`, and README links.
- Categories must use only VS Code's allowed manifest values from the official Extension Manifest reference. For this extension, `Visualization`, `Data Science`, and `Other` are appropriate.
- Keep examples RF and Touchstone oriented, but avoid over-narrow wording that makes the extension look limited to one filter design workflow.
- Keep image/GIF references honest to the real VS Code UI. Generated or edited visuals require visual inspection before being used as evidence or committed.

## Release And Push

- Local development commits may be made without a version bump.
- Every push intended for GitHub, VS Code Marketplace, or Open VSX must include a patch version bump.
- Use `npm run release:patch` on Windows/PowerShell or `npm run release:patch:bash` in Bash when releasing from a clean tree.
- If releasing manually, do the equivalent steps: `npm version patch --no-git-tag-version`, update the local VSIX filename in `README.md`, run checks, commit, then push.
- Do not push without explicit user approval.
- Do not publish to Marketplace or Open VSX unless the user explicitly asks. Publishing uses the built `.vsix` for the same version as `package.json`.

## Required Checks Before Push Or Publication

Run these from the repository root:

```powershell
npm test
npm run package
npm audit --audit-level=moderate
git diff --check
```

Also run a publication-safety scan over staged changes before push:

```powershell
$safetyScript = ".agents\skills\lead\scripts\check-publication-safety.ps1"
if (-not (Test-Path -LiteralPath $safetyScript) -and $env:CODEX_HOME) {
  $safetyScript = Join-Path $env:CODEX_HOME "skills\lead\scripts\check-publication-safety.ps1"
}
if (Test-Path -LiteralPath $safetyScript) {
  powershell -ExecutionPolicy Bypass -File $safetyScript
}
git diff --cached --text | rg -n -i "D:\\|C:\\|BEGIN (RSA|OPENSSH|PRIVATE) KEY|token|secret|password|api[_-]?key|PRIVATE"
```

If the `rg` command exits with no matches, treat that as clean. Do not commit secrets, tokens, local absolute paths, raw logs, transcripts, or private screenshots.

## Review Expectations

- Before push, inspect the staged diff and verify the intended scope.
- For non-trivial behavior, release, or metadata changes, prefer an external pre-push review when available; Claude CLI review artifacts belong in scratch space, not in the repository.
- Do not treat external review as a substitute for local checks.
- If review feedback changes the staged diff, rerun the relevant checks before commit or push.

## Terms and Abbreviations

- `AGENTS.md`: repository-local instructions for agent sessions.
- `Open VSX`: the open extension registry used by VS Code-compatible editors.
- `RF`: Radio Frequency.
- `S-parameter`: scattering parameter data used for RF network analysis.
- `Touchstone`: RF network parameter file format used by `.sNp` files.
- `VS Code`: Visual Studio Code.
- `VSIX`: packaged install format for VS Code extensions.
- `Z0`: reference impedance used for S-parameter normalization.
