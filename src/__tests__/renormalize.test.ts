import assert from "node:assert/strict";
import test from "node:test";
import { effectiveReferenceOhms, renormalizeDocument } from "../renormalize";
import { parseTouchstone } from "../touchstone";

test("renormalizes a one-port S-parameter from 50 Ohm to 75 Ohm", () => {
  const doc = parseTouchstone("# GHZ S RI R 50\n1 0.5 0", "sample.s1p");

  const renormalized = renormalizeDocument(doc, [75], [true]);

  assert.deepEqual(renormalized.referenceOhms, [75]);
  assert.equal(renormalized.samples[0].matrix[0][0].re.toFixed(6), "0.333333");
  assert.equal(Math.abs(renormalized.samples[0].matrix[0][0].im) < 1e-12, true);
});

test("keeps unchecked ports at their source reference impedance", () => {
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

  const references = effectiveReferenceOhms(doc.referenceOhms, [100, 100], [true, false]);
  const renormalized = renormalizeDocument(doc, [100, 100], [true, false]);

  assert.deepEqual(references, [100, 75]);
  assert.deepEqual(renormalized.referenceOhms, [100, 75]);
  assert.equal(renormalized.samples[0].matrix[0][0].re.toFixed(6), "-0.142857");
  assert.equal(renormalized.samples[0].matrix[1][1].re.toFixed(6), "0.200000");
});

test("uses independent target impedances for selected ports", () => {
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

  const references = effectiveReferenceOhms(doc.referenceOhms, [50, 100], [false, true]);
  const renormalized = renormalizeDocument(doc, [50, 100], [false, true]);

  assert.deepEqual(references, [50, 100]);
  assert.deepEqual(renormalized.referenceOhms, [50, 100]);
  assert.equal(renormalized.samples[0].matrix[0][0].re.toFixed(6), "0.200000");
  assert.equal(renormalized.samples[0].matrix[1][1].re.toFixed(6), "0.058824");
});

test("rejects non-positive target impedance", () => {
  const doc = parseTouchstone("# GHZ S RI R 50\n1 0.5 0", "sample.s1p");

  assert.throws(
    () => renormalizeDocument(doc, [0], [true]),
    /Target impedance for port 1 must be positive/
  );
});
