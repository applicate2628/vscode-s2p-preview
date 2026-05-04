import assert from "node:assert/strict";
import test from "node:test";
import { buildPreviewModel } from "../previewModel";
import { parseTouchstone } from "../touchstone";

test("builds a one-port preview model with S11 and no two-port metrics", () => {
  const doc = parseTouchstone("# GHZ S MA R 50\n1 0.5 0\n2 0.25 0", "sample.s1p");
  const model = buildPreviewModel(doc, "sample.s1p");

  assert.equal(model.title, "S1P Preview");
  assert.equal(model.fileLabel, "sample.s1p");
  assert.equal(model.metricRows, undefined);
  assert.deepEqual(model.series.map((series) => series.label), ["S11"]);
  assert.equal(model.series[0].rows[0].db.toFixed(2), "-6.02");
});

test("keeps two-port preview metrics and default S11 S21 S22 curves", () => {
  const doc = parseTouchstone("# GHZ S MA R 50\n1 0.5 0 0.9 0 0.01 0 0.4 180", "sample.s2p");
  const model = buildPreviewModel(doc, "sample.s2p");

  assert.equal(model.title, "S2P Preview");
  assert.deepEqual(model.series.map((series) => series.label), ["S11", "S21", "S22"]);
  assert.equal(model.metricRows?.[0].s21db.toFixed(2), "-0.92");
  assert.equal(model.series[1].rows[0].db.toFixed(2), "-0.92");
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
  const model = buildPreviewModel(doc, "sample.s3p");

  assert.equal(model.title, "S3P Preview");
  assert.equal(model.metricRows, undefined);
  assert.deepEqual(model.series.map((series) => series.label), ["S11", "S21", "S22"]);
  assert.equal(model.series[1].rows[0].db.toFixed(2), "-7.96");
});
