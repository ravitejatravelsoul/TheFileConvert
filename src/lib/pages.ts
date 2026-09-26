/**
 * Page-list helpers for the page pickers. Pages are 0-based internally and 1-based in anything the
 * user reads or types.
 */

/** "1-3, 7, 9-10" for [0,1,2,6,8,9]. */
export function describePages(sortedZeroBased: number[]): string {
  const parts: string[] = [];
  let i = 0;
  while (i < sortedZeroBased.length) {
    let j = i;
    while (j + 1 < sortedZeroBased.length && sortedZeroBased[j + 1] === sortedZeroBased[j] + 1) j++;
    const a = sortedZeroBased[i] + 1;
    const b = sortedZeroBased[j] + 1;
    parts.push(a === b ? String(a) : `${a}-${b}`);
    i = j + 1;
  }
  return parts.join(", ");
}

/** Parses "1-3, 7" against a page count. Pages outside the document are an error, not ignored. */
export function parsePageList(input: string, pageCount: number): { pages: number[] } | { error: string } {
  const cleaned = input.trim();
  if (!cleaned) return { error: "Type at least one page, like 2 or 1-3." };
  const pages = new Set<number>();
  for (const raw of cleaned.split(/[,;]+/)) {
    const part = raw.trim();
    if (!part) continue;
    const range = part.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    const single = part.match(/^\d+$/);
    if (!range && !single) return { error: `“${part}” isn't a page number or range.` };
    let [a, b] = range ? [Number(range[1]), Number(range[2])] : [Number(part), Number(part)];
    if (a > b) [a, b] = [b, a];
    if (a < 1 || b > pageCount) return { error: `This PDF has pages 1 to ${pageCount}.` };
    for (let p = a; p <= b; p++) pages.add(p - 1);
  }
  if (pages.size === 0) return { error: "Type at least one page, like 2 or 1-3." };
  return { pages: [...pages].sort((x, y) => x - y) };
}
