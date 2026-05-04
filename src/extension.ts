import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import {
  AUTO_PASSBAND_LABEL,
  DEFAULT_PASSBAND_PRESETS,
  PassbandPreset,
  createAutoPassband,
  normalizeDefaultPassbandLabel
} from "./passband";
import {
  ChartPoint,
  ChartSeries,
  PreviewModel,
  buildPreviewModel
} from "./previewModel";
import { S2pRow, parseTouchstone } from "./touchstone";

const CUSTOM_EDITOR_VIEW_TYPE = "s2pPreview.editor";

interface PassbandSettings {
  presets: PassbandPreset[];
  defaultPresetLabel: string;
}

type WebviewMessage =
  | { type: "addPreset"; startGHz: number; stopGHz: number }
  | { type: "deletePreset"; label: string }
  | { type: "setDefaultPreset"; label: string };

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

function attachWebviewMessageHandler(panel: vscode.WebviewPanel): void {
  const disposable = panel.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
    try {
      switch (message.type) {
        case "addPreset":
          await addPresetFromWebview(panel, message.startGHz, message.stopGHz);
          return;
        case "deletePreset":
          await deletePresetFromWebview(panel, message.label);
          return;
        case "setDefaultPreset":
          await setDefaultPresetFromWebview(panel, message.label);
          return;
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`S2P Preview: ${messageText}`);
      await panel.webview.postMessage({ type: "operationStatus", message: messageText });
    }
  });

  panel.onDidDispose(() => disposable.dispose());
}

