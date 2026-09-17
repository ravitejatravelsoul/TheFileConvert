import { pdfTools } from "./pdf-tools";
import { imageTools, imageConvertTools } from "./image-tools";
import { dataTools, archiveTools } from "./data-tools";
import { roadmapTools } from "./roadmap-tools";
import type { ToolCategory, ToolDefinition } from "./types";

export const allTools: ToolDefinition[] = [
  ...pdfTools,
  ...imageTools,
  ...imageConvertTools,
  ...dataTools,
  ...archiveTools,
  ...roadmapTools,
];

export const liveTools: ToolDefinition[] = allTools.filter((t) => t.status !== "coming-soon");

export const availableTools: ToolDefinition[] = allTools.filter((t) => t.status === "available");

export function getToolById(id: string): ToolDefinition | undefined {
  return allTools.find((t) => t.id === id);
}

export function getToolByHref(href: string): ToolDefinition | undefined {
  return allTools.find((t) => t.href === href);
}

export function getToolsByCategory(category: ToolCategory): ToolDefinition[] {
  return allTools.filter((t) => t.category === category);
}

export function getToolsAcceptingExtension(extension: string): ToolDefinition[] {
  const ext = extension.toLowerCase();
  return liveTools.filter(
    (t) => t.acceptedExtensions.includes(ext) || t.acceptedExtensions.includes("*")
  );
}

export function getRelatedTools(tool: ToolDefinition, limit = 4): ToolDefinition[] {
  const related = (tool.relatedToolIds ?? [])
    .map((id) => getToolById(id))
    .filter((t): t is ToolDefinition => Boolean(t) && t!.status !== "coming-soon");
  if (related.length >= limit) return related.slice(0, limit);

  const fallback = getToolsByCategory(tool.category).filter(
    (t) => t.id !== tool.id && t.status !== "coming-soon" && !related.includes(t)
  );
  return [...related, ...fallback].slice(0, limit);
}

export const CATEGORY_LABELS: Record<ToolCategory, string> = {
  pdf: "PDF",
  image: "Image",
  document: "Document",
  data: "Data & Developer",
  archive: "Archive",
  media: "Audio & Video",
};

export const POPULAR_TOOL_IDS = [
  "pdf-editor",
  "pdf-merge",
  "pdf-compress",
  "image-compress",
  "jpg-to-png",
  "png-to-jpg",
  "pdf-split",
  "images-to-pdf",
];

export function getPopularTools(): ToolDefinition[] {
  return POPULAR_TOOL_IDS.map((id) => getToolById(id)).filter(
    (t): t is ToolDefinition => Boolean(t)
  );
}

function normalize(text: string): string {
  return text.toLowerCase().trim();
}

/** Lightweight, dependency-free fuzzy search: scores substring and keyword hits. */
export function searchTools(query: string, options: { includeComingSoon?: boolean } = {}): ToolDefinition[] {
  const q = normalize(query);
  if (!q) return [];

  const pool = options.includeComingSoon ? allTools : liveTools;
  const scored = pool
    .map((tool) => ({ tool, score: scoreTool(tool, q) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.map((entry) => entry.tool);
}

function scoreTool(tool: ToolDefinition, q: string): number {
  const name = normalize(tool.name);
  const description = normalize(tool.description);
  const keywords = tool.keywords.map(normalize);

  if (name === q) return 100;
  if (name.startsWith(q)) return 90;
  if (keywords.includes(q)) return 85;
  if (name.includes(q)) return 70;
  if (keywords.some((k) => k.includes(q))) return 60;
  if (description.includes(q)) return 40;

  if (isFuzzySubsequence(q, name)) return 20;
  if (keywords.some((k) => isFuzzySubsequence(q, k))) return 15;

  return 0;
}

/** True if every character of `needle` appears in order within `haystack` (typo-tolerant match). */
function isFuzzySubsequence(needle: string, haystack: string): boolean {
  if (needle.length < 3) return false;
  let i = 0;
  for (let j = 0; j < haystack.length && i < needle.length; j++) {
    if (haystack[j] === needle[i]) i++;
  }
  return i === needle.length;
}

export { pdfTools, imageTools, imageConvertTools, dataTools, archiveTools, roadmapTools };
export * from "./types";
