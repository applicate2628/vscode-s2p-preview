import {
  toS2pRows,
  traceDbRows,
  traceSelectorLabel
} from "./touchstone";
import type {
  S2pRow,
  TouchstoneDocument,
  TouchstoneSample,
  TraceSelector
} from "./touchstone";

export interface ChartPoint {
  freqGHz: number;
  db: number;
}

export interface ChartSeries {
  label: string;
  cssClass: string;
  rows: ChartPoint[];
  defaultVisible: boolean;
  selector?: TraceSelector;
}

export interface PreviewImpedanceModel {
  referenceOhms: number[];
  targetOhms: number[];
  selectedPorts: boolean[];
  samples: TouchstoneSample[];
}

export interface PreviewModel {
  title: string;
  fileLabel: string;
  series: ChartSeries[];
  metricRows?: S2pRow[];
  impedance?: PreviewImpedanceModel;
  warnings?: string[];
}

export function buildPreviewModel(doc: TouchstoneDocument, fileLabel: string): PreviewModel {
  if (doc.ports === 2) {
    const metricRows = toS2pRows(doc);
    return {
      title: "S2P Preview",
      fileLabel,
      series: [
        {
          label: "S11",
          cssClass: "s11",
          defaultVisible: true,
          selector: { toPort: 1, fromPort: 1 },
          rows: metricRows.map((row) => ({ freqGHz: row.freqGHz, db: row.s11db }))
        },
        {
          label: "S21",
          cssClass: "s21",
          defaultVisible: true,
          selector: { toPort: 2, fromPort: 1 },
          rows: metricRows.map((row) => ({ freqGHz: row.freqGHz, db: row.s21db }))
        },
        {
          label: "S22",
          cssClass: "s22",
          defaultVisible: true,
          selector: { toPort: 2, fromPort: 2 },
          rows: metricRows.map((row) => ({ freqGHz: row.freqGHz, db: row.s22db }))
        }
      ],
      metricRows,
      impedance: buildImpedanceModel(doc),
      warnings: doc.warnings.slice()
    };
  }

  const selectors = defaultSelectorsForPortCount(doc.ports);
  return {
    title: `S${doc.ports}P Preview`,
    fileLabel,
    series: selectors.map((selector, index) => traceSeries(doc, selector, index)),
    impedance: buildImpedanceModel(doc),
    warnings: doc.warnings.slice()
  };
}

export function buildOverlayPreviewModel(docs: Array<{ doc: TouchstoneDocument; fileLabel: string }>): PreviewModel {
  if (docs.length === 0) {
    throw new Error("Overlay preview requires at least one Touchstone document.");
  }

  const selector: TraceSelector = docs.every((item) => item.doc.ports >= 2)
    ? { toPort: 2, fromPort: 1 }
    : { toPort: 1, fromPort: 1 };
  const traceLabel = traceSelectorLabel(selector);

  return {
    title: "S2P Overlay",
    fileLabel: `${docs.length} files, ${traceLabel}`,
    series: docs.map((item, index) => ({
      label: `${item.fileLabel} ${traceLabel}`,
      cssClass: `overlay-${index % 8}`,
      defaultVisible: true,
      rows: traceDbRows(item.doc, selector)
    })),
    warnings: docs.flatMap((item) => item.doc.warnings.map((warning) => `${item.fileLabel}: ${warning}`))
  };
}

function defaultSelectorsForPortCount(ports: number): TraceSelector[] {
  const selectors: TraceSelector[] = [];
  for (let toPort = 1; toPort <= ports; toPort += 1) {
    for (let fromPort = 1; fromPort <= ports; fromPort += 1) {
      selectors.push({ toPort, fromPort });
    }
  }
  return selectors;
}

function traceSeries(doc: TouchstoneDocument, selector: TraceSelector, index: number): ChartSeries {
  const label = traceSelectorLabel(selector);
  return {
    label,
    cssClass: `trace-${index % 12}`,
    defaultVisible: selector.fromPort === 1,
    selector,
    rows: traceDbRows(doc, selector)
  };
}

function buildImpedanceModel(doc: TouchstoneDocument): PreviewImpedanceModel {
  return {
    referenceOhms: doc.referenceOhms.slice(),
    targetOhms: doc.referenceOhms.slice(),
    selectedPorts: doc.referenceOhms.map(() => false),
    samples: doc.samples.map((sample) => ({
      freqGHz: sample.freqGHz,
      matrix: sample.matrix.map((row) => row.map((value) => ({ re: value.re, im: value.im })))
    }))
  };
}
