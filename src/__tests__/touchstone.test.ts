import assert from "node:assert/strict";
import test from "node:test";
import {
  complexToDb,
  parseTouchstone,
  toS2pRows,
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

test("keeps legacy s2p dB row mapping from the complex model", () => {
  const doc = parseTouchstone("# GHZ S MA R 50\n1 0.5 0 0.9 0 0.01 0 0.4 180", "sample.s2p");
  const rows = toS2pRows(doc);

  assert.equal(rows[0].s11db.toFixed(2), "-6.02");
  assert.equal(rows[0].s21db.toFixed(2), "-0.92");
  assert.equal(rows[0].s12db.toFixed(2), "-40.00");
  assert.equal(rows[0].s22db.toFixed(2), "-7.96");
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

test("parses Touchstone 2.1 keyword-block s2p files", () => {
  const doc = parseTouchstone(
    [
      "[Version] 2.1",
      "# GHZ S DB R 50",
      "[Number of Ports] 2",
      "[Two-Port Data Order] 21_12",
      "[Number of Frequencies] 1",
      "[Reference] 50 75",
      "[Network Data]",
      "1 -6 0 -1 0 -40 0 -8 0",
      "[End]"
    ].join("\n"),
    "network.s2p"
  );

  assert.equal(doc.version, "2.1");
  assert.equal(doc.ports, 2);
  assert.deepEqual(doc.referenceOhms, [50, 75]);
  assert.equal(traceDbRows(doc, { toPort: 2, fromPort: 1 })[0].db, -1);
});

test("parses Touchstone 2.0 full matrix s3p files", () => {
  const doc = parseTouchstone(
    [
      "[Version] 2.0",
      "# GHZ S RI R 50",
      "[Number of Ports] 3",
      "[Number of Frequencies] 1",
      "[Network Data]",
      "1",
      "0.1 0 0.2 0 0.3 0",
      "0.4 0 0.5 0 0.6 0",
      "0.7 0 0.8 0 0.9 0",
      "[End]"
    ].join("\n"),
    "network.s3p"
  );

  assert.equal(doc.version, "2.0");
  assert.equal(doc.ports, 3);
  assert.deepEqual(doc.samples[0].matrix[2][1], { re: 0.8, im: 0 });
});

test("rejects unsupported non-S Touchstone parameters", () => {
  assert.throws(
    () => parseTouchstone("# GHZ Z RI R 50\n1 50 0 0 0 0 0 50 0", "impedance.s2p"),
    /supports only S-parameters/
  );
});

test("rejects unsupported Touchstone matrix formats clearly", () => {
  assert.throws(
    () => parseTouchstone(
      [
        "[Version] 2.1",
        "# GHZ S MA R 50",
        "[Number of Ports] 3",
        "[Matrix Format] Upper",
        "[Number of Frequencies] 1",
        "[Network Data]",
        "1 0.1 0 0.2 0 0.3 0",
        "[End]"
      ].join("\n"),
      "upper.s3p"
    ),
    /Unsupported Touchstone keyword '\[Matrix Format\] Upper'/
  );
});

test("rejects Touchstone 2.x option lines after network data", () => {
  assert.throws(
    () => parseTouchstone(
      [
        "[Version] 2.1",
        "# GHZ S DB R 50",
        "[Number of Ports] 2",
        "[Network Data]",
        "1 -6 0 -1 0 -40 0 -8 0",
        "[End]",
        "# GHZ S RI R 75"
      ].join("\n"),
      "late-option.s2p"
    ),
    /option line.*before \[Network Data\]|after \[Network Data\]/i
  );
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
