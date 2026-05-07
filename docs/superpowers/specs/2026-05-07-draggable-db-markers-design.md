# Draggable dB Markers and Axis Grid Design

## Purpose

The preview currently shows fixed guide lines at `-3 dB`, `-15 dB`, and `-20 dB`.
Those lines should become editable preset-owned markers while the chart also keeps a normal background grid based on axis ticks.
The feature should help users tune thresholds while reviewing Touchstone traces without forcing the extra UI on users who do not need it.

## Scope

In scope:

- Store dB markers in passband presets.
- Use `-3 dB`, `-15 dB`, and `-20 dB` as the default marker set for new or old presets.
- Render marker lines over the chart grid with labels.
- Let users drag marker lines vertically.
- Let users edit, add, and delete markers from a compact marker list.
- Add metrics for each marker.
- Add settings toggles so users can disable marker editing and marker metrics.
- Keep the background grid based on axis ticks, not marker values.

Out of scope:

- Marker roles such as insertion-loss or return-loss semantics.
- Smith chart work.
- Non-S-parameter families such as Y/Z/G/H.
- Persisting marker edits outside the preset system.

## Preset Model

Extend each passband preset with an optional `markers` array:

```json
{
  "label": "2-4 GHz",
  "startGHz": 2,
  "stopGHz": 4,
  "markers": [
    { "label": "-3 dB", "db": -3 },
    { "label": "-15 dB", "db": -15 },
    { "label": "-20 dB", "db": -20 }
  ]
}
```

Older presets without `markers` remain valid and resolve to the default marker set at render time.
Saving or updating a preset stores the current marker state with the range, trace selection, and Z0 state.

Sanitization rules:

- `db` must be a finite number.
- `label` is optional; if missing or blank, display `${db} dB`.
- Duplicate dB values are allowed because labels may carry user meaning.
- Invalid marker entries are ignored.
- If all entries are invalid, fall back to the default marker set.

## Settings

Add configuration flags:

- `s2pPreview.markers.enabled`: default `true`.
  When false, do not render marker lines, marker editor controls, or marker metrics.
- `s2pPreview.markers.editable`: default `true`.
  When false, render marker lines but disable drag/add/delete/value editing.
- `s2pPreview.markers.metrics.enabled`: default `true`.
  When false, keep marker lines and editing but hide marker-specific metrics.

These are user/workspace settings, independent of preset data.
They control feature visibility and interaction, not the stored preset marker values.

## Chart Rendering

The chart should have two independent visual layers:

1. Axis grid:
   - X grid uses nice GHz ticks for the current visible frequency range.
   - Y grid uses nice dB ticks for the current y-range.
   - Grid lines remain low contrast and are not saved in presets.
2. dB markers:
   - Marker lines render above the grid and passband shading.
   - Marker labels render near the right edge.
   - Marker stroke is visually stronger than the grid but quieter than data traces.

The current hardcoded guide lines at `-3`, `-15`, and `-20` are replaced by preset markers.

## Marker Editor

Add a compact marker editor near the chart controls or chart footer:

- One row per marker.
- Numeric input for dB value.
- Text input for label.
- Delete button.
- `+ Add marker` button.

When `markers.editable` is false, show read-only values or omit editing controls while preserving labels on the chart.

Dragging behavior:

- Dragging a marker moves it vertically and updates its dB input.
- Dragging clamps to the current y-axis range.
- Dragging updates metrics immediately.
- Pointer capture should be used so drag remains stable if the cursor leaves the line.
- Keyboard and manual input remain available for precise values.

## Metrics

For every marker, compute marker-specific metrics across the current passband range for currently visible traces.
The first implementation should be neutral rather than RF-role-aware:

- For each visible trace, show bands where the trace is at or above the marker.
- For each visible trace, show bands where the trace is at or below the marker.
- Show coverage in GHz inside the current passband for those bands.

Existing legacy 2-port metrics may remain for compatibility, but marker metrics should not depend on the old hardcoded `-3 dB` or `-15 dB` thresholds.

## Data Flow

- Extension settings load presets and feature toggles.
- Preset sanitization resolves marker data.
- `renderPreviewHtml` receives resolved markers and feature toggles.
- The webview owns transient drag state.
- Editing markers updates webview state immediately.
- Saving or updating a preset sends the current marker array back with the rest of the preset payload.
- Settings updates re-render or update UI visibility without mutating preset marker data.

## Testing

Add focused tests for:

- Preset marker sanitization and fallback defaults.
- Saving/updating presets includes marker arrays.
- Rendered chart uses axis grid ticks separately from marker lines.
- Marker UI respects `markers.enabled`, `markers.editable`, and `markers.metrics.enabled`.
- Drag/list edits update marker values without changing passband or Z0 state.
- Marker metrics are generated from marker values instead of fixed `-3/-15/-20` constants.

Manual verification:

- Open a 2-port and an N-port Touchstone file.
- Drag markers in light and dark themes.
- Confirm old presets still show default markers.
- Confirm disabling settings hides or locks the feature as configured.
- Confirm PNG export includes visible marker lines and the background grid.

## Terms and Abbreviations

- `dB`: decibel, logarithmic magnitude unit used for S-parameter plots.
- `GHz`: gigahertz, frequency unit used on the X axis.
- `marker`: user-editable horizontal dB threshold line stored in a preset.
- `preset`: saved view state containing passband range and optional trace, Z0, and marker state.
- `S-parameter`: scattering parameter data used for RF network analysis.
- `Touchstone`: RF network parameter file format used by `.sNp` files.
- `UI`: User Interface.
- `Z0`: reference impedance used for S-parameter normalization.
