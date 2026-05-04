export function formatFileReferenceOhms(referenceOhms: readonly number[]): string {
  return formatReferenceOhms("File Z0", referenceOhms);
}

export function formatEffectiveReferenceOhms(referenceOhms: readonly number[]): string {
  return formatReferenceOhms("Active Z0", referenceOhms);
}

function formatReferenceOhms(label: string, referenceOhms: readonly number[]): string {
  const unique = Array.from(new Set(referenceOhms.map(formatOhm)));
  if (unique.length === 1) {
    return `${label}: ${unique[0]} Ohm`;
  }

  const perPort = referenceOhms.map((value, index) => `P${index + 1} ${formatOhm(value)}`).join(", ");
  return `${label}: ${perPort} Ohm`;
}

function formatOhm(value: number): string {
  const fixed = value.toFixed(3);
  return fixed.replace(/\.?0+$/, "");
}
