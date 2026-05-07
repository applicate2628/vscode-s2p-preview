import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTO_PASSBAND_LABEL,
  DEFAULT_DB_MARKERS,
  DEFAULT_PASSBAND_PRESETS,
  createAutoPassband,
  normalizeDefaultPassbandLabel,
  sanitizePresetMarkers,
  sanitizePresetRenormalize,
  sanitizePresetTraces,
  upsertPassbandPreset,
  userScopedConfigurationValue
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

test("default dB markers match the legacy guide lines", () => {
  assert.deepEqual(DEFAULT_DB_MARKERS, [
    { label: "-3 dB", db: -3 },
    { label: "-15 dB", db: -15 },
    { label: "-20 dB", db: -20 }
  ]);
});

test("sanitizes preset dB markers", () => {
  assert.deepEqual(
    sanitizePresetMarkers([
      { label: "Pass", db: -3 },
      { label: "", db: -15 },
      { label: "bad", db: Number.NaN },
      { db: -20 },
      "skip"
    ]),
    [
      { label: "Pass", db: -3 },
      { label: "-15 dB", db: -15 },
      { label: "-20 dB", db: -20 }
    ]
  );

  assert.deepEqual(sanitizePresetMarkers([{ label: "bad", db: Number.NaN }]), DEFAULT_DB_MARKERS);
  assert.deepEqual(sanitizePresetMarkers(undefined), DEFAULT_DB_MARKERS);
});

test("upserts passband presets by label", () => {
  const existing = [
    { label: "1-10 GHz", startGHz: 1, stopGHz: 10 },
    { label: "2-4 GHz", startGHz: 2, stopGHz: 4 }
  ];

  const updated = upsertPassbandPreset(existing, {
    label: "2-4 GHz",
    startGHz: 2.1,
    stopGHz: 3.9,
    traces: [{ toPort: 2, fromPort: 1 }]
  });
  assert.equal(updated.updated, true);
  assert.deepEqual(updated.presets, [
    { label: "1-10 GHz", startGHz: 1, stopGHz: 10 },
    { label: "2-4 GHz", startGHz: 2.1, stopGHz: 3.9, traces: [{ toPort: 2, fromPort: 1 }] }
  ]);

  const added = upsertPassbandPreset(existing, { label: "5-6 GHz", startGHz: 5, stopGHz: 6 });
  assert.equal(added.updated, false);
  assert.deepEqual(added.presets.map((preset) => preset.label), ["1-10 GHz", "2-4 GHz", "5-6 GHz"]);
});

test("uses user-scoped preset settings instead of workspace overrides", () => {
  assert.deepEqual(
    userScopedConfigurationValue({
      defaultValue: [{ label: "1-10 GHz", startGHz: 1, stopGHz: 10 }],
      globalValue: [{ label: "2-4 GHz", startGHz: 2, stopGHz: 4 }],
      workspaceValue: [{ label: "File local", startGHz: 3, stopGHz: 5 }],
      workspaceFolderValue: [{ label: "Folder local", startGHz: 6, stopGHz: 8 }]
    }),
    [{ label: "2-4 GHz", startGHz: 2, stopGHz: 4 }]
  );

  assert.deepEqual(
    userScopedConfigurationValue({
      defaultValue: [{ label: "1-10 GHz", startGHz: 1, stopGHz: 10 }],
      workspaceValue: [{ label: "File local", startGHz: 3, stopGHz: 5 }]
    }),
    [{ label: "1-10 GHz", startGHz: 1, stopGHz: 10 }]
  );
});
