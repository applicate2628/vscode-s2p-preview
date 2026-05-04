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
  warnings: string[];
}

export interface TouchstoneParseOptions {
  allowIncompleteFinalSample?: boolean;
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

type TwoPortDataOrder = "21_12";

interface KeywordLine {
  original: string;
  keyword: string;
  argument: string;
}

interface TouchstoneParseState {
  version: TouchstoneVersion;
  ports: number;
  options?: TouchstoneOptions;
  samples: TouchstoneSample[];
  pendingValues: number[];
  warnings: string[];
  skippedIncompleteFinalSample: boolean;
  numberOfFrequencies?: number;
  referenceValues?: number[];
  twoPortDataOrder?: TwoPortDataOrder;
  inNetworkData: boolean;
  sawNetworkData: boolean;
  endedNetworkData: boolean;
}

const FREQ_SCALE_TO_GHZ: Record<string, number> = {
  HZ: 1e-9,
  KHZ: 1e-6,
  MHZ: 1e-3,
  GHZ: 1
};

const SUPPORTED_FORMATS: TouchstoneFormat[] = ["MA", "DB", "RI"];

export function parseTouchstone(
  text: string,
  sourceName = "untitled.s2p",
  options: TouchstoneParseOptions = {}
): TouchstoneDocument {
  const state: TouchstoneParseState = {
    version: "1.x",
    ports: inferPortCount(sourceName),
    samples: [],
    pendingValues: [],
    warnings: [],
    skippedIncompleteFinalSample: false,
    inNetworkData: false,
    sawNetworkData: false,
    endedNetworkData: false
  };
  const lines = text.split(/\r?\n/);

  for (const rawLine of lines) {
    const withoutComment = rawLine.split("!")[0].trim();
    if (!withoutComment) {
      continue;
    }

    const keywordLine = parseKeywordLine(withoutComment);
    if (keywordLine) {
      if (keywordLine.keyword === "end") {
        handlePendingValuesAtBoundary(state, options);
      } else {
        assertNoPendingValues(state);
      }
      applyKeywordLine(state, keywordLine);
      continue;
    }

    if (withoutComment.startsWith("[")) {
      throw unsupportedKeywordError(withoutComment);
    }

    if (withoutComment.startsWith("#")) {
      assertCanApplyOptionLine(state);
      assertNoPendingValues(state);
      state.options = parseOptions(withoutComment);
      assertSupportedOptions(state.options);
      continue;
    }

    if (!state.options) {
      throw new Error("Missing Touchstone option line. Expected '# GHZ S MA R 50'.");
    }

    if (state.version !== "1.x" && !state.inNetworkData) {
      if (state.endedNetworkData) {
        throw new Error("Touchstone numeric network data found after [End]. Start a new [Network Data] block before more data.");
      }
      throw new Error("Touchstone 2.x network data must appear after [Network Data].");
    }

    appendNetworkValues(state, parseNumericRow(withoutComment));
  }

  if (!state.options) {
    throw new Error("Missing Touchstone option line. Expected '# GHZ S MA R 50'.");
  }
  assertSupportedOptions(state.options);
  handlePendingValuesAtBoundary(state, options);
  if (state.samples.length === 0) {
    throw new Error("No Touchstone data rows found.");
  }
  if (state.numberOfFrequencies !== undefined && state.numberOfFrequencies !== state.samples.length) {
    if (options.allowIncompleteFinalSample && state.skippedIncompleteFinalSample) {
      state.warnings.push(`[Number of Frequencies] expected ${state.numberOfFrequencies} samples, parsed ${state.samples.length} after skipping incomplete final data.`);
    } else {
      throw new Error(`[Number of Frequencies] expected ${state.numberOfFrequencies} samples, parsed ${state.samples.length}.`);
    }
  }
  if (state.twoPortDataOrder && state.ports !== 2) {
    throw new Error("[Two-Port Data Order] is valid only for 2-port Touchstone files.");
  }

  return {
    version: state.version,
    ports: state.ports,
    parameter: state.options.parameter,
    format: state.options.format,
    referenceOhms: referenceOhmsForState(state, state.options),
    samples: state.samples,
    sourceName,
    warnings: state.warnings
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

function parseKeywordLine(line: string): KeywordLine | undefined {
  const match = line.match(/^\[([^\]]+)\]\s*(.*)$/);
  if (!match) {
    return undefined;
  }

  return {
    original: line,
    keyword: match[1].trim().toLowerCase().replace(/\s+/g, " "),
    argument: match[2].trim()
  };
}

function applyKeywordLine(state: TouchstoneParseState, line: KeywordLine): void {
  if (line.keyword === "version") {
    applyVersionKeyword(state, line);
    return;
  }

  if (state.version === "1.x") {
    throw unsupportedKeywordError(line.original);
  }

  switch (line.keyword) {
    case "number of ports":
      assertNoNetworkDataStarted(state, line.original);
      state.ports = parsePositiveIntegerKeyword(line);
      validateReferenceValueCount(state);
      return;
    case "number of frequencies":
      assertNoNetworkDataStarted(state, line.original);
      state.numberOfFrequencies = parsePositiveIntegerKeyword(line);
      return;
    case "reference":
      assertNoNetworkDataStarted(state, line.original);
      state.referenceValues = parseNumberList(line);
      validateReferenceValueCount(state);
      return;
    case "two-port data order":
      assertNoNetworkDataStarted(state, line.original);
      if (line.argument.trim().toUpperCase() !== "21_12") {
        throw new Error(`Unsupported Touchstone keyword '${line.original}'. Supported: 21_12.`);
      }
      state.twoPortDataOrder = "21_12";
      return;
    case "matrix format":
      assertNoNetworkDataStarted(state, line.original);
      if (!line.argument || line.argument.toUpperCase() === "FULL") {
        return;
      }
      throw new Error(`Unsupported Touchstone keyword '${line.original}'. Supported: Full.`);
    case "network data":
      if (!state.options) {
        throw new Error("Missing Touchstone option line. Expected '# GHZ S MA R 50'.");
      }
      assertSupportedOptions(state.options);
      if (state.sawNetworkData) {
        throw new Error("Multiple [Network Data] blocks are not supported.");
      }
      state.inNetworkData = true;
      state.sawNetworkData = true;
      state.endedNetworkData = false;
      return;
    case "end":
      if (!state.inNetworkData) {
        throw new Error("Unexpected [End] before [Network Data].");
      }
      state.inNetworkData = false;
      state.endedNetworkData = true;
      return;
    default:
      throw unsupportedKeywordError(line.original);
  }
}

function applyVersionKeyword(state: TouchstoneParseState, line: KeywordLine): void {
  if (state.sawNetworkData || state.samples.length > 0) {
    throw new Error("[Version] must appear before Touchstone network data.");
  }

  switch (line.argument) {
    case "2.0":
    case "2.1":
      state.version = line.argument;
      return;
    default:
      throw new Error(`Unsupported Touchstone [Version] '${line.argument}'. Supported: 2.0, 2.1.`);
  }
}

function appendNetworkValues(state: TouchstoneParseState, values: number[]): void {
  if (!state.options) {
    throw new Error("Missing Touchstone option line. Expected '# GHZ S MA R 50'.");
  }
  assertSupportedOptions(state.options);

  state.pendingValues = state.pendingValues.concat(values);
  const expectedValueCount = expectedNetworkValueCount(state.ports);

  while (state.pendingValues.length >= expectedValueCount) {
    const sampleValues = state.pendingValues.slice(0, expectedValueCount);
    state.pendingValues = state.pendingValues.slice(expectedValueCount);
    state.samples.push(valuesToSample(sampleValues, state.ports, state.options));
  }
}

function assertCanApplyOptionLine(state: TouchstoneParseState): void {
  if (state.version !== "1.x" && state.sawNetworkData) {
    throw new Error("Touchstone option line must appear before [Network Data].");
  }
  if (state.samples.length > 0) {
    throw new Error("Touchstone option line cannot appear after network data.");
  }
}

function assertNoPendingValues(state: TouchstoneParseState): void {
  if (state.pendingValues.length > 0) {
    throw incompleteNetworkDataError(state.ports, expectedNetworkValueCount(state.ports), state.pendingValues.length);
  }
}

function handlePendingValuesAtBoundary(state: TouchstoneParseState, options: TouchstoneParseOptions): void {
  if (state.pendingValues.length === 0) {
    return;
  }

  if (!options.allowIncompleteFinalSample) {
    assertNoPendingValues(state);
    return;
  }

  const expectedValueCount = expectedNetworkValueCount(state.ports);
  state.warnings.push(incompleteFinalSampleWarning(state, expectedValueCount, state.pendingValues.length));
  state.pendingValues = [];
  state.skippedIncompleteFinalSample = true;
}

function assertNoNetworkDataStarted(state: TouchstoneParseState, keyword: string): void {
  if (state.sawNetworkData || state.samples.length > 0) {
    throw new Error(`Touchstone keyword '${keyword}' must appear before [Network Data].`);
  }
}

function parsePositiveIntegerKeyword(line: KeywordLine): number {
  const value = Number(line.argument);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Malformed Touchstone keyword '${line.original}'. Expected a positive integer.`);
  }

  return value;
}

function parseNumberList(line: KeywordLine): number[] {
  if (!line.argument) {
    throw new Error(`Malformed Touchstone keyword '${line.original}'. Expected numeric values.`);
  }

  const values = line.argument.split(/\s+/).map(Number);
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error(`Malformed Touchstone keyword '${line.original}'. Expected numeric values.`);
  }

  return values;
}

function validateReferenceValueCount(state: TouchstoneParseState): void {
  if (!state.referenceValues) {
    return;
  }
  if (state.referenceValues.length !== 1 && state.referenceValues.length !== state.ports) {
    throw new Error(`[Reference] expects one value or ${state.ports} values, found ${state.referenceValues.length}.`);
  }
}

function referenceOhmsForState(state: TouchstoneParseState, options: SupportedTouchstoneOptions): number[] {
  const values = state.referenceValues ?? [options.referenceOhms];
  if (values.length === 1) {
    return Array.from({ length: state.ports }, () => values[0]);
  }
  if (values.length === state.ports) {
    return values.slice();
  }

  throw new Error(`[Reference] expects one value or ${state.ports} values, found ${values.length}.`);
}

function expectedNetworkValueCount(ports: number): number {
  return 1 + ports * ports * 2;
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

function incompleteFinalSampleWarning(
  state: TouchstoneParseState,
  expectedValueCount: number,
  foundValueCount: number
): string {
  const freqLabel = formatPendingFrequencyGHz(state);
  return `Skipped incomplete final ${state.ports}-port sample${freqLabel}. Expected ${expectedValueCount} numeric values per sample, found ${foundValueCount}.`;
}

function formatPendingFrequencyGHz(state: TouchstoneParseState): string {
  const freqScale = state.options ? FREQ_SCALE_TO_GHZ[state.options.freqUnit] : undefined;
  const freqValue = state.pendingValues[0];
  if (!freqScale || !Number.isFinite(freqValue)) {
    return "";
  }

  return ` at ${formatNumber(freqValue * freqScale)} GHz`;
}

function formatNumber(value: number): string {
  return value.toFixed(6).replace(/\.?0+$/, "");
}

function unsupportedKeywordError(line: string): Error {
  const keyword = line.match(/^\[[^\]]+\]/)?.[0] ?? line.split(/\s+/)[0];
  return new Error(`Unsupported Touchstone keyword '${keyword}'.`);
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
  const db = 20 * Math.log10(Math.max(magnitude, 1e-300));
  return Math.round(db * 1e12) / 1e12;
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
