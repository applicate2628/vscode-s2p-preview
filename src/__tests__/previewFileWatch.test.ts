import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PREVIEW_REFRESH_DEBOUNCE_MS,
  normalizeAutoRefreshOnFileChange,
  normalizePreviewRefreshDebounceMs,
  previewFileWatchKeys
} from "../previewFileWatch";

test("preview file watchers include the source file and unique overlays", () => {
  assert.deepEqual(
    previewFileWatchKeys("file:///workspace/base.s2p", [
      "file:///workspace/overlay-a.s2p",
      "file:///workspace/base.s2p",
      "file:///workspace/overlay-a.s2p",
      "file:///workspace/overlay-b.s4p"
    ]),
    [
      "file:///workspace/base.s2p",
      "file:///workspace/overlay-a.s2p",
      "file:///workspace/overlay-b.s4p"
    ]
  );
});

test("normalizes the auto-refresh setting", () => {
  assert.equal(normalizeAutoRefreshOnFileChange(true), true);
  assert.equal(normalizeAutoRefreshOnFileChange(false), false);
  assert.equal(normalizeAutoRefreshOnFileChange("yes"), true);
});

test("normalizes preview refresh debounce milliseconds", () => {
  assert.equal(normalizePreviewRefreshDebounceMs(300), 300);
  assert.equal(normalizePreviewRefreshDebounceMs(0), DEFAULT_PREVIEW_REFRESH_DEBOUNCE_MS);
  assert.equal(normalizePreviewRefreshDebounceMs(49), DEFAULT_PREVIEW_REFRESH_DEBOUNCE_MS);
  assert.equal(normalizePreviewRefreshDebounceMs(10_001), DEFAULT_PREVIEW_REFRESH_DEBOUNCE_MS);
  assert.equal(normalizePreviewRefreshDebounceMs("500"), DEFAULT_PREVIEW_REFRESH_DEBOUNCE_MS);
});
