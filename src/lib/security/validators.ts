import { detectFile, matchesAcceptedTypes } from "@/lib/file-detection";
import type { Tool } from "@/lib/tools/registry";

export type ToolInputRules = Pick<Tool, "name" | "inputNoun" | "acceptedExtensions" | "acceptedMimeTypes" | "maxRecommendedSizeMb">;

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

const HARD_MAX_SIZE_MB = 500;

export async function validateFileForTool(file: File, tool: ToolInputRules): Promise<ValidationResult> {
  if (file.size === 0) {
    return { valid: false, error: `“${file.name}” is empty.` };
  }

  if (file.size > HARD_MAX_SIZE_MB * 1024 * 1024) {
    return {
      valid: false,
      error: `“${file.name}” is larger than ${HARD_MAX_SIZE_MB} MB, which is more than a browser can safely process.`,
    };
  }

  const detected = await detectFile(file);
  if (!matchesAcceptedTypes(detected.extension, detected.mimeType, tool.acceptedExtensions, tool.acceptedMimeTypes)) {
    return { valid: false, error: `“${file.name}” isn't supported here. ${tool.name} takes ${describeAccepted(tool)}.` };
  }

  return { valid: true };
}

function describeAccepted(tool: ToolInputRules): string {
  const label: Record<string, string> = { jpg: "JPG", jpeg: "JPG", png: "PNG", webp: "WebP", svg: "SVG", pdf: "PDF" };
  const exts = [...new Set(tool.acceptedExtensions.map((e) => label[e] ?? e.toUpperCase()))];
  if (exts.length === 1) return `${exts[0]} files`;
  return `${exts.slice(0, -1).join(", ")} or ${exts[exts.length - 1]} files`;
}

export function isOverRecommendedSize(file: File, tool: ToolInputRules): boolean {
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
