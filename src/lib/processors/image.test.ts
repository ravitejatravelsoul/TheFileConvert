import { describe, expect, it } from "vitest";
import { inputFormatOf, targetFormatFor } from "./image";

describe("targetFormatFor", () => {
  it("keeps JPG as JPG and sends transparent images to WebP", () => {
    expect(targetFormatFor("jpeg", false, true)).toBe("jpeg");
    expect(targetFormatFor("png", true, true)).toBe("webp");
    expect(targetFormatFor("webp", true, true)).toBe("webp");
    expect(targetFormatFor("png", false, true)).toBe("webp");
  });

  it("never picks WebP where the browser can't write it", () => {
    expect(targetFormatFor("png", true, false)).toBe("png"); // keeps transparency
    expect(targetFormatFor("png", false, false)).toBe("jpeg");
    expect(targetFormatFor("webp", false, false)).toBe("jpeg");
  });
});

describe("inputFormatOf", () => {
  it("reads the type, falling back to the extension", () => {
    expect(inputFormatOf(new File([], "a.bin", { type: "image/png" }))).toBe("png");
    expect(inputFormatOf(new File([], "photo.JPEG"))).toBe("jpeg");
    expect(inputFormatOf(new File([], "x.webp"))).toBe("webp");
    expect(inputFormatOf(new File([], "x.gif"))).toBeNull();
  });
});
