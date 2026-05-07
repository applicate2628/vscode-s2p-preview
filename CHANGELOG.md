# Changelog

## 0.0.21

- Added editable preset-owned dB markers with short default labels `m1`, `m2`, and `m3`.
- Added per-marker metrics and settings to hide markers, lock marker editing, or hide marker metrics.
- Added background chart grid lines based on normal axis ticks.
- Added automatic preview refresh when source or overlay Touchstone files change on disk.
- Improved high-resolution PNG export quality.
- Increased the editable dB marker range to `-200..200 dB`.
- Improved overlay trace legends, unique overlay colors, and multi-file overlay behavior.
- Added preset persistence for visible `Sij` traces, selected-port `Z0` renormalization, and dB markers.
- Added support for Touchstone `.s1p`, `.s2p`, `.s3p`, and `.s4p` S-parameter previews, including Touchstone 2.0/2.1 keyword blocks with full matrix data.

## Terms and Abbreviations

- `dB`: decibel, a logarithmic unit used here for S-parameter magnitude.
- `PNG`: Portable Network Graphics image format.
- `Sij`: one S-parameter trace where `i` is the destination/output port and `j` is the source/input port.
- `S-parameter`: scattering parameter used to describe RF network behavior.
- `Touchstone`: RF network parameter file format used by `.sNp` files.
- `Z0`: reference impedance.
