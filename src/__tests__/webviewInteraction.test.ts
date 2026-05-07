import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("number inputs handle wheel events without propagating page scroll", () => {
  const extensionSource = readFileSync(resolve(__dirname, "../../src/extension.ts"), "utf8");
  const handler = extensionSource.match(/function installNumberInputWheelGuard\(\)[\s\S]*?\n    \}/);

  assert.ok(handler, "Expected webview script to install a number input wheel guard.");
  assert.match(handler[0], /document\.addEventListener\("wheel"/);
  assert.match(handler[0], /event\.preventDefault\(\)/);
  assert.match(handler[0], /event\.stopPropagation\(\)/);
  assert.match(handler[0], /stepNumberInputWithWheel\(input, event\.deltaY < 0 \? 1 : -1\)/);
  assert.doesNotMatch(handler[0], /querySelectorAll\("input\[type=number\]"\)/);
  assert.match(extensionSource, /addEventListener\("wheel"[\s\S]*passive:\s*false/);
});

test("number input wheel uses the native spin button step path", () => {
  const extensionSource = readFileSync(resolve(__dirname, "../../src/extension.ts"), "utf8");
  const stepper = extensionSource.match(/function stepNumberInputWithWheel\(input, direction\)[\s\S]*?\n    \}/);

  assert.ok(stepper, "Expected wheel to use a dedicated native spin helper.");
  assert.match(stepper[0], /input\.stepUp\(\)/);
  assert.match(stepper[0], /input\.stepDown\(\)/);
  assert.match(stepper[0], /input\.dispatchEvent\(new Event\("input", \{ bubbles: true \}\)\)/);
  assert.doesNotMatch(stepper[0], /Math\.floor|Math\.ceil|:\s*0;/);
});

test("Z0 inputs use a step base that does not snap whole-ohm values to fractional values", () => {
  const extensionSource = readFileSync(resolve(__dirname, "../../src/extension.ts"), "utf8");
  const z0Input = extensionSource.match(/<input class="port-target-input"[\s\S]*?\/>/);

  assert.ok(z0Input, "Expected Z0 target impedance input markup.");
  assert.match(z0Input[0], /step="1"/);
  assert.match(z0Input[0], /min="0"/);
  assert.doesNotMatch(z0Input[0], /min="0\.001"/);
});

