import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function cssValue(rule: string, property: string): string | undefined {
  const match = rule.match(new RegExp(`${property}\\s*:\\s*([^;}]+)`));
  return match ? match[1].trim() : undefined;
}

test("chart SVG has no fixed minimum width", () => {
  const extensionSource = readFileSync(resolve(__dirname, "../../src/extension.ts"), "utf8");
  const svgRule = extensionSource.match(/svg\s*\{[^}]*\}/);

  assert.ok(svgRule, "Expected the webview stylesheet to include an svg rule.");
  const minWidth = cssValue(svgRule[0], "min-width");
  assert.ok(minWidth === undefined || minWidth === "0", `Expected no positive chart SVG min-width, got ${minWidth}.`);
});

test("chart container does not force page-level horizontal overflow", () => {
  const extensionSource = readFileSync(resolve(__dirname, "../../src/extension.ts"), "utf8");
  const chartWrapRule = extensionSource.match(/\.chart-wrap\s*\{[^}]*\}/);
  const svgRule = extensionSource.match(/svg\s*\{[^}]*\}/);
  const metricsRule = extensionSource.match(/\.metrics\s*\{[^}]*\}/);
  const traceControlsRule = extensionSource.match(/\.trace-controls\s*\{[^}]*\}/);

  assert.ok(chartWrapRule, "Expected the webview stylesheet to include a chart-wrap rule.");
  assert.ok(svgRule, "Expected the webview stylesheet to include an svg rule.");
  assert.ok(metricsRule, "Expected the webview stylesheet to include a metrics rule.");
  assert.ok(traceControlsRule, "Expected the webview stylesheet to include a trace-controls rule.");

  assert.match(chartWrapRule[0], /min-width\s*:\s*0\b/);
  assert.match(chartWrapRule[0], /max-width\s*:\s*100%/);
  assert.match(svgRule[0], /min-width\s*:\s*0\b/);
  assert.match(svgRule[0], /max-width\s*:\s*100%/);
  assert.match(metricsRule[0], /overflow-x\s*:\s*auto/);
  assert.match(traceControlsRule[0], /overflow-x\s*:\s*auto/);
});
