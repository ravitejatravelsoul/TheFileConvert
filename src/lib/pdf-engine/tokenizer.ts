/**
 * PDF content-stream tokenizer.
 *
 * Turns the bytes of a content stream into operations (`operands… operator`) that remember the byte span they came from,
 * so an edit can be a *patch* of those bytes and every other operator stays byte-identical.
 */

export type Obj =
  | { t: "num"; v: number }
  | { t: "name"; v: string }
  | { t: "str"; v: Uint8Array; hex: boolean }
  | { t: "arr"; v: Obj[] }
  | { t: "dict"; v: Record<string, Obj> }
  | { t: "bool"; v: boolean }
  | { t: "null" };

export interface Op {
  op: string;
  args: Obj[];
  /** Byte span of the whole operation: first operand (or the operator) to the end of the operator. */
  start: number;
  end: number;
  /** Where the operator keyword itself starts (after its operands). */
  opStart: number;
  /** For `BI … ID … EI`: the image dictionary and the span of its data. */
  inline?: { dict: Record<string, Obj>; dataStart: number; dataEnd: number };
}

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]); // ( ) < > [ ] { } / %

const isWs = (c: number) => WS.has(c);
const isRegular = (c: number) => !WS.has(c) && !DELIM.has(c);
const isDigit = (c: number) => c >= 48 && c <= 57;

class Reader {
  pos = 0;
  constructor(readonly b: Uint8Array) {}

  skipWs() {
    for (;;) {
      const c = this.b[this.pos];
      if (c === undefined) return;
      if (isWs(c)) this.pos++;
      else if (c === 37) {
        while (this.pos < this.b.length && this.b[this.pos] !== 10 && this.b[this.pos] !== 13) this.pos++;
      } else return;
    }
  }

  eof() {
    return this.pos >= this.b.length;
  }

  readName(): string {
    this.pos++; // '/'
    let s = "";
    while (this.pos < this.b.length && isRegular(this.b[this.pos])) {
      const c = this.b[this.pos];
      if (c === 35 && this.pos + 2 < this.b.length) {
        const h = parseInt(String.fromCharCode(this.b[this.pos + 1], this.b[this.pos + 2]), 16);
        if (!Number.isNaN(h)) {
          s += String.fromCharCode(h);
          this.pos += 3;
          continue;
        }
      }
      s += String.fromCharCode(c);
      this.pos++;
    }
    return s;
  }

  readLiteralString(): Uint8Array {
    this.pos++; // '('
    const out: number[] = [];
    let depth = 1;
    while (this.pos < this.b.length) {
      let c = this.b[this.pos++];
      if (c === 92) {
        c = this.b[this.pos++];
        if (c === undefined) break;
        if (c === 110) out.push(10);
        else if (c === 114) out.push(13);
        else if (c === 116) out.push(9);
        else if (c === 98) out.push(8);
        else if (c === 102) out.push(12);
        else if (c >= 48 && c <= 55) {
          let v = c - 48;
          for (let k = 0; k < 2; k++) {
            const d = this.b[this.pos];
            if (d >= 48 && d <= 55) {
              v = v * 8 + (d - 48);
              this.pos++;
            } else break;
          }
          out.push(v & 255);
        } else if (c === 13) {
          if (this.b[this.pos] === 10) this.pos++; // line continuation
        } else if (c === 10) {
          // line continuation
        } else out.push(c); // \( \) \\ and unknown escapes
      } else if (c === 40) {
        depth++;
        out.push(c);
      } else if (c === 41) {
        if (--depth === 0) break;
        out.push(c);
      } else out.push(c);
    }
    return Uint8Array.from(out);
  }

