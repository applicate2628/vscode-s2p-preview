export interface ComplexValue {
  re: number;
  im: number;
}

export interface TouchstoneSample {
  freqGHz: number;
  matrix: ComplexValue[][];
}

export type TouchstoneVersion = "1.x" | "2.0" | "2.1";

export type TouchstoneParameter = "S";

export type TouchstoneFormat = "MA" | "DB" | "RI";

export interface TouchstoneDocument {
  version: TouchstoneVersion;
  ports: number;
  parameter: TouchstoneParameter;
  format: TouchstoneFormat;
  referenceOhms: number[];
  samples: TouchstoneSample[];
  sourceName: string;
}

export interface TraceSelector {
  toPort: number;
  fromPort: number;
}

export interface TraceDbRow {
  freqGHz: number;
  db: number;
}

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

type SupportedTouchstoneOptions = TouchstoneOptions & {
  parameter: TouchstoneParameter;
  format: TouchstoneFormat;
};

const FREQ_SCALE_TO_GHZ: Record<string, number> = {
  HZ: 1e-9,
  KHZ: 1e-6,
  MHZ: 1e-3,
  GHZ: 1
};

const SUPPORTED_FORMATS: TouchstoneFormat[] = ["MA", "DB", "RI"];

export function parseTouchstone(text: string, sourceName = "untitled.s2p"): TouchstoneDocument {
  const ports = inferPortCount(sourceName);
  const expectedValueCount = 1 + ports * ports * 2;
  const lines = text.split(/\r?\n/);
  let options: TouchstoneOptions | undefined;
  const samples: TouchstoneSample[] = [];
  let pendingValues: number[] = [];

  for (const rawLine of lines) {
    const withoutComment = rawLine.split("!")[0].trim();
    if (!withoutComment) {
      continue;
    }
    if (withoutComment.startsWith("[")) {
      throw unsupportedKeywordError(withoutComment);
    }
    if (withoutComment.startsWith("#")) {
      if (pendingValues.length > 0) {
        throw incompleteNetworkDataError(ports, expectedValueCount, pendingValues.length);
      }
      options = parseOptions(withoutComment);
      assertSupportedOptions(options);
      continue;
    }
    if (!options) {
      throw new Error("Missing Touchstone option line. Expected '# GHZ S MA R 50'.");
    }

    assertSupportedOptions(options);

    pendingValues = pendingValues.concat(parseNumericRow(withoutComment));

    while (pendingValues.length >= expectedValueCount) {
      const sampleValues = pendingValues.slice(0, expectedValueCount);
      pendingValues = pendingValues.slice(expectedValueCount);
      samples.push(valuesToSample(sampleValues, ports, options));
    }
  }

  if (!options) {
    throw new Error("Missing Touchstone option line. Expected '# GHZ S MA R 50'.");
  }
  assertSupportedOptions(options);
  if (pendingValues.length > 0) {
    throw incompleteNetworkDataError(ports, expectedValueCount, pendingValues.length);
  }
  if (samples.length === 0) {
    throw new Error("No Touchstone data rows found.");
  }

  return {
    version: "1.x",
    ports,
    parameter: options.parameter,
    format: options.format,
    referenceOhms: Array.from({ length: ports }, () => options.referenceOhms),
    samples,
    sourceName
  };
}

export function parseS2p(text: string): S2pRow[] {
  return toS2pRows(parseTouchstone(text, "untitled.s2p"));
}

export function toS2pRows(doc: TouchstoneDocument): S2pRow[] {
  if (doc.ports !== 2) {
    throw new Error("toS2pRows supports only 2-port Touchstone documents.");
  }

  return doc.samples.map((sample) => ({
    freqGHz: sample.freqGHz,
    s11db: complexToDb(sample.matrix[0][0]),
    s21db: complexToDb(sample.matrix[1][0]),
    s12db: complexToDb(sample.matrix[0][1]),
    s22db: complexToDb(sample.matrix[1][1])
  }));
}

export function complexToDb(value: ComplexValue): number {
  return magnitudeToDb(Math.hypot(value.re, value.im));
}

export function traceSelectorLabel(selector: TraceSelector): string {
  return `S${selector.toPort}${selector.fromPort}`;
}

export function traceDbRows(doc: TouchstoneDocument, selector: TraceSelector): TraceDbRow[] {
  validateTraceSelector(doc, selector);
  const toIndex = selector.toPort - 1;
  const fromIndex = selector.fromPort - 1;

  return doc.samples.map((sample) => ({
    freqGHz: sample.freqGHz,
    db: complexToDb(sample.matrix[toIndex][fromIndex])
  }));
}

