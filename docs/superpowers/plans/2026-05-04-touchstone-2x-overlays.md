# Touchstone 2.x Overlays Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first Touchstone viewer slice: complex `S`-parameter model, Touchstone 1.x and 2.0/2.1 parsing, `.s1p` through `.s4p` support, and an opt-in multi-file overlay command.

**Architecture:** `src/touchstone.ts` becomes the single owner for parsing, complex values, trace derivation, and compatibility rows. `src/extension.ts` stays the VS Code and webview owner, but it consumes parsed Touchstone documents and chart series instead of raw text-to-dB rows. UI behavior remains simple for one `.s2p` file while overlay mode compares one selected trace across several files.

**Tech Stack:** TypeScript, VS Code extension API, custom readonly editor, SVG inside VS Code webview, Node `node:test`.

---

## File Structure

- Modify `src/touchstone.ts`: define `ComplexValue`, `TouchstoneSample`, `TouchstoneDocument`, `TraceSelector`, parser helpers, dB conversion, trace derivation, and `S2pRow` compatibility adapter.
- Create `src/__tests__/touchstone.test.ts`: focused parser and trace tests for Touchstone 1.x, Touchstone 2.0/2.1, N-port `S` matrices, unsupported parameters, and unsupported matrix formats.
- Modify `src/extension.ts`: replace `parseS2p` usage with `parseTouchstone`, add selected-file overlay command, build chart series, and keep existing passband/preset flow.
- Modify `package.json`: add `.s1p`, `.s2p`, `.s3p`, `.s4p` selectors and overlay command/menu contribution.
- Modify `README.md` and `README.marketplace.md`: update supported format text and list unsupported items accurately after this slice.

## Task 1: Touchstone Model and Trace Helpers

**Files:**
- Modify: `src/touchstone.ts`
- Create: `src/__tests__/touchstone.test.ts`

- [ ] **Step 1: Write failing tests for complex parsing and trace derivation**

Add this new test file:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  complexToDb,
  parseTouchstone,
  traceDbRows,
  traceSelectorLabel
} from "../touchstone";

test("parses Touchstone 1.x s2p data as complex S-parameter samples", () => {
  const doc = parseTouchstone(
    [
      "# GHZ S MA R 50",
      "1 0.5 0 0.9 0 0.01 0 0.4 180"
    ].join("\n"),
    "sample.s2p"
  );

  assert.equal(doc.version, "1.x");
  assert.equal(doc.ports, 2);
  assert.equal(doc.parameter, "S");
  assert.deepEqual(doc.referenceOhms, [50, 50]);
  assert.deepEqual(doc.samples[0].matrix[0][0], { re: 0.5, im: 0 });
  assert.ok(Math.abs(doc.samples[0].matrix[1][1].re + 0.4) < 1e-12);
});

test("derives dB rows for an S-parameter trace", () => {
  const doc = parseTouchstone("# GHZ S MA R 50\n1 0.5 0 0.9 0 0.01 0 0.4 180", "sample.s2p");
  const rows = traceDbRows(doc, { toPort: 2, fromPort: 1 });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].freqGHz, 1);
  assert.equal(rows[0].db.toFixed(2), "-0.92");
  assert.equal(traceSelectorLabel({ toPort: 2, fromPort: 1 }), "S21");
});

test("converts complex values to dB safely", () => {
  assert.equal(complexToDb({ re: 1, im: 0 }), 0);
  assert.equal(Number.isFinite(complexToDb({ re: 0, im: 0 })), true);
});
```

- [ ] **Step 2: Run the new parser tests and verify they fail**

Run:

```powershell
npm test
```

Expected: compile or test failure because `parseTouchstone`, `traceDbRows`, `traceSelectorLabel`, and `complexToDb` are not exported yet.

- [ ] **Step 3: Add model types and trace helpers**

In `src/touchstone.ts`, add these exported types and helpers above the current `S2pRow` type:

```ts
export interface ComplexValue {
  re: number;
  im: number;
}

export interface TouchstoneSample {
  freqGHz: number;
  matrix: ComplexValue[][];
}

export type TouchstoneVersion = "1.x" | "2.0" | "2.1";
export type TouchstoneParameter = "S";
export type TouchstoneFormat = "MA" | "DB" | "RI";

export interface TouchstoneDocument {
  version: TouchstoneVersion;
  ports: number;
  parameter: TouchstoneParameter;
  format: TouchstoneFormat;
  referenceOhms: number[];
  samples: TouchstoneSample[];
  sourceName: string;
}