async function addPresetFromWebview(panel: vscode.WebviewPanel, startGHz: number, stopGHz: number): Promise<void> {
  const normalized = normalizePresetRange(startGHz, stopGHz);
  if (!normalized) {
    await panel.webview.postMessage({ type: "operationStatus", message: "Cannot save invalid passband range." });
    return;
  }

  const settings = getPassbandSettings();
  const suggestedLabel = formatRangeLabel(normalized.startGHz, normalized.stopGHz);
  const label = await vscode.window.showInputBox({
    title: "Save S2P passband preset",
    prompt: "Preset label",
    value: suggestedLabel,
    validateInput: (value) => {
      const trimmed = value.trim();
      if (!trimmed) {
        return "Preset label is required.";
      }
      if (settings.presets.some((preset) => preset.label === trimmed)) {
        return "Preset label already exists.";
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
  const nextPresets = [...settings.presets, nextPreset];
  await updatePassbandSettings(panel, nextPresets, nextPreset.label, `Preset saved: ${nextPreset.label}`);
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

async function setDefaultPresetFromWebview(panel: vscode.WebviewPanel, label: string): Promise<void> {
  const settings = getPassbandSettings();
  if (label !== AUTO_PASSBAND_LABEL && !settings.presets.some((preset) => preset.label === label)) {
    return;
  }

  await updateConfigurationValue("defaultPassbandPreset", label);
  await panel.webview.postMessage({ type: "settingsUpdated", settings: getPassbandSettings() });
}

async function updatePassbandSettings(
  panel: vscode.WebviewPanel,
  presets: PassbandPreset[],
  defaultPresetLabel: string,
  status: string
): Promise<void> {
  await updateConfigurationValue("passbandPresets", presets);
  await updateConfigurationValue("defaultPassbandPreset", defaultPresetLabel);
  await panel.webview.postMessage({ type: "settingsUpdated", settings: getPassbandSettings(), status });
}

async function updateConfigurationValue<T>(key: string, value: T): Promise<void> {
  await vscode.workspace.getConfiguration("s2pPreview").update(key, value, passbandConfigurationTarget());
}

function passbandConfigurationTarget(): vscode.ConfigurationTarget {
  const config = vscode.workspace.getConfiguration("s2pPreview");
  const presets = config.inspect("passbandPresets");
  const defaultPreset = config.inspect("defaultPassbandPreset");
  const hasWorkspaceOverride =
    presets?.workspaceValue !== undefined ||
    presets?.workspaceFolderValue !== undefined ||
    defaultPreset?.workspaceValue !== undefined ||
    defaultPreset?.workspaceFolderValue !== undefined;

  return hasWorkspaceOverride ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
}

async function renderUriIntoWebview(uri: vscode.Uri, panel: vscode.WebviewPanel): Promise<void> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const text = new TextDecoder("utf-8").decode(bytes);
    const doc = parseTouchstone(text, basename(uri));
    const model = buildPreviewModel(doc, vscode.workspace.asRelativePath(uri, false));
    panel.webview.html = renderPreviewHtml(panel.webview, model, getPassbandSettings());
  } catch (error) {
    panel.webview.html = renderErrorHtml(panel.webview, uri, error);
  }
}

function renderPreviewHtml(
  webview: vscode.Webview,
  model: PreviewModel,
  settings: PassbandSettings
): string {
  const defaultPreset = resolveInitialPassband(model, settings);
  const chart = renderChart(model.series, defaultPreset);
  const metricsTable = renderMetrics(defaultPreset, model.metricRows);
  const controls = renderControls(defaultPreset);
  const script = renderClientScript(model, settings);

  return htmlShell(
    webview,
    `
    <header>
      <h1>${escapeHtml(model.title)}</h1>
      <p class="file">${escapeHtml(model.fileLabel)}</p>
    </header>
    ${controls}
    ${chart}
    ${metricsTable}
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

function renderControls(defaultPreset: PassbandPreset): string {
  return `
    <section class="controls" aria-label="Passband controls">
      <label>
        Start GHz
        <input id="passband-start" type="number" value="${defaultPreset.startGHz}" step="0.01" />
      </label>
      <label>
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
      <span id="passband-status" role="status" aria-live="polite"></span>
    </section>
  `;
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
  const legendItems = series.map((item, index) => {
    const legendX = chart.margin.left + 12 + index * 100;
    return `<line class="legend-line ${escapeHtml(item.cssClass)}" x1="${legendX}" y1="18" x2="${legendX + 30}" y2="18" /><text x="${legendX + 38}" y="22">${escapeHtml(item.label)}</text>`;
  }).join("");
  const passbandLegendX = chart.margin.left + 24 + series.length * 100;

  return `
    <section class="chart-wrap">
      <svg viewBox="0 0 ${chart.width} ${chart.height}" role="img" aria-label="S-parameter plot">
        <rect class="chart-bg" x="0" y="0" width="${chart.width}" height="${chart.height}" />
        <rect id="passband-rect" class="passband" x="${passbandX.toFixed(2)}" y="${chart.margin.top}" width="${passbandWidth.toFixed(2)}" height="${chart.plotHeight}" />
        ${xTicks.map((tick) => `<line class="grid" x1="${xCoord(tick, chart).toFixed(2)}" y1="${chart.margin.top}" x2="${xCoord(tick, chart).toFixed(2)}" y2="${chart.margin.top + chart.plotHeight}" />`).join("")}
        ${yTicks.map((tick) => `<line class="grid" x1="${chart.margin.left}" y1="${yCoord(tick, chart).toFixed(2)}" x2="${chart.margin.left + chart.plotWidth}" y2="${yCoord(tick, chart).toFixed(2)}" />`).join("")}
        ${guides.map((guide) => `<line class="guide" x1="${chart.margin.left}" y1="${yCoord(guide, chart).toFixed(2)}" x2="${chart.margin.left + chart.plotWidth}" y2="${yCoord(guide, chart).toFixed(2)}" /><text class="guide-label" x="${chart.margin.left + chart.plotWidth - 56}" y="${(yCoord(guide, chart) - 5).toFixed(2)}">${guide} dB</text>`).join("")}
        ${series.map((item) => `<polyline class="curve ${escapeHtml(item.cssClass)}" points="${linePoints(item.rows, chart)}" />`).join("")}
        <rect class="axis" x="${chart.margin.left}" y="${chart.margin.top}" width="${chart.plotWidth}" height="${chart.plotHeight}" />
        ${xTicks.map((tick) => `<text class="tick" x="${xCoord(tick, chart).toFixed(2)}" y="${chart.height - 28}" text-anchor="middle">${tick}</text>`).join("")}
        ${yTicks.map((tick) => `<text class="tick" x="${chart.margin.left - 12}" y="${(yCoord(tick, chart) + 4).toFixed(2)}" text-anchor="end">${tick}</text>`).join("")}
        <text class="axis-label" x="${chart.margin.left + chart.plotWidth / 2}" y="${chart.height - 8}" text-anchor="middle">Frequency, GHz</text>
        <text class="axis-label" x="18" y="${chart.margin.top + chart.plotHeight / 2}" text-anchor="middle" transform="rotate(-90 18 ${chart.margin.top + chart.plotHeight / 2})">dB</text>
        <g class="legend">
          ${legendItems}
          <rect class="legend-passband" x="${passbandLegendX}" y="9" width="28" height="16" /><text id="legend-passband-label" x="${passbandLegendX + 36}" y="22">${escapeHtml(formatRangeLabel(defaultPreset.startGHz, defaultPreset.stopGHz))}</text>
        </g>
      </svg>
    </section>
  `;
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
  const settingsJson = jsonForScript(settings);
  const hasMetricRows = model.metricRows ? "true" : "false";

  return `
    const vscode = acquireVsCodeApi();
    const AUTO_PASSBAND_LABEL = ${jsonForScript(AUTO_PASSBAND_LABEL)};
    const METRICS_UNAVAILABLE = "2-port passband metrics are not available for this file.";
    const metricRows = ${metricRowsJson};
    const hasMetricRows = ${hasMetricRows};
    let settings = ${settingsJson};
    let activePresetLabel = settings.defaultPresetLabel;
    const chart = {
      minFreq: ${chart.minFreq},
      maxFreq: ${chart.maxFreq},
      displayMinFreq: ${chart.displayMinFreq},
      displayMaxFreq: ${chart.displayMaxFreq},
      marginLeft: ${chart.margin.left},
      plotWidth: ${chart.plotWidth}
    };

    const startInput = document.getElementById("passband-start");
    const stopInput = document.getElementById("passband-stop");
    const presetMenuButton = document.getElementById("preset-menu-button");
    const presetMenu = document.getElementById("preset-menu");
    const presetMenuLabel = document.getElementById("preset-menu-label");
    const presetMenuRange = document.getElementById("preset-menu-range");
    const status = document.getElementById("passband-status");
    const passbandRect = document.getElementById("passband-rect");
    const legendPassbandLabel = document.getElementById("legend-passband-label");
    const metricsTitle = document.getElementById("metrics-title");

    startInput.min = String(chart.minFreq);
    startInput.max = String(chart.maxFreq);
    stopInput.min = String(chart.minFreq);
    stopInput.max = String(chart.maxFreq);

    function x(freqGHz) {
      return chart.marginLeft + ((freqGHz - chart.displayMinFreq) / (chart.displayMaxFreq - chart.displayMinFreq)) * chart.plotWidth;
    }

    function formatRange(startGHz, stopGHz) {
      return startGHz.toFixed(2) + "-" + stopGHz.toFixed(2) + " GHz";
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

      for (const row of metricRows) {
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
      addButton.textContent = "+ Add current range";
      addButton.addEventListener("click", () => {
        if (!currentRangeIsValid()) {
          status.textContent = "Cannot save invalid passband range.";
          return;
        }
        setPresetMenuOpen(false);
        vscode.postMessage({
          type: "addPreset",
          startGHz: Number(startInput.value),
          stopGHz: Number(stopInput.value)
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
      updatePresetControls();
      renderPresetMenu();
      updatePassband();
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

      const passbandRows = metricRows.filter((row) => row.freqGHz >= startGHz && row.freqGHz <= stopGHz);
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
    presetMenuButton.addEventListener("click", (event) => {
      event.stopPropagation();
      setPresetMenuOpen(presetMenu.hidden);
    });
    presetMenu.addEventListener("click", (event) => event.stopPropagation());
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
      }
    });

    renderPresetMenu();
    updatePresetControls();
    updatePassband();
  `;
}

function getPassbandSettings(): PassbandSettings {
  const config = vscode.workspace.getConfiguration("s2pPreview");
  const configuredPresets = config.get<unknown>("passbandPresets");
  const presets = sanitizePresets(configuredPresets);
  const configuredDefault = config.get<string>("defaultPassbandPreset");

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

    seenLabels.add(label);
    presets.push({
      label,
      startGHz: range.startGHz,
      stopGHz: range.stopGHz
    });
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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <style>
    body { color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); margin: 0; padding: 18px; }
    header { margin-bottom: 12px; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    h2 { font-size: 15px; margin: 18px 0 8px; }
    .file { color: var(--vscode-descriptionForeground); margin: 0; }
    .controls { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: end; margin: 14px 0 8px; }
    .controls label { display: grid; gap: 4px; color: var(--vscode-descriptionForeground); font-size: 12px; }
    .controls input { width: 96px; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); padding: 4px 6px; font: inherit; }
    .controls button { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 1px solid var(--vscode-button-border, transparent); padding: 5px 10px; font: inherit; cursor: pointer; }
    .controls button:hover { background: var(--vscode-button-hoverBackground); }
    .controls button:disabled { color: var(--vscode-disabledForeground); background: var(--vscode-button-secondaryBackground); cursor: default; }
    .split-button { display: inline-grid; gap: 2px; justify-items: center; min-width: 86px; }
    .split-button small { color: inherit; font-size: 11px; line-height: 1.2; opacity: 0.82; }
    #passband-status { color: var(--vscode-inputValidation-warningForeground, var(--vscode-descriptionForeground)); min-height: 20px; align-self: center; }
    .preset-dropdown { position: relative; }
    .preset-menu-button { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); border-color: var(--vscode-panel-border); }
    .preset-menu-button:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground)); }
    .preset-menu { position: absolute; z-index: 20; top: calc(100% + 4px); left: 0; min-width: 260px; max-height: 320px; overflow: auto; padding: 4px; color: var(--vscode-dropdown-foreground); background: var(--vscode-dropdown-background); border: 1px solid var(--vscode-dropdown-border, var(--vscode-panel-border)); box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25); }
    .preset-menu[hidden] { display: none; }
    .preset-menu-row { display: grid; grid-template-columns: 1fr 30px; gap: 4px; align-items: stretch; margin-bottom: 3px; }
    .preset-menu-row.auto .preset-menu-item { grid-column: 1 / -1; }
    .preset-menu-item, .preset-menu-add, .preset-delete { font: inherit; border: 0; cursor: pointer; }
    .preset-menu-item { display: grid; gap: 2px; justify-items: start; width: 100%; padding: 6px 8px; color: var(--vscode-dropdown-foreground); background: transparent; text-align: left; }
    .preset-menu-item small { color: var(--vscode-descriptionForeground); font-size: 11px; }
    .preset-menu-item:hover, .preset-menu-add:hover { background: var(--vscode-list-hoverBackground); }
    .preset-menu-item.active { color: var(--vscode-list-activeSelectionForeground); background: var(--vscode-list-activeSelectionBackground); }
    .preset-menu-item.active small { color: inherit; opacity: 0.82; }
    .preset-delete { min-width: 30px; color: var(--vscode-icon-foreground); background: transparent; }
    .preset-delete:hover:not(:disabled) { color: var(--vscode-errorForeground); background: var(--vscode-inputValidation-errorBackground); }
    .preset-delete:disabled { color: var(--vscode-disabledForeground); cursor: default; }
    .preset-menu-add { width: 100%; margin-top: 4px; padding: 7px 8px; color: var(--vscode-dropdown-foreground); background: transparent; text-align: left; border-top: 1px solid var(--vscode-panel-border); }
    .chart-wrap { border: 1px solid var(--vscode-panel-border); overflow: auto; background: var(--vscode-editor-background); }
    svg { display: block; width: min(100%, 1120px); height: auto; }
    .chart-bg { fill: var(--vscode-editor-background); }
    .passband, .legend-passband { fill: #4f46e5; opacity: 0.12; }
    .grid { stroke: var(--vscode-editorIndentGuide-background); stroke-width: 1; }
    .axis { fill: none; stroke: var(--vscode-foreground); stroke-width: 1.2; }
    .guide { stroke: var(--vscode-descriptionForeground); stroke-width: 1; stroke-dasharray: 5 5; }
    .guide-label, .tick, .axis-label, .legend text { fill: var(--vscode-descriptionForeground); font-size: 12px; }
    .curve, .legend-line { fill: none; stroke-width: 2.4; stroke-linejoin: round; stroke-linecap: round; }
    .s11 { stroke: #ef4444; }
    .s21 { stroke: #22c55e; }
    .s22 { stroke: #38bdf8; }
    table { border-collapse: collapse; min-width: 540px; }
    th, td { border: 1px solid var(--vscode-panel-border); padding: 6px 8px; text-align: left; }
    th { color: var(--vscode-descriptionForeground); font-weight: 600; }
    .metric-status { color: var(--vscode-descriptionForeground); margin: 0 0 8px; }
    code { background: var(--vscode-textCodeBlock-background); padding: 1px 4px; border-radius: 3px; }
    .error { border: 1px solid var(--vscode-inputValidation-errorBorder); padding: 12px; background: var(--vscode-inputValidation-errorBackground); }
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getNonce(): string {
  return randomBytes(32).toString("base64url");
}
