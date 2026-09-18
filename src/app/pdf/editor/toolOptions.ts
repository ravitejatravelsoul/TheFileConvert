import type { RgbColor } from "@/lib/editor/types";

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
