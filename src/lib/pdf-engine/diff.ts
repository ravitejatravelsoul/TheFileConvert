/**
 * Character diff between a line's old and new text, as a list of hunks (a run of old characters replaced by new text).
 * Uses the longest common subsequence, so editing "recieve" → "receive" is a swap of two letters, not a rewritten line.
 */
export interface Hunk {
  /** Old characters [delStart, delEnd) are replaced by `insert`. A pure insertion has delStart === delEnd. */
  delStart: number;
  delEnd: number;
  insert: string;
}

export function diffChars(oldChars: string[], newChars: string[]): Hunk[] {
  const n = oldChars.length;
  const m = newChars.length;
  // trim the common prefix and suffix first (the usual case is one small edit in a long line)
  let pre = 0;
  while (pre < n && pre < m && oldChars[pre] === newChars[pre]) pre++;
  let suf = 0;
  while (suf < n - pre && suf < m - pre && oldChars[n - 1 - suf] === newChars[m - 1 - suf]) suf++;
  const a = oldChars.slice(pre, n - suf);
  const b = newChars.slice(pre, m - suf);
  if (a.length === 0 && b.length === 0) return [];
  if (a.length === 0 || b.length === 0 || a.length * b.length > 4_000_000) return [{ delStart: pre, delEnd: pre + a.length, insert: b.join("") }];

  // LCS table
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = new Uint16Array(rows * cols);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i * cols + j] = a[i] === b[j] ? dp[(i + 1) * cols + j + 1] + 1 : Math.max(dp[(i + 1) * cols + j], dp[i * cols + j + 1]);
    }
  }
  const hunks: Hunk[] = [];
  let i = 0;
  let j = 0;
  let cur: Hunk | null = null;
  const flush = () => {
    if (cur) hunks.push(cur);
    cur = null;
  };
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      flush();
      i++;
      j++;
    } else if (j < b.length && (i === a.length || dp[i * cols + j + 1] >= dp[(i + 1) * cols + j])) {
      if (!cur) cur = { delStart: pre + i, delEnd: pre + i, insert: "" };
      cur.insert += b[j++];
    } else {
      if (!cur) cur = { delStart: pre + i, delEnd: pre + i, insert: "" };
      cur.delEnd = pre + ++i;
    }
  }
  flush();
  return hunks;
}

/** Applies hunks to the old characters (for tests and sanity checks). */
export function applyHunks(oldChars: string[], hunks: Hunk[]): string {
  let out = "";
  let pos = 0;
  for (const h of hunks) {
    out += oldChars.slice(pos, h.delStart).join("") + h.insert;
    pos = h.delEnd;
  }
  return out + oldChars.slice(pos).join("");
}
