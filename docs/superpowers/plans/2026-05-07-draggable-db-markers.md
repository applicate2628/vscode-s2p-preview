# Draggable dB Markers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add preset-owned draggable dB markers, marker editor controls, marker metrics, settings toggles, and axis-tick background grid behavior to the Touchstone preview.

**Architecture:** Keep marker preset data and sanitization in `src/passband.ts`; keep VS Code settings, command messages, and webview rendering in `src/extension.ts`. The webview owns transient drag state and sends marker arrays only when saving presets, while axis grid ticks stay derived from chart geometry and are never stored.

**Tech Stack:** TypeScript, VS Code extension API, SVG webview rendering, Node test runner, `vsce` packaging.

---

## File Map

- `src/passband.ts`: Owns preset types, default markers, and marker sanitization.
- `src/__tests__/passband.test.ts`: Tests marker sanitization and old preset compatibility.
- `package.json`: Adds preset `markers` schema and feature toggle settings.
- `src/extension.ts`: Wires settings, render data, marker SVG, marker editor, drag handling, preset save/update, and marker metrics.
- `src/__tests__/webviewInteraction.test.ts`: Lightweight static regression tests for webview marker behavior.
- `README.md` and `README.marketplace.md`: Brief feature copy after implementation.

---

### Task 1: Preset Marker Model

**Files:**
- Modify: `src/passband.ts`
- Modify: `src/__tests__/passband.test.ts`

- [ ] **Step 1: Write failing tests for marker defaults and sanitization**

Add imports in `src/__tests__/passband.test.ts`:

```ts
import {
  AUTO_PASSBAND_LABEL,
  DEFAULT_DB_MARKERS,
  DEFAULT_PASSBAND_PRESETS,
  createAutoPassband,
  normalizeDefaultPassbandLabel,
  sanitizePresetMarkers,
  sanitizePresetRenormalize,
  sanitizePresetTraces,
  upsertPassbandPreset,
  userScopedConfigurationValue
} from "../passband";
```

Add tests:

```ts
test("default dB markers match the legacy guide lines", () => {
  assert.deepEqual(DEFAULT_DB_MARKERS, [
    { label: "-3 dB", db: -3 },
    { label: "-15 dB", db: -15 },
    { label: "-20 dB", db: -20 }
  ]);
});

test("sanitizes preset dB markers", () => {
  assert.deepEqual(
    sanitizePresetMarkers([
      { label: "Pass", db: -3 },
      { label: "", db: -15 },
      { label: "bad", db: Number.NaN },
      { db: -20 },
      "skip"
    ]),
    [
      { label: "Pass", db: -3 },
      { label: "-15 dB", db: -15 },
      { label: "-20 dB", db: -20 }
    ]
  );

  assert.deepEqual(sanitizePresetMarkers([{ label: "bad", db: Number.NaN }]), DEFAULT_DB_MARKERS);
  assert.deepEqual(sanitizePresetMarkers(undefined), DEFAULT_DB_MARKERS);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
npm test
```

Expected: compile fails because `DEFAULT_DB_MARKERS` and `sanitizePresetMarkers` are not exported.

- [ ] **Step 3: Implement marker types and sanitizer**

In `src/passband.ts`, extend the preset type and add marker helpers:

```ts
export interface PassbandPreset {
  label: string;
  startGHz: number;
  stopGHz: number;
  traces?: PassbandPresetTrace[];
  renormalize?: PassbandPresetRenormalize;
  markers?: PassbandPresetMarker[];
}

export interface PassbandPresetMarker {
  label: string;
  db: number;
}

export const DEFAULT_DB_MARKERS: PassbandPresetMarker[] = [
  { label: "-3 dB", db: -3 },
  { label: "-15 dB", db: -15 },
  { label: "-20 dB", db: -20 }
];

export function sanitizePresetMarkers(value: unknown): PassbandPresetMarker[] {
  if (!Array.isArray(value)) {
    return DEFAULT_DB_MARKERS.map((marker) => ({ ...marker }));
  }

  const markers: PassbandPresetMarker[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }

    const db = Number(item.db);
    if (!Number.isFinite(db)) {
      continue;
    }

    const rawLabel = typeof item.label === "string" ? item.label.trim() : "";
    markers.push({
      label: rawLabel || `${formatMarkerDb(db)} dB`,
      db
    });
  }

  return markers.length > 0 ? markers : DEFAULT_DB_MARKERS.map((marker) => ({ ...marker }));
}

function formatMarkerDb(db: number): string {
  return Number(db).toFixed(3).replace(/\.?0+$/, "");
}
```

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```powershell
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/passband.ts src/__tests__/passband.test.ts
git commit -m "Add preset marker model"
```

