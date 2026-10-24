import { describe, expect, it } from "vitest";
import { DEFAULT_TOOL_OPTIONS, objectPatchFromOptions, optionsFromObject, PRESET_COLORS } from "./toolOptions";
import type { AddedTextObject, ShapeObjectData, WhiteoutObjectData } from "@/lib/editor/types";

const red = PRESET_COLORS[1].value;
const text: AddedTextObject = {
  id: "t", pageId: "p", x: 0, y: 0, width: 100, height: 20, type: "added-text",
  text: "hi", fontSize: 18, color: { r: 0, g: 0, b: 0 }, align: "center", bold: true,
};
const rect: ShapeObjectData = {
  id: "s", pageId: "p", x: 0, y: 0, width: 10, height: 10, type: "shape", shape: "rectangle",
  strokeColor: { r: 0, g: 0, b: 1 }, strokeWidth: 3,
};

describe("optionsFromObject", () => {
  it("shows the selected text object's own values in the panel", () => {
    const o = optionsFromObject(text, DEFAULT_TOOL_OPTIONS);
    expect(o.fontSize).toBe(18);
    expect(o.bold).toBe(true);
    expect(o.align).toBe("center");
  });
  it("shows a shape's stroke color and fill state", () => {
    expect(optionsFromObject(rect, DEFAULT_TOOL_OPTIONS).strokeWidth).toBe(3);
    expect(optionsFromObject(rect, DEFAULT_TOOL_OPTIONS).fillShape).toBe(false);
  });
});

describe("objectPatchFromOptions", () => {
  it("applies color and font size to selected text", () => {
    expect(objectPatchFromOptions(text, { color: red })).toEqual({ color: red });
    expect(objectPatchFromOptions(text, { fontSize: 30 })).toEqual({ fontSize: 30 });
  });
  it("clamps an absurdly small font size", () => {
    expect(objectPatchFromOptions(text, { fontSize: 0 })).toEqual({ fontSize: 4 });
  });
  it("maps color to a shape's stroke, and fill toggles the fill color", () => {
    expect(objectPatchFromOptions(rect, { color: red })).toEqual({ strokeColor: red });
    expect(objectPatchFromOptions(rect, { fillShape: true })).toEqual({ fillColor: rect.strokeColor });
    expect(objectPatchFromOptions({ ...rect, fillColor: red }, { fillShape: false })).toEqual({ fillColor: undefined });
  });
  it("returns null for a control that doesn't apply to the object", () => {
    expect(objectPatchFromOptions(text, { strokeWidth: 5 })).toBeNull();
    const w: WhiteoutObjectData = { id: "w", pageId: "p", x: 0, y: 0, width: 1, height: 1, type: "whiteout" };
    expect(objectPatchFromOptions(w, { color: red })).toBeNull();
  });
});