export interface TraceSelector {
  toPort: number;
  fromPort: number;
}

export interface TraceDbRow {
  freqGHz: number;
  db: number;
}

export function complexToDb(value: ComplexValue): number {
  return magnitudeToDb(Math.hypot(value.re, value.im));
}

export function traceSelectorLabel(selector: TraceSelector): string {
  return `S${selector.toPort}${selector.fromPort}`;
}

export function traceDbRows(doc: TouchstoneDocument, selector: TraceSelector): TraceDbRow[] {
  assertTraceSelector(doc, selector);
  return doc.samples.map((sample) => ({
    freqGHz: sample.freqGHz,
    db: complexToDb(sample.matrix[selector.toPort - 1][selector.fromPort - 1])
  }));
}

function assertTraceSelector(doc: TouchstoneDocument, selector: TraceSelector): void {
  if (!Number.isInteger(selector.toPort) || !Number.isInteger(selector.fromPort)) {
    throw new Error("Trace selector ports must be integers.");
  }
  if (selector.toPort < 1 || selector.toPort > doc.ports || selector.fromPort < 1 || selector.fromPort > doc.ports) {
    throw new Error(`Trace ${traceSelectorLabel(selector)} is outside this ${doc.ports}-port file.`);
  }
}
```

- [ ] **Step 4: Add `parseTouchstone` for current 1.x `.s2p` behavior**

Keep `parseS2p` exported for compatibility, but implement it through `parseTouchstone` plus a compatibility adapter. Add these functions in `src/touchstone.ts`:

```ts
export function parseTouchstone(text: string, sourceName = "untitled.s2p"): TouchstoneDocument {
  const extensionPorts = portsFromSourceName(sourceName);
  const lines = text.split(/\r?\n/);
  let options: TouchstoneOptions | undefined;
  const samples: TouchstoneSample[] = [];

  for (const rawLine of lines) {
    const withoutComment = rawLine.split("!")[0].trim();
    if (!withoutComment) {
      continue;
    }
    if (withoutComment.startsWith("[")) {
      throw new Error(`Unsupported Touchstone keyword '${keywordName(withoutComment)}'. Touchstone 2.x keyword parsing is added in the next task.`);
    }
    if (withoutComment.startsWith("#")) {
      options = parseOptions(withoutComment);
      continue;
    }
    if (!options) {
      throw new Error("Missing Touchstone option line. Expected '# GHZ S MA R 50'.");
    }

    const values = parseNumericValues(withoutComment);
    const ports = extensionPorts ?? 2;
    const expectedValues = 1 + ports * ports * 2;
    if (values.length < expectedValues) {
      throw new Error(`Incomplete ${ports}-port Touchstone data row. Expected ${expectedValues} numeric values, found ${values.length}.`);
    }

    samples.push({
      freqGHz: values[0] * FREQ_SCALE_TO_GHZ[options.freqUnit],
      matrix: pairsToMatrix(values.slice(1, expectedValues), ports, options.format)
    });
  }

  if (!options) {
    throw new Error("Missing Touchstone option line. Expected '# GHZ S MA R 50'.");
  }
  assertSupportedOptions(options);
  if (samples.length === 0) {
    throw new Error("No Touchstone data rows found.");
  }

  const ports = extensionPorts ?? 2;
  return {
    version: "1.x",
    ports,
    parameter: "S",
    format: options.format as TouchstoneFormat,
    referenceOhms: Array.from({ length: ports }, () => options.referenceOhms),
    samples,
    sourceName
  };
}

export function parseS2p(text: string): S2pRow[] {
  return toS2pRows(parseTouchstone(text, "untitled.s2p"));
}
```

Add these local helpers below `parseOptions`:

```ts
function assertSupportedOptions(options: TouchstoneOptions): void {
  if (options.parameter !== "S") {
    throw new Error(`Unsupported parameter '${options.parameter}'. Current implementation supports only S-parameters.`);
  }
  if (!["MA", "DB", "RI"].includes(options.format)) {
    throw new Error(`Unsupported Touchstone format '# ${options.freqUnit} ${options.parameter} ${options.format}'. Supported: MA, DB, RI.`);
  }
}

