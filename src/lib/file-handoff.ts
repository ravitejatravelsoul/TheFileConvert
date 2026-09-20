/**
 * Carries the file(s) picked on the home page into the tool page the user then opens, so they don't have
 * to choose the same file twice. Purely in-memory (no storage, nothing leaves the page): it lives only as
 * long as the client-side navigation, is consumed once, and expires after a short while so a stale file can
 * never appear in an unrelated tool later.
 */
const EXPIRES_MS = 60_000;
let pending: { files: File[]; at: number } | null = null;

export function setPendingFiles(files: File[]): void {
  pending = files.length > 0 ? { files, at: Date.now() } : null;
}

export function takePendingFiles(now: number = Date.now()): File[] {
  const taken = pending;
  pending = null;
  if (!taken || now - taken.at > EXPIRES_MS) return [];
  return taken.files;
}
