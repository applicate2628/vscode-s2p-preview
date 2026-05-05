import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import {
  AUTO_PASSBAND_LABEL,
  DEFAULT_PASSBAND_PRESETS,
  createAutoPassband,
  normalizeDefaultPassbandLabel,
  sanitizePresetRenormalize,
  sanitizePresetTraces,
  upsertPassbandPreset,
  userScopedConfigurationValue
} from "./passband";
import type { PassbandPreset, PassbandPresetRenormalize, PassbandPresetTrace } from "./passband";
import { formatEffectiveReferenceOhms, formatFileReferenceOhms } from "./impedanceDisplay";
import {
  ChartPoint,
  ChartSeries,
  PreviewModel,
  buildOverlayPreviewModel,
  buildPreviewModel,
  buildPreviewModelWithOverlays
} from "./previewModel";
import type { PreviewImpedanceModel } from "./previewModel";
import {
  MAX_PNG_EXPORT_EDGE,
  MAX_PNG_EXPORT_PIXELS,
  MAX_PNG_EXPORT_SCALE,
  MIN_PNG_EXPORT_SCALE
} from "./pngExport";
import { renormalizeDocument } from "./renormalize";
import { broadcastSettingsUpdated } from "./settingsSync";
import { parseTouchstone, traceSelectorLabel } from "./touchstone";
import type { S2pRow, TouchstoneDocument, TraceSelector } from "./touchstone";

const CUSTOM_EDITOR_VIEW_TYPE = "s2pPreview.editor";
const OVERLAY_SELECTION_ERROR = "S2P Preview: select one or more Touchstone files first.";
const TOUCHSTONE_EXTENSIONS = new Set([".s1p", ".s2p", ".s3p", ".s4p"]);
const TOUCHSTONE_PARSE_OPTIONS = { allowIncompleteFinalSample: true };
const activePreviewPanels = new Set<vscode.WebviewPanel>();
const activePreviewDocuments = new Map<vscode.WebviewPanel, PreviewDocumentState>();
let lastActivePreviewPanel: vscode.WebviewPanel | undefined;

interface PassbandSettings {
  presets: PassbandPreset[];
  defaultPresetLabel: string;
}

interface PreviewDocumentState {
  doc: TouchstoneDocument;
  fileLabel: string;
  uri: vscode.Uri;
  overlays: OverlayDocumentState[];
}

interface OverlayDocumentState {
  doc: TouchstoneDocument;
  fileLabel: string;
  uri: vscode.Uri;
}

type WebviewMessage =
  | {
    type: "addPreset";
    startGHz: number;
    stopGHz: number;
    activePresetLabel?: string;
    traces?: PassbandPresetTrace[];
    renormalize?: PassbandPresetRenormalize;
  }
  | { type: "deletePreset"; label: string }
  | { type: "setDefaultPreset"; label: string }
  | { type: "exportPng"; fileName?: string; dataUrl?: string }
  | { type: "openOverlayPicker" }
  | { type: "renormalize"; targetOhms: number[]; selectedPorts: boolean[] };

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("s2pPreview.open", async (uri?: vscode.Uri) => {
      const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!targetUri) {
        vscode.window.showErrorMessage("S2P Preview: open or select a Touchstone S-parameter file first.");
        return;
      }

      const title = `S2P Preview: ${basename(targetUri)}`;
      const panel = vscode.window.createWebviewPanel(
        "s2pPreview",
        title,
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          localResourceRoots: []
        }
      );

      attachWebviewMessageHandler(panel);
      await renderUriIntoWebview(targetUri, panel);
    }),
    vscode.commands.registerCommand("s2pPreview.openOverlay", async (uri?: vscode.Uri, selectedUris?: vscode.Uri[]) => {
      await openOverlayPreview(uri, selectedUris);
    }),
    vscode.commands.registerCommand("s2pPreview.openOverlayPicker", async (uri?: vscode.Uri) => {
      const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!targetUri || !isTouchstoneUri(targetUri)) {
        vscode.window.showErrorMessage("S2P Preview: open or select a Touchstone file first.");
        return;
      }

      await openOverlayPickerForUri(targetUri);
    }),
    vscode.window.registerCustomEditorProvider(
      CUSTOM_EDITOR_VIEW_TYPE,
      new S2pPreviewEditorProvider(),
      {
        supportsMultipleEditorsPerDocument: false,
        webviewOptions: {
          retainContextWhenHidden: true
        }
      }
    )
  );
}

export function deactivate(): void {
  // No resources to release.
}

class S2pDocument implements vscode.CustomDocument {
  public constructor(public readonly uri: vscode.Uri) {}

  public dispose(): void {
    // No resources to release.
  }
}

class S2pPreviewEditorProvider implements vscode.CustomReadonlyEditorProvider<S2pDocument> {
  public async openCustomDocument(uri: vscode.Uri): Promise<S2pDocument> {
    return new S2pDocument(uri);
  }

  public async resolveCustomEditor(document: S2pDocument, webviewPanel: vscode.WebviewPanel): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: []
    };

    attachWebviewMessageHandler(webviewPanel);
    await renderUriIntoWebview(document.uri, webviewPanel);
  }
}

async function openOverlayPreview(uri?: vscode.Uri, selectedUris?: vscode.Uri[]): Promise<void> {
  const uris = selectedTouchstoneUris(uri, selectedUris);
  if (uris.length === 0) {
    vscode.window.showErrorMessage(OVERLAY_SELECTION_ERROR);
    return;
  }

  const targetPanel = activePreviewPanel();
  if (targetPanel) {
    await applyOverlayUrisToPanel(targetPanel, uris);
    return;
  }

  try {
    const docs = await readTouchstoneDocuments(uris);
    const model = buildOverlayPreviewModel(docs);
    const panel = vscode.window.createWebviewPanel(
      "s2pPreview",
      `S2P Overlay: ${uris.length} files`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        localResourceRoots: []
      }
    );

    attachWebviewMessageHandler(panel);
    panel.webview.html = renderPreviewHtml(panel.webview, model, getPassbandSettings());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`S2P Preview: ${message}`);
  }
}

async function openOverlayPickerFromWebview(panel: vscode.WebviewPanel): Promise<void> {
  const state = activePreviewDocuments.get(panel);
  if (!state) {
    await panel.webview.postMessage({
      type: "operationStatus",
      message: "Open a single Touchstone file first, then select files for overlay."
    });
    return;
  }

  await openOverlayPickerForUri(state.uri, panel);
}

async function openOverlayPickerForUri(uri: vscode.Uri, targetPanel?: vscode.WebviewPanel): Promise<void> {
  const folder = dirnameUri(uri);
  const entries = await vscode.workspace.fs.readDirectory(folder);
  const candidates = entries
    .filter(([, fileType]) => (fileType & vscode.FileType.File) !== 0)
    .map(([name]) => vscode.Uri.joinPath(folder, name))
    .filter(isTouchstoneUri)
    .sort((left, right) => basename(left).localeCompare(basename(right), undefined, { numeric: true }));

  if (candidates.length === 0) {
    vscode.window.showErrorMessage("S2P Preview: no Touchstone files found in this folder.");
    return;
  }

  const sourceKey = uri.toString();
  const selected = await vscode.window.showQuickPick(
    candidates.map((candidate) => ({
      label: basename(candidate),
      description: vscode.workspace.asRelativePath(candidate, false),
      detail: candidate.toString() === sourceKey ? "Current file is already plotted." : undefined,
      picked: false,
      uri: candidate
    })),
    {
      canPickMany: true,
      matchOnDescription: true,
      placeHolder: "Select Touchstone files to overlay"
    }
  );

  if (!selected || selected.length === 0) {
    return;
  }

  if (targetPanel) {
    await applyOverlayUrisToPanel(targetPanel, selected.map((item) => item.uri));
    return;
  }

  await openOverlayPreview(undefined, selected.map((item) => item.uri));
}

async function applyOverlayUrisToPanel(panel: vscode.WebviewPanel, uris: vscode.Uri[]): Promise<void> {
  const state = activePreviewDocuments.get(panel);
  if (!state) {
    await openOverlayPreview(undefined, uris);
    return;
  }

  const sourceKey = state.uri.toString();
  const overlayUris = selectedTouchstoneUris(undefined, uris)
    .filter((item) => item.toString() !== sourceKey);
  if (overlayUris.length === 0) {
    await panel.webview.postMessage({
      type: "operationStatus",
      message: "Select at least one additional Touchstone file to overlay."
    });
    return;
  }

  state.overlays = await readTouchstoneDocuments(overlayUris);
  const model = buildPreviewModelWithOverlays(state.doc, state.fileLabel, state.overlays);
  panel.webview.html = renderPreviewHtml(panel.webview, model, getPassbandSettings(), { canPickOverlay: true });
}

async function readTouchstoneDocuments(uris: vscode.Uri[]): Promise<OverlayDocumentState[]> {
  return Promise.all(uris.map(async (item) => {
    const fileLabel = vscode.workspace.asRelativePath(item, false);
    const bytes = await vscode.workspace.fs.readFile(item);
    const text = new TextDecoder("utf-8").decode(bytes);
    return {
      doc: parseTouchstone(text, basename(item), TOUCHSTONE_PARSE_OPTIONS),
      fileLabel,
      uri: item
    };
  }));
}

function selectedTouchstoneUris(uri?: vscode.Uri, selectedUris?: vscode.Uri[]): vscode.Uri[] {
  const candidates = selectedUris && selectedUris.length > 0
    ? selectedUris
    : uri
      ? [uri]
      : [];
  const seen = new Set<string>();
  const uris: vscode.Uri[] = [];

  for (const item of candidates) {
    if (!isTouchstoneUri(item)) {
      continue;
    }

    const key = item.toString();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    uris.push(item);
  }

  return uris;
}

function isTouchstoneUri(uri: vscode.Uri): boolean {
  const name = basename(uri).toLowerCase();
  const dotIndex = name.lastIndexOf(".");
  return dotIndex >= 0 && TOUCHSTONE_EXTENSIONS.has(name.slice(dotIndex));
}

function attachWebviewMessageHandler(panel: vscode.WebviewPanel): void {
  activePreviewPanels.add(panel);
  lastActivePreviewPanel = panel;

  const disposable = panel.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
    try {
      switch (message.type) {
        case "addPreset":
          await addPresetFromWebview(
            panel,
            message.startGHz,
            message.stopGHz,
            message.activePresetLabel,
            message.traces,
            message.renormalize
          );
          return;
        case "deletePreset":
          await deletePresetFromWebview(panel, message.label);
          return;
        case "setDefaultPreset":
          await setDefaultPresetFromWebview(panel, message.label);
          return;
        case "exportPng":
          await exportPngFromWebview(panel, message.fileName, message.dataUrl);
          return;
        case "openOverlayPicker":
          await openOverlayPickerFromWebview(panel);
          return;
        case "renormalize":
          await renormalizeFromWebview(panel, message.targetOhms, message.selectedPorts);
          return;
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`S2P Preview: ${messageText}`);
      await panel.webview.postMessage({ type: "operationStatus", message: messageText });
    }
  });

  panel.onDidDispose(() => {
    disposable.dispose();
    activePreviewPanels.delete(panel);
    activePreviewDocuments.delete(panel);
    if (lastActivePreviewPanel === panel) {
      lastActivePreviewPanel = activePreviewPanels.values().next().value;
    }
  });
  panel.onDidChangeViewState((event) => {
    if (event.webviewPanel.active) {
      lastActivePreviewPanel = event.webviewPanel;
    }
  });
}

