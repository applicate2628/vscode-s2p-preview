# S2P Preview

Preview Touchstone `S`-parameter files for RF simulation work directly in VS Code.

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
- Shows guide lines at `-3 dB`, `-15 dB`, and `-20 dB`.

Unsupported for the current release: `Y`/`Z`/`G`/`H` parameter conversion, mixed-mode transformation UI, PNG export, and generic high-port `.sNp` visualization.

## Use

Open a `.s1p`, `.s2p`, `.s3p`, or `.s4p` file. VS Code should use the `S2P Preview` custom editor by default.

To open the preview from an already-open text editor, run:

```text
S2P: Preview Current File
```

You can also right-click a `.s1p`, `.s2p`, `.s3p`, or `.s4p` file in Explorer and run the same command.
To compare selected files, multi-select Touchstone files in Explorer, right-click, and run `S2P: Preview Selected Files Overlay`.
Use the `Start GHz` and `Stop GHz` fields in the preview to update the shaded band and metrics interactively.
Use the preset dropdown to activate a preset, save the current view as a new preset, or delete a preset with the `x` at the end of its row.
To return to the active preset after manual edits, open the dropdown and select that preset again.
Use the `Sij` checkbox matrix to choose visible traces for multi-port files.
Use `Normalize Z0, Ohm` and the port checkboxes to renormalize selected ports; the initial values come from the Touchstone option line or `[Reference]` block.

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
      }
    }
  ],
  "s2pPreview.defaultPassbandPreset": "Auto / Full file range"
}
```

Preset add/delete actions update user settings by default. If the workspace already defines `s2pPreview.passbandPresets` or `s2pPreview.defaultPassbandPreset`, those actions update the workspace settings instead. Old range-only presets remain valid; presets without `traces` or `renormalize` use the file's default trace visibility and reference impedance.

## License

Commercial licensing is available separately.
Unless you have a separate commercial license agreement, this project is licensed under MPL-2.0.
See the repository `LICENSE` for the full MPL-2.0 text and `NOTICE` for copyright and commercial licensing notice.

## Terms and Abbreviations

- `dB`: decibel, a logarithmic unit used here for S-parameter magnitude.
- `GHz`: gigahertz.
- `mixed-mode`: a network-parameter representation that separates common-mode and differential-mode behavior.
- `MPL`: Mozilla Public License.
- `PNG`: Portable Network Graphics image format.
- `S2P`: Touchstone two-port `S`-parameter file format.
- `S-parameter`: scattering parameter used to describe RF network behavior.
- `Sij`: one S-parameter trace where `i` is the destination/output port and `j` is the source/input port.
- `SNP`: generic Touchstone N-port `S`-parameter file extension family such as `.s1p`, `.s2p`, `.s3p`, or `.s4p`.
- `Touchstone 1.x`: option-line Touchstone syntax without Touchstone 2.x keyword blocks.
- `Touchstone 2.x`: keyword-block Touchstone syntax for extended network data.
- `VS Code`: Visual Studio Code.
- `Y`/`Z`/`G`/`H`: admittance, impedance, inverse hybrid, and hybrid network-parameter families.
- `Z0`: reference impedance.
