import { detectFile, matchesAcceptedTypes } from "@/lib/file-detection";
import type { ToolDefinition } from "@/lib/tools/types";

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

const HARD_MAX_SIZE_MB = 500;

export async function validateFileForTool(
  file: File,
  tool: ToolDefinition
): Promise<ValidationResult> {
  if (file.size === 0) {
    return { valid: false, error: "This file is empty." };
  }

  const hardMaxBytes = HARD_MAX_SIZE_MB * 1024 * 1024;
  if (file.size > hardMaxBytes) {
    return {
      valid: false,
      error: `This file is larger than the ${HARD_MAX_SIZE_MB} MB limit this tool can safely process in your browser.`,
    };
  }

  const detected = await detectFile(file);
  const matches = matchesAcceptedTypes(
    detected.extension,
    detected.mimeType,
    tool.acceptedExtensions,
    tool.acceptedMimeTypes
  );

  if (!matches) {
    return {
      valid: false,
      error: `This file type isn't supported by ${tool.name}.`,
    };
  }

  return { valid: true };
}

export function isOverRecommendedSize(file: File, tool: ToolDefinition): boolean {
  return file.size > tool.maxRecommendedSizeMb * 1024 * 1024;
}

/**
 * Strips script execution vectors from untrusted SVG markup before it is
 * rendered or rasterized. SVG is XML and can carry <script>, event handler
 * attributes, and external references, so we never inject raw SVG as-is.
 */
export function sanitizeSvgMarkup(svgText: string): string {
  let cleaned = svgText.replace(/<script[\s\S]*?<\/script>/gi, "");
  cleaned = cleaned.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  cleaned = cleaned.replace(/xlink:href\s*=\s*("javascript:[^"]*"|'javascript:[^']*')/gi, "");
  cleaned = cleaned.replace(/href\s*=\s*("javascript:[^"]*"|'javascript:[^']*')/gi, "");
  cleaned = cleaned.replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "");
  return cleaned;
}

/** Filesystem/path-traversal safe name for entries pulled out of user-supplied archives. */
export function sanitizeArchiveEntryName(entryName: string): string {
  const normalized = entryName.replace(/\\/g, "/");
  const parts = normalized
    .split("/")
    .filter((part) => part !== "" && part !== "." && part !== "..");
  return parts.join("/") || "file";
}

const ZIP_BOMB_MAX_RATIO = 200;
const ZIP_BOMB_MAX_UNCOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024;

export function looksLikeZipBomb(compressedBytes: number, uncompressedBytes: number): boolean {
  if (uncompressedBytes > ZIP_BOMB_MAX_UNCOMPRESSED_BYTES) return true;
  if (compressedBytes <= 0) return false;
  return uncompressedBytes / compressedBytes > ZIP_BOMB_MAX_RATIO;
}
