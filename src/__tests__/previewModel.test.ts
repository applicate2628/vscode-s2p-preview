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

test("keeps two-port preview metrics and default S11 S21 S22 curves", () => {
  const doc = parseTouchstone("# GHZ S MA R 50\n1 0.5 0 0.9 0 0.01 0 0.4 180", "sample.s2p");
  const model = previewModel.buildPreviewModel(doc, "sample.s2p");

  assert.equal(model.title, "S2P Preview");
  assert.deepEqual(model.series.map((series) => series.label), ["S11", "S21", "S22"]);
  assert.equal(model.metricRows?.[0].s21db.toFixed(2), "-0.92");
  assert.equal(model.series[1].rows[0].db.toFixed(2), "-0.92");
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
  assert.deepEqual(model.series.map((series) => series.label), ["S11", "S21", "S22"]);
  assert.equal(model.series[1].rows[0].db.toFixed(2), "-7.96");
});

test("builds an overlay preview model with S21 for two-port files", () => {
  const first = parseTouchstone("# GHZ S MA R 50\n1 0.5 0 0.8 0 0.01 0 0.4 0", "m_000.s2p");
  const second = parseTouchstone("# GHZ S MA R 50\n1 0.4 0 0.7 0 0.02 0 0.3 0", "m_001.s2p");
  const model = buildOverlayPreviewModel([
    { doc: first, fileLabel: "m_000.s2p" },
    { doc: second, fileLabel: "m_001.s2p" }
  ]);

  assert.equal(model.title, "S2P Overlay");
  assert.equal(model.fileLabel, "2 files, S21");
  assert.equal(model.metricRows, undefined);
  assert.deepEqual(model.series.map((series) => series.label), ["m_000.s2p S21", "m_001.s2p S21"]);
  assert.deepEqual(model.series.map((series) => series.cssClass), ["overlay-0", "overlay-1"]);
  assert.equal(model.series[0].rows[0].db.toFixed(2), "-1.94");
  assert.equal(model.impedance, undefined);
});

test("builds an overlay preview model with S11 for mixed one-port and two-port files", () => {
  const onePort = parseTouchstone("# GHZ S MA R 50\n1 0.25 0", "single.s1p");
  const twoPort = parseTouchstone("# GHZ S MA R 50\n1 0.5 0 0.8 0 0.01 0 0.4 0", "paired.s2p");
  const model = buildOverlayPreviewModel([
    { doc: onePort, fileLabel: "single.s1p" },
    { doc: twoPort, fileLabel: "paired.s2p" }
  ]);

  assert.equal(model.fileLabel, "2 files, S11");
  assert.equal(model.metricRows, undefined);
  assert.deepEqual(model.series.map((series) => series.label), ["single.s1p S11", "paired.s2p S11"]);
  assert.equal(model.series[0].rows[0].db.toFixed(2), "-12.04");
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
