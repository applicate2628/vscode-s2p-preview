export const DEFAULT_PREVIEW_REFRESH_DEBOUNCE_MS = 500;
const MIN_PREVIEW_REFRESH_DEBOUNCE_MS = 50;
const MAX_PREVIEW_REFRESH_DEBOUNCE_MS = 10_000;

export function previewFileWatchKeys(sourceUri: string, overlayUris: readonly string[]): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();

  for (const uri of [sourceUri, ...overlayUris]) {
    if (seen.has(uri)) {
      continue;
    }

    seen.add(uri);
    keys.push(uri);
  }

  return keys;
}

export function normalizeAutoRefreshOnFileChange(value: unknown): boolean {
  return typeof value === "boolean" ? value : true;
}

export function normalizePreviewRefreshDebounceMs(value: unknown): number {
  if (
    typeof value === "number"
    && Number.isFinite(value)
    && Number.isInteger(value)
    && value >= MIN_PREVIEW_REFRESH_DEBOUNCE_MS
    && value <= MAX_PREVIEW_REFRESH_DEBOUNCE_MS
  ) {
    return value;
  }

  return DEFAULT_PREVIEW_REFRESH_DEBOUNCE_MS;
}
