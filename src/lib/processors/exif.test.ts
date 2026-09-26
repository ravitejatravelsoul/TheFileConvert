import { describe, expect, it } from "vitest";
import { jpegOrientation } from "./exif";

/** A minimal JPEG: SOI, APP1 EXIF with one IFD entry (Orientation), then SOS. */
function jpegWithOrientation(value: number, littleEndian: boolean): Uint8Array {
  const tiff = littleEndian
    ? [0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, value, 0x00, 0x00, 0x00, 0x00, 0x00, 0, 0, 0, 0]
    : [0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, value, 0x00, 0x00, 0x00, 0x00, 0, 0, 0, 0];
  const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, ...tiff];
  const len = payload.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 0xff, ...payload, 0xff, 0xda, 0x00, 0x02]);
}

describe("jpegOrientation", () => {
  it("reads little- and big-endian orientation tags", () => {
    expect(jpegOrientation(jpegWithOrientation(6, true))).toBe(6);
    expect(jpegOrientation(jpegWithOrientation(8, false))).toBe(8);
    expect(jpegOrientation(jpegWithOrientation(3, true))).toBe(3);
  });

  it("returns 1 for non-JPEG data, JPEGs without EXIF, and truncated files", () => {
    expect(jpegOrientation(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe(1);
    expect(jpegOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]))).toBe(1);
    expect(jpegOrientation(jpegWithOrientation(6, true).slice(0, 20))).toBe(1);
  });

  it("ignores out-of-range values", () => {
    expect(jpegOrientation(jpegWithOrientation(42, true))).toBe(1);
  });
});
