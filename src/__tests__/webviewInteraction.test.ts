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
  assert.match(handler[0], /applyNumberInputWheelStep/);
  assert.doesNotMatch(handler[0], /stepUp\(\)/);
  assert.doesNotMatch(handler[0], /stepDown\(\)/);
  assert.match(extensionSource, /addEventListener\("wheel"[\s\S]*passive:\s*false/);
});

test("number input wheel guard avoids browser step-base snapping", () => {
  const extensionSource = readFileSync(resolve(__dirname, "../../src/extension.ts"), "utf8");

  assert.match(extensionSource, /function applyNumberInputWheelStep\(/);
  assert.match(extensionSource, /function numberInputWheelStep\(/);
  assert.match(extensionSource, /function formatNumberInputWheelValue\(/);
});

test("Z0 inputs use a step base that does not snap whole-ohm values to fractional values", () => {
  const extensionSource = readFileSync(resolve(__dirname, "../../src/extension.ts"), "utf8");
  const z0Input = extensionSource.match(/<input class="port-target-input"[\s\S]*?\/>/);

  assert.ok(z0Input, "Expected Z0 target impedance input markup.");
  assert.match(z0Input[0], /step="1"/);
  assert.match(z0Input[0], /min="0"/);
  assert.doesNotMatch(z0Input[0], /min="0\.001"/);
});