  readHexString(): Uint8Array {
    this.pos++; // '<'
    const digits: number[] = [];
    while (this.pos < this.b.length && this.b[this.pos] !== 62) {
      const c = this.b[this.pos++];
      const v = isDigit(c) ? c - 48 : c >= 65 && c <= 70 ? c - 55 : c >= 97 && c <= 102 ? c - 87 : -1;
      if (v >= 0) digits.push(v);
    }
    this.pos++; // '>'
    if (digits.length % 2) digits.push(0);
    const out = new Uint8Array(digits.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = digits[2 * i] * 16 + digits[2 * i + 1];
    return out;
  }

  /** A number, or undefined (and the position unchanged) when the bytes aren't one. */
  tryNumber(): number | undefined {
    const start = this.pos;
    let p = start;
    let sign = 1;
    while (this.b[p] === 43 || this.b[p] === 45) {
      if (this.b[p] === 45) sign = -1;
      p++;
    }
    let digits = 0;
    let v = 0;
    while (isDigit(this.b[p])) {
      v = v * 10 + (this.b[p] - 48);
      p++;
      digits++;
    }
    if (this.b[p] === 46) {
      p++;
      let f = 0.1;
      while (isDigit(this.b[p])) {
        v += (this.b[p] - 48) * f;
        f /= 10;
        p++;
        digits++;
      }
    }
    if (digits === 0) return undefined;
    // "1.2.3" and friends: a lenient reader takes the first number and skips the rest of the token.
    while (p < this.b.length && isRegular(this.b[p])) {
      if (!isDigit(this.b[p]) && this.b[p] !== 46 && this.b[p] !== 45) return undefined; // not a number at all ("1abc")
      p++;
    }
    this.pos = p;
    return sign * v;
  }

  readKeyword(): string {
    let s = "";
    while (this.pos < this.b.length && isRegular(this.b[this.pos])) s += String.fromCharCode(this.b[this.pos++]);
    return s;
  }

  readObject(): Obj | { kw: string } | null {
    this.skipWs();
    if (this.eof()) return null;
    const c = this.b[this.pos];
    if (c === 47) return { t: "name", v: this.readName() };
    if (c === 40) return { t: "str", v: this.readLiteralString(), hex: false };
    if (c === 60) {
      if (this.b[this.pos + 1] === 60) {
        this.pos += 2;
        return this.readDictBody();
      }
      return { t: "str", v: this.readHexString(), hex: true };
    }
    if (c === 91) {
      this.pos++;
      const arr: Obj[] = [];
      for (;;) {
        this.skipWs();
        if (this.eof()) break;
        if (this.b[this.pos] === 93) {
          this.pos++;
          break;
        }
        const o = this.readObject();
        if (o === null) break;
        if ("kw" in o) {
          if (o.kw === "") this.pos++; // an unexpected delimiter inside an array: skip it
          continue;
        }
        arr.push(o);
      }
      return { t: "arr", v: arr };
    }
    if (c === 93 || c === 62 || c === 41 || c === 123 || c === 125) {
      this.pos++; // a stray delimiter: ignore
      return { kw: "" };
    }
    const n = this.tryNumber();
    if (n !== undefined) return { t: "num", v: n };
    const kw = this.readKeyword();
    if (kw === "true") return { t: "bool", v: true };
    if (kw === "false") return { t: "bool", v: false };
    if (kw === "null") return { t: "null" };
    return { kw };
  }

  readDictBody(): Obj {
    const v: Record<string, Obj> = {};
    for (;;) {
      this.skipWs();
      if (this.eof()) break;
      if (this.b[this.pos] === 62 && this.b[this.pos + 1] === 62) {
        this.pos += 2;
        break;
      }
      const k = this.readObject();
      if (!k || "kw" in k || k.t !== "name") {
        if (k && "kw" in k && k.kw === "") continue;
        break;
      }
      const val = this.readObject();
      if (!val || "kw" in val) break;
      v[k.v] = val;
    }
    return { t: "dict", v };
  }
}

/** Does the data after `EI` look like content (text) rather than more binary image data? */
function looksLikeContent(b: Uint8Array, at: number): boolean {
  for (let i = at; i < Math.min(b.length, at + 12); i++) {
    const c = b[i];
    if (c > 127 || (c < 32 && !isWs(c))) return false;
  }
  return true;
}

const num = (o: Obj | undefined): number | undefined => (o && o.t === "num" ? o.v : undefined);

/** Parses a whole content stream. Never throws: unreadable trailing bytes end the list. */
export function parseContent(bytes: Uint8Array): Op[] {
  const r = new Reader(bytes);
  const ops: Op[] = [];
  let args: Obj[] = [];
  let argStart = -1;
  while (!r.eof()) {
    r.skipWs();
    if (r.eof()) break;
    const before = r.pos;
    const o = r.readObject();
    if (o === null) break;
    if (r.pos === before) r.pos++; // guarantee progress
    if (!("kw" in o)) {
      if (args.length === 0) argStart = before;
      args.push(o);
      continue;
    }
    if (o.kw === "") continue;
    const opStart = before;
    let end = r.pos;
    const op: Op = { op: o.kw, args, start: args.length ? argStart : opStart, end, opStart };
    if (o.kw === "BI") {
      // BI <key value>* ID <data> EI
      const dict: Record<string, Obj> = {};
      for (;;) {
        r.skipWs();
        const k = r.readObject();
        if (!k || ("kw" in k && k.kw === "ID")) break;
        if ("kw" in k || k.t !== "name") continue;
        const v = r.readObject();
        if (!v || "kw" in v) break;
        dict[k.v] = v;
      }
      r.pos++; // the single whitespace byte after ID
      const dataStart = r.pos;
      const L = num(dict.L) ?? num(dict.Length);
      let dataEnd = -1;
      if (L !== undefined && dataStart + L <= bytes.length) {
        // trust /L only if an EI follows
        let q = dataStart + L;
        while (q < bytes.length && isWs(bytes[q])) q++;
        if (bytes[q] === 69 && bytes[q + 1] === 73) {
          dataEnd = dataStart + L;
          r.pos = q + 2;
        }
      }
      if (dataEnd < 0) {
        let q = dataStart;
        for (; q < bytes.length - 1; q++) {
          if (bytes[q] === 69 && bytes[q + 1] === 73 && (q === dataStart || isWs(bytes[q - 1])) && (q + 2 >= bytes.length || isWs(bytes[q + 2]) || DELIM.has(bytes[q + 2])) && looksLikeContent(bytes, q + 2)) break;
        }
        dataEnd = q;
        r.pos = Math.min(bytes.length, q + 2);
      }
      op.inline = { dict, dataStart, dataEnd };
      end = r.pos;
      op.end = end;
    }
    ops.push(op);
    args = [];
    argStart = -1;
  }
  return ops;
}

// ---------------------------------------------------------------------------------------------- writing

const enc = new TextEncoder();
const dec = new TextDecoder("latin1");

export function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const s = (Math.round(n * 1e5) / 1e5).toString();
  if (s.includes("e")) return n.toFixed(5).replace(/\.?0+$/, "");
  return s === "-0" ? "0" : s;
}

