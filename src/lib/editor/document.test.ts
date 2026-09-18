import { describe, expect, it } from "vitest";
import { setPageCropBox, setCropBoxForAllPages } from "./document";
import type { EditorDocument, EditorPage } from "./types";

function makePage(id: string, mediaBox: [number, number, number, number]): EditorPage {
  return { id, sourceFileId: "f1", sourcePageIndex: 0, baseRotation: 0, rotationDelta: 0, mediaBox };
}

function makeDoc(pages: EditorPage[]): EditorDocument {
  return { sourceFiles: {}, pages, objects: [], formFields: [] };
}

describe("setPageCropBox", () => {
  it("sets a crop box only on the targeted page", () => {
    const doc = makeDoc([makePage("p1", [0, 0, 612, 792]), makePage("p2", [0, 0, 612, 792])]);
    const next = setPageCropBox(doc, "p1", [10, 10, 200, 300]);
    expect(next.pages[0].cropBox).toEqual([10, 10, 200, 300]);
    expect(next.pages[1].cropBox).toBeUndefined();
  });

  it("clears a crop box when passed null", () => {
    const doc = makeDoc([makePage("p1", [0, 0, 612, 792])]);
    const cropped = setPageCropBox(doc, "p1", [10, 10, 200, 300]);
    const cleared = setPageCropBox(cropped, "p1", null);
    expect(cleared.pages[0].cropBox).toBeUndefined();
  });

  it("does not mutate the original document", () => {
    const doc = makeDoc([makePage("p1", [0, 0, 612, 792])]);
    setPageCropBox(doc, "p1", [10, 10, 200, 300]);
    expect(doc.pages[0].cropBox).toBeUndefined();
  });

  it("is a no-op for an unknown page id", () => {
    const doc = makeDoc([makePage("p1", [0, 0, 612, 792])]);
    const next = setPageCropBox(doc, "does-not-exist", [10, 10, 200, 300]);
    expect(next.pages[0].cropBox).toBeUndefined();
  });
});

describe("setCropBoxForAllPages", () => {
  it("applies the same crop box to every page that it fits inside", () => {
    const doc = makeDoc([makePage("p1", [0, 0, 612, 792]), makePage("p2", [0, 0, 612, 792])]);
    const next = setCropBoxForAllPages(doc, [10, 10, 200, 300]);
    expect(next.pages[0].cropBox).toEqual([10, 10, 200, 300]);
    expect(next.pages[1].cropBox).toEqual([10, 10, 200, 300]);
  });

  it("skips a page the crop box doesn't fit inside (different/smaller page size)", () => {
    const doc = makeDoc([makePage("p1", [0, 0, 612, 792]), makePage("p2", [0, 0, 100, 100])]);
    const next = setCropBoxForAllPages(doc, [10, 10, 200, 300]);
    expect(next.pages[0].cropBox).toEqual([10, 10, 200, 300]);
    expect(next.pages[1].cropBox).toBeUndefined();
  });
});
