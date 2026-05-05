import test from "node:test";
import assert from "node:assert/strict";
import { pngExportRasterSize } from "../pngExport";

test("pngExportRasterSize exports small charts at high intrinsic resolution", () => {
  const size = pngExportRasterSize(980, 620, 1);
  assert.equal(size.scale, 4);
  assert.equal(size.pixelWidth, 3920);
  assert.equal(size.pixelHeight, 2480);
});

test("pngExportRasterSize respects high-DPI displays without exceeding the export cap", () => {
  const size = pngExportRasterSize(1200, 900, 5);
  assert.equal(size.scale, 5);
  assert.equal(size.pixelWidth, 6000);
  assert.equal(size.pixelHeight, 4500);
});

test("pngExportRasterSize bounds very tall overlay exports", () => {
  const size = pngExportRasterSize(1200, 2400, 2);
  assert.ok(size.scale < 4);
  assert.ok(size.pixelWidth * size.pixelHeight <= 32_000_000);
  assert.ok(size.pixelWidth <= 8192);
  assert.ok(size.pixelHeight <= 8192);
});
