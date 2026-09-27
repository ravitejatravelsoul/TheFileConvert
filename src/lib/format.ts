

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