function activePreviewPanel(): vscode.WebviewPanel | undefined {
  if (lastActivePreviewPanel && activePreviewDocuments.has(lastActivePreviewPanel)) {
    return lastActivePreviewPanel;
  }

  for (const panel of activePreviewPanels) {
    if (activePreviewDocuments.has(panel)) {
      return panel;
    }
  }

  return undefined;
}

async function addPresetFromWebview(
  panel: vscode.WebviewPanel,
  startGHz: number,
  stopGHz: number,
  activePresetLabel: unknown,
  traces: unknown,
  renormalize: unknown
): Promise<void> {
  const normalized = normalizePresetRange(startGHz, stopGHz);
  if (!normalized) {
    await panel.webview.postMessage({ type: "operationStatus", message: "Cannot save invalid passband range." });
    return;
  }

  const settings = getPassbandSettings();
  const activePreset = typeof activePresetLabel === "string" && activePresetLabel !== AUTO_PASSBAND_LABEL
    ? settings.presets.find((preset) => preset.label === activePresetLabel)
    : undefined;
  const suggestedLabel = activePreset?.label ?? formatRangeLabel(normalized.startGHz, normalized.stopGHz);
  const label = await vscode.window.showInputBox({
    title: "Save S2P passband preset",
    prompt: "Preset label. Existing names update that preset.",
    value: suggestedLabel,
    validateInput: (value) => {
      const trimmed = value.trim();
      if (!trimmed) {
        return "Preset label is required.";
      }
      if (trimmed === AUTO_PASSBAND_LABEL) {
        return "This preset label is reserved.";
      }
      return undefined;
    }
  });

  if (label === undefined) {
    return;
  }

  const nextPreset: PassbandPreset = {
    label: label.trim(),
    startGHz: normalized.startGHz,
    stopGHz: normalized.stopGHz
  };
  const presetTraces = sanitizePresetTraces(traces);
  if (presetTraces) {
    nextPreset.traces = presetTraces;
  }
  const presetRenormalize = sanitizePresetRenormalize(renormalize);
  if (presetRenormalize) {
    nextPreset.renormalize = presetRenormalize;
  }
  const result = upsertPassbandPreset(settings.presets, nextPreset);
  await updatePassbandSettings(
    panel,
    result.presets,
    nextPreset.label,
    result.updated ? `Preset updated: ${nextPreset.label}` : `Preset saved: ${nextPreset.label}`
  );
}

async function deletePresetFromWebview(panel: vscode.WebviewPanel, label: string): Promise<void> {
  const settings = getPassbandSettings();
  if (settings.presets.length <= 1) {
    await panel.webview.postMessage({ type: "operationStatus", message: "Keep at least one preset." });
    return;
  }

  const nextPresets = settings.presets.filter((preset) => preset.label !== label);
  if (nextPresets.length === settings.presets.length) {
    await panel.webview.postMessage({ type: "operationStatus", message: "Preset was not found." });
    return;
  }

  const nextDefault = settings.defaultPresetLabel === AUTO_PASSBAND_LABEL
    ? AUTO_PASSBAND_LABEL
    : nextPresets.some((preset) => preset.label === settings.defaultPresetLabel)
      ? settings.defaultPresetLabel
      : nextPresets[0].label;
  await updatePassbandSettings(panel, nextPresets, nextDefault, `Preset deleted: ${label}`);
}

async function exportPngFromWebview(
  panel: vscode.WebviewPanel,
  fileName: unknown,
  dataUrl: unknown
): Promise<void> {
  const pngBytes = decodePngDataUrl(dataUrl);
  if (!pngBytes) {
    await panel.webview.postMessage({ type: "operationStatus", message: "Cannot export PNG: invalid image data." });
    return;
  }

  const safeFileName = sanitizePngFileName(fileName);
  const state = activePreviewDocuments.get(panel);
  const defaultUri = state ? vscode.Uri.joinPath(dirnameUri(state.uri), safeFileName) : undefined;
  const target = await vscode.window.showSaveDialog({
    defaultUri,
    filters: { "PNG Images": ["png"] },
    saveLabel: "Export PNG"
  });
  if (!target) {
    await panel.webview.postMessage({ type: "operationStatus", message: "PNG export cancelled." });
    return;
  }

  await vscode.workspace.fs.writeFile(target, pngBytes);
  await panel.webview.postMessage({
    type: "operationStatus",
    message: `PNG exported: ${vscode.workspace.asRelativePath(target, false)}`
  });
}

function decodePngDataUrl(value: unknown): Uint8Array | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const prefix = "data:image/png;base64,";
  if (!value.startsWith(prefix)) {
    return undefined;
  }

  const base64 = value.slice(prefix.length);
  if (!/^[0-9A-Za-z+/=]+$/.test(base64)) {
    return undefined;
  }

  const bytes = Buffer.from(base64, "base64");
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < pngSignature.length || pngSignature.some((byte, index) => bytes[index] !== byte)) {
    return undefined;
  }

  return bytes;
}

function sanitizePngFileName(value: unknown): string {
  const source = typeof value === "string" && value.trim() ? value.trim() : "touchstone-preview.png";
  const sanitized = source
    .replace(/[\\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
  const withFallback = sanitized || "touchstone-preview.png";
  return withFallback.toLowerCase().endsWith(".png") ? withFallback : `${withFallback}.png`;
}

async function setDefaultPresetFromWebview(panel: vscode.WebviewPanel, label: string): Promise<void> {
  const settings = getPassbandSettings();
  if (label !== AUTO_PASSBAND_LABEL && !settings.presets.some((preset) => preset.label === label)) {
    return;
  }

  await updateConfigurationValue("defaultPassbandPreset", label);
  await broadcastPassbandSettings();
}

async function updatePassbandSettings(
  panel: vscode.WebviewPanel,
  presets: PassbandPreset[],
  defaultPresetLabel: string,
  status: string
): Promise<void> {
  await updateConfigurationValue("passbandPresets", presets);
  await updateConfigurationValue("defaultPassbandPreset", defaultPresetLabel);
  await broadcastPassbandSettings(panel, status);
}

async function broadcastPassbandSettings(statusPanel?: vscode.WebviewPanel, status?: string): Promise<void> {
  await broadcastSettingsUpdated(activePreviewPanels, getPassbandSettings(), statusPanel, status);
}

async function renormalizeFromWebview(
  panel: vscode.WebviewPanel,
  targetOhms: number[],
  selectedPorts: boolean[]
): Promise<void> {
  const state = activePreviewDocuments.get(panel);
  if (!state) {
    return;
  }

  const doc = renormalizeDocument(state.doc, targetOhms, selectedPorts);
  const overlays = state.overlays.map((item) => ({
    ...item,
    doc: renormalizeDocument(item.doc, targetOhms, selectedPorts)
  }));
  const model = buildPreviewModelWithOverlays(doc, state.fileLabel, overlays);
  await panel.webview.postMessage({
    type: "renormalizedPreview",
    effectiveReferenceOhms: doc.referenceOhms,
    seriesRows: model.series.map((series) => series.rows),
    metricRows: model.metricRows ?? []
  });
}

async function updateConfigurationValue<T>(key: string, value: T): Promise<void> {
  await vscode.workspace.getConfiguration("s2pPreview").update(key, value, vscode.ConfigurationTarget.Global);
}

async function renderUriIntoWebview(uri: vscode.Uri, panel: vscode.WebviewPanel): Promise<void> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const text = new TextDecoder("utf-8").decode(bytes);
    const doc = parseTouchstone(text, basename(uri), TOUCHSTONE_PARSE_OPTIONS);
    const model = buildPreviewModel(doc, vscode.workspace.asRelativePath(uri, false));
    activePreviewDocuments.set(panel, { doc, fileLabel: vscode.workspace.asRelativePath(uri, false), uri, overlays: [] });
    panel.webview.html = renderPreviewHtml(panel.webview, model, getPassbandSettings(), { canPickOverlay: true });
  } catch (error) {
    activePreviewDocuments.delete(panel);
    panel.webview.html = renderErrorHtml(panel.webview, uri, error);
  }
}

function renderPreviewHtml(
  webview: vscode.Webview,
  model: PreviewModel,
  settings: PassbandSettings,
  options: { canPickOverlay?: boolean } = {}
): string {
  const defaultPreset = resolveInitialPassband(model, settings);
  const chart = renderChart(model.series, defaultPreset);
  const metricsTable = renderMetrics(defaultPreset, model.metricRows);
  const controls = renderControls(defaultPreset, options.canPickOverlay === true, model.impedance);
  const traceSelector = renderTraceSelector(model.series, defaultPreset);
  const warnings = renderWarnings(model.warnings ?? []);
  const script = renderClientScript(model, settings);

  return htmlShell(
    webview,
    `
    <header class="preview-header">
      <div>
        <p class="eyebrow">Touchstone Preview</p>
        <h1>${escapeHtml(model.title)}</h1>
        <p class="file">${escapeHtml(model.fileLabel)}</p>
      </div>
      <div class="header-summary" aria-label="Preview summary">
        <span>${model.series.length} traces</span>
        <span>${model.metricRows ? "2-port metrics" : "N-port view"}</span>
      </div>
    </header>
    ${controls}
    ${warnings}
    <main class="plot-column">
      ${chart}
      ${metricsTable}
      ${traceSelector}
    </main>
  `,
    script
  );
}

function renderErrorHtml(webview: vscode.Webview, uri: vscode.Uri, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return htmlShell(
    webview,
    `
    <header>
      <h1>S2P Preview</h1>
      <p class="file">${escapeHtml(vscode.workspace.asRelativePath(uri, false))}</p>
    </header>
    <section class="error">
      <h2>Cannot preview this file</h2>
      <p>${escapeHtml(message)}</p>
      <p>Current preview supports Touchstone S-parameter files in MA, DB, or RI format. Single-file metrics are available for 2-port files.</p>
    </section>
  `
  );
}

function renderWarnings(warnings: string[]): string {
  if (warnings.length === 0) {
    return "";
  }

  return `
    <section class="warnings" aria-label="Touchstone warnings">
      ${warnings.map((warning) => `<p>${escapeHtml(warning)}</p>`).join("")}
    </section>
  `;
}

function renderTraceSelector(series: ChartSeries[], preset: PassbandPreset): string {
  const selectableSeries = series
    .map((item, index) => ({ item, index }))
    .filter((entry) => entry.item.selector);

  if (selectableSeries.length === 0) {
    return "";
  }

  const matrixGroups = traceMatrixGroups(selectableSeries, preset);
  const hasMultipleGroups = matrixGroups.length > 1;
  const matrices = matrixGroups.map((group) => renderTraceMatrixGroup(group, hasMultipleGroups)).join("");

  return `
    <section class="trace-controls" aria-label="Visible S-parameters">
      <fieldset>
        <legend>S-Parameter Matrix</legend>
        <p class="section-note">Choose traces to plot.</p>
        ${matrices}
      </fieldset>
    </section>
  `;
}

