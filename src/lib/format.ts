export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const value = bytes / Math.pow(1024, exponent);
  const rounded = exponent === 0 ? value.toFixed(0) : value.toFixed(decimals);
  return `${rounded} ${units[exponent]}`;
}

export function percentSmaller(originalBytes: number, newBytes: number): number {
  if (originalBytes <= 0) return 0;
  const diff = originalBytes - newBytes;
  return Math.max(0, Math.round((diff / originalBytes) * 100));
}

export function getExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  if (idx === -1 || idx === filename.length - 1) return "";
  return filename.slice(idx + 1).toLowerCase();
}

export function stripExtension(filename: string): string {
  const idx = filename.lastIndexOf(".");
  if (idx === -1) return filename;
  return filename.slice(0, idx);
}

export function withExtension(filename: string, newExt: string): string {
  return `${stripExtension(filename)}.${newExt.replace(/^\./, "")}`;
}

/** Deterministic, filesystem-safe filename builder for generated output. */
export function safeOutputName(
  originalName: string,
  suffixOrExt: string,
  newExtension?: string
): string {
  const base = stripExtension(originalName)
    .replace(/[^a-zA-Z0-9-_ ]/g, "")
    .trim()
    .slice(0, 80) || "file";
  const ext = newExtension ?? getExtension(originalName) ?? "bin";
  return `${base}-${suffixOrExt}.${ext}`;
}
