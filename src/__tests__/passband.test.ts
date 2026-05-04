import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTO_PASSBAND_LABEL,
  DEFAULT_PASSBAND_PRESETS,
  createAutoPassband,
  normalizeDefaultPassbandLabel,
  sanitizePresetRenormalize,
  sanitizePresetTraces
} from "../passband";

test("default preset list starts with 1-10 GHz", () => {
  assert.deepEqual(DEFAULT_PASSBAND_PRESETS[0], {
    label: "1-10 GHz",
    startGHz: 1,
    stopGHz: 10
  });
});

test("normalizeDefaultPassbandLabel keeps Auto / Full file range as the default mode", () => {
  assert.equal(
    normalizeDefaultPassbandLabel(DEFAULT_PASSBAND_PRESETS, AUTO_PASSBAND_LABEL),
    AUTO_PASSBAND_LABEL
  );
});

test("normalizeDefaultPassbandLabel falls back to Auto / Full file range for stale preset labels", () => {
  assert.equal(
    normalizeDefaultPassbandLabel(DEFAULT_PASSBAND_PRESETS, "2-4 GHz"),
    AUTO_PASSBAND_LABEL
  );
});

test("createAutoPassband spans the full finite file frequency range", () => {
  assert.deepEqual(
    createAutoPassband([
      { freqGHz: 3.5 },
      { freqGHz: 0.25 },
      { freqGHz: 12 },
      { freqGHz: Number.NaN }
    ]),
    {
      label: AUTO_PASSBAND_LABEL,
      startGHz: 0.25,
      stopGHz: 12
    }
  );
});

test("sanitizes S-parameter trace presets", () => {
  assert.deepEqual(
    sanitizePresetTraces([
      { toPort: 1, fromPort: 1 },
      { toPort: 4, fromPort: 1 },
      { toPort: 4, fromPort: 1 },
      { toPort: 0, fromPort: 1 },
      { toPort: 2.5, fromPort: 1 },
      { toPort: 2, fromPort: Number.NaN }
    ]),
    [
      { toPort: 1, fromPort: 1 },
      { toPort: 4, fromPort: 1 }
    ]
  );
});

test("sanitizes renormalization presets", () => {
  assert.deepEqual(
    sanitizePresetRenormalize({
      selectedPorts: [false, true, true],
      targetOhms: [50, 75, 100]
    }),
    {
      selectedPorts: [false, true, true],
      targetOhms: [50, 75, 100]
    }
  );

  assert.equal(
    sanitizePresetRenormalize({
      selectedPorts: [true],
      targetOhms: [0]
    }),
    undefined
  );
});