---

### Task 2: Settings Schema and Preset Persistence

**Files:**
- Modify: `package.json`
- Modify: `src/extension.ts`
- Modify: `src/__tests__/webviewInteraction.test.ts`

- [ ] **Step 1: Write failing tests for marker settings and preset payloads**

Add tests to `src/__tests__/webviewInteraction.test.ts`:

```ts
test("webview saves current dB markers with passband presets", () => {
  const extensionSource = readFileSync(resolve(__dirname, "../../src/extension.ts"), "utf8");

  assert.match(extensionSource, /markers\?: PassbandPresetMarker\[\]/);
  assert.match(extensionSource, /markers: currentMarkerPreset\(\)/);
  assert.match(extensionSource, /function currentMarkerPreset\(\)/);
  assert.match(extensionSource, /sanitizePresetMarkers\(item\.markers\)/);
});

test("package exposes marker feature toggles", () => {
  const packageSource = readFileSync(resolve(__dirname, "../../package.json"), "utf8");

  assert.match(packageSource, /"s2pPreview\.markers\.enabled"/);
  assert.match(packageSource, /"s2pPreview\.markers\.editable"/);
  assert.match(packageSource, /"s2pPreview\.markers\.metrics\.enabled"/);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
npm test
```

Expected: tests fail because marker settings and preset payloads are absent.

- [ ] **Step 3: Add `markers` schema to `passbandPresets`**

In `package.json`, inside preset item `properties`, add:

```json
"markers": {
  "type": "array",
  "description": "Optional dB marker lines for this preset.",
  "items": {
    "type": "object",
    "required": ["db"],
    "additionalProperties": false,
    "properties": {
      "label": {
        "type": "string",
        "description": "Marker label shown in the preview."
      },
      "db": {
        "type": "number",
        "description": "Marker level in dB."
      }
    }
  }
}
```

- [ ] **Step 4: Add marker feature toggle settings**

In `package.json`, add configuration properties:

```json
"s2pPreview.markers.enabled": {
  "type": "boolean",
  "default": true,
  "markdownDescription": "Show dB marker lines and marker controls in the preview."
},
"s2pPreview.markers.editable": {
  "type": "boolean",
  "default": true,
  "markdownDescription": "Allow dB marker dragging, adding, deleting, and value editing."
},
"s2pPreview.markers.metrics.enabled": {
  "type": "boolean",
  "default": true,
  "markdownDescription": "Show per-marker metrics in the preview."
}
```

- [ ] **Step 5: Thread marker settings and preset data through `extension.ts`**

Update imports:

```ts
import {
  AUTO_PASSBAND_LABEL,
  DEFAULT_PASSBAND_PRESETS,
  createAutoPassband,
  normalizeDefaultPassbandLabel,
  sanitizePresetMarkers,
  sanitizePresetRenormalize,
  sanitizePresetTraces,
  upsertPassbandPreset,
  userScopedConfigurationValue
} from "./passband";
import type { PassbandPreset, PassbandPresetMarker, PassbandPresetRenormalize, PassbandPresetTrace } from "./passband";
```

Extend `PassbandSettings`:

```ts
interface PassbandSettings {
  presets: PassbandPreset[];
  defaultPresetLabel: string;
  markers: MarkerFeatureSettings;
}

interface MarkerFeatureSettings {
  enabled: boolean;
  editable: boolean;
  metricsEnabled: boolean;
}
```

