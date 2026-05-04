import assert from "node:assert/strict";
import test from "node:test";
import * as previewModel from "../previewModel";
import type { PreviewModel } from "../previewModel";
import { parseTouchstone } from "../touchstone";

test("builds a one-port preview model with S11 and no two-port metrics", () => {
  const doc = parseTouchstone("# GHZ S MA R 50\n1 0.5 0\n2 0.25 0", "sample.s1p");
  const model = previewModel.buildPreviewModel(doc, "sample.s1p");

  assert.equal(model.title, "S1P Preview");
  assert.equal(model.fileLabel, "sample.s1p");
  assert.equal(model.metricRows, undefined);
  assert.deepEqual(model.series.map((series) => series.label), ["S11"]);
  assert.equal(model.series[0].rows[0].db.toFixed(2), "-6.02");
});

test("keeps two-port preview metrics and exposes the full S-parameter matrix", () => {
  const doc = parseTouchstone("# GHZ S MA R 50\n1 0.5 0 0.9 0 0.01 0 0.4 180", "sample.s2p");
  const model = previewModel.buildPreviewModel(doc, "sample.s2p");

  assert.equal(model.title, "S2P Preview");
  assert.deepEqual(model.series.map((series) => series.label), ["S11", "S12", "S21", "S22"]);
  assert.deepEqual(model.series.map((series) => series.groupLabel), [undefined, undefined, undefined, undefined]);
  assert.deepEqual(
    model.series.filter((series) => series.defaultVisible).map((series) => series.label),
    ["S11", "S21", "S22"]
  );
  assert.equal(model.metricRows?.[0].s21db.toFixed(2), "-0.92");
  assert.equal(model.series.find((series) => series.label === "S21")?.rows[0].db.toFixed(2), "-0.92");
  assert.deepEqual(model.impedance?.targetOhms, [50, 50]);
  assert.deepEqual(model.impedance?.selectedPorts, [false, false]);
});

test("starts mixed-reference previews with per-port targets and no enabled normalization", () => {
  const doc = parseTouchstone(
    [
      "[Version] 2.1",
      "# GHZ S RI R 50",
      "[Number of Ports] 2",
      "[Reference] 50 75",
      "[Network Data]",
      "1 0.2 0 0 0 0 0 0.2 0",
      "[End]"
    ].join("\n"),
    "mixed.s2p"
  );
  const model = previewModel.buildPreviewModel(doc, "mixed.s2p");

  assert.deepEqual(model.impedance?.referenceOhms, [50, 75]);
  assert.deepEqual(model.impedance?.targetOhms, [50, 75]);
  assert.deepEqual(model.impedance?.selectedPorts, [false, false]);
  assert.deepEqual(model.impedance?.samples[0].matrix[1][1], { re: 0.2, im: 0 });
});

test("builds an n-port preview model with default curves and no two-port metrics", () => {
  const doc = parseTouchstone(
    [
      "# GHZ S RI R 50",
      "1",
      "0.1 0 0.2 0 0.3 0",
      "0.4 0 0.5 0 0.6 0",
      "0.7 0 0.8 0 0.9 0"
    ].join("\n"),
    "sample.s3p"
  );
  const model = previewModel.buildPreviewModel(doc, "sample.s3p");

  assert.equal(model.title, "S3P Preview");
  assert.equal(model.metricRows, undefined);
  assert.deepEqual(model.series.map((series) => series.label), [
    "S11", "S12", "S13",
    "S21", "S22", "S23",
    "S31", "S32", "S33"
  ]);
  assert.deepEqual(
    model.series.filter((series) => series.defaultVisible).map((series) => series.label),
    ["S11", "S21", "S31"]
  );
  assert.equal(model.series.find((series) => series.label === "S21")?.rows[0].db.toFixed(2), "-7.96");
});

test("builds a four-port preview model with every Sij selector available", () => {
  const doc = parseTouchstone(
    [
      "# GHZ S RI R 50",
      "1",
      "0.11 0 0.12 0 0.13 0 0.14 0",
      "0.21 0 0.22 0 0.23 0 0.24 0",
      "0.31 0 0.32 0 0.33 0 0.34 0",
      "0.41 0 0.42 0 0.43 0 0.44 0"
    ].join("\n"),
    "sample.s4p"
  );
  const model = previewModel.buildPreviewModel(doc, "sample.s4p");

  assert.equal(model.title, "S4P Preview");
  assert.deepEqual(model.series.map((series) => series.label), [
    "S11", "S12", "S13", "S14",
    "S21", "S22", "S23", "S24",
    "S31", "S32", "S33", "S34",
    "S41", "S42", "S43", "S44"
  ]);
  assert.deepEqual(
    model.series.filter((series) => series.defaultVisible).map((series) => series.label),
    ["S11", "S21", "S31", "S41"]
  );
  assert.equal(model.series.find((series) => series.label === "S34")?.rows[0].db.toFixed(2), "-9.37");
});

