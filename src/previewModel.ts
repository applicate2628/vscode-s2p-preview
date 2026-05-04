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
          selector: { toPort: 1, fromPort: 1 },
          rows: metricRows.map((row) => ({ freqGHz: row.freqGHz, db: row.s11db }))
        },
        {
          label: "S21",
          cssClass: "s21",
          selector: { toPort: 2, fromPort: 1 },
          rows: metricRows.map((row) => ({ freqGHz: row.freqGHz, db: row.s21db }))
        },
        {
          label: "S22",
          cssClass: "s22",
          selector: { toPort: 2, fromPort: 2 },
          rows: metricRows.map((row) => ({ freqGHz: row.freqGHz, db: row.s22db }))
        }
      ],
      metricRows,
      impedance: buildImpedanceModel(doc)
    };
  }

  const selectors = defaultSelectorsForPortCount(doc.ports);
  return {
    title: `S${doc.ports}P Preview`,
    fileLabel,
    series: selectors.map((selector) => traceSeries(doc, selector)),
    impedance: buildImpedanceModel(doc)
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
      rows: traceDbRows(item.doc, selector)
    }))
  };
}

function defaultSelectorsForPortCount(ports: number): TraceSelector[] {
  const selectors: TraceSelector[] = [{ toPort: 1, fromPort: 1 }];
  if (ports >= 2) {
    selectors.push({ toPort: 2, fromPort: 1 }, { toPort: 2, fromPort: 2 });
  }
  return selectors;
}

function traceSeries(doc: TouchstoneDocument, selector: TraceSelector): ChartSeries {
  const label = traceSelectorLabel(selector);
  return {
    label,
    cssClass: label.toLowerCase(),
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
