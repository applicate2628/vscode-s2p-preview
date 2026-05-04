# S2P Preview

MVP VS Code extension for quick Touchstone 1.0 `.s2p` preview for RF simulation files.

## Scope

- Supports 2-port Touchstone 1.0 `.s2p` files with `# GHZ S <MA|DB|RI> R 50`.
- Plots `S11`, `S21`, and `S22` in dB.
- Opens `.s2p` files as the default `S2P Preview` custom editor.
- Opens in `Auto / Full file range` mode and highlights an editable passband.
- Keeps `1-10 GHz` as the first configurable preset.
- Adds and deletes passband presets from the preview.
- Shows guide lines at `-3 dB`, `-15 dB`, and `-20 dB`.
- Shows quick passband metrics for `S21` and `S11/S22`.

Unsupported for MVP: Touchstone 2.0/2.1 keyword blocks, Smith chart, multi-file overlays, and PNG export.

## Build

```powershell
npm install
npm test
npm run package
```

## Install Local VSIX

```powershell
code --install-extension .\vscode-s2p-preview-0.0.2.vsix
```

## Use

Open a `.s2p` file. VS Code should use the `S2P Preview` custom editor by default.

To open the preview from an already-open text editor, run:

```text
S2P: Preview Current File
```

You can also right-click a `.s2p` file in Explorer and run the same command.
Use the `Start GHz` and `Stop GHz` fields in the preview to update the shaded band and metrics interactively.
Use the preset dropdown to activate a preset, save the current range as a new preset, or delete a preset with the `x` at the end of its row.
To return to the active preset after manual edits, open the dropdown and select that preset again.

To inspect raw Touchstone text, use `Reopen Editor With...` and choose `Text Editor`.

## Settings

Presets are stored in VS Code settings:

```json
{
  "s2pPreview.passbandPresets": [
    { "label": "1-10 GHz", "startGHz": 1, "stopGHz": 10 }
  ],
  "s2pPreview.defaultPassbandPreset": "Auto / Full file range"
}
```

Preset add/delete actions update user settings by default. If the workspace already defines `s2pPreview.passbandPresets` or `s2pPreview.defaultPassbandPreset`, those actions update the workspace settings instead.

## License

Commercial licensing is available separately.
Unless you have a separate commercial license agreement, this project is licensed under MPL-2.0.

## Terms and Abbreviations

- `MPL`: Mozilla Public License.
- `S2P`: Touchstone two-port S-parameter file format.
- `Touchstone 1.0`: original option-line Touchstone syntax without Touchstone 2.0/2.1 keyword blocks.
- `VS Code`: Visual Studio Code.
- `VSIX`: the packaged install format for VS Code extensions.