Add marker state to the `addPreset` message type:

```ts
markers?: PassbandPresetMarker[];
```

In `addPresetFromWebview`, add:

```ts
const markers = sanitizePresetMarkers(message.markers);
nextPreset.markers = markers;
```

In `sanitizePresets`, add:

```ts
const markers = sanitizePresetMarkers(item.markers);
preset.markers = markers;
```

In `getPassbandSettings`, return settings:

```ts
return {
  presets,
  defaultPresetLabel: normalizeDefaultPassbandLabel(presets, configuredDefault),
  markers: markerFeatureSettings(config)
};
```

Add helper:

```ts
function markerFeatureSettings(config: vscode.WorkspaceConfiguration): MarkerFeatureSettings {
  const enabled = config.get<boolean>("markers.enabled", true);
  const editable = config.get<boolean>("markers.editable", true);
  const metricsEnabled = config.get<boolean>("markers.metrics.enabled", true);
  return {
    enabled: enabled !== false,
    editable: editable !== false,
    metricsEnabled: metricsEnabled !== false
  };
}
```

- [ ] **Step 6: Include markers in current preset payload**

In `currentRenormalizePreset` neighborhood, add:

```ts
function currentMarkerPreset() {
  if (!markerState || !Array.isArray(markerState.markers)) {
    return [];
  }

  return markerState.markers
    .map((marker) => ({
      label: typeof marker.label === "string" && marker.label.trim()
        ? marker.label.trim()
        : formatOhm(marker.db) + " dB",
      db: Number(marker.db)
    }))
    .filter((marker) => Number.isFinite(marker.db));
}
```

In the add preset post message:

```js
markers: currentMarkerPreset()
```

- [ ] **Step 7: Run tests and verify GREEN**

Run:

```powershell
npm test
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```powershell
git add package.json src/extension.ts src/__tests__/webviewInteraction.test.ts
git commit -m "Add marker settings and preset persistence"
```

---

### Task 3: Marker Rendering, Editor, and Dragging

**Files:**
- Modify: `src/extension.ts`
- Modify: `src/__tests__/webviewInteraction.test.ts`

- [ ] **Step 1: Write failing tests for marker rendering layers and edit controls**

Add tests:

```ts
test("chart renders axis grid separately from dB marker lines", () => {
  const extensionSource = readFileSync(resolve(__dirname, "../../src/extension.ts"), "utf8");

  assert.match(extensionSource, /class="grid"/);
  assert.match(extensionSource, /class="db-marker-line"/);
  assert.match(extensionSource, /data-marker-index/);
  assert.doesNotMatch(extensionSource, /const guides = \[-3, -15, -20\]/);
});

