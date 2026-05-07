# Touchstone S-Parameter Preview

Preview `.s1p`, `.s2p`, `.s3p`, and `.s4p` Touchstone `S`-parameter files for RF simulation work directly in VS Code.

[GitHub repository](https://github.com/applicate2628/vscode-s2p-preview) | [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=applicate2628.vscode-s2p-preview) | [Open VSX](https://open-vsx.org/extension/applicate2628/vscode-s2p-preview)

## Why Use It

- Inspect Touchstone S-parameter charts without leaving VS Code.
- Compare design variants with overlays, saved presets, and PNG export.
- Keep RF simulation files local; no upload, telemetry, or external service is used.

![Touchstone S-parameter preview demo in VS Code showing passband presets, Sij trace selection, overlays, Z0 renormalization, and PNG export](media/s2p-preview-demo.gif)

## Features

- Supports Touchstone `S`-parameter files in `.s1p`, `.s2p`, `.s3p`, and `.s4p` form.
- Supports Touchstone 1.x option-line files and Touchstone 2.0/2.1 keyword-block files with full matrix network data.
- Renders dB charts for `.s1p`, `.s2p`, `.s3p`, and `.s4p` files.
- Single-file passband metrics are available for 2-port files.
- Plots selected `Sij` traces in dB, with a checkbox matrix for multi-port files.
- Opens `.s1p`, `.s2p`, `.s3p`, and `.s4p` files as the default `S2P Preview` custom editor.
- Opens in `Auto / Full file range` mode and highlights an editable passband.
- Keeps `1-10 GHz` as the first configurable preset.
- Adds and deletes view presets from the preview.
- Renormalizes selected ports to editable per-port real `Z0, Ohm` values in single-file previews.
- Exports the current chart area, including range indicator and legend, to PNG.
- Shows editable preset-owned dB markers with optional per-marker metrics.

Unsupported for the current release: `Y`/`Z`/`G`/`H` parameter conversion, mixed-mode transformation UI, and generic high-port `.sNp` visualization.

## Use

Open a `.s1p`, `.s2p`, `.s3p`, or `.s4p` file. VS Code should use the `S2P Preview` custom editor by default.

To open the preview from an already-open text editor, run:

```text
S2P: Preview Current File
```

You can also right-click a `.s1p`, `.s2p`, `.s3p`, or `.s4p` file in Explorer and run the same command.
To compare selected files, multi-select Touchstone files in Explorer, right-click, and run `S2P: Preview Selected Files Overlay`.
From an open preview, use `Overlay files...` to pick Touchstone files from the same folder and open an overlay preview.
Use the `Start GHz` and `Stop GHz` fields in the preview to update the shaded band and metrics interactively.
Use the preset dropdown to activate a preset, save the current view as a new preset, or delete a preset with the `x` at the end of its row.
Saved presets are user-level settings, so ranges, visible traces, and Z0 normalization apply across files and workspaces.
To return to the active preset after manual edits, open the dropdown and select that preset again.
Use the `Sij` checkbox matrix to choose visible traces for multi-port files.
Drag dB marker lines or edit them in the marker list; marker values are saved with presets.
Use `Normalize Z0, Ohm` and the port checkboxes to renormalize selected ports; the initial values come from the Touchstone option line or `[Reference]` block.
Use `Export PNG...` to save the current chart area, including the passband range indicator, plotted traces, and visible legend. PNG export uses high-resolution rasterization for sharper lines and labels.

To inspect raw Touchstone text, use `Reopen Editor With...` and choose `Text Editor`.

## Settings

```json
{
  "s2pPreview.passbandPresets": [
    {
      "label": "1-10 GHz",
      "startGHz": 1,
      "stopGHz": 10,
      "traces": [{ "toPort": 2, "fromPort": 1 }],
      "renormalize": {
        "selectedPorts": [false, true],
        "targetOhms": [50, 75]
      },
      "markers": [
        { "label": "-3 dB", "db": -3 },
        { "label": "-15 dB", "db": -15 },
        { "label": "-20 dB", "db": -20 }
      ]
    }
  ],
  "s2pPreview.defaultPassbandPreset": "Auto / Full file range",
  "s2pPreview.markers.enabled": true,
  "s2pPreview.markers.editable": true,
  "s2pPreview.markers.metrics.enabled": true
}
```

Marker lines are saved with presets. Use `s2pPreview.markers.enabled`, `s2pPreview.markers.editable`, and `s2pPreview.markers.metrics.enabled` to hide marker UI, lock marker editing, or hide marker metrics.

Preset add/delete actions update user settings by default. If the workspace already defines `s2pPreview.passbandPresets` or `s2pPreview.defaultPassbandPreset`, those actions update the workspace settings instead. Old range-only presets remain valid; presets without `traces`, `renormalize`, or `markers` use the file's default trace visibility, reference impedance, and default dB markers.

## Privacy And Security

The extension reads local Touchstone files through the VS Code extension API and renders the preview inside a VS Code webview. It does not upload files, make network requests, or collect telemetry.

## Support The Project

If Touchstone S-Parameter Preview helps your workflow, please star the GitHub repository or leave a rating on the marketplace where you installed it. This helps other VS Code users find the extension.

## License

Commercial licensing is available separately.
Unless you have a separate commercial license agreement, this project is licensed under MPL-2.0.
See the repository `LICENSE` for the full MPL-2.0 text and `NOTICE` for copyright and commercial licensing notice.

## Terms and Abbreviations

- `dB`: decibel, a logarithmic unit used here for S-parameter magnitude.
- `GHz`: gigahertz.
- `mixed-mode`: a network-parameter representation that separates common-mode and differential-mode behavior.
- `MPL`: Mozilla Public License.
- `Open VSX`: the open extension registry used by VS Code-compatible editors.
- `PNG`: Portable Network Graphics image format.
- `overlay`: a preview mode that plots one selected S-parameter trace from multiple files on one chart.
- `rating`: a user review or score on an extension marketplace.
- `S2P`: Touchstone two-port `S`-parameter file format.
- `S-parameter`: scattering parameter used to describe RF network behavior.
- `Sij`: one S-parameter trace where `i` is the destination/output port and `j` is the source/input port.
- `SNP`: generic Touchstone N-port `S`-parameter file extension family such as `.s1p`, `.s2p`, `.s3p`, or `.s4p`.
- `star`: a GitHub repository star used as a lightweight public signal of user interest.
- `Telemetry`: automatic usage or diagnostic data collection; this extension does not collect it.
- `Touchstone 1.x`: option-line Touchstone syntax without Touchstone 2.x keyword blocks.
- `Touchstone 2.x`: keyword-block Touchstone syntax for extended network data.
- `VS Code`: Visual Studio Code.
- `VS Code extension API`: the local API surface VS Code exposes to extensions.
- `webview`: an isolated VS Code panel used to render extension HTML content.
- `Y`/`Z`/`G`/`H`: admittance, impedance, inverse hybrid, and hybrid network-parameter families.
- `Z0`: reference impedance.
