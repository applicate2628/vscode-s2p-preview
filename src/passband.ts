export interface PassbandPreset {
  label: string;
  startGHz: number;
  stopGHz: number;
}

export const AUTO_PASSBAND_LABEL = "Auto / Full file range";

export const DEFAULT_PASSBAND_PRESETS: PassbandPreset[] = [
  { label: "1-10 GHz", startGHz: 1, stopGHz: 10 }
];

export function normalizeDefaultPassbandLabel(presets: readonly PassbandPreset[], configuredDefault: string | undefined): string {
  if (configuredDefault === AUTO_PASSBAND_LABEL) {
    return AUTO_PASSBAND_LABEL;
  }

  if (configuredDefault && presets.some((preset) => preset.label === configuredDefault)) {
    return configuredDefault;
  }

  return AUTO_PASSBAND_LABEL;
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