test("marker editor supports add delete and value editing when enabled", () => {
  const extensionSource = readFileSync(resolve(__dirname, "../../src/extension.ts"), "utf8");

  assert.match(extensionSource, /id="marker-editor"/);
  assert.match(extensionSource, /id="add-marker-button"/);
  assert.match(extensionSource, /function renderMarkerEditor/);
  assert.match(extensionSource, /function installMarkerDragging/);
  assert.match(extensionSource, /setPointerCapture/);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
npm test
```

Expected: marker rendering tests fail.

- [ ] **Step 3: Add marker render helpers**

Change chart render signature:

```ts
function renderChart(series: ChartSeries[], defaultPreset: PassbandPreset, markerSettings: MarkerFeatureSettings): string
```

Replace hardcoded guide lines with:

```ts
const markers = sanitizePresetMarkers(defaultPreset.markers);
const markerSvg = markerSettings.enabled
  ? renderMarkerLines(markers, chart, markerSettings.editable)
  : "";
```

Add helper:

```ts
function renderMarkerLines(markers: PassbandPresetMarker[], chart: ChartGeometry, editable: boolean): string {
  return markers.map((marker, index) => {
    const y = yCoord(marker.db, chart).toFixed(2);
    const label = marker.label || `${formatDb(marker.db)} dB`;
    const dragAttrs = editable ? ` data-marker-index="${index}" tabindex="0"` : "";
    return `
      <g class="db-marker" data-marker-index="${index}">
        <line class="db-marker-line" x1="${chart.margin.left}" y1="${y}" x2="${chart.margin.left + chart.plotWidth}" y2="${y}"${dragAttrs} />
        <text class="db-marker-label" x="${chart.margin.left + chart.plotWidth - 56}" y="${(Number(y) - 5).toFixed(2)}">${escapeHtml(label)}</text>
      </g>
    `;
  }).join("");
}

function formatDb(value: number): string {
  return Number(value).toFixed(3).replace(/\.?0+$/, "");
}
```

- [ ] **Step 4: Add marker editor markup**

After the chart legend in `renderChart`, add:

```ts
${markerSettings.enabled ? renderMarkerEditor(markers, markerSettings.editable) : ""}
```

Add:

```ts
function renderMarkerEditor(markers: PassbandPresetMarker[], editable: boolean): string {
  return `
    <div id="marker-editor" class="marker-editor" data-editable="${editable}">
      <div class="marker-editor-title">dB markers</div>
      <div id="marker-editor-list">
        ${markers.map((marker, index) => renderMarkerEditorRow(marker, index, editable)).join("")}
      </div>
      ${editable ? `<button id="add-marker-button" class="secondary-action" type="button">+ Add marker</button>` : ""}
    </div>
  `;
}

function renderMarkerEditorRow(marker: PassbandPresetMarker, index: number, editable: boolean): string {
  const disabled = editable ? "" : " disabled";
  return `
    <div class="marker-editor-row" data-marker-index="${index}">
      <input class="marker-db-input" type="number" step="1" value="${marker.db}" data-marker-db="${index}"${disabled} />
      <input class="marker-label-input" type="text" value="${escapeHtml(marker.label)}" data-marker-label="${index}"${disabled} />
      ${editable ? `<button class="marker-delete-button" type="button" data-marker-delete="${index}" aria-label="Delete marker">x</button>` : ""}
    </div>
  `;
}
```

- [ ] **Step 5: Add client marker state and drag handlers**

In `renderClientScript`, add marker JSON:

```ts
const markerSettingsJson = jsonForScript(settings.markers);
const markersJson = jsonForScript(sanitizePresetMarkers(resolveInitialPassband(model, settings).markers));
```

Inside the script:

```js
const markerSettings = ${markerSettingsJson};
const DEFAULT_DB_MARKERS = ${jsonForScript(DEFAULT_DB_MARKERS)};
let markerState = {
  markers: ${markersJson}
};
```

Add functions:

```js
function markerDbFromClientY(clientY) {
  const svg = document.querySelector(".chart-wrap svg");
  if (!svg) {
    return Number.NaN;
  }
  const rect = svg.getBoundingClientRect();
  const relativeY = ((clientY - rect.top) / rect.height) * (chart.marginTop + chart.plotHeight + 54);
  const clampedY = Math.min(chart.marginTop + chart.plotHeight, Math.max(chart.marginTop, relativeY));
  return chart.yMax - ((clampedY - chart.marginTop) / chart.plotHeight) * (chart.yMax - chart.yMin);
}

function installMarkerDragging() {
  if (!markerSettings.enabled || !markerSettings.editable) {
    return;
  }

  for (const line of document.querySelectorAll(".db-marker-line[data-marker-index]")) {
    line.addEventListener("pointerdown", (event) => {
      const index = Number(line.dataset.markerIndex);
      if (!Number.isInteger(index) || !markerState.markers[index]) {
        return;
      }
      line.setPointerCapture(event.pointerId);
      const move = (moveEvent) => {
        markerState.markers[index].db = markerDbFromClientY(moveEvent.clientY);
        updateMarkerUi();
      };
      const up = (upEvent) => {
        line.releasePointerCapture(upEvent.pointerId);
        line.removeEventListener("pointermove", move);
        line.removeEventListener("pointerup", up);
      };
      line.addEventListener("pointermove", move);
      line.addEventListener("pointerup", up);
    });
  }
}
```

- [ ] **Step 6: Add marker editor handlers**

Add:

```js
function installMarkerEditor() {
  if (!markerSettings.enabled || !markerSettings.editable) {
    return;
  }

  const addButton = document.getElementById("add-marker-button");
  if (addButton) {
    addButton.addEventListener("click", () => {
      markerState.markers.push({ label: "-30 dB", db: -30 });
      renderMarkerEditorRows();
      updateMarkerUi();
    });
  }

  document.getElementById("marker-editor-list")?.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }
    const dbIndex = Number(target.dataset.markerDb);
    const labelIndex = Number(target.dataset.markerLabel);
    if (Number.isInteger(dbIndex) && markerState.markers[dbIndex]) {
      markerState.markers[dbIndex].db = Number(target.value);
      updateMarkerUi();
    }
    if (Number.isInteger(labelIndex) && markerState.markers[labelIndex]) {
      markerState.markers[labelIndex].label = target.value;
      updateMarkerUi();
    }
  });

  document.getElementById("marker-editor-list")?.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const index = Number(target.dataset.markerDelete);
    if (Number.isInteger(index)) {
      markerState.markers.splice(index, 1);
      renderMarkerEditorRows();
      updateMarkerUi();
    }
  });
}
```

- [ ] **Step 7: Add marker update functions and styles**

Add:

```js
function updateMarkerUi() {
  markerState.markers.forEach((marker, index) => {
    const yValue = y(marker.db);
    const group = document.querySelector('.db-marker[data-marker-index="' + index + '"]');
    const line = group?.querySelector(".db-marker-line");
    const label = group?.querySelector(".db-marker-label");
    if (line) {
      line.setAttribute("y1", yValue.toFixed(2));
      line.setAttribute("y2", yValue.toFixed(2));
    }
    if (label) {
      label.setAttribute("y", (yValue - 5).toFixed(2));
      label.textContent = marker.label || formatOhm(marker.db) + " dB";
    }
  });
  updatePassband();
}
```

Add CSS:

```css
.db-marker-line { stroke: var(--vscode-charts-purple, #8e75ff); stroke-width: 1.4; stroke-dasharray: 7 5; cursor: ns-resize; }
.db-marker-label { fill: var(--muted); font-size: 12px; }
.marker-editor { margin-top: 10px; display: grid; gap: 6px; }
.marker-editor-row { display: grid; grid-template-columns: 90px minmax(120px, 1fr) 28px; gap: 6px; align-items: center; }
.marker-editor input { min-width: 0; }
```

- [ ] **Step 8: Run tests and verify GREEN**

Run:

```powershell
npm test
```

Expected: all tests pass.

- [ ] **Step 9: Commit**

```powershell
git add src/extension.ts src/__tests__/webviewInteraction.test.ts
git commit -m "Add draggable dB marker UI"
```

---

### Task 4: Marker Metrics

**Files:**
- Modify: `src/extension.ts`
- Modify: `src/__tests__/webviewInteraction.test.ts`

- [ ] **Step 1: Write failing tests for marker metrics**

Add tests:

```ts
test("marker metrics are generated from marker values instead of fixed thresholds", () => {
  const extensionSource = readFileSync(resolve(__dirname, "../../src/extension.ts"), "utf8");

  assert.match(extensionSource, /function updateMarkerMetrics\(\)/);
  assert.match(extensionSource, /markerState\.markers\.forEach/);
  assert.match(extensionSource, /row\.db >= marker\.db/);
  assert.match(extensionSource, /row\.db <= marker\.db/);
  assert.doesNotMatch(extensionSource, /s21db >= -3 && row\.s11db <= -15/);
});

test("marker metrics can be disabled independently from marker lines", () => {
  const extensionSource = readFileSync(resolve(__dirname, "../../src/extension.ts"), "utf8");

  assert.match(extensionSource, /markerSettings\.metricsEnabled/);
  assert.match(extensionSource, /id="marker-metrics"/);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
npm test
```

Expected: marker metric tests fail.

- [ ] **Step 3: Serialize current chart series rows to the client**

In `renderClientScript`, add:

```ts
const seriesRowsJson = jsonForScript(model.series.map((item, index) => ({
  index,
  label: item.label,
  selector: item.selector,
  defaultVisible: item.defaultVisible,
  rows: item.rows
})));
```

Inside the script:

```js
let currentSeriesRows = ${seriesRowsJson};
```

In `updateRenormalizedPreview`, after `updateChartSeries(message.seriesRows);`, add:

```js
currentSeriesRows = currentSeriesRows.map((series, index) => ({
  ...series,
  rows: Array.isArray(message.seriesRows[index]) ? message.seriesRows[index] : series.rows
}));
```

- [ ] **Step 4: Render marker metrics container**

In `renderMetrics`, add below the existing table:

```ts
${settings.markers.enabled && settings.markers.metricsEnabled ? `<div id="marker-metrics" class="marker-metrics"></div>` : ""}
```

If passing `settings` into `renderMetrics` is cleaner, change signature to:

```ts
function renderMetrics(defaultPreset: PassbandPreset, settings: PassbandSettings, metricRows?: S2pRow[]): string
```

- [ ] **Step 5: Implement neutral marker metrics**

Add client function:

```js
function updateMarkerMetrics() {
  const container = document.getElementById("marker-metrics");
  if (!container || !markerSettings.enabled || !markerSettings.metricsEnabled) {
    return;
  }

  const startGHz = Number(startInput.value);
  const stopGHz = Number(stopInput.value);
  const visibleKeys = new Set(
    traceInputs
      .filter((input) => input.checked)
      .map((input) => input.dataset.traceTo + ":" + input.dataset.traceFrom)
  );

  const sections = [];
  markerState.markers.forEach((marker) => {
    const rows = [];
    for (const series of currentSeriesRows) {
      const key = series.selector ? series.selector.toPort + ":" + series.selector.fromPort : "";
      if (key && !visibleKeys.has(key)) {
        continue;
      }
      const passbandRows = series.rows.filter((row) => row.freqGHz >= startGHz && row.freqGHz <= stopGHz);
      const aboveBands = clipBands(findSeriesBands(passbandRows, (row) => row.db >= marker.db), startGHz, stopGHz);
      const belowBands = clipBands(findSeriesBands(passbandRows, (row) => row.db <= marker.db), startGHz, stopGHz);
      rows.push(
        "<tr><th>" + escapeHtml(series.label) + " >= " + formatOhm(marker.db) + " dB</th><td>" + formatBands(aboveBands) + " (" + coverageGHz(aboveBands).toFixed(2) + " GHz)</td></tr>",
        "<tr><th>" + escapeHtml(series.label) + " <= " + formatOhm(marker.db) + " dB</th><td>" + formatBands(belowBands) + " (" + coverageGHz(belowBands).toFixed(2) + " GHz)</td></tr>"
      );
    }
    sections.push("<h3>" + escapeHtml(marker.label || formatOhm(marker.db) + " dB") + "</h3><table><tbody>" + rows.join("") + "</tbody></table>");
  });

  container.innerHTML = sections.join("");
}

function findSeriesBands(rows, predicate) {
  const bands = [];
  let activeStart = null;
  let activeEnd = null;
  for (const row of rows) {
    if (predicate(row)) {
      if (activeStart === null) {
        activeStart = row.freqGHz;
      }
      activeEnd = row.freqGHz;
    } else if (activeStart !== null) {
      bands.push({ startGHz: activeStart, endGHz: activeEnd });
      activeStart = null;
      activeEnd = null;
    }
  }
  if (activeStart !== null) {
    bands.push({ startGHz: activeStart, endGHz: activeEnd });
  }
  return bands;
}
```

Call `updateMarkerMetrics()` from `updatePassband()` after legacy metrics update and from `updateMarkerUi()`.

- [ ] **Step 6: Preserve legacy metrics for now**

Keep the existing rows for Best S21, Worst S11, Worst S22, Average S21.
Replace only hardcoded threshold rows or mark them as legacy if they remain.
If keeping legacy threshold rows, ensure marker metric tests do not fail by moving fixed-threshold logic behind clearly named legacy helpers.

- [ ] **Step 7: Run tests and verify GREEN**

Run:

```powershell
npm test
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```powershell
git add src/extension.ts src/__tests__/webviewInteraction.test.ts
git commit -m "Add marker metrics"
```

---

### Task 5: Documentation, Manual Check, and Package Verification

**Files:**
- Modify: `README.md`
- Modify: `README.marketplace.md`

- [ ] **Step 1: Update README feature copy**

In both README files, replace the fixed guide-line bullet with:

```md
- Shows editable preset-owned dB markers with optional per-marker metrics.
```

Add a short settings note near preset usage:

```md
Marker lines are saved with presets. Use `s2pPreview.markers.enabled`, `s2pPreview.markers.editable`, and `s2pPreview.markers.metrics.enabled` to hide marker UI, lock marker editing, or hide marker metrics.
```

- [ ] **Step 2: Run full validation**

Run:

```powershell
npm test
npm run package
npm audit --audit-level=moderate
git diff --check
```

Expected:

- `npm test`: all tests pass.
- `npm run package`: produces `vscode-s2p-preview-0.0.20.vsix` or current package version.
- `npm audit --audit-level=moderate`: `found 0 vulnerabilities`.
- `git diff --check`: no output, exit code 0.

- [ ] **Step 3: Install and manually verify in isolated VS Code profile**

Run:

```powershell
$repo = (Resolve-Path .).Path
$vsix = Get-ChildItem -Path $repo -Filter "vscode-s2p-preview-*.vsix" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$userData = Join-Path $repo ".scratch\vscode-s2p-marker-user-data"
$extensions = Join-Path $repo ".scratch\vscode-s2p-marker-extensions"
code-insiders --user-data-dir $userData --extensions-dir $extensions --install-extension $vsix.FullName --force
Start-Process -FilePath code-insiders -ArgumentList @('--user-data-dir', $userData, '--extensions-dir', $extensions, '-n', $repo)
```

Manual acceptance:

- Old presets show default `-3`, `-15`, `-20` markers.
- Marker drag changes the line and editor value.
- Adding and deleting markers works.
- Saving a preset persists markers.
- Settings can disable markers, editing, and marker metrics independently.
- Axis grid remains visible and does not follow marker values.
- PNG export includes visible marker lines and the grid.

- [ ] **Step 4: Commit docs and any final fixes**

```powershell
git add README.md README.marketplace.md src/extension.ts src/__tests__/webviewInteraction.test.ts src/passband.ts src/__tests__/passband.test.ts package.json
git commit -m "Document draggable dB markers"
```

---

## Self-Review

Spec coverage:

- Preset-owned markers: Task 1 and Task 2.
- Default marker fallback: Task 1.
- Drag plus list editing: Task 3.
- Axis grid independent from markers: Task 3.
- Marker metrics: Task 4.
- Settings toggles: Task 2, Task 3, Task 4, Task 5.
- Manual and package verification: Task 5.

No placeholders are intentionally left. All paths are repo-relative and all commands are PowerShell-compatible for the current Windows workflow.

## Terms and Abbreviations

- `dB`: decibel, logarithmic magnitude unit used for S-parameter plots.
- `GHz`: gigahertz, frequency unit used on the X axis.
- `PNG`: Portable Network Graphics image export format.
- `S-parameter`: scattering parameter data used for RF network analysis.
- `VSIX`: packaged install format for VS Code extensions.
- `Z0`: reference impedance used for S-parameter normalization.