interface TraceMatrixGroup {
  label?: string;
  portCount: number;
  entries: Array<{ item: ChartSeries; index: number }>;
  selectedTraceKeys?: Set<string>;
}

function traceMatrixGroups(
  selectableSeries: Array<{ item: ChartSeries; index: number }>,
  preset: PassbandPreset
): TraceMatrixGroup[] {
  const groups: TraceMatrixGroup[] = [];
  const byLabel = new Map<string, TraceMatrixGroup>();
  const selectedTraceKeys = selectedTraceKeysForPreset(selectableSeries, preset);

  for (const entry of selectableSeries) {
    const label = entry.item.groupLabel;
    const key = label ?? "";
    let group = byLabel.get(key);
    if (!group) {
      group = {
        label,
        portCount: 0,
        entries: [],
        selectedTraceKeys
      };
      byLabel.set(key, group);
      groups.push(group);
    }

    group.entries.push(entry);
    group.portCount = Math.max(
      group.portCount,
      entry.item.selector?.toPort ?? 0,
      entry.item.selector?.fromPort ?? 0
    );
  }

  return groups.filter((group) => group.portCount > 0 && group.entries.length > 0);
}

function renderTraceMatrixGroup(group: TraceMatrixGroup, showTitle: boolean): string {
  const bySelector = new Map<string, { item: ChartSeries; index: number }>();
  for (const entry of group.entries) {
    bySelector.set(traceKey(entry.item.selector), entry);
  }

  const header = [
    `<span class="trace-corner">to/from</span>`,
    ...range(1, group.portCount, 1).map((port) => `<span class="trace-header">P${port}</span>`)
  ].join("");
  const rows = range(1, group.portCount, 1).map((toPort) => [
    `<span class="trace-header">P${toPort}</span>`,
    ...range(1, group.portCount, 1).map((fromPort) => {
      const entry = bySelector.get(`${toPort}:${fromPort}`);
      if (!entry) {
        return `<span class="trace-empty"></span>`;
      }

      const key = `${toPort}:${fromPort}`;
      const checked = group.selectedTraceKeys
        ? group.selectedTraceKeys.has(key)
        : entry.item.defaultVisible;
      return `
        <label class="trace-toggle">
          <input type="checkbox" data-trace-series="${entry.index}" data-trace-key="${key}" data-trace-to="${toPort}" data-trace-from="${fromPort}" data-trace-default="${entry.item.defaultVisible ? "true" : "false"}" ${checked ? "checked" : ""} />
          <span class="trace-swatch ${escapeHtml(entry.item.cssClass)}"></span>
          <span>S${toPort}${fromPort}</span>
        </label>
      `;
    })
  ].join("")).join("");

  return `
    <div class="trace-matrix-block">
      ${showTitle && group.label ? `<h3 class="trace-matrix-title">${escapeHtml(group.label)}</h3>` : ""}
      <div class="trace-selector-grid" style="--trace-port-count: ${group.portCount}">
        ${header}
        ${rows}
      </div>
    </div>
  `;
}

function traceKey(selector?: TraceSelector): string {
  return selector ? `${selector.toPort}:${selector.fromPort}` : "";
}

function selectedTraceKeysForPreset(
  selectableSeries: Array<{ item: ChartSeries; index: number }>,
  preset: PassbandPreset
): Set<string> | undefined {
  const available = new Set(
    selectableSeries.map((entry) => `${entry.item.selector?.toPort}:${entry.item.selector?.fromPort}`)
  );
  const selected = new Set<string>();
  for (const trace of preset.traces ?? []) {
    const key = `${trace.toPort}:${trace.fromPort}`;
    if (available.has(key)) {
      selected.add(key);
    }
  }

  return selected.size > 0 ? selected : undefined;
}

function renderControls(
  defaultPreset: PassbandPreset,
  canPickOverlay: boolean,
  impedance?: PreviewImpedanceModel
): string {
  return `
    <section class="controls" aria-label="Passband controls">
      <div class="range-controls">
        <label class="control-field">
          Start GHz
          <input id="passband-start" type="number" value="${defaultPreset.startGHz}" step="0.01" />
        </label>
        <label class="control-field">
          Stop GHz
          <input id="passband-stop" type="number" value="${defaultPreset.stopGHz}" step="0.01" />
        </label>
        <div class="preset-dropdown">
          <button id="preset-menu-button" class="split-button preset-menu-button" type="button" aria-haspopup="listbox" aria-expanded="false">
            <span id="preset-menu-label">${escapeHtml(defaultPreset.label)}</span>
            <small id="preset-menu-range">${escapeHtml(formatRangeLabel(defaultPreset.startGHz, defaultPreset.stopGHz))}</small>
          </button>
          <div id="preset-menu" class="preset-menu" role="listbox" hidden></div>
        </div>
        ${canPickOverlay ? `<button id="overlay-picker-button" class="secondary-action" type="button">Overlay files...</button>` : ""}
        <button id="export-png-button" class="secondary-action" type="button">Export PNG...</button>
        ${impedance ? renderImpedanceControls(impedance, defaultPreset) : ""}
        <span id="passband-status" role="status" aria-live="polite"></span>
      </div>
    </section>
  `;
}

function renderImpedanceControls(impedance: PreviewImpedanceModel, preset: PassbandPreset): string {
  const initial = initialRenormalizeState(impedance, preset);
  const ports = impedance.referenceOhms.map((sourceOhms, index) => `
        <div class="port-target">
          <label class="port-target-toggle">
            <input type="checkbox" data-z0-port="${index}" ${initial.selectedPorts[index] ? "checked" : ""} />
            <span>P${index + 1}</span>
          </label>
          <input class="port-target-input" type="number" data-z0-target="${index}" aria-label="P${index + 1} target Z0 Ohm" value="${initial.targetOhms[index] ?? sourceOhms}" min="0.001" step="1" />
        </div>
      `).join("");

  return `
      <section class="z0-card">
      <fieldset class="z0-ports">
        <legend>Z0 Renormalization</legend>
        <div class="port-target-row">
          ${ports}
        </div>
      </fieldset>
      <span class="z0-info">
        <span>${escapeHtml(formatFileReferenceOhms(impedance.referenceOhms))}</span>
        <span id="effective-z0">${escapeHtml(formatEffectiveReferenceOhms(effectiveInitialReferenceOhms(impedance, initial)))}</span>
      </span>
      </section>
  `;
}

function initialRenormalizeState(
  impedance: PreviewImpedanceModel,
  preset: PassbandPreset
): PassbandPresetRenormalize {
  const selectedPorts = impedance.referenceOhms.map(() => false);
  const targetOhms = impedance.referenceOhms.slice();
  const renormalize = preset.renormalize;
  if (renormalize) {
    for (let index = 0; index < targetOhms.length; index += 1) {
      const target = renormalize.targetOhms[index];
      if (Number.isFinite(target) && target > 0) {
        targetOhms[index] = target;
      }
      selectedPorts[index] = renormalize.selectedPorts[index] === true;
    }
  }

  return { selectedPorts, targetOhms };
}

function effectiveInitialReferenceOhms(
  impedance: PreviewImpedanceModel,
  initial: PassbandPresetRenormalize
): number[] {
  return impedance.referenceOhms.map((sourceOhms, index) =>
    initial.selectedPorts[index] ? initial.targetOhms[index] : sourceOhms
  );
}

interface ChartGeometry {
  width: number;
  height: number;
  margin: { left: number; right: number; top: number; bottom: number };
  plotWidth: number;
  plotHeight: number;
  minFreq: number;
  maxFreq: number;
  displayMinFreq: number;
  displayMaxFreq: number;
  yMin: number;
  yMax: number;
}

function renderChart(series: ChartSeries[], defaultPreset: PassbandPreset): string {
  const chart = chartGeometry(series);
  const xTicks = range(Math.ceil(chart.minFreq), Math.floor(chart.maxFreq), 1);
  const yTicks = range(Math.ceil(chart.yMin / 10) * 10, 0, 10);
  const visibleStart = Math.max(defaultPreset.startGHz, chart.minFreq);
  const visibleStop = Math.min(defaultPreset.stopGHz, chart.maxFreq);
  const passbandX = visibleStart < visibleStop ? xCoord(visibleStart, chart) : xCoord(defaultPreset.startGHz, chart);
  const passbandWidth = visibleStart < visibleStop ? xCoord(visibleStop, chart) - passbandX : 0;
  const guides = [-3, -15, -20];
  const hasOverlaySeries = series.some((item) => item.cssClass.includes("overlay-line"));
  const legendGroups = hasOverlaySeries ? legendGroupsForSeries(series) : [];
  const showSeriesLegend = hasOverlaySeries || series.length <= 4;
  const legendItems = showSeriesLegend
    ? hasOverlaySeries
      ? renderGroupedLegendItems(legendGroups)
      : renderInlineLegendItems(series)
    : "";
  const legendModeClass = hasOverlaySeries ? "grouped" : "inline";
  const legendStyle = hasOverlaySeries ? ` style="--legend-height: ${legendHeightForGroups(legendGroups)}px"` : "";

  return `
    <section class="chart-wrap">
      <div class="chart-range-indicator" aria-label="Passband range">
        <span class="legend-passband"></span>
        <span id="legend-passband-label">${escapeHtml(formatRangeLabel(defaultPreset.startGHz, defaultPreset.stopGHz))}</span>
      </div>
      <svg viewBox="0 0 ${chart.width} ${chart.height}" role="img" aria-label="S-parameter plot">
        <rect class="chart-bg" x="0" y="0" width="${chart.width}" height="${chart.height}" />
        <rect id="passband-rect" class="passband" x="${passbandX.toFixed(2)}" y="${chart.margin.top}" width="${passbandWidth.toFixed(2)}" height="${chart.plotHeight}" />
        ${xTicks.map((tick) => `<line class="grid" x1="${xCoord(tick, chart).toFixed(2)}" y1="${chart.margin.top}" x2="${xCoord(tick, chart).toFixed(2)}" y2="${chart.margin.top + chart.plotHeight}" />`).join("")}
        ${yTicks.map((tick) => `<line class="grid" x1="${chart.margin.left}" y1="${yCoord(tick, chart).toFixed(2)}" x2="${chart.margin.left + chart.plotWidth}" y2="${yCoord(tick, chart).toFixed(2)}" />`).join("")}
        ${guides.map((guide) => `<line class="guide" x1="${chart.margin.left}" y1="${yCoord(guide, chart).toFixed(2)}" x2="${chart.margin.left + chart.plotWidth}" y2="${yCoord(guide, chart).toFixed(2)}" /><text class="guide-label" x="${chart.margin.left + chart.plotWidth - 56}" y="${(yCoord(guide, chart) - 5).toFixed(2)}">${guide} dB</text>`).join("")}
        ${series.map((item, index) => {
          const key = traceKey(item.selector);
          return `<polyline id="series-${index}" class="curve ${escapeHtml(item.cssClass)}${item.defaultVisible ? "" : " series-hidden"}" ${key ? `data-series-trace-key="${escapeHtml(key)}"` : ""}${seriesStyleAttribute(item)} points="${linePoints(item.rows, chart)}" />`;
        }).join("")}
        <rect class="axis" x="${chart.margin.left}" y="${chart.margin.top}" width="${chart.plotWidth}" height="${chart.plotHeight}" />
        ${xTicks.map((tick) => `<text class="tick" x="${xCoord(tick, chart).toFixed(2)}" y="${chart.height - 28}" text-anchor="middle">${tick}</text>`).join("")}
        ${yTicks.map((tick) => `<text class="tick" x="${chart.margin.left - 12}" y="${(yCoord(tick, chart) + 4).toFixed(2)}" text-anchor="end">${tick}</text>`).join("")}
        <text class="axis-label" x="${chart.margin.left + chart.plotWidth / 2}" y="${chart.height - 8}" text-anchor="middle">Frequency, GHz</text>
        <text class="axis-label" x="18" y="${chart.margin.top + chart.plotHeight / 2}" text-anchor="middle" transform="rotate(-90 18 ${chart.margin.top + chart.plotHeight / 2})">dB</text>
      </svg>
      ${legendItems ? `<div class="chart-legend ${legendModeClass}"${legendStyle} aria-label="Plot legend">
        ${legendItems}
      </div>` : ""}
    </section>
  `;
}

