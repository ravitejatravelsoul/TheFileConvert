/**
 * Is this image file complete? Browsers decode a JPEG that was cut off halfway as a picture whose lower
 * part is grey — no error — and pdf-lib embeds JPEG/PNG bytes without decoding them at all. So a damaged
 * upload could silently become a damaged output. This checks the structure that a complete file must have.
 */
export function isCompleteImage(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpegComplete(bytes);
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return pngComplete(bytes);
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    const declared = (bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24)) >>> 0;
    return declared + 8 <= bytes.length;
  }
  return true; // other formats (SVG, …) are checked by their own decoders
}

function ascii(b: Uint8Array, at: number, n: number): string {
  let s = "";
  for (let i = 0; i < n && at + i < b.length; i++) s += String.fromCharCode(b[at + i]);
  return s;
}

/** Walks the marker segments to the main image's start-of-scan, then requires an end-of-image marker
 * after it. (Scan data can't contain FF D9: 0xFF bytes in it are stuffed with 00. Data *after* the end
 * marker — phone "motion photos" append a video there — is fine.) */
function jpegComplete(b: Uint8Array): boolean {
  let at = 2;
  while (at + 4 <= b.length) {
    if (b[at] !== 0xff) return false;
    const marker = b[at + 1];
    if (marker === 0xff) {
      at++; // fill byte
      continue;
    }
    if (marker === 0xda) break; // start of scan
    if (marker === 0xd9) return false; // end before any image data
    const length = (b[at + 2] << 8) | b[at + 3];
    if (length < 2) return false;
    at += 2 + length;
  }
  if (at + 4 > b.length) return false;
  for (let i = at + 2; i + 1 < b.length; i++) if (b[i] === 0xff && b[i + 1] === 0xd9) return true;
  return false;
}

function pngComplete(b: Uint8Array): boolean {
  // IEND is the last chunk; search backwards so trailing junk after it doesn't matter.
  for (let i = b.length - 8; i >= 8; i--) if (b[i] === 0x49 && b[i + 1] === 0x45 && b[i + 2] === 0x4e && b[i + 3] === 0x44) return true;
  return false;
}