export function hexString(bytes: Uint8Array): string {
  let s = "<";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s + ">";
}

export function serName(name: string): string {
  let s = "/";
  for (const ch of name) {
    const c = ch.charCodeAt(0);
    s += c < 33 || c > 126 || DELIM.has(c) || c === 35 ? "#" + c.toString(16).padStart(2, "0") : ch;
  }
  return s;
}

export function serObj(o: Obj): string {
  switch (o.t) {
    case "num":
      return fmtNum(o.v);
    case "name":
      return serName(o.v);
    case "str":
      return hexString(o.v);
    case "arr":
      return "[" + o.v.map(serObj).join(" ") + "]";
    case "dict":
      return "<<" + Object.entries(o.v).map(([k, v]) => serName(k) + " " + serObj(v)).join(" ") + ">>";
    case "bool":
      return o.v ? "true" : "false";
    case "null":
      return "null";
  }
}

export const toBytes = (s: string): Uint8Array => enc.encode(s);
export const toLatin1 = (b: Uint8Array): string => dec.decode(b);

/** A set of non-overlapping byte patches applied to the original stream. */
export interface Patch {
  start: number;
  end: number;
  text: string | Uint8Array;
}

export function applyPatches(bytes: Uint8Array, patches: Patch[]): Uint8Array {
  const sorted = [...patches].sort((a, b) => a.start - b.start || a.end - b.end);
  const parts: Uint8Array[] = [];
  let pos = 0;
  for (const p of sorted) {
    if (p.start < pos) throw new Error(`Overlapping patches at ${p.start}`);
    parts.push(bytes.subarray(pos, p.start));
    parts.push(typeof p.text === "string" ? toBytes(p.text) : p.text);
    pos = p.end;
  }
  parts.push(bytes.subarray(pos));
  const out = new Uint8Array(parts.reduce((n, q) => n + q.length, 0));
  let o = 0;
  for (const q of parts) {
    out.set(q, o);
    o += q.length;
  }
  return out;
}
