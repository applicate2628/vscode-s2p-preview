# Touchstone 2.x, Overlays, Smith Chart, and N-Port Roadmap Design

## Purpose

`S2P Preview` should grow from a narrow `.s2p` magnitude preview into a small Touchstone viewer that stays useful for RF simulation review inside VS Code. The next work should add a proper Touchstone data model first, because the current parser immediately collapses each parameter pair into dB and loses the phase and port matrix data needed by Smith charts, overlays, and future `.s3p`/`.s4p` support.

The first implementation slice is Touchstone `S`-parameter support only. `Y`, `Z`, `G`, and `H` parsing or conversion remain future work and should fail with a clear unsupported-parameter message until implemented.

## Current State

- The extension registers a custom editor for `*.s2p`.
- `src/touchstone.ts` parses Touchstone option-line files and returns rows with `freqGHz`, `s11db`, `s21db`, `s12db`, and `s22db`.
- `src/extension.ts` renders one SVG magnitude chart for `S11`, `S21`, and `S22`, passband controls, and quick passband metrics.
- The current README explicitly lists Touchstone 2.0/2.1 keyword blocks, Smith chart, multi-file overlays, and PNG export as unsupported.

## External Format Facts

Touchstone 2.1 is an official IBIS Open Forum specification ratified on January 26, 2024. The 2.1 specification says `[Version] 2.1` files are identical to `[Version] 2.0` files except for the version string. The implementation should therefore treat this as one `Touchstone 2.x` parser path rather than two unrelated formats.

The next parser should support these `S`-parameter surfaces:

- Touchstone 1.x option-line files without keyword blocks.
- Touchstone 2.0/2.1 files with `[Version]`, option line, `[Number of Ports]`, `[Two-Port Data Order]`, `[Number of Frequencies]`, `[Reference]`, `[Matrix Format]`, `[Network Data]`, and `[End]`.
- File extensions `.s1p`, `.s2p`, `.s3p`, `.s4p`, and later generic `.sNp` where VS Code filename matching and UI behavior remain manageable.

## Proposed Architecture

Replace the current `S2pRow[]` parse result with a format-neutral Touchstone document model:

```ts
interface ComplexValue {
  re: number;
  im: number;
}

interface TouchstoneSample {
  freqGHz: number;
  matrix: ComplexValue[][];
}

interface TouchstoneDocument {
  version: "1.x" | "2.0" | "2.1";
  ports: number;
  parameter: "S";
  format: "MA" | "DB" | "RI";
  referenceOhms: number[];
  samples: TouchstoneSample[];
  sourceName: string;
}
```

Magnitude, phase, dB, VSWR-style future values, and Smith chart coordinates should be derived from this model rather than stored as the primary parser output. Existing passband metrics can be preserved by adapting them to selectors like `S21`, `S11`, and `S22`.

## Feature Order

1. Parser and model foundation:
   Support complex `S` matrices for 1-port through 4-port files and Touchstone 2.0/2.1 keyword blocks. Keep clear errors for unsupported matrix forms or unsupported parameters.

2. Multi-file overlays:
   Add a command to overlay selected Touchstone files on the existing dB chart. The first UI should compare the same trace selector across files, for example `S21` across `m_000.s2p` through `m_010.s2p`.

3. Smith chart:
   Add a view mode for reflection traces. For `.s2p`, default to `S11` and optionally `S22`. For `.s4p`, allow `S11`, `S22`, `S33`, and `S44` first. Transmission terms do not belong on the default Smith chart.

4. PNG export:
   Export the currently active chart state, including active trace selections, passband, overlays, and Smith or dB mode. SVG-to-canvas in the webview is acceptable if it preserves VS Code theme-independent colors.

5. Wider N-port UI:
   Enable `.s3p`/`.s4p` UI through explicit trace selection, not by drawing every `Sij` by default.

## UI Behavior

The default experience should remain simple:

- Opening a single `.s2p` still shows the current dB chart style and passband metrics.
- Overlay mode should be opt-in through a command or button, not automatic for every sibling file.
- The trace selector should start with common useful choices: `S11`, `S21`, `S22` for `.s2p`; reflection traces plus selected transmission traces for `.s3p`/`.s4p`.
- Smith chart mode should not replace the magnitude chart; it should be a chart mode toggle.
- PNG export should export what the user is looking at, not a separate hidden report layout.

## Error Handling

- Unsupported `Y`, `Z`, `G`, and `H` files must show a clear message that the current implementation supports only `S`-parameters.
- Unsupported Touchstone 2.x blocks should include the keyword name in the error.
- Files with mismatched port counts, malformed numeric pairs, or incomplete matrices should fail before rendering.
- Overlay failures should be per file where practical, so one malformed file does not hide every valid overlay.

## Testing

Parser tests should cover:

- Existing Touchstone 1.x `.s2p` fixtures in `MA`, `DB`, and `RI`.
- Touchstone 2.0 and 2.1 keyword-block `.s2p` files.
- 1-port, 3-port, and 4-port `S` matrix parsing.
- Unsupported `Y`, `Z`, `G`, and `H` files with clear errors.
- Matrix order and `[Two-Port Data Order]` behavior.

UI-adjacent tests should cover:

- Deriving dB traces from complex values.
- Preserving current passband metrics for `.s2p`.
- Selecting one trace across multiple files for overlays.
- Smith chart coordinate derivation from reflection coefficients.

## Out of Scope for the First Slice

- Numeric conversion from `Y`, `Z`, `G`, or `H` to `S`.
- Mixed-mode transformation UI.
- Full generic `.sNp` visualization for arbitrary high port counts.
- Publication or Marketplace release. Version bump and push remain a separate release step.

## References

- IBIS Open Forum, Touchstone 2.1 official files: <https://www.ibis.org/touchstone_ver2.1/>
- IBIS Open Forum, Touchstone File Format Specification Version 2.1 PDF: <https://www.ibis.org/touchstone_ver2.1/touchstone_ver2_1.pdf>

## Terms and Abbreviations

- `dB`: decibel, a logarithmic magnitude unit used for S-parameter plots.
- `IBIS`: I/O Buffer Information Specification; the Open Forum that publishes the Touchstone specification.
- `N-port`: a network model with an arbitrary number of ports.
- `PNG`: Portable Network Graphics, a raster image export format.
- `RF`: radio frequency.
- `S-parameter`: scattering parameter used for network behavior in RF and microwave systems.
- `Smith chart`: a chart for complex reflection coefficients and impedance/admittance relationships.
- `Touchstone 1.x`: option-line Touchstone files without Touchstone 2.x keyword blocks.
- `Touchstone 2.x`: Touchstone 2.0 and 2.1 keyword-block files.
- `VS Code`: Visual Studio Code.
- `VSWR`: Voltage Standing Wave Ratio; a derived RF matching metric that can be computed from reflection coefficients.