function renderInlineLegendItems(series: ChartSeries[]): string {
  return series.map((item, index) => renderLegendItem(item, index, item.label)).join("");
}

interface LegendGroup {
  label: string;
  entries: Array<{ item: ChartSeries; index: number }>;
}

function legendGroupsForSeries(series: ChartSeries[]): LegendGroup[] {
  const groups: Array<{ label: string; entries: Array<{ item: ChartSeries; index: number }> }> = [];
  const byLabel = new Map<string, { label: string; entries: Array<{ item: ChartSeries; index: number }> }>();

  for (const entry of series.map((item, index) => ({ item, index }))) {
    const label = entry.item.groupLabel ?? "File";
    let group = byLabel.get(label);
    if (!group) {
      group = { label, entries: [] };
      byLabel.set(label, group);
      groups.push(group);
    }
    group.entries.push(entry);
  }

  return groups;
}

function renderGroupedLegendItems(groups: LegendGroup[]): string {
  return groups.map((group) => `
    <div class="legend-file-row">
      <span class="legend-file-label" title="${escapeHtml(group.label)}">${escapeHtml(group.label)}</span>
      <div class="legend-file-items">
        ${group.entries.map((entry) => renderLegendItem(entry.item, entry.index, legendTraceLabel(entry.item))).join("")}
      </div>
    </div>
  `).join("");
}

function legendHeightForGroups(groups: LegendGroup[]): number {
  const baseHeight = 76;
  const rowHeight = 22;
  const verticalPadding = 24;
  const maxHeight = 280;
  return Math.min(maxHeight, Math.max(baseHeight, groups.length * rowHeight + verticalPadding));
}

function renderLegendItem(item: ChartSeries, index: number, label: string): string {
  const visibilityClass = item.defaultVisible ? "" : " series-hidden";
  const key = traceKey(item.selector);
  return `
    <div id="legend-${index}" class="legend-item${visibilityClass}" ${key ? `data-series-trace-key="${escapeHtml(key)}"` : ""}>
      <span class="legend-line ${escapeHtml(item.cssClass)}"${seriesStyleAttribute(item)}></span>
      <span>${escapeHtml(label)}</span>
    </div>
  `;
}

function seriesStyleAttribute(item: ChartSeries): string {
  return item.color ? ` style="--trace-color: ${escapeHtml(item.color)}"` : "";
}

function legendTraceLabel(item: ChartSeries): string {
  return item.selector ? traceSelectorLabel(item.selector) : item.label;
}

function linePoints(rows: ChartPoint[], chart: ChartGeometry): string {
  return rows.map((row) => `${xCoord(row.freqGHz, chart).toFixed(2)},${yCoord(row.db, chart).toFixed(2)}`).join(" ");
}

