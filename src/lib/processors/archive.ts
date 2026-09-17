import JSZip from "jszip";
import { looksLikeZipBomb, sanitizeArchiveEntryName } from "@/lib/security/validators";

export class ProcessorError extends Error {}

export interface NamedBlob {
  name: string;
  blob: Blob;
}

export async function createZip(files: File[]): Promise<Blob> {
  if (files.length === 0) throw new ProcessorError("Add at least one file to zip.");
  const zip = new JSZip();
  const usedNames = new Set<string>();

  for (const file of files) {
    let name = sanitizeArchiveEntryName(file.name);
    while (usedNames.has(name)) {
      name = `copy-${name}`;
    }
    usedNames.add(name);
    zip.file(name, await file.arrayBuffer());
  }

  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

export interface ZipEntryInfo {
  name: string;
  isDirectory: boolean;
  compressedSize: number;
  uncompressedSize: number;
}

async function openZip(file: File): Promise<JSZip> {
  try {
    return await JSZip.loadAsync(file);
  } catch {
    throw new ProcessorError("We couldn't read this archive. It may be damaged or not a ZIP file.");
  }
}

export async function inspectZip(file: File): Promise<ZipEntryInfo[]> {
  const zip = await openZip(file);
  const entries: ZipEntryInfo[] = [];
  zip.forEach((relativePath, entry) => {
    const meta = entry as unknown as { _data?: { compressedSize: number; uncompressedSize: number } };
    entries.push({
      name: relativePath,
      isDirectory: entry.dir,
      compressedSize: meta._data?.compressedSize ?? 0,
      uncompressedSize: meta._data?.uncompressedSize ?? 0,
    });
  });
  return entries;
}

export async function extractZip(file: File): Promise<NamedBlob[]> {
  const zip = await openZip(file);

  const results: NamedBlob[] = [];
  let totalUncompressed = 0;

  for (const [relativePath, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const blob = await entry.async("blob");
    totalUncompressed += blob.size;
    if (looksLikeZipBomb(file.size, totalUncompressed)) {
      throw new ProcessorError(
        "This archive expands to an unusually large size and was blocked as a safety precaution."
      );
    }
    results.push({ name: sanitizeArchiveEntryName(relativePath), blob });
  }

  if (results.length === 0) {
    throw new ProcessorError("This archive doesn't contain any files.");
  }

  return results;
}
