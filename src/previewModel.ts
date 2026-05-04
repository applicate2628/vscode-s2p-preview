import {
  S2pRow,
  TouchstoneDocument,
  TraceSelector,
  toS2pRows,
  traceDbRows,
  traceSelectorLabel
} from "./touchstone";

export interface ChartPoint {
  freqGHz: number;
  db: number;
}

export interface ChartSeries {
  label: string;
  cssClass: string;
  rows: ChartPoint[];
}

export interface PreviewModel {
  title: string;
  fileLabel: string;
  series: ChartSeries[];
  metricRows?: S2pRow[];
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
          rows: metricRows.map((row) => ({ freqGHz: row.freqGHz, db: row.s11db }))
        },
        {
          label: "S21",
          cssClass: "s21",
          rows: metricRows.map((row) => ({ freqGHz: row.freqGHz, db: row.s21db }))
        },
        {
          label: "S22",
          cssClass: "s22",
          rows: metricRows.map((row) => ({ freqGHz: row.freqGHz, db: row.s22db }))
        }
      ],
      metricRows
    };
  }

  const selectors = defaultSelectorsForPortCount(doc.ports);
  return {
    title: `S${doc.ports}P Preview`,
    fileLabel,
    series: selectors.map((selector) => traceSeries(doc, selector))
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
    rows: traceDbRows(doc, selector)
  };
}
