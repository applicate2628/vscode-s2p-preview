export interface PassbandPreset {
  label: string;
  startGHz: number;
  stopGHz: number;
  traces?: PassbandPresetTrace[];
  renormalize?: PassbandPresetRenormalize;
  markers?: PassbandPresetMarker[];
}

export interface PassbandPresetTrace {
  toPort: number;
  fromPort: number;
}

export interface PassbandPresetMarker {
  label: string;
  db: number;
}

export interface PassbandPresetRenormalize {
  selectedPorts: boolean[];
  targetOhms: number[];
}

export interface ConfigurationInspectionLike<T> {
  defaultValue?: T;
  globalValue?: T;
  workspaceValue?: T;
  workspaceFolderValue?: T;
}

export const AUTO_PASSBAND_LABEL = "Auto / Full file range";

export const DEFAULT_PASSBAND_PRESETS: PassbandPreset[] = [
  { label: "1-10 GHz", startGHz: 1, stopGHz: 10 }
];

export const DEFAULT_DB_MARKERS: PassbandPresetMarker[] = [
  { label: "-3 dB", db: -3 },
  { label: "-15 dB", db: -15 },
  { label: "-20 dB", db: -20 }
];

export const MAX_DB_MARKERS = 10;
export const MAX_DB_MARKER_LABEL_LENGTH = 64;
export const MIN_DB_MARKER_VALUE = -200;
export const MAX_DB_MARKER_VALUE = 20;

export function normalizeDefaultPassbandLabel(presets: readonly PassbandPreset[], configuredDefault: string | undefined): string {
  if (configuredDefault === AUTO_PASSBAND_LABEL) {
    return AUTO_PASSBAND_LABEL;
  }

  if (configuredDefault && presets.some((preset) => preset.label === configuredDefault)) {
    return configuredDefault;
  }

  return AUTO_PASSBAND_LABEL;
}

export function upsertPassbandPreset(
  presets: readonly PassbandPreset[],
  preset: PassbandPreset
): { presets: PassbandPreset[]; updated: boolean } {
  const existingIndex = presets.findIndex((item) => item.label === preset.label);
  if (existingIndex === -1) {
    return { presets: [...presets, preset], updated: false };
  }

  return {
    presets: presets.map((item, index) => (index === existingIndex ? preset : item)),
    updated: true
  };
}

export function userScopedConfigurationValue<T>(
  inspection: ConfigurationInspectionLike<T> | undefined
): T | undefined {
  return inspection?.globalValue ?? inspection?.defaultValue;
}

export function createAutoPassband(rows: readonly { freqGHz: number }[]): PassbandPreset {
  const frequencies = rows
    .map((row) => row.freqGHz)
    .filter((freqGHz) => Number.isFinite(freqGHz));
  if (frequencies.length === 0) {
    return { label: AUTO_PASSBAND_LABEL, startGHz: 0, stopGHz: 1 };
  }

  const startGHz = Math.min(...frequencies);
  const stopGHz = Math.max(...frequencies);
  if (startGHz < stopGHz) {
    return { label: AUTO_PASSBAND_LABEL, startGHz, stopGHz };
  }

  return { label: AUTO_PASSBAND_LABEL, startGHz, stopGHz: startGHz + 1 };
}

export function sanitizePresetTraces(value: unknown): PassbandPresetTrace[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const traces: PassbandPresetTrace[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }

    const toPort = Number(item.toPort);
    const fromPort = Number(item.fromPort);
    if (!Number.isInteger(toPort) || !Number.isInteger(fromPort) || toPort <= 0 || fromPort <= 0) {
      continue;
    }

    const key = `${toPort}:${fromPort}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    traces.push({ toPort, fromPort });
  }

  return traces.length > 0 ? traces : undefined;
}

export function sanitizePresetRenormalize(value: unknown): PassbandPresetRenormalize | undefined {
  if (!isRecord(value) || !Array.isArray(value.selectedPorts) || !Array.isArray(value.targetOhms)) {
    return undefined;
  }

  const count = Math.min(value.selectedPorts.length, value.targetOhms.length);
  if (count === 0) {
    return undefined;
  }

  const selectedPorts: boolean[] = [];
  const targetOhms: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const target = Number(value.targetOhms[index]);
    if (!Number.isFinite(target) || target <= 0) {
      return undefined;
    }

    selectedPorts.push(value.selectedPorts[index] === true);
    targetOhms.push(target);
  }

  return { selectedPorts, targetOhms };
}

export function sanitizePresetMarkers(value: unknown): PassbandPresetMarker[] {
  if (!Array.isArray(value)) {
    return cloneDefaultDbMarkers();
  }
  if (value.length === 0) {
    return [];
  }

  const markers: PassbandPresetMarker[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }

    const db = Number(item.db);
    if (
      !Number.isFinite(db)
      || db < MIN_DB_MARKER_VALUE
      || db > MAX_DB_MARKER_VALUE
    ) {
      continue;
    }

    const rawLabel = typeof item.label === "string" ? item.label.trim() : "";
    markers.push({
      label: (rawLabel || `${formatMarkerDb(db)} dB`).slice(0, MAX_DB_MARKER_LABEL_LENGTH),
      db
    });
    if (markers.length >= MAX_DB_MARKERS) {
      break;
    }
  }

  return markers.length > 0 ? markers : cloneDefaultDbMarkers();
}

function cloneDefaultDbMarkers(): PassbandPresetMarker[] {
  return DEFAULT_DB_MARKERS.map((marker) => ({ ...marker }));
}

function formatMarkerDb(db: number): string {
  return Number(db).toFixed(3).replace(/\.?0+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