function assertSupportedOptions(options: TouchstoneOptions): asserts options is SupportedTouchstoneOptions {
  if (options.parameter !== "S") {
    throw new Error(`Unsupported parameter '${options.parameter}'. Current implementation supports only S-parameters.`);
  }
  if (!isTouchstoneFormat(options.format)) {
    throw new Error(`Unsupported Touchstone format '# ${options.freqUnit} ${options.parameter} ${options.format}'. Supported: MA, DB, RI.`);
  }
}

function isTouchstoneFormat(format: string): format is TouchstoneFormat {
  return SUPPORTED_FORMATS.includes(format as TouchstoneFormat);
}

function inferPortCount(sourceName: string): number {
  const match = sourceName.match(/\.s(\d+)p$/i);
  if (!match) {
    return 2;
  }

  const ports = Number(match[1]);
  return Number.isInteger(ports) && ports > 0 ? ports : 2;
}

function parseNumericRow(line: string): number[] {
  const values = line.split(/\s+/).map(Number);
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error("Malformed numeric Touchstone data row.");
  }

  return values;
}

function valuesToSample(values: number[], ports: number, options: SupportedTouchstoneOptions): TouchstoneSample {
  const freqGHz = values[0] * FREQ_SCALE_TO_GHZ[options.freqUnit];
  const pairs: ComplexValue[] = [];
  for (let index = 1; index < values.length; index += 2) {
    pairs.push(pairToComplex(values[index], values[index + 1], options.format));
  }

  return {
    freqGHz,
    matrix: pairsToMatrix(pairs, ports)
  };
}

function incompleteNetworkDataError(ports: number, expectedValueCount: number, foundValueCount: number): Error {
  return new Error(`Incomplete ${ports}-port Touchstone network data. Expected ${expectedValueCount} numeric values per sample, found ${foundValueCount}.`);
}

function unsupportedKeywordError(line: string): Error {
  const keyword = line.match(/^\[[^\]]+\]/)?.[0] ?? line.split(/\s+/)[0];
  return new Error(`Unsupported Touchstone keyword '${keyword}'. Touchstone 2.x keyword parsing is added in the next task.`);
}

function validateTraceSelector(doc: TouchstoneDocument, selector: TraceSelector): void {
  if (!Number.isInteger(selector.toPort) || !Number.isInteger(selector.fromPort)) {
    throw new Error(`Invalid trace selector '${traceSelectorLabel(selector)}'. Port numbers must be integers.`);
  }
  if (selector.toPort < 1 || selector.toPort > doc.ports || selector.fromPort < 1 || selector.fromPort > doc.ports) {
    throw new Error(`Trace selector '${traceSelectorLabel(selector)}' is outside the ${doc.ports}-port Touchstone document.`);
  }
}

function pairsToMatrix(pairs: ComplexValue[], ports: number): ComplexValue[][] {
  const matrix = createEmptyMatrix(ports);

  if (ports === 2) {
    for (let fromIndex = 0; fromIndex < ports; fromIndex += 1) {
      for (let toIndex = 0; toIndex < ports; toIndex += 1) {
        matrix[toIndex][fromIndex] = pairs[fromIndex * ports + toIndex];
      }
    }
    return matrix;
  }

  for (let rowIndex = 0; rowIndex < ports; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < ports; columnIndex += 1) {
      matrix[rowIndex][columnIndex] = pairs[rowIndex * ports + columnIndex];
    }
  }

  return matrix;
}

function createEmptyMatrix(ports: number): ComplexValue[][] {
  return Array.from({ length: ports }, () =>
    Array.from({ length: ports }, () => ({ re: 0, im: 0 }))
  );
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

function pairToComplex(v1: number, v2: number, format: TouchstoneFormat): ComplexValue {
  switch (format) {
    case "MA":
      return magnitudeAngleToComplex(v1, v2);
    case "DB":
      return magnitudeAngleToComplex(Math.pow(10, v1 / 20), v2);
    case "RI":
      return { re: v1, im: v2 };
    default:
      throw new Error(`Unsupported Touchstone format '${format}'. Supported: MA, DB, RI.`);
  }
}

function magnitudeAngleToComplex(magnitude: number, angleDeg: number): ComplexValue {
  const angleRad = angleDeg * Math.PI / 180;
  return {
    re: magnitude * Math.cos(angleRad),
    im: magnitude * Math.sin(angleRad)
  };
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