function chartGeometry(series: ChartSeries[]): ChartGeometry {
  const width = 980;
  const height = 520;
  const margin = { left: 64, right: 24, top: 30, bottom: 54 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const points = allChartPoints(series);
  const minFreq = Math.min(...points.map((row) => row.freqGHz));
  const maxFreq = Math.max(...points.map((row) => row.freqGHz));
  const allDb = points.map((row) => row.db);
  // Clamp yMin to a reasonable display range. Very small magnitudes (numerical noise
  // or deep stopband nulls) can otherwise push yMin to -200 dB or lower, which
  // squashes the in-band curves to a sliver near the top of the chart.
  const dataMin = Math.min(...allDb);
  const yMinFloor = -80;
  const yMin = Math.max(yMinFloor, Math.min(-40, Math.floor(dataMin / 10) * 10));
  const yMax = 2;
  const displayPadding = minFreq === maxFreq ? 0.5 : 0;

  return {
    width,
    height,
    margin,
    plotWidth,
    plotHeight,
    minFreq,
    maxFreq,
    displayMinFreq: minFreq - displayPadding,
    displayMaxFreq: maxFreq + displayPadding,
    yMin,
    yMax
  };
}

function xCoord(freqGHz: number, chart: ChartGeometry): number {
  return chart.margin.left + ((freqGHz - chart.displayMinFreq) / (chart.displayMaxFreq - chart.displayMinFreq)) * chart.plotWidth;
}

function yCoord(db: number, chart: ChartGeometry): number {
  return chart.margin.top + ((chart.yMax - db) / (chart.yMax - chart.yMin)) * chart.plotHeight;
}

function renderMetrics(defaultPreset: PassbandPreset, metricRows?: S2pRow[]): string {
  if (!metricRows) {
    return `
      <section class="metrics">
        <h2 id="metrics-title">${escapeHtml(formatRangeLabel(defaultPreset.startGHz, defaultPreset.stopGHz))} Metrics</h2>
        <p id="metric-status" class="metric-status">2-port passband metrics are not available for this file.</p>
      </section>
    `;
  }

  return `
    <section class="metrics">
      <h2 id="metrics-title">${escapeHtml(formatRangeLabel(defaultPreset.startGHz, defaultPreset.stopGHz))} Metrics</h2>
      <p id="metric-status" class="metric-status" aria-live="polite"></p>
      <table>
        <tbody>
          <tr><th>Best S21</th><td id="metric-best-s21">-</td></tr>
          <tr><th>Worst S11</th><td id="metric-worst-s11">-</td></tr>
          <tr><th>Worst S22</th><td id="metric-worst-s22">-</td></tr>
          <tr><th>Average S21</th><td id="metric-avg-s21">-</td></tr>
          <tr><th>S21 &gt;= -3 dB bands</th><td id="metric-s21-bands">-</td></tr>
          <tr><th>S21 &gt;= -3 dB and S11/S22 &lt;= -15 dB</th><td id="metric-matched-bands">-</td></tr>
          <tr><th>Matched coverage inside passband</th><td id="metric-matched-coverage">-</td></tr>
        </tbody>
      </table>
    </section>
  `;
}

function renderClientScript(model: PreviewModel, settings: PassbandSettings): string {
  const chart = chartGeometry(model.series);
  const metricRows = model.metricRows ?? [];
  const metricRowsJson = jsonForScript(metricRows);
  const impedanceJson = jsonForScript(model.impedance);
  const settingsJson = jsonForScript(settings);
  const fileLabelJson = jsonForScript(model.fileLabel);
  const hasMetricRows = model.metricRows ? "true" : "false";

  return `
    const vscode = acquireVsCodeApi();
    const AUTO_PASSBAND_LABEL = ${jsonForScript(AUTO_PASSBAND_LABEL)};
    const METRICS_UNAVAILABLE = "2-port passband metrics are not available for this file.";
    const metricRows = ${metricRowsJson};
    const impedance = ${impedanceJson};
    const exportSourceLabel = ${fileLabelJson};
    const hasMetricRows = ${hasMetricRows};
    const MIN_PNG_EXPORT_SCALE = ${MIN_PNG_EXPORT_SCALE};
    const MAX_PNG_EXPORT_SCALE = ${MAX_PNG_EXPORT_SCALE};
    const MAX_PNG_EXPORT_EDGE = ${MAX_PNG_EXPORT_EDGE};
    const MAX_PNG_EXPORT_PIXELS = ${MAX_PNG_EXPORT_PIXELS};
    let currentMetricRows = metricRows;
    let settings = ${settingsJson};
    let activePresetLabel = settings.defaultPresetLabel;
    const chart = {
      minFreq: ${chart.minFreq},
      maxFreq: ${chart.maxFreq},
      displayMinFreq: ${chart.displayMinFreq},
      displayMaxFreq: ${chart.displayMaxFreq},
      yMin: ${chart.yMin},
      yMax: ${chart.yMax},
      marginTop: ${chart.margin.top},
      marginLeft: ${chart.margin.left},
      plotWidth: ${chart.plotWidth},
      plotHeight: ${chart.plotHeight}
    };

    const startInput = document.getElementById("passband-start");
    const stopInput = document.getElementById("passband-stop");
    const presetMenuButton = document.getElementById("preset-menu-button");
    const presetMenu = document.getElementById("preset-menu");
    const presetMenuLabel = document.getElementById("preset-menu-label");
    const presetMenuRange = document.getElementById("preset-menu-range");
    const overlayPickerButton = document.getElementById("overlay-picker-button");
    const exportPngButton = document.getElementById("export-png-button");
    const status = document.getElementById("passband-status");
    const passbandRect = document.getElementById("passband-rect");
    const legendPassbandLabel = document.getElementById("legend-passband-label");
    const metricsTitle = document.getElementById("metrics-title");
    const traceInputs = Array.from(document.querySelectorAll("[data-trace-series]"));
    const portInputs = Array.from(document.querySelectorAll("[data-z0-port]"));
    const targetOhmsInputs = Array.from(document.querySelectorAll("[data-z0-target]"));
    const effectiveZ0 = document.getElementById("effective-z0");

    startInput.min = String(chart.minFreq);
    startInput.max = String(chart.maxFreq);
    stopInput.min = String(chart.minFreq);
    stopInput.max = String(chart.maxFreq);

    function x(freqGHz) {
      return chart.marginLeft + ((freqGHz - chart.displayMinFreq) / (chart.displayMaxFreq - chart.displayMinFreq)) * chart.plotWidth;
    }

    function y(db) {
      return chart.marginTop + ((chart.yMax - db) / (chart.yMax - chart.yMin)) * chart.plotHeight;
    }

    function formatRange(startGHz, stopGHz) {
      return startGHz.toFixed(2) + "-" + stopGHz.toFixed(2) + " GHz";
    }

    async function exportCurrentChartPng() {
      const target = document.querySelector(".chart-wrap");
      if (!target) {
        status.textContent = "Cannot export PNG: chart is not available.";
        return;
      }

      status.textContent = "Preparing PNG export...";
      try {
        const exportSvg = buildExportSvg();
        const image = await loadSvgImage(exportSvg.markup);
        const canvas = document.createElement("canvas");
        canvas.width = exportSvg.pixelWidth;
        canvas.height = exportSvg.pixelHeight;
        const context = canvas.getContext("2d");
        if (!context) {
          throw new Error("Canvas rendering is not available.");
        }

        context.fillStyle = getComputedStyle(document.body).backgroundColor || "#ffffff";
        context.fillRect(0, 0, exportSvg.pixelWidth, exportSvg.pixelHeight);
        context.drawImage(image, 0, 0, exportSvg.pixelWidth, exportSvg.pixelHeight);
        vscode.postMessage({
          type: "exportPng",
          fileName: exportPngFileName(),
          dataUrl: canvas.toDataURL("image/png")
        });
        status.textContent = "Choose where to save PNG...";
      } catch (error) {
        status.textContent = "Cannot export PNG: " + (error && error.message ? error.message : String(error));
      }
    }

    function loadSvgImage(markup) {
      return new Promise((resolve, reject) => {
        const blob = new Blob([markup], { type: "image/svg+xml;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const image = new Image();
        image.onload = () => {
          URL.revokeObjectURL(url);
          resolve(image);
        };
        image.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error("SVG rendering failed."));
        };
        image.src = url;
      });
    }

    function buildExportSvg() {
      const chartSvg = document.querySelector(".chart-wrap svg");
      if (!chartSvg) {
        throw new Error("Chart SVG is not available.");
      }

      const viewBox = chartSvg.viewBox && chartSvg.viewBox.baseVal;
      const chartWidth = viewBox && viewBox.width ? viewBox.width : 980;
      const chartHeight = viewBox && viewBox.height ? viewBox.height : 520;
      const topHeight = 30;
      const legendRows = exportLegendRows();
      const legend = buildLegendSvg(legendRows, topHeight + chartHeight + 18, chartWidth);
      const totalHeight = topHeight + chartHeight + legend.height + 28;
      const rasterSize = pngExportRasterSize(chartWidth, totalHeight, window.devicePixelRatio || 1);
      const clone = chartSvg.cloneNode(true);
      inlineSvgStyles(chartSvg, clone);

      const background = getComputedStyle(document.body).backgroundColor || "#ffffff";
      const passbandSwatch = document.querySelector(".chart-range-indicator .legend-passband");
      const passbandLabel = document.getElementById("legend-passband-label");
      const passbandColor = passbandSwatch ? getComputedStyle(passbandSwatch).backgroundColor : "rgba(79, 140, 255, 0.14)";
      const textColor = passbandLabel ? getComputedStyle(passbandLabel).color : getComputedStyle(document.body).color;
      const fontFamily = getComputedStyle(document.body).fontFamily || "Arial, sans-serif";
      const rangeLabel = passbandLabel ? passbandLabel.textContent || "Passband" : "Passband";

      const markup =
        '<svg xmlns="http://www.w3.org/2000/svg" width="' + rasterSize.pixelWidth + '" height="' + rasterSize.pixelHeight + '" viewBox="0 0 ' + chartWidth + ' ' + totalHeight + '">' +
        '<rect x="0" y="0" width="' + chartWidth + '" height="' + totalHeight + '" fill="' + escapeXml(background) + '"/>' +
        '<rect x="64" y="8" width="32" height="14" rx="2" fill="' + escapeXml(passbandColor) + '"/>' +
        '<text x="108" y="20" fill="' + escapeXml(textColor) + '" font-family="' + escapeXml(fontFamily) + '" font-size="12">' + escapeXml(rangeLabel) + '</text>' +
        '<g transform="translate(0 ' + topHeight + ')">' + clone.innerHTML + '</g>' +
        legend.markup +
        '</svg>';

      return {
        markup,
        width: chartWidth,
        height: totalHeight,
        pixelWidth: rasterSize.pixelWidth,
        pixelHeight: rasterSize.pixelHeight,
        scale: rasterSize.scale
      };
    }

    function pngExportRasterSize(logicalWidth, logicalHeight, devicePixelRatio) {
      const safeWidth = finitePositiveOrFallback(logicalWidth, 1);
      const safeHeight = finitePositiveOrFallback(logicalHeight, 1);
      const safeDevicePixelRatio = finitePositiveOrFallback(devicePixelRatio, 1);
      let scale = Math.min(MAX_PNG_EXPORT_SCALE, Math.max(MIN_PNG_EXPORT_SCALE, Math.ceil(safeDevicePixelRatio)));
      scale = Math.min(scale, MAX_PNG_EXPORT_EDGE / Math.max(safeWidth, safeHeight));
      scale = Math.min(scale, Math.sqrt(MAX_PNG_EXPORT_PIXELS / (safeWidth * safeHeight)));
      scale = Math.max(1, Math.floor(scale * 100) / 100);
      return {
        scale,
        pixelWidth: Math.max(1, Math.floor(safeWidth * scale)),
        pixelHeight: Math.max(1, Math.floor(safeHeight * scale))
      };
    }

    function finitePositiveOrFallback(value, fallback) {
      return Number.isFinite(value) && value > 0 ? value : fallback;
    }

    function inlineSvgStyles(source, target) {
      copySvgStyle(source, target);
      const sourceChildren = Array.from(source.children);
      const targetChildren = Array.from(target.children);
      for (let index = 0; index < sourceChildren.length; index += 1) {
        if (targetChildren[index]) {
          inlineSvgStyles(sourceChildren[index], targetChildren[index]);
        }
      }
    }

    function copySvgStyle(source, target) {
      const computed = getComputedStyle(source);
      const properties = [
        "display", "fill", "font-family", "font-size", "font-weight", "opacity",
        "stroke", "stroke-dasharray", "stroke-linecap", "stroke-linejoin", "stroke-width"
      ];

      for (const property of properties) {
        const value = computed.getPropertyValue(property);
        if (value) {
          target.style.setProperty(property, value);
        }
      }
    }

    function exportLegendRows() {
      const groupedRows = Array.from(document.querySelectorAll(".chart-legend.grouped .legend-file-row"));
      if (groupedRows.length > 0) {
        return groupedRows.map((row) => ({
          label: (row.querySelector(".legend-file-label")?.textContent || "").trim(),
          items: exportLegendItems(row)
        })).filter((row) => row.items.length > 0);
      }

      const inlineLegend = document.querySelector(".chart-legend.inline");
      if (!inlineLegend) {
        return [];
      }

      return [{ label: "", items: exportLegendItems(inlineLegend) }];
    }

    function exportLegendItems(container) {
      return Array.from(container.querySelectorAll(".legend-item"))
        .filter((item) => getComputedStyle(item).display !== "none")
        .map((item) => {
          const line = item.querySelector(".legend-line");
          return {
            label: (item.textContent || "").trim(),
            color: line ? getComputedStyle(line).backgroundColor : getComputedStyle(document.body).color
          };
        })
        .filter((item) => item.label);
    }

    function buildLegendSvg(rows, startY, width) {
      const fontFamily = getComputedStyle(document.body).fontFamily || "Arial, sans-serif";
      const textColor = getComputedStyle(document.body).color || "#000000";
      const rowHeight = 22;
      const left = 64;
      const labelWidth = rows.some((row) => row.label) ? 138 : 0;
      let y = startY;
      const parts = [];

      for (const row of rows) {
        let x = left;
        const rowStartY = y;
        if (row.label) {
          parts.push('<text x="' + x + '" y="' + y + '" fill="' + escapeXml(textColor) + '" font-family="' + escapeXml(fontFamily) + '" font-size="12" font-weight="600">' + escapeXml(row.label) + '</text>');
          x += labelWidth;
        }

        for (const item of row.items) {
          const itemWidth = Math.max(78, item.label.length * 7 + 50);
          if (x + itemWidth > width - 24) {
            y += rowHeight;
            x = left + labelWidth;
          }
          parts.push('<line x1="' + x + '" y1="' + (y - 4) + '" x2="' + (x + 32) + '" y2="' + (y - 4) + '" stroke="' + escapeXml(item.color) + '" stroke-width="3" stroke-linecap="round"/>');
          parts.push('<text x="' + (x + 42) + '" y="' + y + '" fill="' + escapeXml(textColor) + '" font-family="' + escapeXml(fontFamily) + '" font-size="12">' + escapeXml(item.label) + '</text>');
          x += itemWidth;
        }

        y = Math.max(y, rowStartY) + rowHeight;
      }

      return { markup: parts.join(""), height: rows.length > 0 ? y - startY : 0 };
    }

    function escapeXml(value) {
      return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function exportPngFileName() {
      const range = formatRange(Number(startInput.value), Number(stopInput.value));
      const base = String(exportSourceLabel || "touchstone-preview")
        .replace(/[\\\\/:*?"<>|]+/g, "_")
        .replace(/\\s+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 72) || "touchstone-preview";
      const suffix = range
        .replace(/[^0-9A-Za-z.\\-]+/g, "_")
        .replace(/^_+|_+$/g, "");
      return base + "-" + suffix + ".png";
    }

    function setText(id, value) {
      const target = document.getElementById(id);
      if (target) {
        target.textContent = value;
      }
    }

    function setMetricStatus(message) {
      setText("metric-status", message);
    }

    function clearMetricCells() {
      if (!hasMetricRows) {
        return;
      }
      setText("metric-best-s21", "-");
      setText("metric-worst-s11", "-");
      setText("metric-worst-s22", "-");
      setText("metric-avg-s21", "-");
      setText("metric-s21-bands", "-");
      setText("metric-matched-bands", "-");
      setText("metric-matched-coverage", "-");
    }

    function selectedPreset() {
      if (activePresetLabel === AUTO_PASSBAND_LABEL) {
        return autoPreset();
      }
      return settings.presets.find((preset) => preset.label === activePresetLabel) || settings.presets[0];
    }

    function autoPreset() {
      return {
        label: AUTO_PASSBAND_LABEL,
        startGHz: chart.minFreq,
        stopGHz: chart.maxFreq
      };
    }

    function byMax(key, list) {
      return list.reduce((best, row) => row[key] > best[key] ? row : best, list[0]);
    }

    function byMin(key, list) {
      return list.reduce((worst, row) => row[key] < worst[key] ? row : worst, list[0]);
    }

    function average(key, list) {
      return list.reduce((sum, row) => sum + row[key], 0) / list.length;
    }

    function formatPoint(row, key) {
      return row[key].toFixed(2) + " dB @ " + row.freqGHz.toFixed(3) + " GHz";
    }

    function findBands(predicate) {
      const bands = [];
      let activeStart = null;
      let activeEnd = null;

      for (const row of currentMetricRows) {
        if (predicate(row)) {
          if (activeStart === null) {
            activeStart = row.freqGHz;
          }
          activeEnd = row.freqGHz;
        } else if (activeStart !== null) {
          bands.push({ startGHz: activeStart, endGHz: activeEnd });
          activeStart = null;
          activeEnd = null;
        }
      }

      if (activeStart !== null) {
        bands.push({ startGHz: activeStart, endGHz: activeEnd });
      }

      return bands;
    }

    function clipBands(bands, startGHz, stopGHz) {
      return bands
        .map((band) => ({
          startGHz: Math.max(band.startGHz, startGHz),
          endGHz: Math.min(band.endGHz, stopGHz)
        }))
        .filter((band) => band.endGHz >= band.startGHz);
    }

    function formatBands(bands) {
      if (bands.length === 0) {
        return "-";
      }
      return bands.map((band) => formatRange(band.startGHz, band.endGHz)).join(", ");
    }

    function coverageGHz(bands) {
      return bands.reduce((sum, band) => sum + Math.max(0, band.endGHz - band.startGHz), 0);
    }

    function updateImpedancePreview() {
      if (!impedance || targetOhmsInputs.length === 0) {
        return;
      }

      const targetOhms = targetOhmsInputs.map((input) => Number(input.value));
      const selectedPorts = portInputs.map((input) => input.checked);
      const invalidIndex = targetOhms.findIndex((value, index) =>
        selectedPorts[index] && (!Number.isFinite(value) || value <= 0)
      );
      if (invalidIndex !== -1) {
        status.textContent = "Use a positive target impedance for P" + (invalidIndex + 1) + ".";
        return;
      }

      vscode.postMessage({
        type: "renormalize",
        targetOhms,
        selectedPorts
      });
    }

    function updateRenormalizedPreview(message) {
      if (effectiveZ0 && Array.isArray(message.effectiveReferenceOhms)) {
        effectiveZ0.textContent = formatReferenceOhms("Active Z0", message.effectiveReferenceOhms);
      }
      updateChartSeries(message.seriesRows);
      currentMetricRows = hasMetricRows ? message.metricRows : [];
      updatePassband();
    }

    function updateChartSeries(seriesRows) {
      seriesRows.forEach((rows, index) => {
        const curve = document.getElementById("series-" + index);
        if (!curve) {
          return;
        }
        curve.setAttribute("points", linePoints(rows));
      });
    }

    function updateTraceVisibility() {
      for (const input of traceInputs) {
        const index = Number(input.dataset.traceSeries);
        if (!Number.isInteger(index)) {
          continue;
        }
        const hidden = !input.checked;
        const curve = document.getElementById("series-" + index);
        const legend = document.getElementById("legend-" + index);
        if (curve) {
          curve.classList.toggle("series-hidden", hidden);
        }
        if (legend) {
          legend.classList.toggle("series-hidden", hidden);
        }
      }
    }

    function applyTracePreset(traces) {
      if (traceInputs.length === 0) {
        return;
      }

      const available = new Set(traceInputs.map((input) => input.dataset.traceTo + ":" + input.dataset.traceFrom));
      const selected = new Set();
      if (Array.isArray(traces)) {
        for (const trace of traces) {
          if (!trace) {
            continue;
          }
          const key = Number(trace.toPort) + ":" + Number(trace.fromPort);
          if (available.has(key)) {
            selected.add(key);
          }
        }
      }

      for (const input of traceInputs) {
        const key = input.dataset.traceTo + ":" + input.dataset.traceFrom;
        input.checked = selected.size > 0 ? selected.has(key) : input.dataset.traceDefault === "true";
      }
      updateTraceVisibility();
    }

    function currentTracePreset() {
      const traces = [];
      const seen = new Set();
      for (const input of traceInputs) {
        if (!input.checked) {
          continue;
        }
        const key = input.dataset.traceTo + ":" + input.dataset.traceFrom;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        traces.push({
          toPort: Number(input.dataset.traceTo),
          fromPort: Number(input.dataset.traceFrom)
        });
      }
      return traces.filter((trace) => Number.isInteger(trace.toPort) && Number.isInteger(trace.fromPort));
    }

    function applyRenormalizePreset(renormalize) {
      if (!impedance || targetOhmsInputs.length === 0) {
        return false;
      }

      const selectedPorts = Array.isArray(renormalize && renormalize.selectedPorts)
        ? renormalize.selectedPorts
        : [];
      const targetOhms = Array.isArray(renormalize && renormalize.targetOhms)
        ? renormalize.targetOhms
        : [];
      for (const input of targetOhmsInputs) {
        const index = Number(input.dataset.z0Target);
        const target = Number(targetOhms[index]);
        input.value = String(Number.isFinite(target) && target > 0
          ? target
          : impedance.referenceOhms[index]);
      }
      for (const input of portInputs) {
        const index = Number(input.dataset.z0Port);
        input.checked = selectedPorts[index] === true;
      }
      return true;
    }

    function currentRenormalizePreset() {
      if (!impedance || targetOhmsInputs.length === 0) {
        return undefined;
      }

      return {
        selectedPorts: portInputs.map((input) => input.checked),
        targetOhms: targetOhmsInputs.map((input, index) => {
          const target = Number(input.value);
          return Number.isFinite(target) && target > 0 ? target : impedance.referenceOhms[index];
        })
      };
    }

    function linePoints(rows) {
      return rows.map((row) => x(row.freqGHz).toFixed(2) + "," + y(row.db).toFixed(2)).join(" ");
    }

    function formatReferenceOhms(label, referenceOhms) {
      const values = referenceOhms.map((value) => formatOhm(value));
      if (values.every((value) => value === values[0])) {
        return label + ": " + values[0] + " Ohm";
      }
      return label + ": " + values.map((value, index) => "P" + (index + 1) + " " + value).join(", ") + " Ohm";
    }

    function formatOhm(value) {
      return Number(value).toFixed(3).replace(/\\.?0+$/, "");
    }

    function clearMetrics(message) {
      status.textContent = message;
      passbandRect.setAttribute("width", "0");
      setMetricStatus(message);
      clearMetricCells();
    }

    function setPresetMenuOpen(open) {
      presetMenu.hidden = !open;
      presetMenuButton.setAttribute("aria-expanded", String(open));
    }

    function renderPresetMenu() {
      presetMenu.textContent = "";
      const auto = autoPreset();
      const autoRow = document.createElement("div");
      autoRow.className = "preset-menu-row auto";

      const autoButton = document.createElement("button");
      autoButton.type = "button";
      autoButton.className = "preset-menu-item" + (activePresetLabel === AUTO_PASSBAND_LABEL ? " active" : "");
      autoButton.setAttribute("role", "option");
      autoButton.setAttribute("aria-selected", String(activePresetLabel === AUTO_PASSBAND_LABEL));

      const autoLabel = document.createElement("span");
      autoLabel.textContent = AUTO_PASSBAND_LABEL;
      const autoRange = document.createElement("small");
      autoRange.textContent = formatRange(auto.startGHz, auto.stopGHz);

      autoButton.append(autoLabel, autoRange);
      autoButton.addEventListener("click", () => {
        applyPreset(autoPreset(), true);
        setPresetMenuOpen(false);
      });
      autoRow.append(autoButton);
      presetMenu.appendChild(autoRow);

      for (const preset of settings.presets) {
        const row = document.createElement("div");
        row.className = "preset-menu-row";

        const selectButton = document.createElement("button");
        selectButton.type = "button";
        selectButton.className = "preset-menu-item" + (preset.label === activePresetLabel ? " active" : "");
        selectButton.setAttribute("role", "option");
        selectButton.setAttribute("aria-selected", String(preset.label === activePresetLabel));

        const label = document.createElement("span");
        label.textContent = preset.label;
        const range = document.createElement("small");
        range.textContent = formatRange(preset.startGHz, preset.stopGHz);

        selectButton.append(label, range);
        selectButton.addEventListener("click", () => {
          applyPreset(preset, true);
          setPresetMenuOpen(false);
        });

        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "preset-delete";
        deleteButton.textContent = "x";
        deleteButton.title = "Delete preset";
        deleteButton.setAttribute("aria-label", "Delete " + preset.label);
        deleteButton.disabled = settings.presets.length <= 1;
        deleteButton.addEventListener("click", (event) => {
          event.stopPropagation();
          vscode.postMessage({ type: "deletePreset", label: preset.label });
        });

        row.append(selectButton, deleteButton);
        presetMenu.appendChild(row);
      }

      const addButton = document.createElement("button");
      addButton.type = "button";
      addButton.className = "preset-menu-add";
      addButton.textContent = "Save current view...";
      addButton.addEventListener("click", () => {
        if (!currentRangeIsValid()) {
          status.textContent = "Cannot save invalid passband range.";
          return;
        }
        setPresetMenuOpen(false);
        vscode.postMessage({
          type: "addPreset",
          startGHz: Number(startInput.value),
          stopGHz: Number(stopInput.value),
          activePresetLabel,
          traces: currentTracePreset(),
          renormalize: currentRenormalizePreset()
        });
      });
      presetMenu.appendChild(addButton);
    }

    function updatePresetControls() {
      const preset = selectedPreset();
      const range = formatRange(preset.startGHz, preset.stopGHz);
      presetMenuLabel.textContent = preset.label;
      presetMenuRange.textContent = range;
      presetMenuButton.title = "Preset: " + preset.label + " (" + range + ")";
    }

    function applyPreset(preset, persistDefault) {
      activePresetLabel = preset.label;
      startInput.value = String(preset.startGHz);
      stopInput.value = String(preset.stopGHz);
      applyTracePreset(preset.traces);
      const renormalizeApplied = applyRenormalizePreset(preset.renormalize);
      updatePresetControls();
      renderPresetMenu();
      updatePassband();
      if (renormalizeApplied) {
        updateImpedancePreview();
      }
      if (persistDefault) {
        vscode.postMessage({ type: "setDefaultPreset", label: preset.label });
      }
    }

    function currentRangeIsValid() {
      const startGHz = Number(startInput.value);
      const stopGHz = Number(stopInput.value);
      return Number.isFinite(startGHz) && Number.isFinite(stopGHz) && startGHz < stopGHz;
    }

    function updatePassband() {
      const startGHz = Number(startInput.value);
      const stopGHz = Number(stopInput.value);
      if (!Number.isFinite(startGHz) || !Number.isFinite(stopGHz)) {
        metricsTitle.textContent = "Passband Metrics";
        legendPassbandLabel.textContent = "Passband";
        clearMetrics("Use finite passband values.");
        return;
      }

      const label = formatRange(startGHz, stopGHz);
      metricsTitle.textContent = label + " Metrics";
      legendPassbandLabel.textContent = label;

      if (startGHz >= stopGHz) {
        clearMetrics("Use a finite start below stop.");
        return;
      }

      const visibleStart = Math.max(startGHz, chart.minFreq);
      const visibleStop = Math.min(stopGHz, chart.maxFreq);
      if (visibleStart >= visibleStop) {
        clearMetrics("Range is outside this file.");
        return;
      }

      passbandRect.setAttribute("x", x(visibleStart).toFixed(2));
      passbandRect.setAttribute("width", (x(visibleStop) - x(visibleStart)).toFixed(2));
      status.textContent = "";
      if (!hasMetricRows) {
        setMetricStatus(METRICS_UNAVAILABLE);
        return;
      }
      setMetricStatus("");

      const passbandRows = currentMetricRows.filter((row) => row.freqGHz >= startGHz && row.freqGHz <= stopGHz);
      if (passbandRows.length === 0) {
        clearMetrics("No sample points inside range.");
        return;
      }

      const s21Bands = clipBands(findBands((row) => row.s21db >= -3), startGHz, stopGHz);
      const matchedBands = clipBands(
        findBands((row) => row.s21db >= -3 && row.s11db <= -15 && row.s22db <= -15),
        startGHz,
        stopGHz
      );

      setText("metric-best-s21", formatPoint(byMax("s21db", passbandRows), "s21db"));
      setText("metric-worst-s11", formatPoint(byMin("s11db", passbandRows), "s11db"));
      setText("metric-worst-s22", formatPoint(byMin("s22db", passbandRows), "s22db"));
      setText("metric-avg-s21", average("s21db", passbandRows).toFixed(2) + " dB");
      setText("metric-s21-bands", formatBands(s21Bands));
      setText("metric-matched-bands", formatBands(matchedBands));
      setText("metric-matched-coverage", coverageGHz(matchedBands).toFixed(2) + " GHz");
    }

    startInput.addEventListener("input", updatePassband);
    stopInput.addEventListener("input", updatePassband);
    for (const input of traceInputs) {
      input.addEventListener("change", updateTraceVisibility);
    }
    for (const input of targetOhmsInputs) {
      input.addEventListener("input", () => {
        const index = Number(input.dataset.z0Target);
        if (Number.isInteger(index) && portInputs[index]) {
          portInputs[index].checked = true;
        }
        updateImpedancePreview();
      });
    }
    for (const input of portInputs) {
      input.addEventListener("change", updateImpedancePreview);
    }
    presetMenuButton.addEventListener("click", (event) => {
      event.stopPropagation();
      setPresetMenuOpen(presetMenu.hidden);
    });
    presetMenu.addEventListener("click", (event) => event.stopPropagation());
    if (overlayPickerButton) {
      overlayPickerButton.addEventListener("click", () => {
        vscode.postMessage({ type: "openOverlayPicker" });
      });
    }
    if (exportPngButton) {
      exportPngButton.addEventListener("click", exportCurrentChartPng);
    }
    document.addEventListener("click", () => setPresetMenuOpen(false));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        setPresetMenuOpen(false);
      }
    });
    window.addEventListener("message", (event) => {
      const message = event.data;
      if (message.type === "settingsUpdated") {
        settings = message.settings;
        activePresetLabel = settings.defaultPresetLabel;
        renderPresetMenu();
        applyPreset(selectedPreset(), false);
        if (message.status) {
          status.textContent = message.status;
        }
      } else if (message.type === "operationStatus") {
        status.textContent = message.message;
      } else if (message.type === "renormalizedPreview") {
        updateRenormalizedPreview(message);
      }
    });

    renderPresetMenu();
    applyPreset(selectedPreset(), false);
  `;
}

function getPassbandSettings(): PassbandSettings {
  const config = vscode.workspace.getConfiguration("s2pPreview");
  const inspectedPresets = config.inspect<unknown>("passbandPresets");
  const configuredPresets = userScopedConfigurationValue(inspectedPresets);
  const presets = sanitizePresets(configuredPresets);
  const inspectedDefault = config.inspect<string>("defaultPassbandPreset");
  const configuredDefault = userScopedConfigurationValue(inspectedDefault);

  return {
    presets,
    defaultPresetLabel: normalizeDefaultPassbandLabel(presets, configuredDefault)
  };
}

function sanitizePresets(value: unknown): PassbandPreset[] {
  if (!Array.isArray(value)) {
    return DEFAULT_PASSBAND_PRESETS;
  }

  const presets: PassbandPreset[] = [];
  const seenLabels = new Set<string>();
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }

    const label = typeof item.label === "string" ? item.label.trim() : "";
    const range = normalizePresetRange(Number(item.startGHz), Number(item.stopGHz));
    if (!label || seenLabels.has(label) || !range) {
      continue;
    }

    const preset: PassbandPreset = {
      label,
      startGHz: range.startGHz,
      stopGHz: range.stopGHz
    };
    const traces = sanitizePresetTraces(item.traces);
    if (traces) {
      preset.traces = traces;
    }
    const renormalize = sanitizePresetRenormalize(item.renormalize);
    if (renormalize) {
      preset.renormalize = renormalize;
    }

    seenLabels.add(label);
    presets.push(preset);
  }

  return presets.length > 0 ? presets : DEFAULT_PASSBAND_PRESETS;
}