test("builds an overlay preview model with every common two-port trace", () => {
  const first = parseTouchstone("# GHZ S MA R 50\n1 0.5 0 0.8 0 0.01 0 0.4 0", "m_000.s2p");
  const second = parseTouchstone("# GHZ S MA R 50\n1 0.4 0 0.7 0 0.02 0 0.3 0", "m_001.s2p");
  const model = buildOverlayPreviewModel([
    { doc: first, fileLabel: "m_000.s2p" },
    { doc: second, fileLabel: "m_001.s2p" }
  ]);

  assert.equal(model.title, "S2P Overlay");
  assert.equal(model.fileLabel, "2 files, 4 traces");
  assert.equal(model.metricRows, undefined);
  assert.deepEqual(model.series.map((series) => series.label), [
    "m_000.s2p S11", "m_000.s2p S12", "m_000.s2p S21", "m_000.s2p S22",
    "m_001.s2p S11", "m_001.s2p S12", "m_001.s2p S21", "m_001.s2p S22"
  ]);
  assert.deepEqual(
    model.series.filter((series) => series.defaultVisible).map((series) => series.label),
    ["m_000.s2p S11", "m_000.s2p S21", "m_000.s2p S22", "m_001.s2p S11", "m_001.s2p S21", "m_001.s2p S22"]
  );
  assert.equal(model.series.find((series) => series.label === "m_000.s2p S21")?.rows[0].db.toFixed(2), "-1.94");
  assert.equal(model.impedance, undefined);
});

test("builds an overlay preview model with S11 for mixed one-port and two-port files", () => {
  const onePort = parseTouchstone("# GHZ S MA R 50\n1 0.25 0", "single.s1p");
  const twoPort = parseTouchstone("# GHZ S MA R 50\n1 0.5 0 0.8 0 0.01 0 0.4 0", "paired.s2p");
  const model = buildOverlayPreviewModel([
    { doc: onePort, fileLabel: "single.s1p" },
    { doc: twoPort, fileLabel: "paired.s2p" }
  ]);

  assert.equal(model.fileLabel, "2 files, 1 trace");
  assert.equal(model.metricRows, undefined);
  assert.deepEqual(model.series.map((series) => series.label), ["single.s1p S11", "paired.s2p S11"]);
  assert.equal(model.series[0].rows[0].db.toFixed(2), "-12.04");
});

test("adds overlay traces to the current preview model instead of narrowing to one trace", () => {
  const base = parseTouchstone("# GHZ S MA R 50\n1 0.5 0 0.8 0 0.01 0 0.4 0", "base.s2p");
  const overlay = parseTouchstone("# GHZ S MA R 50\n1 0.4 0 0.7 0 0.02 0 0.3 0", "overlay.s2p");
  const builder = (previewModel as unknown as {
    buildPreviewModelWithOverlays?: (
      doc: ReturnType<typeof parseTouchstone>,
      fileLabel: string,
      overlays: Array<{ doc: ReturnType<typeof parseTouchstone>; fileLabel: string }>
    ) => PreviewModel;
  }).buildPreviewModelWithOverlays;
  if (typeof builder !== "function") {
    assert.fail("buildPreviewModelWithOverlays should be exported");
  }

  const model = builder(base, "base.s2p", [{ doc: overlay, fileLabel: "overlay.s2p" }]);

  assert.equal(model.title, "S2P Preview");
  assert.equal(model.fileLabel, "base.s2p + 1 overlay");
  assert.deepEqual(model.series.map((series) => series.label), [
    "base.s2p S11", "base.s2p S12", "base.s2p S21", "base.s2p S22",
    "overlay.s2p S11", "overlay.s2p S12", "overlay.s2p S21", "overlay.s2p S22"
  ]);
  assert.deepEqual(model.series.map((series) => series.groupLabel), [
    "base.s2p", "base.s2p", "base.s2p", "base.s2p",
    "overlay.s2p", "overlay.s2p", "overlay.s2p", "overlay.s2p"
  ]);
  assert.equal(new Set(model.series.map((series) => overlayColor(series.color))).size, model.series.length);
  assert.deepEqual(
    model.series.filter((series) => series.defaultVisible).map((series) => series.label),
    ["base.s2p S11", "base.s2p S21", "base.s2p S22", "overlay.s2p S11", "overlay.s2p S21", "overlay.s2p S22"]
  );
  assert.equal(model.metricRows?.[0].s21db.toFixed(2), "-1.94");
  assert.deepEqual(model.impedance?.targetOhms, [50, 50]);
});

function buildOverlayPreviewModel(docs: Array<{ doc: ReturnType<typeof parseTouchstone>; fileLabel: string }>): PreviewModel {
  const builder = (previewModel as unknown as {
    buildOverlayPreviewModel?: (items: Array<{ doc: ReturnType<typeof parseTouchstone>; fileLabel: string }>) => PreviewModel;
  }).buildOverlayPreviewModel;
  if (typeof builder !== "function") {
    assert.fail("buildOverlayPreviewModel should be exported");
  }
  return builder(docs);
}

function overlayColor(color: string | undefined): string {
  assert.ok(color, "expected overlay color");
  return color;
}
