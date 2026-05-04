# Selected-Port Z0 Renormalization Design

## Purpose

`S2P Preview` should let the user inspect how loaded Touchstone `S`-parameters look after renormalizing selected ports to a target real reference impedance. The default state must preserve the file exactly as opened: no visible trace should change until the user edits the target impedance or changes the selected ports.

## Scope

This slice supports real positive per-port reference impedances already parsed from Touchstone `# ... R ...` option lines and Touchstone 2.x `[Reference]` blocks. It applies to single-file previews first. Overlay previews can keep their existing file-as-is behavior until they get a separate overlay control model.

## UI Behavior

The passband control row gains a compact `Target Z0, Ohm` numeric input and one checkbox per port.

The initial target impedance is chosen from the file:

- If all parsed `referenceOhms` values are the same, the input starts at that value and all ports are selected.
- If references are mixed, the input starts at port 1 reference and only ports whose source reference equals that value are selected.
- A short label shows the file references, for example `File Z0: 50 Ohm` or `File Z0: P1 50, P2 75 Ohm`.

Changing the target value or checkbox selection recomputes chart traces and 2-port metrics in the webview. Unchecked ports keep their source reference impedance from the file.

## Numeric Model

For real positive diagonal reference impedances, renormalization is:

`Z = D_{0}(I + S)(I - S)^{-1}D_{0}`

`S' = (Z_{n}' - I)(Z_{n}' + I)^{-1}`, where `Z_{n}' = D_{1}^{-1}ZD_{1}^{-1}`.

Here `D_{0}` and `D_{1}` are diagonal matrices containing square roots of source and effective target port impedances. For unchecked ports, the effective target impedance equals the source impedance.

The implementation should fail clearly for invalid non-positive target impedance and for singular matrices during conversion. The UI should guard ordinary invalid input before attempting conversion.

## Testing

Tests should cover:

- One-port renormalization from 50 Ohm to 75 Ohm.
- A mixed-reference multi-port case where only selected ports change effective target impedance.
- Invalid target impedance rejection.
- Preview model metadata exposing file references and the default selected ports.

## Terms and Abbreviations

- `Ohm`: electrical resistance unit used for reference impedance.
- `S-parameter`: scattering parameter used for RF network behavior.
- `Touchstone`: common RF network data file format for S-parameters.
- `UI`: User Interface.
- `Z0`: reference impedance, usually written as `$Z_{0}$`.
