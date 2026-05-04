# Selected-Port Z0 Renormalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a target Ohm spinbox and per-port checkboxes that renormalize previewed Touchstone `S`-parameters without changing the file parser contract.

**Architecture:** Keep parsing in `src/touchstone.ts`, add `src/renormalize.ts` for real positive diagonal-impedance S-to-Z-to-S conversion, and extend `src/previewModel.ts` with reference metadata and raw trace samples for webview recomputation. The webview owns transient UI state; extension settings remain limited to passband presets.

**Tech Stack:** TypeScript, VS Code webview HTML/CSS/JavaScript, Node test runner, existing `vsce` package script.

---

### Task 1: Renormalization Core

**Files:**
- Create: `src/renormalize.ts`
- Test: `src/__tests__/renormalize.test.ts`

- [ ] **Step 1: Write failing tests for one-port and selected-port behavior**

Add tests that parse Touchstone data and call `renormalizeDocument(doc, targetOhms, selectedPorts)`. Check that 50 Ohm one-port `S11 = 0.5` becomes about `0.333333` at 75 Ohm, and that unchecked ports keep their source reference in a mixed-reference 2-port file.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test`

Expected: compile failure because `src/renormalize.ts` does not exist.

- [ ] **Step 3: Implement real positive diagonal renormalization**

Create `renormalizeDocument`, `effectiveReferenceOhms`, and small complex-matrix helpers. Use `Z = D0(I + S)(I - S)^-1D0`, then `S' = (Zn - I)(Zn + I)^-1`.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `npm test`

Expected: all tests pass.

### Task 2: Preview Model Metadata

**Files:**
- Modify: `src/previewModel.ts`
- Test: `src/__tests__/previewModel.test.ts`

- [ ] **Step 1: Add failing tests for impedance metadata**

Assert that `buildPreviewModel` exposes `referenceOhms`, `defaultTargetOhms`, `selectedPorts`, and serializable raw samples for webview recomputation.

- [ ] **Step 2: Implement metadata on single-file preview models**

Add an `impedance` object to `PreviewModel` for single-file previews. Do not enable it for overlay models in this slice.

- [ ] **Step 3: Run tests**

Run: `npm test`

Expected: all tests pass.

### Task 3: Webview Controls and Recomputed Traces

**Files:**
- Modify: `src/extension.ts`

- [ ] **Step 1: Render the numeric input and port checkboxes**

Add `Target Z0, Ohm`, file-reference text, and `P1...Pn` checkboxes next to passband controls when `model.impedance` is present.

- [ ] **Step 2: Add client-side recomputation**

Embed impedance metadata and the same real positive renormalization math in the webview script. Recompute SVG polyline points and 2-port metric rows when the target or checkboxes change.

- [ ] **Step 3: Keep passband behavior unchanged**

Make `updatePassband()` read the currently recomputed metric rows instead of the initially serialized metric rows.

### Task 4: Verification, Commit, and Install

**Files:**
- Add report under `D:\dev\layered-filter\.reports\2026-05\`

- [ ] **Step 1: Run verification**

Run:

```powershell
npm test
git diff --check
npm audit --audit-level=moderate
npm run package
npx vsce ls .\vscode-s2p-preview-0.0.7.vsix
```

- [ ] **Step 2: Commit without version bump**

Run:

```powershell
git add src docs
git commit -m "Add selected-port impedance renormalization"
```

- [ ] **Step 3: Install in VS Code Insiders**

Run:

```powershell
code-insiders --install-extension .\vscode-s2p-preview-0.0.7.vsix --force
code-insiders --list-extensions --show-versions | Select-String -Pattern '^applicate2628\.vscode-s2p-preview@'
```

## Terms and Abbreviations

- `S-parameter`: scattering parameter used for RF network behavior.
- `UI`: User Interface.
- `VSIX`: VS Code extension package file.
- `Z0`: reference impedance, usually written as `$Z_{0}$`.
