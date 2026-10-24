/**
 * Edits a content stream as a list of operations while keeping every untouched operation byte-for-byte.
 *
 * Each original operation can be replaced (or deleted), and text can be inserted before/after it. `build()` returns the new
 * bytes plus, for every original operation, the index it has in the new stream — which is how the engine finds "the same
 * glyph" again after an edit, to check that nothing else moved.
 */
import { parseContent, toBytes, type Op } from "./tokenizer";

interface Piece {
  /** The original operation this piece stands for (the original bytes unless `text` is set). */
  orig: number | null;
  text: string | null;
}

export class StreamEditor {
  readonly ops: Op[];
  private readonly before: string[][];
  private readonly after: string[][];
  private readonly replaced: (string | null)[];

  constructor(readonly bytes: Uint8Array, ops?: Op[]) {
    this.ops = ops ?? parseContent(bytes);
    this.before = this.ops.map(() => []);
    this.after = this.ops.map(() => []);
    this.replaced = this.ops.map(() => null);
  }

  /** Replace the whole operation (operands and operator). "" removes it. */
  replace(opIndex: number, text: string) {
    this.replaced[opIndex] = text;
  }

  delete(opIndex: number) {
    this.replaced[opIndex] = "";
  }

  insertBefore(opIndex: number, text: string) {
    this.before[opIndex].push(text);
  }

  insertAfter(opIndex: number, text: string) {
    this.after[opIndex].push(text);
  }

  isReplaced(opIndex: number): boolean {
    return this.replaced[opIndex] !== null;
  }

  /** Everything queued as text for an operation (used when stacking corrections on an operation already rewritten). */
  hasEdits(opIndex: number): boolean {
    return this.replaced[opIndex] !== null || this.before[opIndex].length > 0 || this.after[opIndex].length > 0;
  }

  build(): { bytes: Uint8Array; newIndex: number[]; inserted: number[] } {
    const out: string[] = [];
    const parts: Uint8Array[] = [];
    void out;
    const newIndex: number[] = new Array(this.ops.length).fill(-1);
    const inserted: number[] = [];
    let count = 0;
    let pos = 0;
    const push = (b: Uint8Array) => parts.push(b);
    const pieceOps = (text: string) => parseContent(toBytes(text)).length;
    const nl = toBytes("\n");
    for (let i = 0; i < this.ops.length; i++) {
      const op = this.ops[i];
      push(this.bytes.subarray(pos, op.start)); // whitespace / comments between operations
      for (const t of this.before[i]) {
        const n = pieceOps(t);
        for (let k = 0; k < n; k++) inserted.push(count + k);
        count += n;
        push(toBytes(t));
        push(nl);
      }
      if (this.replaced[i] === null) {
        newIndex[i] = count;
        count += 1;
        push(this.bytes.subarray(op.start, op.end));
      } else if (this.replaced[i] !== "") {
        const t = this.replaced[i] as string;
        const n = pieceOps(t);
        newIndex[i] = n ? count : -1;
        count += n;
        push(toBytes(t));
      }
      for (const t of this.after[i]) {
        push(nl);
        const n = pieceOps(t);
        for (let k = 0; k < n; k++) inserted.push(count + k);
        count += n;
        push(toBytes(t));
      }
      pos = op.end;
    }
    push(this.bytes.subarray(pos));
    const total = parts.reduce((n, p) => n + p.length, 0);
    const bytes = new Uint8Array(total);
    let o = 0;
    for (const p of parts) {
      bytes.set(p, o);
      o += p.length;
    }
    return { bytes, newIndex, inserted };
  }
}

export type { Piece };