function normalizePresetRange(startGHz: number, stopGHz: number): Pick<PassbandPreset, "startGHz" | "stopGHz"> | undefined {
  if (!Number.isFinite(startGHz) || !Number.isFinite(stopGHz) || startGHz >= stopGHz) {
    return undefined;
  }

  return {
    startGHz: roundGHz(startGHz),
    stopGHz: roundGHz(stopGHz)
  };
}

function roundGHz(value: number): number {
  return Math.round(value * 1000000) / 1000000;
}

function resolveInitialPassband(model: PreviewModel, settings: PassbandSettings): PassbandPreset {
  const rows = allChartPoints(model.series);
  if (settings.defaultPresetLabel === AUTO_PASSBAND_LABEL) {
    return createAutoPassband(rows);
  }

  return settings.presets.find((preset) => preset.label === settings.defaultPresetLabel) ?? createAutoPassband(rows);
}

function allChartPoints(series: ChartSeries[]): ChartPoint[] {
  return series.flatMap((item) => item.rows);
}

function formatRangeLabel(startGHz: number, stopGHz: number): string {
  return `${formatGHz(startGHz)}-${formatGHz(stopGHz)} GHz`;
}

function formatGHz(value: number): string {
  const fixed = value.toFixed(3);
  return fixed.replace(/\.?0+$/, "");
}

