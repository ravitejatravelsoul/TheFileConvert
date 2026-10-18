/**
 * ToUnicode CMap parsing: character code → Unicode text.
 *
 * Handles `begincodespacerange`, `beginbfchar` and `beginbfrange` (both the incrementing form and the array form),
 * which is everything the PDF producers in the wild write.
 */

export interface ToUnicode {
  /** Code → text (usually one character; ligatures map to several). */
  map: Map<number, string>;
  /** Byte lengths of the code space ranges (1 for a simple font, 2 for Identity-H CID fonts). */
  codeLengths: number[];
}

const hexToBytes = (h: string): number[] => {
  const clean = h.replace(/\s+/g, "");
  const out: number[] = [];
  for (let i = 0; i < clean.length; i += 2) out.push(parseInt(clean.slice(i, i + 2).padEnd(2, "0"), 16));
  return out;
};

const toNumber = (bytes: number[]): number => bytes.reduce((n, b) => n * 256 + b, 0);

/** UTF-16BE bytes → string. */
function utf16(bytes: number[]): string {
  let s = "";
  for (let i = 0; i + 1 < bytes.length; i += 2) s += String.fromCharCode(bytes[i] * 256 + bytes[i + 1]);
  if (bytes.length === 1) s = String.fromCharCode(bytes[0]);
  return s;
}

export function parseToUnicode(source: string): ToUnicode {
  const map = new Map<number, string>();
  const codeLengths = new Set<number>();

  for (const m of source.matchAll(/begincodespacerange([\s\S]*?)endcodespacerange/g)) {
    for (const r of m[1].matchAll(/<([0-9a-fA-F\s]+)>\s*<([0-9a-fA-F\s]+)>/g)) codeLengths.add(hexToBytes(r[1]).length);
  }

  for (const m of source.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const r of m[1].matchAll(/<([0-9a-fA-F\s]+)>\s*<([0-9a-fA-F\s]*)>/g)) {
      map.set(toNumber(hexToBytes(r[1])), utf16(hexToBytes(r[2])));
    }
  }

  for (const m of source.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const body = m[1];
    // <lo> <hi> <dst>   or   <lo> <hi> [<d1> <d2> …]
    const re = /<([0-9a-fA-F\s]+)>\s*<([0-9a-fA-F\s]+)>\s*(\[[^\]]*\]|<[0-9a-fA-F\s]*>)/g;
    for (const r of body.matchAll(re)) {
      const lo = toNumber(hexToBytes(r[1]));
      const hi = toNumber(hexToBytes(r[2]));
      if (hi < lo || hi - lo > 65535) continue;
      const dst = r[3];
      if (dst.startsWith("[")) {
        const items = [...dst.matchAll(/<([0-9a-fA-F\s]*)>/g)].map((x) => utf16(hexToBytes(x[1])));
        for (let c = lo; c <= hi && c - lo < items.length; c++) map.set(c, items[c - lo]);
      } else {
        const base = hexToBytes(dst.slice(1, -1));
        if (base.length < 2) {
          for (let c = lo; c <= hi; c++) map.set(c, String.fromCharCode((base[0] ?? 0) + (c - lo)));
        } else {
          // increment the last UTF-16 unit
          const last = base.length - 2;
          const head = utf16(base.slice(0, last));
          const unit = base[last] * 256 + base[last + 1];
          for (let c = lo; c <= hi; c++) map.set(c, head + String.fromCharCode(unit + (c - lo)));
        }
      }
    }
  }

  return { map, codeLengths: [...codeLengths].sort() };
}
