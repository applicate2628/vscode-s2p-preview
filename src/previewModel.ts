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
  return {
    title: previewTitle(doc),
    fileLabel,
    series: defaultSelectorsForPortCount(doc.ports).map((selector, index) =>
      traceSeries(doc, selector, index, { labelPrefix: "", overlayIndex: undefined })
    ),
    metricRows: doc.ports === 2 ? toS2pRows(doc) : undefined,
    impedance: buildImpedanceModel(doc),
    warnings: doc.warnings.slice()
  };
}

export function buildPreviewModelWithOverlays(
  doc: TouchstoneDocument,
  fileLabel: string,
  overlays: Array<{ doc: TouchstoneDocument; fileLabel: string }>
): PreviewModel {
  if (overlays.length === 0) {
    return buildPreviewModel(doc, fileLabel);
  }

  const selectors = defaultSelectorsForPortCount(doc.ports);
  const baseSeries = selectors.map((selector, index) =>
    traceSeries(doc, selector, index, {
      labelPrefix: shortFileLabel(fileLabel),
      overlayIndex: undefined
    })
  );
  const overlaySeries = overlays.flatMap((item, overlayIndex) =>
    selectors
      .filter((selector) => selector.toPort <= item.doc.ports && selector.fromPort <= item.doc.ports)
      .map((selector, index) =>
        traceSeries(item.doc, selector, index, {
          labelPrefix: shortFileLabel(item.fileLabel),
          overlayIndex
        })
      )
  );

  return {
    title: previewTitle(doc),
    fileLabel: `${fileLabel} + ${overlays.length} overlay${overlays.length === 1 ? "" : "s"}`,
    series: [...baseSeries, ...overlaySeries],
    metricRows: doc.ports === 2 ? toS2pRows(doc) : undefined,
    impedance: buildImpedanceModel(doc),
    warnings: [
      ...doc.warnings,
      ...overlays.flatMap((item) => item.doc.warnings.map((warning) => `${item.fileLabel}: ${warning}`))
    ]
  };
}

export function buildOverlayPreviewModel(docs: Array<{ doc: TouchstoneDocument; fileLabel: string }>): PreviewModel {
  if (docs.length === 0) {
    throw new Error("Overlay preview requires at least one Touchstone document.");
  }

  const commonPortCount = Math.min(...docs.map((item) => item.doc.ports));
  const selectors = defaultSelectorsForPortCount(commonPortCount);

  return {
    title: "S2P Overlay",
    fileLabel: `${docs.length} files, ${selectors.length} trace${selectors.length === 1 ? "" : "s"}`,
    series: docs.flatMap((item, overlayIndex) =>
      selectors.map((selector, index) =>
        traceSeries(item.doc, selector, index, {
          labelPrefix: shortFileLabel(item.fileLabel),
          overlayIndex
        })
      )
    ),
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

function traceSeries(
  doc: TouchstoneDocument,
  selector: TraceSelector,
  index: number,
  options: { labelPrefix: string; overlayIndex?: number }
): ChartSeries {
  const label = traceSelectorLabel(selector);
  const baseClass = selectorCssClass(selector, index);
  const overlayClass = options.overlayIndex === undefined
    ? ""
    : ` overlay-line overlay-file-${options.overlayIndex % 8}`;
  return {
    label: options.labelPrefix ? `${options.labelPrefix} ${label}` : label,
    cssClass: `${baseClass}${overlayClass}`,
    defaultVisible: defaultVisibleForSelector(doc.ports, selector),
    selector,
    rows: traceDbRows(doc, selector)
  };
}

function previewTitle(doc: TouchstoneDocument): string {
  return `S${doc.ports}P Preview`;
}

function selectorCssClass(selector: TraceSelector, index: number): string {
  const label = traceSelectorLabel(selector).toLowerCase();
  if (label === "s11" || label === "s21" || label === "s22") {
    return label;
  }
  return `trace-${index % 12}`;
}

function defaultVisibleForSelector(ports: number, selector: TraceSelector): boolean {
  if (ports === 1) {
    return selector.toPort === 1 && selector.fromPort === 1;
  }
  if (ports === 2) {
    return (
      (selector.toPort === 1 && selector.fromPort === 1) ||
      (selector.toPort === 2 && selector.fromPort === 1) ||
      (selector.toPort === 2 && selector.fromPort === 2)
    );
  }
  return selector.fromPort === 1;
}

function shortFileLabel(fileLabel: string): string {
  const normalized = fileLabel.replace(/\\/g, "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1);
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
