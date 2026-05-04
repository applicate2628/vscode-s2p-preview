export interface S2pRow {
  freqGHz: number;
  s11db: number;
  s21db: number;
  s12db: number;
  s22db: number;
}

export interface Band {
  startGHz: number;
  endGHz: number;
}

export interface S2pMetrics {
  bestS21: S2pRow;
  avgS21db: number;
  worstS11: S2pRow;
  worstS22: S2pRow;
  s21Bands: Band[];
  matchedMinus15Bands: Band[];
  matchedMinus15CoverageGHz: number;
}

interface TouchstoneOptions {
  freqUnit: string;
  parameter: string;
  format: string;
  referenceOhms: number;
}

const FREQ_SCALE_TO_GHZ: Record<string, number> = {
  HZ: 1e-9,
  KHZ: 1e-6,
  MHZ: 1e-3,
  GHZ: 1
};

export function parseS2p(text: string): S2pRow[] {
  const lines = text.split(/\r?\n/);
  let options: TouchstoneOptions | undefined;
  const rows: S2pRow[] = [];

  for (const rawLine of lines) {
    const withoutComment = rawLine.split("!")[0].trim();
    if (!withoutComment) {
      continue;
    }
    if (withoutComment.startsWith("#")) {
      options = parseOptions(withoutComment);
      continue;
    }
    if (!options) {
      throw new Error("Missing Touchstone option line. Expected '# GHZ S MA R 50'.");
    }
    const values = withoutComment.split(/\s+/).map(Number);
    if (values.length < 9 || values.some((value) => Number.isNaN(value))) {
      continue;
    }
    const freqGHz = values[0] * FREQ_SCALE_TO_GHZ[options.freqUnit];
    // 2-port Touchstone column order: f S11 S21 S12 S22 — each as (val1 val2) pair.
    rows.push({
      freqGHz,
      s11db: pairToDb(values[1], values[2], options.format),
      s21db: pairToDb(values[3], values[4], options.format),
      s12db: pairToDb(values[5], values[6], options.format),
      s22db: pairToDb(values[7], values[8], options.format)
    });
  }

  if (!options) {
    throw new Error("Missing Touchstone option line. Expected '# GHZ S MA R 50'.");
  }
  if (options.parameter !== "S") {
    throw new Error(`Unsupported parameter '${options.parameter}'. Expected 'S' (S-parameters).`);
  }
  if (!["MA", "DB", "RI"].includes(options.format)) {
    throw new Error(`Unsupported Touchstone format '# ${options.freqUnit} ${options.parameter} ${options.format}'. Supported: MA, DB, RI.`);
  }
  if (rows.length === 0) {
    throw new Error("No S2P data rows found.");
  }

  return rows;
}

export function computeMetrics(rows: S2pRow[], passbandStartGHz = 1, passbandEndGHz = 10): S2pMetrics {
  const passband = rows.filter((row) => row.freqGHz >= passbandStartGHz && row.freqGHz <= passbandEndGHz);
  if (passband.length === 0) {
    throw new Error(`No samples inside ${passbandStartGHz}-${passbandEndGHz} GHz passband.`);
  }

  const bestS21 = maxBy(passband, (row) => row.s21db);
  const worstS11 = maxBy(passband, (row) => row.s11db);
  const worstS22 = maxBy(passband, (row) => row.s22db);
  const avgS21db = passband.reduce((sum, row) => sum + row.s21db, 0) / passband.length;
  const s21Bands = contiguousBands(rows, (row) => row.s21db >= -3);
  const matchedMinus15Bands = contiguousBands(rows, (row) => row.s21db >= -3 && row.s11db <= -15 && row.s22db <= -15);

  return {
    bestS21,
    avgS21db,
    worstS11,
    worstS22,
    s21Bands,
    matchedMinus15Bands,
    matchedMinus15CoverageGHz: coverageInside(matchedMinus15Bands, passbandStartGHz, passbandEndGHz)
  };
}

function parseOptions(line: string): TouchstoneOptions {
  const tokens = line.slice(1).trim().toUpperCase().split(/\s+/);
  const freqUnit = tokens[0] ?? "";
  const parameter = tokens[1] ?? "";
  const format = tokens[2] ?? "";
  const rIndex = tokens.indexOf("R");
  const referenceOhms = rIndex >= 0 ? Number(tokens[rIndex + 1]) : 50;

  if (!FREQ_SCALE_TO_GHZ[freqUnit]) {
    throw new Error(`Unsupported frequency unit '${freqUnit}'. Expected GHZ for Sonnet MVP files.`);
  }

  return {
    freqUnit,
    parameter,
    format,
    referenceOhms: Number.isFinite(referenceOhms) ? referenceOhms : 50
  };
}

function magnitudeToDb(magnitude: number): number {
  return 20 * Math.log10(Math.max(magnitude, 1e-300));
}

/**
 * Convert a Touchstone 2-value pair (v1, v2) for an S-parameter element into dB.
 *  - MA: v1 = magnitude (linear), v2 = angle (deg)  → dB = 20*log10(v1)
 *  - DB: v1 = dB                  v2 = angle (deg)  → dB = v1
 *  - RI: v1 = real,               v2 = imaginary    → dB = 20*log10(|v1+jv2|)
 */
function pairToDb(v1: number, v2: number, format: string): number {
  switch (format) {
    case "MA":
      return magnitudeToDb(v1);
    case "DB":
      return v1;
    case "RI": {
      const magnitude = Math.sqrt(v1 * v1 + v2 * v2);
      return magnitudeToDb(magnitude);
    }
    default:
      throw new Error(`Unsupported Touchstone format '${format}'. Supported: MA, DB, RI.`);
  }
}

function maxBy<T>(items: T[], score: (item: T) => number): T {
  return items.reduce((best, item) => score(item) > score(best) ? item : best);
}

function contiguousBands(rows: S2pRow[], predicate: (row: S2pRow) => boolean): Band[] {
  const bands: Band[] = [];
  let start: number | undefined;
  let previous: S2pRow | undefined;

  for (const row of rows) {
    const ok = predicate(row);
    if (ok && start === undefined) {
      start = row.freqGHz;
    }
    if (!ok && start !== undefined && previous) {
      bands.push({ startGHz: start, endGHz: previous.freqGHz });
      start = undefined;
    }
    previous = row;
  }

  if (start !== undefined && previous) {
    bands.push({ startGHz: start, endGHz: previous.freqGHz });
  }

  return bands;
}

function coverageInside(bands: Band[], loGHz: number, hiGHz: number): number {
  return bands.reduce((sum, band) => sum + Math.max(0, Math.min(hiGHz, band.endGHz) - Math.max(loGHz, band.startGHz)), 0);
}
