export interface PngExportRasterSize {
  scale: number;
  pixelWidth: number;
  pixelHeight: number;
}

export const MIN_PNG_EXPORT_SCALE = 4;
export const MAX_PNG_EXPORT_SCALE = 5;
export const MAX_PNG_EXPORT_EDGE = 8192;
export const MAX_PNG_EXPORT_PIXELS = 32_000_000;

export function pngExportRasterSize(
  logicalWidth: number,
  logicalHeight: number,
  devicePixelRatio: number
): PngExportRasterSize {
  const safeWidth = finitePositiveOrFallback(logicalWidth, 1);
  const safeHeight = finitePositiveOrFallback(logicalHeight, 1);
  const safeDevicePixelRatio = finitePositiveOrFallback(devicePixelRatio, 1);

  let scale = Math.min(MAX_PNG_EXPORT_SCALE, Math.max(MIN_PNG_EXPORT_SCALE, Math.ceil(safeDevicePixelRatio)));
  scale = Math.min(scale, MAX_PNG_EXPORT_EDGE / Math.max(safeWidth, safeHeight));
  scale = Math.min(scale, Math.sqrt(MAX_PNG_EXPORT_PIXELS / (safeWidth * safeHeight)));
  scale = Math.max(1, Math.floor(scale * 100) / 100);

  return {
    scale,
    pixelWidth: Math.max(1, Math.floor(safeWidth * scale)),
    pixelHeight: Math.max(1, Math.floor(safeHeight * scale))
  };
}

function finitePositiveOrFallback(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
