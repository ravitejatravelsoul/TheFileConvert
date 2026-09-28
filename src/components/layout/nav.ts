import type { ToolId } from "@/lib/tools/registry";

export interface NavGroup {
  label: string;
  tools: ToolId[];
}

/** Desktop nav: three menus and one direct link (the editor is the single destination people ask for by name). */
export const NAV_GROUPS: NavGroup[] = [
  { label: "Compress", tools: ["compress-pdf", "compress-image"] },
  { label: "Convert", tools: ["pdf-to-word", "convert-image", "pdf-to-image", "image-to-pdf"] },
  { label: "PDF Tools", tools: ["merge-pdf", "split-pdf", "organize-pdf", "pdf-editor"] },
];
