/**
 * Sizes in the new UI are decimal (1 KB = 1,000 bytes, 1 MB = 1,000,000 bytes). For targets that is
 * the conservative choice: a file under 1,000,000 bytes is also under an upload limit that means
 * 1,048,576, but not the other way round.
 */
export const KB = 1000;
export const MB = 1000 * 1000;

export type SizeUnit = "KB" | "MB";

export function toBytes(value: number, unit: SizeUnit): number {
  return Math.round(value * (unit === "MB" ? MB : KB));
}

/** Parses the custom-target field. Returns null for anything that isn't a usable positive size. */
export function parseTarget(raw: string, unit: SizeUnit): number | null {
  const cleaned = raw.trim().replace(",", ".");
  if (!/^\d*\.?\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) return null;
  const bytes = toBytes(value, unit);
  return bytes >= 1 * KB ? bytes : null;
}

/** "384 KB", "1.2 MB", "812 B". */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < KB) return `${Math.round(bytes)} B`;
  if (bytes < MB) {
    const kb = bytes / KB;
    return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  }
  const mb = bytes / MB;
  return `${mb < 10 ? mb.toFixed(2).replace(/0$/, "") : mb.toFixed(1)} MB`;
}

/** A target as the user thinks of it: "500 KB", "1 MB", "2.5 MB". */
export function formatTarget(bytes: number): string {
  if (bytes >= MB) return `${+(bytes / MB).toFixed(2)} MB`;
  return `${+(bytes / KB).toFixed(1)} KB`;
}

/** "1,234,567 bytes" */
export function formatExact(bytes: number): string {
  return `${Math.round(bytes).toLocaleString("en-US")} bytes`;
}

/** Whole-percent reduction, never negative. */
export function percentSaved(before: number, after: number): number {
  if (before <= 0 || after >= before) return 0;
  return Math.round(((before - after) / before) * 100);
}
