/**
 * Reads the EXIF Orientation tag (1–8) from JPEG bytes, or 1 if there is none. Phone photos are
 * often stored sideways with this flag saying how to turn them; embedding the raw JPEG in a PDF
 * ignores the flag, so such photos have to be re-drawn upright first.
 */
export function jpegOrientation(bytes: Uint8Array): number {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return 1;
    const marker = bytes[offset + 1];
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (marker === 0xda || marker === 0xd9) return 1; // image data starts: no EXIF before it
    if (marker === 0xe1 && offset + 10 <= bytes.length) {
      const start = offset + 4;
      const isExif = bytes[start] === 0x45 && bytes[start + 1] === 0x78 && bytes[start + 2] === 0x69 && bytes[start + 3] === 0x66;
      if (isExif) return readTiffOrientation(bytes, start + 6, Math.min(bytes.length, offset + 2 + length));
    }
    offset += 2 + length;
  }
  return 1;
}

function readTiffOrientation(b: Uint8Array, tiff: number, end: number): number {
  if (tiff + 8 > end) return 1;
  const little = b[tiff] === 0x49 && b[tiff + 1] === 0x49;
  const u16 = (at: number) => (little ? b[at] | (b[at + 1] << 8) : (b[at] << 8) | b[at + 1]);
  const u32 = (at: number) => (little ? (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0 : ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0);
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > end) return 1;
  const entries = u16(ifd);
  for (let i = 0; i < entries; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) return 1;
    if (u16(entry) === 0x0112) {
      const value = u16(entry + 8);
      return value >= 1 && value <= 8 ? value : 1;
    }
  }
  return 1;
}
