import type { EditorObject, RgbColor } from "@/lib/editor/types";

export interface ToolOptions {
  color: RgbColor;
  strokeWidth: number;
  fontSize: number;
  bold: boolean;
  align: "left" | "center" | "right";
  fillShape: boolean;
}

export const DEFAULT_TOOL_OPTIONS: ToolOptions = {
  color: { r: 0.1, g: 0.1, b: 0.1 },
  strokeWidth: 2,
  fontSize: 14,
  bold: false,
  align: "left",
  fillShape: false,
};

export const PRESET_COLORS: { label: string; value: RgbColor }[] = [
  { label: "Black", value: { r: 0.05, g: 0.05, b: 0.05 } },
  { label: "Red", value: { r: 0.86, g: 0.15, b: 0.15 } },
  { label: "Orange", value: { r: 0.92, g: 0.35, b: 0.05 } },
  { label: "Yellow", value: { r: 0.98, g: 0.8, b: 0.08 } },
  { label: "Green", value: { r: 0.06, g: 0.6, b: 0.35 } },
  { label: "Blue", value: { r: 0.1, g: 0.4, b: 0.85 } },
  { label: "White", value: { r: 1, g: 1, b: 1 } },
];

export function rgbToCss(c: RgbColor): string {
  return `rgb(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)})`;
}

function toHex2(n: number): string {
  return Math.round(n * 255).toString(16).padStart(2, "0");
}

export function rgbToHex(c: RgbColor): string {
  return `#${toHex2(c.r)}${toHex2(c.g)}${toHex2(c.b)}`;
}

export function hexToRgb(hex: string): RgbColor {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;
  return { r: Number.isFinite(r) ? r : 0, g: Number.isFinite(g) ? g : 0, b: Number.isFinite(b) ? b : 0 };
}

/** The panel's controls (color, stroke width, font size, fill) as they apply to `obj` — so with
 * an object selected, the panel shows *that object's* values instead of the defaults for the
 * next object drawn. Falls back to `base` for anything the object doesn't have. */
export function optionsFromObject(obj: EditorObject, base: ToolOptions): ToolOptions {
  switch (obj.type) {
    case "added-text":
      return { ...base, color: obj.color, fontSize: obj.fontSize, bold: obj.bold, align: obj.align };
    case "shape":
      return { ...base, color: obj.strokeColor, strokeWidth: obj.strokeWidth, fillShape: Boolean(obj.fillColor) };
    case "drawing":
      return { ...base, color: obj.color, strokeWidth: obj.strokeWidth };
    case "annotation":
      return { ...base, color: obj.color };
    default:
      return base;
  }
}

/** The change to make to `obj` when the user edits a panel control while it's selected, or null
 * when that control doesn't apply to this kind of object. Only the fields present in `patch`
 * are touched. */
export function objectPatchFromOptions(obj: EditorObject, patch: Partial<ToolOptions>): Partial<EditorObject> | null {
  const out: Record<string, unknown> = {};
  switch (obj.type) {
    case "added-text":
      if (patch.color) out.color = patch.color;
      if (patch.fontSize !== undefined) out.fontSize = Math.max(4, patch.fontSize);
      if (patch.bold !== undefined) out.bold = patch.bold;
      if (patch.align) out.align = patch.align;
      break;
    case "shape":
      if (patch.color) {
        out.strokeColor = patch.color;
        if (obj.fillColor) out.fillColor = patch.color;
      }
      if (patch.strokeWidth !== undefined) out.strokeWidth = patch.strokeWidth;
      if (patch.fillShape !== undefined) out.fillColor = patch.fillShape ? (patch.color ?? obj.strokeColor) : undefined;
      break;
    case "drawing":
      if (patch.color) out.color = patch.color;
      if (patch.strokeWidth !== undefined) out.strokeWidth = patch.strokeWidth;
      break;
    case "annotation":
      if (patch.color) out.color = patch.color;
      break;
    default:
      return null;
  }
  return Object.keys(out).length > 0 ? (out as Partial<EditorObject>) : null;
}
