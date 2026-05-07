import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("number inputs handle wheel events without propagating page scroll", () => {
  const extensionSource = readFileSync(resolve(__dirname, "../../src/extension.ts"), "utf8");
  const handler = extensionSource.match(/function installNumberInputWheelGuard\(\)[\s\S]*?\n    \}/);

  assert.ok(handler, "Expected webview script to install a number input wheel guard.");
  assert.match(handler[0], /event\.preventDefault\(\)/);
  assert.match(handler[0], /event\.stopPropagation\(\)/);
  assert.match(handler[0], /stepNumberInputWithWheel\(input, event\.deltaY < 0 \? 1 : -1\)/);
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
