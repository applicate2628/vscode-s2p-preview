import assert from "node:assert/strict";
import test from "node:test";
import {
  complexToDb,
  parseTouchstone,
  traceDbRows,
  traceSelectorLabel
} from "../touchstone";

test("parses Touchstone 1.x s2p data as complex S-parameter samples", () => {
  const doc = parseTouchstone(
    [
      "# GHZ S MA R 50",
      "1 0.5 0 0.9 0 0.01 0 0.4 180"
    ].join("\n"),
    "sample.s2p"
  );

  assert.equal(doc.version, "1.x");
  assert.equal(doc.ports, 2);
  assert.equal(doc.parameter, "S");
  assert.deepEqual(doc.referenceOhms, [50, 50]);
  assert.deepEqual(doc.samples[0].matrix[0][0], { re: 0.5, im: 0 });
  assert.ok(Math.abs(doc.samples[0].matrix[1][1].re + 0.4) < 1e-12);
});

test("derives dB rows for an S-parameter trace", () => {
  const doc = parseTouchstone("# GHZ S MA R 50\n1 0.5 0 0.9 0 0.01 0 0.4 180", "sample.s2p");
  const rows = traceDbRows(doc, { toPort: 2, fromPort: 1 });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].freqGHz, 1);
  assert.equal(rows[0].db.toFixed(2), "-0.92");
  assert.equal(traceSelectorLabel({ toPort: 2, fromPort: 1 }), "S21");
});

test("accumulates Touchstone 1.x 3-port RI data split across matrix rows", () => {
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

  assert.equal(doc.ports, 3);
  assert.equal(doc.samples[0].freqGHz, 1);
  assert.deepEqual(doc.samples[0].matrix, [
    [
      { re: 0.1, im: 0 },
      { re: 0.2, im: 0 },
      { re: 0.3, im: 0 }
    ],
    [
      { re: 0.4, im: 0 },
      { re: 0.5, im: 0 },
      { re: 0.6, im: 0 }
    ],
    [
      { re: 0.7, im: 0 },
      { re: 0.8, im: 0 },
      { re: 0.9, im: 0 }
    ]
  ]);
});

test("throws a clear error for incomplete multi-line network data", () => {
  assert.throws(
    () => parseTouchstone("# GHZ S RI R 50\n1\n0.1 0", "broken.s3p"),
    /Incomplete 3-port Touchstone network data/
  );
});

test("converts complex values to dB safely", () => {
  assert.equal(complexToDb({ re: 1, im: 0 }), 0);
  assert.equal(Number.isFinite(complexToDb({ re: 0, im: 0 })), true);
});