function htmlShell(webview: vscode.Webview, body: string, script = ""): string {
  const nonce = getNonce();
  const scriptBlock = script ? `<script nonce="${nonce}">${script}</script>` : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src blob: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <style>
    :root {
      --surface: var(--vscode-sideBar-background, var(--vscode-editorWidget-background, var(--vscode-editor-background)));
      --surface-strong: var(--vscode-editorWidget-background, var(--vscode-editor-background));
      --surface-muted: var(--vscode-button-secondaryBackground, var(--vscode-editor-background));
      --border: var(--vscode-panel-border, var(--vscode-widget-border, rgba(127, 127, 127, 0.35)));
      --muted: var(--vscode-descriptionForeground);
      --accent: var(--vscode-focusBorder, #4f8cff);
      --warning-border: var(--vscode-inputValidation-warningBorder, var(--vscode-editorWarning-border, #d6aa00));
      --warning-bg: var(--vscode-inputValidation-warningBackground, rgba(214, 170, 0, 0.12));
      --warning-fg: var(--vscode-inputValidation-warningForeground, var(--vscode-editorWarning-foreground, var(--vscode-foreground)));
    }
    * { box-sizing: border-box; }
    body {
      color: var(--vscode-foreground, #1f2328);
      background: var(--vscode-editor-background, #ffffff);
      font-family: var(--vscode-font-family, "Segoe UI", sans-serif);
      margin: 0;
      padding: 18px;
    }
    h1 { font-size: 23px; line-height: 1.18; margin: 2px 0 6px; }
    h2 { font-size: 15px; margin: 0 0 10px; }
    input { accent-color: var(--accent); }
    .preview-header,
    .controls,
    .warnings,
    .plot-column {
      max-width: 1280px;
    }
    .preview-header {
      display: flex;
      justify-content: space-between;
      gap: 18px;
      align-items: start;
      padding: 16px 18px;
      margin-bottom: 12px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
    }
    .eyebrow {
      margin: 0;
      color: var(--muted);
      font-size: 11px;
      text-transform: uppercase;
    }
    .file { color: var(--muted); margin: 0; }
    .header-summary {
      display: flex;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 6px;
      min-width: 190px;
    }
    .header-summary span {
      padding: 5px 8px;
      color: var(--muted);
      background: var(--surface-muted);
      border: 1px solid var(--border);
      border-radius: 999px;
      font-size: 12px;
      white-space: nowrap;
    }
    .controls {
      display: grid;
      gap: 10px;
      align-items: start;
      width: max-content;
      max-width: 100%;
      margin: 0 0 12px;
      padding: 12px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
    }
    .range-controls {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: end;
      min-width: 0;
    }
    .control-field {
      display: grid;
      gap: 5px;
      color: var(--muted);
      font-size: 12px;
    }
    .controls input,
    .port-target-input {
      color: var(--vscode-input-foreground, var(--vscode-foreground, #1f2328));
      background: var(--vscode-input-background, #ffffff);
      border: 1px solid var(--vscode-input-border, var(--border));
      border-radius: 4px;
      padding: 6px 8px;
      font: inherit;
    }
    .control-field input { width: 112px; }
    .range-controls > button,
    .split-button {
      min-height: 48px;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 6px;
      padding: 7px 12px;
      font: inherit;
      cursor: pointer;
    }
    .range-controls > button:hover,
    .split-button:hover { background: var(--vscode-button-hoverBackground); }
    .secondary-action {
      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
      background: var(--vscode-button-secondaryBackground, transparent);
      border-color: var(--border);
    }
    .secondary-action:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-toolbar-hoverBackground)); }
    .split-button { display: inline-grid; gap: 2px; justify-items: center; min-width: 128px; }
    .split-button small { color: inherit; font-size: 11px; line-height: 1.2; opacity: 0.82; }
    #passband-status {
      color: var(--warning-fg);
      min-height: 20px;
      align-self: center;
      flex: 0 1 260px;
      font-size: 12px;
    }
    #passband-status:empty { display: none; }
    .warnings {
      margin: 0 0 12px;
      padding: 9px 11px;
      color: var(--warning-fg);
      background: var(--warning-bg);
      border: 1px solid var(--warning-border);
      border-radius: 6px;
      font-size: 12px;
    }
    .warnings p { margin: 0; }
    .warnings p + p { margin-top: 4px; }
    .plot-column { min-width: 0; }
    .trace-controls,
    .metrics,
    .chart-wrap {
      min-width: 0;
      max-width: 100%;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
    }
    .trace-controls { margin-top: 12px; padding: 12px; overflow-x: auto; }
    .z0-card {
      display: grid;
      grid-template-columns: auto auto;
      gap: 10px 14px;
      align-items: end;
      width: max-content;
      max-width: 100%;
    }
    .trace-controls fieldset,
    .z0-ports { min-width: 0; margin: 0; padding: 0; border: 0; }
    .trace-controls legend,
    .z0-ports legend {
      margin: 0;
      padding: 0;
      color: var(--vscode-foreground);
      font-size: 13px;
      font-weight: 600;
    }
    .section-note {
      margin: 4px 0 10px;
      color: var(--muted);
      font-size: 12px;
    }
    .trace-matrix-block + .trace-matrix-block {
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid var(--border);
    }
    .trace-matrix-title {
      margin: 0 0 8px;
      color: var(--muted);
      font-size: 12px;
      font-weight: 600;
    }
    .trace-selector-grid {
      display: grid;
      grid-template-columns: 48px repeat(var(--trace-port-count), minmax(58px, 1fr));
      gap: 5px;
      align-items: stretch;
      overflow-x: auto;
      max-width: 100%;
    }
    .trace-header,
    .trace-corner {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 24px;
      color: var(--muted);
      font-size: 11px;
    }
    .trace-corner { justify-content: start; }
    .trace-toggle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      min-height: 30px;
      padding: 4px 6px;
      color: var(--vscode-foreground);
      background: var(--surface-muted);
      border: 1px solid var(--border);
      border-radius: 4px;
      font-size: 12px;
      white-space: nowrap;
    }
    .trace-toggle input { width: auto; margin: 0; padding: 0; }
    .trace-swatch { width: 15px; height: 3px; border-radius: 999px; background: var(--trace-color, var(--vscode-foreground)); }
    .port-target-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 10px;
    }
    .port-target {
      display: grid;
      grid-template-columns: auto minmax(64px, 1fr);
      align-items: center;
      gap: 7px;
      width: 132px;
      min-height: 35px;
      padding: 5px 7px;
      color: var(--vscode-foreground);
      background: var(--surface-muted);
      border: 1px solid var(--border);
      border-radius: 4px;
      font-size: 12px;
    }
    .port-target-toggle { display: inline-flex; align-items: center; gap: 4px; color: var(--vscode-foreground); font-size: 12px; }
    .port-target-toggle input { width: auto; margin: 0; padding: 0; }
    .port-target-input { width: 100%; min-width: 0; padding: 5px 6px; }
    .z0-info {
      display: grid;
      gap: 4px;
      color: var(--muted);
      font-size: 12px;
      min-width: 136px;
    }
    .series-hidden { display: none !important; }
    .preset-dropdown { position: relative; }
    .preset-menu-button { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); border-color: var(--vscode-panel-border); }
    .preset-menu-button:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground)); }
    .preset-menu { position: absolute; z-index: 20; top: calc(100% + 4px); left: 0; min-width: 260px; max-height: 320px; overflow: auto; padding: 4px; color: var(--vscode-dropdown-foreground, var(--vscode-foreground, #f3f3f3)); background: var(--vscode-dropdown-background, var(--vscode-editor-background, #1f1f1f)); border: 1px solid var(--vscode-dropdown-border, var(--vscode-panel-border, #555)); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25); }
    .preset-menu[hidden] { display: none; }
    .preset-menu-row { display: grid; grid-template-columns: 1fr 30px; gap: 4px; align-items: stretch; margin-bottom: 3px; }
    .preset-menu-row.auto .preset-menu-item { grid-column: 1 / -1; }
    .preset-menu .preset-menu-item, .preset-menu .preset-menu-add, .preset-menu .preset-delete { font: inherit; border: 0; background: transparent; cursor: pointer; }
    .preset-menu .preset-menu-item { display: grid; gap: 2px; justify-items: start; width: 100%; padding: 6px 8px; color: var(--vscode-dropdown-foreground, var(--vscode-foreground, #f3f3f3)); text-align: left; }
    .preset-menu .preset-menu-item small { color: var(--vscode-descriptionForeground, #b7b7b7); font-size: 11px; }
    .preset-menu .preset-menu-item:hover, .preset-menu .preset-menu-add:hover { background: transparent; outline: 1px solid var(--vscode-focusBorder, #5e9eff); outline-offset: -1px; }
    .preset-menu .preset-menu-item:focus-visible, .preset-menu .preset-menu-add:focus-visible, .preset-menu .preset-delete:focus-visible { outline: 1px solid var(--vscode-focusBorder, #5e9eff); outline-offset: -1px; }
    .preset-menu .preset-menu-item.active { color: var(--vscode-dropdown-foreground, var(--vscode-foreground, #f3f3f3)); background: transparent; box-shadow: inset 3px 0 0 var(--vscode-focusBorder, #5e9eff); outline: 1px solid var(--vscode-focusBorder, #5e9eff); outline-offset: -1px; }
    .preset-menu .preset-menu-item.active small { color: var(--vscode-descriptionForeground, #d0d0d0); opacity: 1; }
    .preset-menu .preset-delete { min-width: 30px; color: var(--vscode-icon-foreground); }
    .preset-menu .preset-delete:hover:not(:disabled) { color: var(--vscode-errorForeground); background: transparent; outline: 1px solid var(--vscode-errorForeground); outline-offset: -1px; }
    .preset-menu .preset-delete:disabled { color: var(--vscode-disabledForeground); cursor: default; }
    .preset-menu .preset-menu-add { width: 100%; margin-top: 4px; padding: 7px 8px; color: var(--vscode-dropdown-foreground, var(--vscode-foreground, #f3f3f3)); text-align: left; border-top: 1px solid var(--vscode-panel-border, #555); }
    .chart-wrap { overflow: auto; padding: 12px; }
    .chart-range-indicator {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0 0 8px 64px;
      color: var(--muted);
      font-size: 12px;
    }
    svg { display: block; width: 100%; min-width: 0; max-width: 100%; height: auto; }
    .chart-bg { fill: var(--vscode-editor-background, #ffffff); }
    .passband { fill: var(--accent); opacity: 0.14; }
    .grid { stroke: var(--vscode-editorIndentGuide-background, var(--border)); stroke-width: 1; opacity: 0.75; }
    .axis { fill: none; stroke: var(--vscode-foreground, #1f2328); stroke-width: 1.2; opacity: 0.82; }
    .guide { stroke: var(--vscode-descriptionForeground, #6a737d); stroke-width: 1; stroke-dasharray: 5 5; }
    .guide-label, .tick, .axis-label { fill: var(--vscode-descriptionForeground, #6a737d); font-size: 12px; }
    .curve { fill: none; stroke-width: 2.4; stroke-linejoin: round; stroke-linecap: round; }
    .chart-legend {
      height: var(--legend-height, 76px);
      min-height: 38px;
      max-height: 280px;
      margin: 10px 0 0 64px;
      color: var(--muted);
      font-size: 12px;
      overflow: auto;
      padding-right: 6px;
      resize: vertical;
    }
    .chart-legend.inline {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 28px;
      align-items: center;
    }
    .chart-legend.grouped {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 7px;
      align-items: center;
      align-content: start;
    }
    .legend-file-row {
      display: grid;
      grid-template-columns: minmax(96px, max-content) minmax(0, 1fr);
      gap: 10px;
      align-items: start;
      min-width: 0;
    }
    .legend-file-label {
      color: var(--vscode-foreground);
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .legend-file-items {
      display: flex;
      flex-wrap: wrap;
      gap: 7px 22px;
      min-width: 0;
    }
    .legend-item {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      white-space: nowrap;
    }
    .legend-line {
      width: 32px;
      height: 3px;
      border-radius: 999px;
      background: var(--trace-color, var(--vscode-foreground));
    }
    .legend-passband {
      width: 32px;
      height: 14px;
      border-radius: 2px;
      background: var(--accent);
      opacity: 0.14;
    }
    .s11 { stroke: #ef4444; }
    .s21 { stroke: #22c55e; }
    .s22 { stroke: #38bdf8; }
    .s11 { --trace-color: #ef4444; }
    .s21 { --trace-color: #22c55e; }
    .s22 { --trace-color: #38bdf8; }
    .trace-0 { stroke: #ef4444; --trace-color: #ef4444; }
    .trace-1 { stroke: #f59e0b; --trace-color: #f59e0b; }
    .trace-2 { stroke: #22c55e; --trace-color: #22c55e; }
    .trace-3 { stroke: #38bdf8; --trace-color: #38bdf8; }
    .trace-4 { stroke: #a78bfa; --trace-color: #a78bfa; }
    .trace-5 { stroke: #f472b6; --trace-color: #f472b6; }
    .trace-6 { stroke: #14b8a6; --trace-color: #14b8a6; }
    .trace-7 { stroke: #eab308; --trace-color: #eab308; }
    .trace-8 { stroke: #fb7185; --trace-color: #fb7185; }
    .trace-9 { stroke: #60a5fa; --trace-color: #60a5fa; }
    .trace-10 { stroke: #84cc16; --trace-color: #84cc16; }
    .trace-11 { stroke: #c084fc; --trace-color: #c084fc; }
    .overlay-line { stroke: var(--trace-color, var(--vscode-foreground)); opacity: 0.85; stroke-width: 1.9; }
    .overlay-file-1 { stroke-dasharray: 7 4; }
    .overlay-file-2 { stroke-dasharray: 2 4; }
    .overlay-file-3 { stroke-dasharray: 10 4 2 4; }
    .overlay-file-4 { stroke-dasharray: 5 3; }
    .overlay-file-5 { stroke-dasharray: 2 2; }
    .overlay-file-6 { stroke-dasharray: 12 4; }
    .overlay-file-7 { stroke-dasharray: 4 6; }
    .metrics { margin-top: 12px; padding: 14px; overflow-x: auto; }
    table { border-collapse: collapse; min-width: 540px; }
    th, td { border: 1px solid var(--vscode-panel-border); padding: 6px 8px; text-align: left; }
    th { color: var(--vscode-descriptionForeground); font-weight: 600; }
    .metric-status { color: var(--muted); margin: 0 0 8px; }
    code { background: var(--vscode-textCodeBlock-background); padding: 1px 4px; border-radius: 3px; }
    .error { border: 1px solid var(--vscode-inputValidation-errorBorder); padding: 12px; background: var(--vscode-inputValidation-errorBackground); }
    @media (max-width: 1080px) {
      .preview-header { display: grid; }
      .header-summary { justify-content: flex-start; }
      .z0-card { grid-template-columns: 1fr; width: 100%; }
      .chart-range-indicator { margin-left: 0; }
      .chart-legend { margin-left: 0; }
      .legend-file-row { grid-template-columns: minmax(0, 1fr); gap: 3px; }
    }
  </style>
</head>
<body>${body}${scriptBlock}</body>
</html>`;
}

function range(start: number, end: number, step: number): number[] {
  const values: number[] = [];
  for (let value = start; value <= end; value += step) {
    values.push(value);
  }
  return values;
}

function basename(uri: vscode.Uri): string {
  const normalized = uri.path.replace(/\\/g, "/");
  return decodeURIComponent(normalized.slice(normalized.lastIndexOf("/") + 1));
}

function dirnameUri(uri: vscode.Uri): vscode.Uri {
  const normalized = uri.path.replace(/\\/g, "/");
  const slashIndex = normalized.lastIndexOf("/");
  const folderPath = slashIndex > 0 ? normalized.slice(0, slashIndex) : "/";
  return uri.with({ path: folderPath });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function jsonForScript(value: unknown): string {
  return JSON.stringify(value ?? null).replace(/</g, "\\u003c");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getNonce(): string {
  return randomBytes(32).toString("base64url");
}