function parseNumericValues(line: string): number[] {
  const values = line.split(/\s+/).map(Number);
  if (values.some((value) => Number.isNaN(value))) {
    throw new Error(`Malformed numeric Touchstone data: '${line}'.`);
  }
  return values;
}

function portsFromSourceName(sourceName: string): number | undefined {
  const match = /\.s(\d+)p$/i.exec(sourceName);
  if (!match) {
    return undefined;
  }
  const ports = Number(match[1]);
  return Number.isInteger(ports) && ports > 0 ? ports : undefined;
}

function pairsToMatrix(values: number[], ports: number, format: string): ComplexValue[][] {
  const matrix: ComplexValue[][] = [];
  let offset = 0;
  for (let row = 0; row < ports; row += 1) {
    const matrixRow: ComplexValue[] = [];
    for (let column = 0; column < ports; column += 1) {
      matrixRow.push(pairToComplex(values[offset], values[offset + 1], format));
      offset += 2;
    }
    matrix.push(matrixRow);
  }
  return matrix;
}

function pairToComplex(v1: number, v2: number, format: string): ComplexValue {
  switch (format) {
    case "MA": {
      const radians = degreesToRadians(v2);
      return { re: v1 * Math.cos(radians), im: v1 * Math.sin(radians) };
    }
    case "DB": {
      const magnitude = Math.pow(10, v1 / 20);
      const radians = degreesToRadians(v2);
      return { re: magnitude * Math.cos(radians), im: magnitude * Math.sin(radians) };
    }
    case "RI":
      return { re: v1, im: v2 };
    default:
      throw new Error(`Unsupported Touchstone format '${format}'. Supported: MA, DB, RI.`);
  }
}

function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function keywordName(line: string): string {
  const end = line.indexOf("]");
  return end >= 0 ? line.slice(0, end + 1) : line;
}
```

Add this compatibility adapter near `parseS2p`:

```ts
export function toS2pRows(doc: TouchstoneDocument): S2pRow[] {
  if (doc.ports !== 2) {
    throw new Error(`S2P metrics require a 2-port file; got ${doc.ports} ports.`);
  }

  return doc.samples.map((sample) => ({
    freqGHz: sample.freqGHz,
    s11db: complexToDb(sample.matrix[0][0]),
    s21db: complexToDb(sample.matrix[1][0]),
    s12db: complexToDb(sample.matrix[0][1]),
    s22db: complexToDb(sample.matrix[1][1])
  }));
}
```

- [ ] **Step 5: Run tests and commit Task 1**

Run:

```powershell
npm test
```

Expected: all existing tests and new Task 1 tests pass.

Commit:

```powershell
git add src\touchstone.ts src\__tests__\touchstone.test.ts
git commit -m "Add Touchstone complex model"
```

## Task 2: Touchstone 2.0 and 2.1 Keyword Parser

**Files:**
- Modify: `src/touchstone.ts`
- Modify: `src/__tests__/touchstone.test.ts`

- [ ] **Step 1: Write failing tests for Touchstone 2.x keyword files**

Append these tests to `src/__tests__/touchstone.test.ts`:

```ts
test("parses Touchstone 2.1 keyword-block s2p files", () => {
  const doc = parseTouchstone(
    [
      "[Version] 2.1",
      "# GHZ S DB R 50",
      "[Number of Ports] 2",
      "[Two-Port Data Order] 21_12",
      "[Number of Frequencies] 1",
      "[Reference] 50 75",
      "[Network Data]",
      "1 -6 0 -1 0 -40 0 -8 0",
      "[End]"
    ].join("\n"),
    "network.s2p"
  );

  assert.equal(doc.version, "2.1");
  assert.equal(doc.ports, 2);
  assert.deepEqual(doc.referenceOhms, [50, 75]);
  assert.equal(traceDbRows(doc, { toPort: 2, fromPort: 1 })[0].db, -1);
});

test("parses Touchstone 2.0 full matrix s3p files", () => {
  const doc = parseTouchstone(
    [
      "[Version] 2.0",
      "# GHZ S RI R 50",
      "[Number of Ports] 3",
      "[Number of Frequencies] 1",
      "[Network Data]",
      "1",
      "0.1 0 0.2 0 0.3 0",
      "0.4 0 0.5 0 0.6 0",
      "0.7 0 0.8 0 0.9 0",
      "[End]"
    ].join("\n"),
    "network.s3p"
  );

  assert.equal(doc.version, "2.0");
  assert.equal(doc.ports, 3);
  assert.deepEqual(doc.samples[0].matrix[2][1], { re: 0.8, im: 0 });
});