test("Z0 controls expose a link toggle for synchronous target impedance edits", () => {
  const extensionSource = readFileSync(resolve(__dirname, "../../src/extension.ts"), "utf8");

  assert.match(extensionSource, /id="z0-link-button"/);
  assert.match(extensionSource, /aria-pressed="\$\{z0Linked\}"/);
  assert.match(extensionSource, /data-z0-linked="\$\{z0Linked\}"/);
  assert.match(extensionSource, /function initialZ0TargetsLinked\(/);
});

test("linked Z0 edits apply deltas without selecting every port", () => {
  const extensionSource = readFileSync(resolve(__dirname, "../../src/extension.ts"), "utf8");

  assert.match(extensionSource, /const z0LinkButton = document\.getElementById\("z0-link-button"\)/);
  assert.match(extensionSource, /let z0InputsLinked = z0LinkButton \? z0LinkButton\.dataset\.z0Linked === "true" : false;/);
  assert.match(extensionSource, /let previousZ0TargetValues = targetOhmsInputs\.map\(numberInputValue\);/);
  assert.match(extensionSource, /function synchronizeZ0TargetInputs\(sourceInput, deltaOhms\)/);
  assert.match(extensionSource, /function z0TargetPortSelected\(input\)/);
  assert.match(extensionSource, /input !== sourceInput && z0TargetPortSelected\(input\)/);
  assert.match(extensionSource, /input\.value = formatZ0TargetValue\(base \+ deltaOhms\);/);
  assert.match(extensionSource, /if \(z0InputsLinked && z0TargetPortSelected\(input\) && Number\.isFinite\(deltaOhms\)\) \{\s+synchronizeZ0TargetInputs\(input, deltaOhms\);/);
  assert.doesNotMatch(extensionSource, /input\.value = sourceInput\.value/);
  assert.doesNotMatch(extensionSource, /portInputs\.forEach\([\s\S]*?checked = true/);
});

test("Z0 target edits preserve checkbox state before synchronizing checked targets", () => {
  const extensionSource = readFileSync(resolve(__dirname, "../../src/extension.ts"), "utf8");
  const handler = extensionSource.match(/function handleZ0TargetInput\(input\)[\s\S]*?\n    \}/);

  assert.ok(handler, "Expected one Z0 target input handler.");
  assert.doesNotMatch(handler[0], /checked\s*=\s*true/);
  assert.match(handler[0], /const deltaOhms = currentValue - previousValue;/);
  assert.match(handler[0], /if \(z0InputsLinked && z0TargetPortSelected\(input\) && Number\.isFinite\(deltaOhms\)\) \{[\s\S]*?synchronizeZ0TargetInputs\(input, deltaOhms\);/);
  assert.match(handler[0], /syncPreviousZ0TargetValues\(\);/);
});

test("Z0 link toggle snapshots current values without equalizing targets", () => {
  const extensionSource = readFileSync(resolve(__dirname, "../../src/extension.ts"), "utf8");
  const linkHandler = extensionSource.match(/z0LinkButton\.addEventListener\("click", \(\) => \{[\s\S]*?\n      \}\);/);

  assert.ok(linkHandler, "Expected a Z0 link button handler.");
  assert.match(linkHandler[0], /setZ0InputsLinked\(!z0InputsLinked\);/);
  assert.match(linkHandler[0], /syncPreviousZ0TargetValues\(\);/);
  assert.doesNotMatch(linkHandler[0], /handleZ0TargetInput|synchronizeZ0TargetInputs/);
});

test("Z0 target inputs still share the same change path for typing and native spin buttons", () => {
  const extensionSource = readFileSync(resolve(__dirname, "../../src/extension.ts"), "utf8");

  assert.match(extensionSource, /function handleZ0TargetInput\(input\)/);
  assert.match(extensionSource, /input\.addEventListener\("input", \(\) => \{\s+handleZ0TargetInput\(input\);/);
});

test("webview saves current dB markers with passband presets", () => {
  const extensionSource = readFileSync(resolve(__dirname, "../../src/extension.ts"), "utf8");

  assert.match(extensionSource, /markers\?: PassbandPresetMarker\[\]/);
  assert.match(extensionSource, /markers: markerSettings\.enabled \? currentMarkerPreset\(\) : undefined/);
  assert.match(extensionSource, /function currentMarkerPreset\(\)/);
  assert.match(extensionSource, /return sanitizeClientMarkers\(markerState\.markers\);/);
  assert.match(extensionSource, /sanitizePresetMarkers\(item\.markers\)/);
});

test("package exposes marker feature toggles", () => {
  const packageSource = readFileSync(resolve(__dirname, "../../package.json"), "utf8");

  assert.match(packageSource, /"s2pPreview\.markers\.enabled"/);
  assert.match(packageSource, /"s2pPreview\.markers\.editable"/);
  assert.match(packageSource, /"s2pPreview\.markers\.metrics\.enabled"/);
  assert.match(packageSource, /"maxItems":\s*10/);
  assert.match(packageSource, /"maxLength":\s*64/);
  assert.match(packageSource, /"minimum":\s*-200/);
  assert.match(packageSource, /"maximum":\s*200/);
});

test("chart renders axis grid separately from dB marker lines", () => {
  const extensionSource = readFileSync(resolve(__dirname, "../../src/extension.ts"), "utf8");

  assert.match(extensionSource, /class="grid"/);
  assert.match(extensionSource, /id="marker-layer"/);
  assert.match(extensionSource, /class="db-marker-line"/);
  assert.match(extensionSource, /class="db-marker-handle"/);
  assert.match(extensionSource, /data-marker-index/);
  assert.doesNotMatch(extensionSource, /const guides = \[-3, -15, -20\]/);
});

test("marker names stay on lines and dB values render as smaller y-axis labels", () => {
  const extensionSource = readFileSync(resolve(__dirname, "../../src/extension.ts"), "utf8");

  assert.match(extensionSource, /class="db-marker-label"/);
  assert.match(extensionSource, /class="db-marker-axis-label"/);
  assert.match(extensionSource, /const label = marker\.label;/);
  assert.match(extensionSource, /formatMarkerAxisLabel\(marker\.db\)/);
  assert.match(extensionSource, /db-marker-axis-label" x="\$\{chart\.margin\.left \+ 8\}" y="\$\{\(Number\(y\) - 5\)\.toFixed\(2\)\}"/);
  assert.match(extensionSource, /db-marker-axis-label" x="' \+ \(chart\.marginLeft \+ 8\) \+ '" y="' \+ \(Number\(markerY\) - 5\)\.toFixed\(2\)/);
  assert.match(extensionSource, /\.db-marker-axis-label \{[\s\S]*font-size: 10px/);
  assert.doesNotMatch(extensionSource, /marker\.label \|\| formatDb/);
  assert.doesNotMatch(extensionSource, /marker\.label \|\| `\$\{formatDbLabel\(marker\.db\)\} dB`/);
});

test("marker editor supports add delete value editing and delegated dragging", () => {
  const extensionSource = readFileSync(resolve(__dirname, "../../src/extension.ts"), "utf8");

  assert.match(extensionSource, /id="marker-editor"/);
  assert.match(extensionSource, /id="marker-editor-list"/);
  assert.match(extensionSource, /id="add-marker-button"/);
  assert.match(extensionSource, /function renderMarkerEditor/);
  assert.match(extensionSource, /function renderMarkerEditorRows\(\)/);
  assert.match(extensionSource, /function syncMarkerDom/);
  assert.match(extensionSource, /function installMarkerDragging\(\)/);
  assert.match(extensionSource, /createSVGPoint\(\)/);
  assert.match(extensionSource, /getScreenCTM\(\)\.inverse\(\)/);
  assert.match(extensionSource, /setPointerCapture/);
  assert.match(extensionSource, /markerState\.markers\.push\(\{ label: "m" \+ \(markerState\.markers\.length \+ 1\), db: -30 \}\)/);
});

test("marker live edits are bounded before rendering or posting", () => {
  const extensionSource = readFileSync(resolve(__dirname, "../../src/extension.ts"), "utf8");

  assert.match(extensionSource, /function sanitizeClientMarker\(marker\)/);
  assert.match(extensionSource, /function clampMarkerDb\(db\)/);
  assert.match(extensionSource, /Math\.min\(MARKER_DB_MAX, Math\.max\(MARKER_DB_MIN, db\)\)/);
  assert.match(extensionSource, /const label = typeof marker\?\.label === "string"[\s\S]*: "";/);
  assert.match(extensionSource, /markerState\.markers\[dbIndex\] = normalized \|\| markerState\.markers\[dbIndex\];/);
  assert.match(extensionSource, /markerState\.markers\[labelIndex\] = normalized \|\| markerState\.markers\[labelIndex\];/);
  assert.match(extensionSource, /const db = clampMarkerDb\(markerDbFromPointerEvent\(event\)\);/);
});

test("marker dB inputs allow incomplete negative typing before committing", () => {
  const extensionSource = readFileSync(resolve(__dirname, "../../src/extension.ts"), "utf8");
  const inputHandler = extensionSource.match(/markerEditorList\.addEventListener\("input", \(event\) => \{[\s\S]*?\n      \}\);/);

  assert.ok(inputHandler, "Expected marker editor input handler.");
  assert.match(extensionSource, /function parseMarkerDbInput\(input\)/);
  assert.match(extensionSource, /input\.validity\.badInput/);
  assert.match(extensionSource, /raw === "-"/);
  assert.match(inputHandler[0], /const db = parseMarkerDbInput\(event\.target\);/);
  assert.doesNotMatch(inputHandler[0], /event\.target\.value = formatDb/);
});

test("marker state follows selected presets and marker feature settings", () => {
  const extensionSource = readFileSync(resolve(__dirname, "../../src/extension.ts"), "utf8");
  const settingsHandler = extensionSource.match(/if \(message\.type === "settingsUpdated"\) \{[\s\S]*?\n      \}/);

  assert.match(extensionSource, /const markerSettings = settings\.markers/);
  assert.match(extensionSource, /function applyMarkerPreset\(markers\)/);
  assert.match(extensionSource, /applyMarkerPreset\(preset\.markers\)/);
  assert.match(extensionSource, /markerSettings\.enabled/);
  assert.match(extensionSource, /markerSettings\.editable/);
  assert.match(extensionSource, /function nextActivePresetLabel\(previousActiveLabel, previousDefaultLabel\)/);
  assert.ok(settingsHandler, "Expected a settings update message handler.");
  assert.match(settingsHandler[0], /const previousActivePresetLabel = activePresetLabel;/);
  assert.match(settingsHandler[0], /const previousDefaultPresetLabel = settings\.defaultPresetLabel;/);
  assert.match(settingsHandler[0], /activePresetLabel = nextActivePresetLabel\(previousActivePresetLabel, previousDefaultPresetLabel\);/);
  assert.doesNotMatch(settingsHandler[0], /activePresetLabel = settings\.defaultPresetLabel;/);
  assert.match(extensionSource, /let activePresetLabel = initialActivePresetLabel\(\);/);
  assert.match(extensionSource, /function persistWebviewState\(\)/);
  assert.match(extensionSource, /vscode\.setState\(\{[\s\S]*activePresetLabel[\s\S]*\}\);/);
});

test("marker editor keeps add button available across editability setting changes", () => {
  const extensionSource = readFileSync(resolve(__dirname, "../../src/extension.ts"), "utf8");

  assert.match(extensionSource, /<button id="add-marker-button" class="secondary-action marker-add-button" type="button"/);
  assert.match(extensionSource, /addMarkerButton\.hidden = !markerSettings\.enabled \|\| !markerSettings\.editable;/);
  assert.doesNotMatch(extensionSource, /editable \? `<button id="add-marker-button"/);
});

test("marker metrics are generated from marker values instead of fixed thresholds", () => {
  const extensionSource = readFileSync(resolve(__dirname, "../../src/extension.ts"), "utf8");

  assert.match(extensionSource, /let currentSeriesRows =/);
  assert.match(extensionSource, /function updateMarkerMetrics\(\)/);
  assert.match(extensionSource, /markerState\.markers\.forEach/);
  assert.match(extensionSource, /row\.db >= marker\.db/);
  assert.match(extensionSource, /row\.db <= marker\.db/);
});

test("marker metrics can be disabled independently from marker lines", () => {
  const extensionSource = readFileSync(resolve(__dirname, "../../src/extension.ts"), "utf8");

  assert.match(extensionSource, /markerSettings\.metricsEnabled/);
  assert.match(extensionSource, /id="marker-metrics"/);
  assert.match(extensionSource, /settings\.markers\.enabled \? sanitizePresetMarkers/);
  assert.match(extensionSource, /settings\.markers\.enabled && settings\.markers\.metricsEnabled[\s\S]*model\.series\.map/);
  assert.match(extensionSource, /const seriesRows = markerSettings\.enabled && markerSettings\.metricsEnabled \? markerMetricSeriesRows : \[\];/);
});

test("disabled marker settings do not send preset marker payloads to webviews", () => {
  const extensionSource = readFileSync(resolve(__dirname, "../../src/extension.ts"), "utf8");

  assert.match(extensionSource, /broadcastSettingsUpdated\(activePreviewPanels, webviewPassbandSettings\(getPassbandSettings\(\)\)/);
  assert.match(extensionSource, /const settingsJson = jsonForScript\(webviewPassbandSettings\(settings\)\);/);
  assert.match(extensionSource, /function webviewPassbandSettings\(settings: PassbandSettings\): PassbandSettings/);
  assert.match(extensionSource, /presets: settings\.presets\.map\(stripPresetMarkers\)/);
  assert.match(extensionSource, /function stripPresetMarkers\(preset: PassbandPreset\): PassbandPreset/);
});
