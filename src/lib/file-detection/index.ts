import { getExtension } from "@/lib/format";

export interface DetectedFile {
  file: File;
  extension: string;
  mimeType: string;
  sizeBytes: number;
  sniffedType: SniffedType | null;
}

export type SniffedType =
  | "pdf"
  | "png"
  | "jpg"
  | "gif"
  | "webp"
  | "zip"
  | "bmp";

const MAGIC_SIGNATURES: { type: SniffedType; bytes: number[]; offset?: number }[] = [
  { type: "pdf", bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { type: "png", bytes: [0x89, 0x50, 0x4e, 0x47] },
  { type: "jpg", bytes: [0xff, 0xd8, 0xff] },
  { type: "gif", bytes: [0x47, 0x49, 0x46, 0x38] },
  { type: "zip", bytes: [0x50, 0x4b, 0x03, 0x04] }, // PK.. (also docx/xlsx/pptx)
  { type: "bmp", bytes: [0x42, 0x4d] },
  { type: "webp", bytes: [0x52, 0x49, 0x46, 0x46], offset: 0 }, // RIFF....WEBP, verified separately
];

/** Reads the first bytes of a file and matches them against known magic numbers. */
export async function sniffFileType(file: File): Promise<SniffedType | null> {
  const headerSize = 16;
  const buffer = await file.slice(0, headerSize).arrayBuffer();
  const bytes = new Uint8Array(buffer);

  for (const sig of MAGIC_SIGNATURES) {
    const offset = sig.offset ?? 0;
    const matches = sig.bytes.every((b, i) => bytes[offset + i] === b);
    if (matches) {
      if (sig.type === "webp") {
        const isWebp =
          bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
        if (!isWebp) continue;
      }
      return sig.type;
    }
  }
  return null;
}

export async function detectFile(file: File): Promise<DetectedFile> {
  const sniffedType = await sniffFileType(file).catch(() => null);
  return {
    file,
    extension: getExtension(file.name),
    mimeType: file.type || "",
    sizeBytes: file.size,
    sniffedType,
  };
}

export function matchesAcceptedTypes(
  extension: string,
  mimeType: string,
  acceptedExtensions: string[],
  acceptedMimeTypes: string[]
): boolean {
  const extOk =
    acceptedExtensions.length === 0 ||
    acceptedExtensions.includes(extension.toLowerCase());
  const mimeOk =
    acceptedMimeTypes.length === 0 ||
    acceptedMimeTypes.includes("*") ||
    acceptedMimeTypes.some((m) => mimeType === m || (m.endsWith("/*") && mimeType.startsWith(m.replace("/*", "/"))));
  // Browsers frequently leave `type` empty for less common extensions, so we
  // only require one of the two signals to agree, not both.
  return extOk || mimeOk;
}