test("rejects unsupported non-S Touchstone parameters", () => {
  assert.throws(
    () => parseTouchstone("# GHZ Z RI R 50\n1 50 0 0 0 0 0 50 0", "impedance.s2p"),
    /supports only S-parameters/
  );
});

test("rejects unsupported Touchstone matrix formats clearly", () => {
  assert.throws(
    () => parseTouchstone(
      [
        "[Version] 2.1",
        "# GHZ S MA R 50",
        "[Number of Ports] 3",
        "[Matrix Format] Upper",
        "[Number of Frequencies] 1",
        "[Network Data]",
        "1 0.1 0 0.2 0 0.3 0",
        "[End]"
      ].join("\n"),
      "upper.s3p"
    ),
    /Unsupported Touchstone keyword '\\[Matrix Format\\] Upper'/
  );
});
```

- [ ] **Step 2: Run tests and verify the 2.x cases fail**

Run:

```powershell
npm test
```

Expected: tests fail on unsupported keyword parsing.

- [ ] **Step 3: Replace line-by-line parser with tokenized parser states**

Refactor `parseTouchstone` so it:

```ts
interface ParsedLine {
  kind: "option" | "keyword" | "data";
  text: string;
}

interface TouchstoneParseState {
  version: TouchstoneVersion;
  options?: TouchstoneOptions;
  ports?: number;
  numberOfFrequencies?: number;
  referenceOhms?: number[];
  inNetworkData: boolean;
  networkValues: number[];
}
```

Implement these rules:

```ts
function parseLogicalLines(text: string): ParsedLine[] {
  return text
    .split(/\r?\n/)
    .map((rawLine) => rawLine.split("!")[0].trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      if (line.startsWith("#")) {
        return { kind: "option", text: line };
      }
      if (line.startsWith("[")) {
        return { kind: "keyword", text: line };
      }
      return { kind: "data", text: line };
    });
}
```

Use a single pass:

```ts
for (const line of parseLogicalLines(text)) {
  if (line.kind === "option") {
    state.options = parseOptions(line.text);
    continue;
  }

  if (line.kind === "keyword") {
    applyKeyword(state, line.text);
    continue;
  }

  if (!state.inNetworkData && state.version !== "1.x") {
    throw new Error("Touchstone 2.x data appeared before [Network Data].");
  }

  state.networkValues.push(...parseNumericValues(line.text));
}
```

- [ ] **Step 4: Implement keyword handling**

Add this keyword handler:

```ts
function applyKeyword(state: TouchstoneParseState, line: string): void {
  const match = /^\[([^\]]+)\]\s*(.*)$/.exec(line);
  if (!match) {
    throw new Error(`Malformed Touchstone keyword '${line}'.`);
  }

  const keyword = match[1].toUpperCase();
  const argument = match[2].trim();

  switch (keyword) {
    case "VERSION":
      if (argument !== "2.0" && argument !== "2.1") {
        throw new Error(`Unsupported Touchstone version '${argument}'. Supported: 2.0, 2.1.`);
      }
      state.version = argument;
      return;
    case "NUMBER OF PORTS":
      state.ports = parsePositiveInteger(argument, "[Number of Ports]");
      return;
    case "TWO-PORT DATA ORDER":
      if (argument.toUpperCase() !== "21_12") {
        throw new Error(`Unsupported Touchstone keyword '[Two-Port Data Order] ${argument}'. Supported: 21_12.`);
      }
      return;
    case "NUMBER OF FREQUENCIES":
      state.numberOfFrequencies = parsePositiveInteger(argument, "[Number of Frequencies]");
      return;
    case "REFERENCE":
      state.referenceOhms = parseNumericValues(argument);
      return;
    case "MATRIX FORMAT":
      if (argument && argument.toUpperCase() !== "FULL") {
        throw new Error(`Unsupported Touchstone keyword '[Matrix Format] ${argument}'. Supported: Full.`);
      }
      return;
    case "NETWORK DATA":
      state.inNetworkData = true;
      return;
    case "END":
      state.inNetworkData = false;
      return;
    default:
      throw new Error(`Unsupported Touchstone keyword '[${match[1]}]'.`);
  }
}
```

Add:

```ts
function parsePositiveInteger(value: string, keyword: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${keyword} requires a positive integer.`);
  }
  return parsed;
}
```

- [ ] **Step 5: Build samples from accumulated network values**

Add:

```ts
function samplesFromNetworkValues(values: number[], ports: number, format: string, freqScale: number): TouchstoneSample[] {
  const valuesPerSample = 1 + ports * ports * 2;
  if (values.length % valuesPerSample !== 0) {
    throw new Error(`Incomplete ${ports}-port Touchstone network data. Expected groups of ${valuesPerSample} numeric values.`);
  }

  const samples: TouchstoneSample[] = [];
  for (let offset = 0; offset < values.length; offset += valuesPerSample) {
    samples.push({
      freqGHz: values[offset] * freqScale,
      matrix: pairsToMatrix(values.slice(offset + 1, offset + valuesPerSample), ports, format)
    });
  }
  return samples;
}
```

Use `state.numberOfFrequencies` to verify count when present:

```ts
if (state.numberOfFrequencies !== undefined && samples.length !== state.numberOfFrequencies) {
  throw new Error(`[Number of Frequencies] expected ${state.numberOfFrequencies} samples, found ${samples.length}.`);
}
```

- [ ] **Step 6: Run tests and commit Task 2**

Run:

```powershell
npm test
```

Expected: all parser tests pass.

Commit:

```powershell
git add src\touchstone.ts src\__tests__\touchstone.test.ts
git commit -m "Support Touchstone 2.x keyword blocks"
```

## Task 3: Preserve Current Single-File S2P Preview

**Files:**
- Modify: `src/extension.ts`
- Modify: `src/__tests__/touchstone.test.ts`

- [ ] **Step 1: Add compatibility tests for `toS2pRows`**

Append:

```ts
import { toS2pRows } from "../touchstone";

test("keeps legacy s2p dB row mapping from the complex model", () => {
  const doc = parseTouchstone("# GHZ S MA R 50\n1 0.5 0 0.9 0 0.01 0 0.4 180", "sample.s2p");
  const rows = toS2pRows(doc);

  assert.equal(rows[0].s11db.toFixed(2), "-6.02");
  assert.equal(rows[0].s21db.toFixed(2), "-0.92");
  assert.equal(rows[0].s12db.toFixed(2), "-40.00");
  assert.equal(rows[0].s22db.toFixed(2), "-7.96");
});
```

- [ ] **Step 2: Run tests**

Run:

```powershell
npm test
```

Expected: pass after Task 1; fail only if adapter was not exported.

- [ ] **Step 3: Update extension parsing**

Change the import in `src/extension.ts`:

```ts
import { S2pRow, parseTouchstone, toS2pRows } from "./touchstone";
```

Change `renderUriIntoWebview`:

```ts
const doc = parseTouchstone(text, basename(uri));
const rows = toS2pRows(doc);
panel.webview.html = renderPreviewHtml(panel.webview, uri, rows, getPassbandSettings());
```

- [ ] **Step 4: Update error copy**

Change the explanatory paragraph in `renderErrorHtml` to:

```ts
<p>Current preview supports Touchstone S-parameter files in MA, DB, or RI format. Single-file metrics are available for 2-port files.</p>
```

- [ ] **Step 5: Run tests and commit Task 3**

Run:

```powershell
npm test
```

Expected: compile and tests pass.

Commit:

```powershell
git add src\extension.ts src\__tests__\touchstone.test.ts
git commit -m "Use Touchstone model in S2P preview"
```

## Task 4: Extension Metadata for S1P Through S4P

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Modify: `README.marketplace.md`

- [ ] **Step 1: Add custom editor selectors**

In `package.json`, replace the single custom editor selector with:

```json
"selector": [
  { "filenamePattern": "*.s1p" },
  { "filenamePattern": "*.s2p" },
  { "filenamePattern": "*.s3p" },
  { "filenamePattern": "*.s4p" }
]
```

- [ ] **Step 2: Add menu conditions for S1P through S4P**

Change both existing menu `when` clauses to:

```json
"resourceExtname == .s1p || resourceExtname == .s2p || resourceExtname == .s3p || resourceExtname == .s4p"
```

- [ ] **Step 3: Update docs support wording**

In `README.md` and `README.marketplace.md`, replace the old support bullets with:

```md
- Supports Touchstone `S`-parameter files in `.s1p`, `.s2p`, `.s3p`, and `.s4p` form.
- Supports Touchstone 1.x option-line files and Touchstone 2.0/2.1 keyword-block files with full matrix network data.
- Single-file passband metrics are available for 2-port files.
```

Replace the unsupported sentence with:

```md
Unsupported for the current release: `Y`/`Z`/`G`/`H` parameter conversion, mixed-mode transformation UI, Smith chart, PNG export, and generic high-port `.sNp` visualization.
```

- [ ] **Step 4: Run metadata/package validation and commit Task 4**

Run:

```powershell
npm test
npm run package
```

Expected: tests pass and `vscode-s2p-preview-0.0.7.vsix` is created or overwritten.

Commit:

```powershell
git add package.json README.md README.marketplace.md
git commit -m "Advertise Touchstone S-parameter support"
```

## Task 5: Overlay Command and Chart Series Model

**Files:**
- Modify: `src/extension.ts`
- Modify: `package.json`

- [ ] **Step 1: Add overlay command contribution**

In `package.json`, add this command:

```json
{
  "command": "s2pPreview.openOverlay",
  "title": "S2P: Preview Selected Files Overlay"
}
```

Add it to `explorer/context`:

```json
{
  "command": "s2pPreview.openOverlay",
  "when": "resourceExtname == .s1p || resourceExtname == .s2p || resourceExtname == .s3p || resourceExtname == .s4p",
  "group": "navigation@2"
}
```

- [ ] **Step 2: Define chart series types**

In `src/extension.ts`, add near `PassbandSettings`:

```ts
interface ChartSeries {
  label: string;
  cssClass: string;
  rows: Array<{ freqGHz: number; db: number }>;
}

interface PreviewModel {
  title: string;
  fileLabel: string;
  rowsForMetrics?: S2pRow[];
  series: ChartSeries[];
}
```

- [ ] **Step 3: Register the overlay command**

In `activate`, add:

```ts
vscode.commands.registerCommand("s2pPreview.openOverlay", async (uri?: vscode.Uri, selectedUris?: vscode.Uri[]) => {
  const uris = uniqueTouchstoneUris(selectedUris && selectedUris.length > 0 ? selectedUris : uri ? [uri] : []);
  if (uris.length === 0) {
    vscode.window.showErrorMessage("S2P Preview: select one or more Touchstone files first.");
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    "s2pPreview",
    `S2P Overlay: ${uris.length} files`,
    vscode.ViewColumn.Beside,
    { enableScripts: true, localResourceRoots: [] }
  );

  attachWebviewMessageHandler(panel);
  await renderOverlayIntoWebview(uris, panel);
})
```

Ensure this registration is included in `context.subscriptions.push(...)`.

- [ ] **Step 4: Add URI helpers**

Add:

```ts
function uniqueTouchstoneUris(uris: readonly vscode.Uri[]): vscode.Uri[] {
  const seen = new Set<string>();
  const result: vscode.Uri[] = [];
  for (const uri of uris) {
    if (!isTouchstoneUri(uri)) {
      continue;
    }
    const key = uri.toString();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(uri);
    }
  }
  return result;
}

function isTouchstoneUri(uri: vscode.Uri): boolean {
  return /\.s[1-4]p$/i.test(uri.path);
}
```

- [ ] **Step 5: Render overlay data**

Add:

```ts
async function renderOverlayIntoWebview(uris: vscode.Uri[], panel: vscode.WebviewPanel): Promise<void> {
  try {
    const series: ChartSeries[] = [];
    for (const [index, uri] of uris.entries()) {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const text = new TextDecoder("utf-8").decode(bytes);
      const doc = parseTouchstone(text, basename(uri));
      series.push({
        label: `${basename(uri)} S21`,
        cssClass: `overlay-${index % 8}`,
        rows: traceDbRows(doc, { toPort: Math.min(2, doc.ports), fromPort: 1 })
      });
    }

    panel.webview.html = renderPreviewHtml(
      panel.webview,
      uris[0],
      {
        title: "S2P Overlay",
        fileLabel: `${uris.length} files`,
        series
      },
      getPassbandSettings()
    );
  } catch (error) {
    panel.webview.html = renderErrorHtml(panel.webview, uris[0], error);
  }
}
```

Update the existing single-file path to create a `PreviewModel` with legacy metrics rows and three default series:

```ts
const model: PreviewModel = {
  title: "S2P Preview",
  fileLabel: vscode.workspace.asRelativePath(uri, false),
  rowsForMetrics: rows,
  series: [
    { label: "S11", cssClass: "s11", rows: rows.map((row) => ({ freqGHz: row.freqGHz, db: row.s11db })) },
    { label: "S21", cssClass: "s21", rows: rows.map((row) => ({ freqGHz: row.freqGHz, db: row.s21db })) },
    { label: "S22", cssClass: "s22", rows: rows.map((row) => ({ freqGHz: row.freqGHz, db: row.s22db })) }
  ]
};
```

- [ ] **Step 6: Refactor rendering functions to consume `PreviewModel`**

Change:

```ts
function renderPreviewHtml(webview: vscode.Webview, uri: vscode.Uri, rows: S2pRow[], settings: PassbandSettings): string
```

to:

```ts
function renderPreviewHtml(webview: vscode.Webview, uri: vscode.Uri, model: PreviewModel, settings: PassbandSettings): string
```

Use all series rows for chart extents:

```ts
const allRows = model.series.flatMap((series) => series.rows);
```

Render series polylines from `model.series`:

```ts
${model.series.map((series) => `<polyline class="curve ${series.cssClass}" points="${line(series.rows)}" />`).join("")}
```

Render a compact legend from `model.series`:

```ts
${model.series.map((series, index) => `<line class="legend-line ${series.cssClass}" x1="${margin.left + 12 + index * 120}" y1="18" x2="${margin.left + 42 + index * 120}" y2="18" /><text x="${margin.left + 50 + index * 120}" y="22">${escapeHtml(series.label)}</text>`).join("")}
```

For passband metrics, pass `model.rowsForMetrics ?? []` into the client script and disable metric rows when no 2-port metrics source exists.

- [ ] **Step 7: Run compile/tests/package and commit Task 5**

Run:

```powershell
npm test
npm run package
```

Expected: compile, tests, and packaging pass.

Commit:

```powershell
git add src\extension.ts package.json
git commit -m "Add Touchstone overlay preview command"
```

## Task 6: Final Verification and Local Install

**Files:**
- Modify: `README.md`
- Modify: `README.marketplace.md`
- Possible generated file: `vscode-s2p-preview-0.0.7.vsix`

- [ ] **Step 1: Run full local verification**

Run:

```powershell
git diff --check
npm test
npm run package
npm audit --audit-level=moderate
```

Expected:

- `git diff --check` prints no whitespace errors.
- `npm test` passes.
- `npm run package` creates `vscode-s2p-preview-0.0.7.vsix`.
- `npm audit --audit-level=moderate` reports 0 vulnerabilities.

- [ ] **Step 2: Inspect packaged metadata**

Run:

```powershell
npx vsce ls .\vscode-s2p-preview-0.0.7.vsix
```

Expected: output includes `package.json`, `out/extension.js`, `README.marketplace.md`, `LICENSE`, `NOTICE`, `media/icon.png`, and does not include `src/__tests__`.

- [ ] **Step 3: Install locally into VS Code Insiders**

Run:

```powershell
code-insiders --install-extension .\vscode-s2p-preview-0.0.7.vsix --force
```

Expected: command reports successful installation or replacement of `applicate2628.vscode-s2p-preview`.

- [ ] **Step 4: Commit docs/package residue if package metadata changed**

Run:

```powershell
git status --short
```

If README/package files changed after Task 5, commit them:

```powershell
git add README.md README.marketplace.md package.json package-lock.json
git commit -m "Update Touchstone preview documentation"
```

Do not bump version and do not push in this task. Version bump and push are handled only by `npm run release:patch` when the local batch is ready to publish.

## Self-Review

- Spec coverage: Task 1 covers the complex data model; Task 2 covers Touchstone 2.0/2.1 keyword blocks and `.s3p`/`.s4p` parser behavior; Task 3 preserves current `.s2p` preview behavior; Task 4 exposes `.s1p` through `.s4p`; Task 5 adds opt-in multi-file overlays; Task 6 verifies package/install. Smith chart and PNG export are intentionally outside this plan and remain separate implementation slices from the approved design.
- Placeholder scan: the plan contains concrete file paths, function names, commands, expected outcomes, and code snippets for each code-changing task.
- Type consistency: parser types use `TouchstoneDocument`, `TouchstoneSample`, `ComplexValue`, `TraceSelector`, and `TraceDbRow`; extension rendering uses `PreviewModel` and `ChartSeries` derived from those parser surfaces.
