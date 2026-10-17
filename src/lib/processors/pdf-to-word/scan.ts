/**
 * Layout analysis of a scanned page, from its pixels. OCR only reads words; a scanned form's structure —
 * rules, underlines, boxes, table grids, shaded panels, bold labels — is in the image, and is found here.
 *
 * Pure: works on a greyscale/RGBA raster and returns pixel-space results, so it is unit-tested without a
 * browser. `extract.ts` runs it on the page as rendered for OCR, maps the results to PDF space, and erases
 * the rules from the image before recognition (OCR reads a table's grid lines as characters otherwise).
 */

export interface Raster {
  /** RGBA, row-major, as from a canvas. */
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** An axis-aligned line in pixels: horizontal when y0 === y1 (x0 < x1), vertical when x0 === x1. */
export interface PxRule {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Stroke thickness in pixels (rows/columns that pass the ink threshold). */
  thickness: number;
  /**
   * Visual weight in pixels: the stroke's ink mass across its profile divided by its colour's contrast, so a
   * blurred 1 pt grey line is rebuilt as a 1 pt line of that grey, not a hairline.
   */
  weight: number;
  /** "rrggbb" */
  color: string;
}

export interface PxBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PxFill extends PxBox {
  color: string;
}

/** A solid dark band (a table's header row, a section heading bar) whose text is light on dark. */
export interface PxBar extends PxBox {
  /** The band's colour, "rrggbb". */
  color: string;
  /** Its text's colour, "rrggbb". */
  text: string;
}

export interface ScanAnalysis {
  /** Page background, luminance 0–255 and "rrggbb". */
  background: number;
  backgroundColor: string;
  rules: PxRule[];
  /** Tinted panels and cells enclosed by rules. */
  fills: PxFill[];
  /** Solid dark bands with light text (also in `fills`, as shading). */
  bars: PxBar[];
  /** Check boxes: the square, and whether something is marked inside. */
  checkboxes: PxCheckbox[];
}

export interface PxCheckbox extends PxBox {
  checked: boolean;
  /** Everything the box's ink covers (a tick may reach outside the square). */
  ink: PxBox;
}

const hex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");

export function luminance(r: Raster): Uint8Array {
  const out = new Uint8Array(r.width * r.height);
  for (let i = 0, p = 0; p < out.length; i += 4, p++) out[p] = (r.data[i] * 299 + r.data[i + 1] * 587 + r.data[i + 2] * 114) / 1000;
  return out;
}

/** The page's own background level: the most common bright luminance (scans are off-white or tinted). */
export function backgroundLevel(lum: Uint8Array): number {
  const hist = new Uint32Array(256);
  for (let i = 0; i < lum.length; i += 3) hist[lum[i]]++;
  let best = 255;
  let bestN = -1;
  for (let v = 96; v < 256; v++) if (hist[v] > bestN) [best, bestN] = [v, hist[v]];
  return best;
}

/** Ink: clearly darker than the background (text, rules, stamps). */
export function inkThreshold(background: number): number {
  return Math.max(40, background - 70);
}

/**
 * Long thin lines. A horizontal rule is a run of ink at least `minLen` long (gaps of up to 3 px from scan
 * noise are bridged) that is at most `maxThick` rows thick and stands alone: the rows just above and below
 * it are mostly clear along its length. Text never produces such a run — its strokes break between letters
 * and have ink right above and below.
 */
export function detectRules(r: Raster, lum: Uint8Array, background: number, opts: { minH: number; minV: number; maxThick: number }): PxRule[] {
  // Lines may be light grey (table grids are often drawn at 25–40 % grey), lighter than text ink: a rule
  // only needs to be clearly off the paper — its length, thinness and standing alone keep text out.
  // Collected at a permissive level (paper noise stays well clear of it) and kept only when the whole
  // stroke is clearly darker than the paper (below).
  const t = Math.max(40, background - 20);
  const W = r.width;
  const H = r.height;
  // Along a faint line, scan noise lifts single pixels over the threshold and breaks it into pieces:
  // each pixel is judged with its two neighbours along the direction being scanned.
  const along = (x: number, y: number, horizontal: boolean) => {
    const p = y * W + x;
    if (horizontal) return (lum[p] + lum[x > 0 ? p - 1 : p] + lum[x < W - 1 ? p + 1 : p]) / 3;
    return (lum[p] + lum[y > 0 ? p - W : p] + lum[y < H - 1 ? p + W : p]) / 3;
  };
  const found: PxRule[] = [];

  const scan = (horizontal: boolean) => {
    const outer = horizontal ? H : W;
    const inner = horizontal ? W : H;
    const minLen = horizontal ? opts.minH : opts.minV;
    const at = (o: number, i: number) => (horizontal ? along(i, o, true) : along(o, i, false)) < t;
    // Runs per line.
    const runs: { o: number; a: number; b: number }[] = [];
    for (let o = 0; o < outer; o++) {
      let start = -1;
      let gap = 0;
      for (let i = 0; i <= inner; i++) {
        const on = i < inner && at(o, i);
        if (on) {
          if (start < 0) start = i;
          gap = 0;
        } else if (start >= 0) {
          gap++;
          if (gap > 3 || i === inner) {
            const end = i - gap + 1;
            if (end - start >= minLen) runs.push({ o, a: start, b: end });
            start = -1;
            gap = 0;
          }
        }
      }
    }
    // Stack runs on neighbouring lines into one rule with a thickness.
    runs.sort((p, q) => p.o - q.o || p.a - q.a);
    const used = new Array(runs.length).fill(false);
    for (let k = 0; k < runs.length; k++) {
      if (used[k]) continue;
      used[k] = true;
      const { o } = runs[k];
      let { a, b } = runs[k];
      const first = o;
      let last = o;
      for (let m = k + 1; m < runs.length && runs[m].o <= last + 1; m++) {
        if (used[m] || runs[m].o !== last + 1) continue;
        const ov = Math.min(b, runs[m].b) - Math.max(a, runs[m].a);
        // Same extent, not just overlapping: a line through a solid bar must not merge with the bar's short
        // runs beside it (which would make it as thick as the bar).
        if (ov > 0.6 * Math.max(b - a, runs[m].b - runs[m].a)) {
          used[m] = true;
          last = runs[m].o;
          a = Math.min(a, runs[m].a);
          b = Math.max(b, runs[m].b);
        }
      }
      // The stroke is the stack's dark core: rows darker than halfway between its darkest row and the paper.
      // (A line bordering a tinted cell or band stacks with the tint's rows at the permissive level.)
      const rowMean = (o: number) => {
        let sum = 0;
        let cnt = 0;
        for (let i = a; i < b; i += 2) {
          sum += horizontal ? along(i, o, true) : along(o, i, false);
          cnt++;
        }
        return sum / Math.max(1, cnt);
      };
      // A stack can hold several lines (rows of a table running through tinted cells): each dark core counts.
      const means: number[] = [];
      for (let o = first; o <= last; o++) means.push(rowMean(o));
      const darkLum = Math.min(...means);
      const mid = (darkLum + background) / 2;
      const cores: [number, number][] = [];
      for (let o = first; o <= last; o++) {
        if (means[o - first] > mid) continue;
        const prev = cores[cores.length - 1];
        if (prev && prev[1] === o - 1) prev[1] = o;
        else cores.push([o, o]);
      }
      for (const [c0, c1] of cores) {
        const thick = c1 - c0 + 1;
        if (thick > opts.maxThick) continue;
        // Stands alone: just outside the stroke, most of its length is clearly lighter than the stroke.
        const clear = (line: number) => {
          if (line < 0 || line >= outer) return 1;
          let c = 0;
          for (let i = a; i < b; i++) if ((horizontal ? along(i, line, true) : along(line, i, false)) > mid) c++;
          return c / Math.max(1, b - a);
        };
        if (clear(c0 - 2) < 0.6 || clear(c1 + 2) < 0.6) continue;
        // Per position along the stroke, its darkest pixel across the thickness (scans blur the edges), then
        // the mean of the darkest third of those.
        const samples: number[] = [];
        const masses: number[] = [];
        for (let i = a; i < b; i += 2) {
          let best = -1;
          let mass = 0;
          for (let o = Math.max(0, c0 - 1); o <= Math.min(outer - 1, c1 + 1); o++) {
            const p = horizontal ? (o * W + i) * 4 : (i * W + o) * 4;
            if (best < 0 || lum[p >> 2] < lum[best >> 2]) best = p;
            mass += Math.max(0, background - lum[p >> 2]);
          }
          samples.push(best);
          masses.push(mass);
        }
        masses.sort((p, q) => p - q);
        samples.sort((p, q) => lum[p >> 2] - lum[q >> 2]);
        const take = samples.slice(0, Math.max(1, Math.ceil(samples.length / 3)));
        let rs = 0;
        let gs = 0;
        let bs = 0;
        for (const p of take) {
          rs += r.data[p];
          gs += r.data[p + 1];
          bs += r.data[p + 2];
        }
        const n = take.length;
        const color = `${hex(rs / n)}${hex(gs / n)}${hex(bs / n)}`;
        let dark = 0;
        for (const p of take) dark += lum[p >> 2];
        const contrast = Math.max(1, background - dark / n);
        // Dark along its whole length, not just where text crosses it (a column through a tinted panel
        // passes the permissive level everywhere and is "dark" only at the letters).
        const typical = lum[samples[samples.length >> 1] >> 2];
        const covered = samples.filter((p) => lum[p >> 2] <= mid).length / samples.length;
        if (contrast < 25 || background - typical < 25 || covered < 0.8) continue;
        const weight = Math.min(thick + 2, Math.max(thick, masses[masses.length >> 1] / contrast));
        const c = (c0 + c1) / 2;
        found.push(horizontal ? { x0: a, x1: b, y0: c, y1: c, thickness: thick, weight, color } : { x0: c, x1: c, y0: a, y1: b, thickness: thick, weight, color });
      }
    }
  };
  scan(true);
  scan(false);
  return found;
}

/**
 * Closes boxes: a rounded or slightly broken corner leaves the horizontal and vertical edges short of each
 * other. Ends within `tol` pixels of a perpendicular rule's end are extended to meet it.
 */
export function snapCorners(rules: PxRule[], tol: number): PxRule[] {
  const out = rules.map((q) => ({ ...q }));
  const hs = out.filter((q) => q.y0 === q.y1);
  const vs = out.filter((q) => q.x0 === q.x1);
  for (const h of hs) {
    for (const v of vs) {
      for (const hx of ["x0", "x1"] as const) {
        for (const vy of ["y0", "y1"] as const) {
          if (Math.abs(h[hx] - v.x0) <= tol && Math.abs(v[vy] - h.y0) <= tol) {
            if (hx === "x0") h.x0 = Math.min(h.x0, v.x0);
            else h.x1 = Math.max(h.x1, v.x0);
            if (vy === "y0") v.y0 = Math.min(v.y0, h.y0);
            else v.y1 = Math.max(v.y1, h.y0);
          }
        }
      }
    }
  }
  return out;
}

/** Paints check boxes (with their marks) over with the background: the recogniser reads them as "[J", "Ml". */
export function eraseCheckboxes(r: Raster, boxes: PxCheckbox[], background: [number, number, number]): void {
  for (const b of boxes)
    for (let y = Math.max(0, b.ink.y - 1); y <= Math.min(r.height - 1, b.ink.y + b.ink.h); y++)
      for (let x = Math.max(0, b.ink.x - 1); x <= Math.min(r.width - 1, b.ink.x + b.ink.w); x++) {
        const p = (y * r.width + x) * 4;
        r.data[p] = background[0];
        r.data[p + 1] = background[1];
        r.data[p + 2] = background[2];
      }
}

/** Paints the rules over with the background, so OCR reads the text between them, not the lines. */
export function eraseRules(r: Raster, rules: PxRule[], background: [number, number, number]): void {
  const W = r.width;
  const H = r.height;
  for (const q of rules) {
    const pad = Math.ceil(q.thickness / 2) + 1;
    const x0 = Math.max(0, Math.floor(Math.min(q.x0, q.x1) - (q.x0 === q.x1 ? pad : 0)));
    const x1 = Math.min(W - 1, Math.ceil(Math.max(q.x0, q.x1) + (q.x0 === q.x1 ? pad : 0)));
    const y0 = Math.max(0, Math.floor(Math.min(q.y0, q.y1) - (q.y0 === q.y1 ? pad : 0)));
    const y1 = Math.min(H - 1, Math.ceil(Math.max(q.y0, q.y1) + (q.y0 === q.y1 ? pad : 0)));
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const p = (y * W + x) * 4;
        r.data[p] = background[0];
        r.data[p + 1] = background[1];
        r.data[p + 2] = background[2];
      }
  }
}

/** The background colour (mean of background-level pixels). */
export function backgroundColor(r: Raster, lum: Uint8Array, level: number): [number, number, number] {
  let rs = 0;
  let gs = 0;
  let bs = 0;
  let n = 0;
  for (let p = 0; p < lum.length; p += 7) {
    if (Math.abs(lum[p] - level) > 4) continue;
    rs += r.data[p * 4];
    gs += r.data[p * 4 + 1];
    bs += r.data[p * 4 + 2];
    n++;
  }
  return n ? [rs / n, gs / n, bs / n] : [255, 255, 255];
}

/**
 * Tinted areas enclosed by rules: for each rectangle bounded by two horizontal rules and two vertical rules
 * (a box, or a table cell), the colour inside — away from its edges and ignoring ink — compared with the
 * page background. A clear difference is a shaded panel or cell.
 */
export function enclosedFills(r: Raster, lum: Uint8Array, rules: PxRule[], bg: [number, number, number]): PxFill[] {
  const W = r.width;
  const t = inkThreshold(backgroundLevel(lum));
  const hs = rules.filter((q) => q.y0 === q.y1).sort((a, b) => a.y0 - b.y0);
  const vs = rules.filter((q) => q.x0 === q.x1).sort((a, b) => a.x0 - b.x0);
  const fills: PxFill[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < hs.length; i++) {
    for (let j = i + 1; j < hs.length; j++) {
      const top = hs[i];
      const bot = hs[j];
      if (bot.y0 - top.y0 < 8) continue;
      const left = Math.max(top.x0, bot.x0);
      const right = Math.min(top.x1, bot.x1);
      if (right - left < 20) continue;
      // Vertical rules spanning this band, inside the overlap.
      const sides = vs.filter((v) => v.y0 <= top.y0 + 4 && v.y1 >= bot.y0 - 4 && v.x0 >= left - 4 && v.x0 <= right + 4).map((v) => v.x0);
      for (let k = 0; k + 1 < sides.length; k++) {
        const x0 = sides[k];
        const x1 = sides[k + 1];
        if (x1 - x0 < 12) continue;
        // The nearest pair only (a cell, not a union of cells).
        if (hs.slice(i + 1, j).some((m) => m.x0 <= x0 + 4 && m.x1 >= x1 - 4)) continue;
        const key = `${x0}|${top.y0}|${x1}|${bot.y0}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const m = 4;
        let rs = 0;
        let gs = 0;
        let bs = 0;
        let n = 0;
        for (let y = Math.ceil(top.y0 + m); y < bot.y0 - m; y += 2)
          for (let x = Math.ceil(x0 + m); x < x1 - m; x += 2) {
            const p = y * W + x;
            if (lum[p] < t) continue;
            rs += r.data[p * 4];
            gs += r.data[p * 4 + 1];
            bs += r.data[p * 4 + 2];
            n++;
          }
        if (n < 20) continue;
        const c = [rs / n, gs / n, bs / n];
        const diff = Math.max(Math.abs(c[0] - bg[0]), Math.abs(c[1] - bg[1]), Math.abs(c[2] - bg[2]));
        if (diff >= 10) fills.push({ x: x0, y: top.y0, w: x1 - x0, h: bot.y0 - top.y0, color: `${hex(c[0])}${hex(c[1])}${hex(c[2])}` });
      }
    }
  }
  return fills;
}

/**
 * Stroke width of the ink inside a box: the mean length of its horizontal ink runs, in pixels. Bold type has
 * thicker strokes relative to its size (scanPage.ts compares it per type size).
 */
export function strokeWeight(lum: Uint8Array, width: number, box: PxBox, threshold: number): number | null {
  const x0 = Math.max(0, Math.floor(box.x));
  const x1 = Math.min(width - 1, Math.ceil(box.x + box.w));
  const y0 = Math.max(0, Math.floor(box.y));
  const y1 = Math.ceil(box.y + box.h);
  let inkPx = 0;
  let runs = 0;
  for (let y = y0; y < y1; y++) {
    let prev = false;
    for (let x = x0; x <= x1; x++) {
      const on = lum[y * width + x] < threshold;
      if (on) inkPx++;
      if (on && !prev) runs++;
      prev = on;
    }
  }
  if (!runs || box.h <= 0) return null;
  return inkPx / runs;
}

/**
 * Solid bands: rectangles of one flat dark colour at least `minW` × `minH` px, found on a 4 px grid (a cell
 * is dark when 70 %+ of its pixels are well off the paper). A band must be mostly solid (its light text
 * leaves holes), flat in colour (a photo isn't) and clearly darker than the paper.
 */
export function solidBars(r: Raster, lum: Uint8Array, background: number, minW: number, minH: number): PxBar[] {
  const C = 4;
  const W = r.width;
  const cw = Math.floor(r.width / C);
  const ch = Math.floor(r.height / C);
  const dark = background - 50;
  const cell = new Uint8Array(cw * ch);
  for (let cy = 0; cy < ch; cy++)
    for (let cx = 0; cx < cw; cx++) {
      let n = 0;
      for (let y = cy * C; y < cy * C + C; y++) for (let x = cx * C; x < cx * C + C; x++) if (lum[y * W + x] < dark) n++;
      if (n >= C * C * 0.7) cell[cy * cw + cx] = 1;
    }
  // Lines one cell wide (a table's rules) would join a band to its whole table: a band's cells have dark
  // neighbours both across and along.
  const solid = new Uint8Array(cw * ch);
  for (let cy = 0; cy < ch; cy++)
    for (let cx = 0; cx < cw; cx++) {
      const i = cy * cw + cx;
      if (!cell[i]) continue;
      const lr = (cx > 0 && cell[i - 1]) || (cx < cw - 1 && cell[i + 1]);
      const ud = (cy > 0 && cell[i - cw]) || (cy < ch - 1 && cell[i + cw]);
      if (lr && ud) solid[i] = 1;
    }
  cell.set(solid);
  const seen = new Uint8Array(cw * ch);
  const out: PxBar[] = [];
  for (let i = 0; i < cell.length; i++) {
    if (!cell[i] || seen[i]) continue;
    const stack = [i];
    seen[i] = 1;
    let x0 = cw;
    let y0 = ch;
    let x1 = 0;
    let y1 = 0;
    let n = 0;
    while (stack.length) {
      const k = stack.pop()!;
      const x = k % cw;
      const y = (k - x) / cw;
      n++;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
        const m = ny * cw + nx;
        if (cell[m] && !seen[m]) {
          seen[m] = 1;
          stack.push(m);
        }
      }
    }
    const bw = (x1 - x0 + 1) * C;
    const bh = (y1 - y0 + 1) * C;
    if (bw < minW || bh < minH || n < (x1 - x0 + 1) * (y1 - y0 + 1) * 0.6) continue;
    // Flat colour: the dark pixels' luminance barely varies; the light ones are its text.
    const darkPx: number[] = [];
    const lightPx: number[] = [];
    for (let y = y0 * C; y < (y1 + 1) * C; y += 2)
      for (let x = x0 * C; x < (x1 + 1) * C; x += 2) {
        const p = y * W + x;
        (lum[p] < dark ? darkPx : lightPx).push(p);
      }
    const mean = darkPx.reduce((a, p) => a + lum[p], 0) / darkPx.length;
    const sd = Math.sqrt(darkPx.reduce((a, p) => a + (lum[p] - mean) ** 2, 0) / darkPx.length);
    if (sd > 18) continue;
    const avg = (ps: number[], fallback: [number, number, number]) => {
      if (!ps.length) return fallback;
      const c = [0, 0, 0];
      for (const p of ps) for (let k = 0; k < 3; k++) c[k] += r.data[p * 4 + k];
      return c.map((v) => v / ps.length) as [number, number, number];
    };
    const bc = avg(darkPx, [0, 0, 0]);
    // Text colour: the clearly light pixels (anti-aliased edges sit in between).
    const tc = avg(lightPx.filter((p) => lum[p] > mean + (background - mean) * 0.7), [255, 255, 255]);
    out.push({ x: x0 * C, y: y0 * C, w: bw, h: bh, color: `${hex(bc[0])}${hex(bc[1])}${hex(bc[2])}`, text: `${hex(tc[0])}${hex(tc[1])}${hex(tc[2])}` });
  }
  return out;
}

/**
 * Makes a band's light-on-dark text dark-on-paper for the recogniser: pixels near the band's colour become
 * the paper's, everything lighter becomes dark, in proportion (anti-aliasing kept).
 */
export function invertBars(r: Raster, bars: PxBar[], paper: [number, number, number]): void {
  const W = r.width;
  const lum = luminance(r);
  for (const b of bars) {
    const band = parseInt(b.color.slice(0, 2), 16) * 0.299 + parseInt(b.color.slice(2, 4), 16) * 0.587 + parseInt(b.color.slice(4, 6), 16) * 0.114;
    const top = Math.max(band + 1, 255 - 1);
    // Only clearly light pixels are text (faint cell dividers and the band's soft edges aren't), and a thin
    // ring at the band's edge is cleared: a dark frame left there makes the recogniser skip the line.
    const ring = 3;
    for (let y = Math.max(0, b.y - ring); y < b.y + b.h + ring && y < r.height; y++)
      for (let x = Math.max(0, b.x - ring); x < b.x + b.w + ring && x < W; x++) {
        const p = y * W + x;
        const edge = y < b.y + ring || y >= b.y + b.h - ring || x < b.x + ring || x >= b.x + b.w - ring;
        const t = edge ? 0 : Math.max(0, Math.min(1, ((lum[p] - band) / (top - band) - 0.35) / 0.65));
        for (let k = 0; k < 3; k++) r.data[p * 4 + k] = Math.round(paper[k] * (1 - t));
      }
  }
}

/**
 * Light tinted areas (shaded cells and panels) made plain paper for the recogniser, which reads text on a
 * tint poorly; the text, clearly darker than the tint, stays. The shading itself is rebuilt from `fills`.
 */
export function flattenFills(r: Raster, fills: PxFill[], paper: [number, number, number]): void {
  const W = r.width;
  for (const f of fills) {
    const tint = parseInt(f.color.slice(0, 2), 16) * 0.299 + parseInt(f.color.slice(2, 4), 16) * 0.587 + parseInt(f.color.slice(4, 6), 16) * 0.114;
    for (let y = Math.max(0, Math.floor(f.y)); y < f.y + f.h && y < r.height; y++)
      for (let x = Math.max(0, Math.floor(f.x)); x < f.x + f.w && x < W; x++) {
        const p = (y * W + x) * 4;
        const l = r.data[p] * 0.299 + r.data[p + 1] * 0.587 + r.data[p + 2] * 0.114;
        if (l >= tint - 35) for (let k = 0; k < 3; k++) r.data[p + k] = paper[k];
      }
  }
}

/**
 * Check boxes: small hollow squares (6.5–18 pt a side). Each connected piece of ink of about that size is
 * tested for a square: its two longest vertical strokes (the sides) of about equal height and as far apart as
 * they are tall, joined by straight top and bottom edges. A box is checked when its inside holds ink (a tick
 * or a cross, which may reach outside the square and is part of the same piece). Letters fail the test: an
 * "H" has no top and bottom edges, an "O" no straight sides, a "[" one side.
 */
export function checkBoxes(r: Raster, lum: Uint8Array, background: number, pxPerPt: number): PxCheckbox[] {
  const W = r.width;
  const H = r.height;
  const t = inkThreshold(background);
  const min = 6.5 * pxPerPt;
  const max = 18 * pxPerPt;
  const seen = new Uint8Array(W * H);
  const out: PxCheckbox[] = [];
  const stack: number[] = [];
  for (let start = 0; start < W * H; start++) {
    if (seen[start] || lum[start] >= t) continue;
    // Flood the piece, giving up early once it is clearly bigger than a box.
    let x0 = W;
    let y0 = H;
    let x1 = 0;
    let y1 = 0;
    let big = false;
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % W;
      const y = (p - x) / W;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (x1 - x0 > max * 1.6 || y1 - y0 > max * 1.6) big = true;
      for (const q of [p - 1, p + 1, p - W, p + W]) {
        if (q < 0 || q >= W * H || seen[q] || lum[q] >= t) continue;
        if ((q === p - 1 && x === 0) || (q === p + 1 && x === W - 1)) continue;
        seen[q] = 1;
        stack.push(q);
      }
    }
    if (big || x1 - x0 < min * 0.9 || y1 - y0 < min * 0.9) continue;
    // Sides: columns with the longest vertical ink runs.
    const colRun = (x: number) => {
      let best = 0;
      let bestEnd = 0;
      let run = 0;
      for (let y = y0; y <= y1; y++) {
        if (lum[y * W + x] < t) run++;
        else run = 0;
        if (run > best) [best, bestEnd] = [run, y];
      }
      return { len: best, top: bestEnd - best + 1, bottom: bestEnd };
    };
    const cols = [];
    for (let x = x0; x <= x1; x++) cols.push({ x, ...colRun(x) });
    const left = cols.slice(0, Math.ceil(cols.length / 2)).sort((a, b) => b.len - a.len)[0];
    const right = cols.slice(Math.floor(cols.length / 2)).sort((a, b) => b.len - a.len)[0];
    if (!left || !right) continue;
    const side = right.x - left.x;
    const tall = Math.min(left.len, right.len);
    if (side < min || side > max || tall < min || Math.abs(left.len - right.len) > 0.2 * tall || Math.abs(side - tall) > 0.25 * tall) continue;
    const top = Math.max(left.top, right.top);
    const bottom = Math.min(left.bottom, right.bottom);
    // Straight top and bottom edges joining the sides (within 2 px of the sides' ends).
    const rowCover = (yc: number) => {
      let best = 0;
      for (let y = yc - 2; y <= yc + 2; y++) {
        if (y < 0 || y >= H) continue;
        let n = 0;
        for (let x = left.x; x <= right.x; x++) if (lum[y * W + x] < t) n++;
        best = Math.max(best, n / (side + 1));
      }
      return best;
    };
    if (rowCover(top) < 0.85 || rowCover(bottom) < 0.85) continue;
    // Square corners (a round letter — O, Q, 0 — has straight-ish sides at small sizes, but no corners).
    const corner = (cx: number, cy: number) => {
      for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 2; x <= cx + 2; x++) if (x >= 0 && y >= 0 && x < W && y < H && lum[y * W + x] < t) return true;
      return false;
    };
    if (!corner(left.x, top) || !corner(right.x, top) || !corner(left.x, bottom) || !corner(right.x, bottom)) continue;
    // The corner pixel itself must be ink, not just near it, on at least three corners.
    const exact = [[left.x, top], [right.x, top], [left.x, bottom], [right.x, bottom]].filter(([x, y]) => {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (lum[(y + dy) * W + x + dx] < t) return true;
      return false;
    }).length;
    if (exact < 3) continue;
    // Drawn with a thin line: a box's sides are under ~1/5 of its width; a letter's ring (O, Q, D) ~1/4 or more.
    // (Measured at three heights, the thinnest counting: a tick may cross a side.)
    const thickness = (from: number, dir: number) =>
      Math.min(
        ...[0.25, 0.5, 0.75].map((f) => {
          const y = Math.round(top + (bottom - top) * f);
          let n = 0;
          for (let x = from; n < side && x >= 0 && x < W && lum[y * W + x] < t; x += dir) n++;
          let m = 0;
          for (let x = from - dir; m < side && x >= 0 && x < W && lum[y * W + x] < t; x -= dir) m++;
          return n + m;
        }),
      );
    if (Math.max(thickness(left.x, 1), thickness(right.x, -1)) > Math.max(2, 0.22 * side)) continue;
    // Inside, away from the edges: a mark makes it a checked box.
    const pad = Math.max(2, Math.round(side * 0.2));
    let ink = 0;
    let all = 0;
    for (let y = top + pad; y <= bottom - pad; y++)
      for (let x = left.x + pad; x <= right.x - pad; x++) {
        all++;
        if (lum[y * W + x] < t) ink++;
      }
    out.push({ x: left.x, y: top, w: side, h: bottom - top, checked: all > 0 && ink / all > 0.06, ink: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } });
  }
  return out;
}

/** Runs the analysis on a page raster: rules (with corners closed), enclosed tinted areas, solid bands. */
export function analyzeScan(r: Raster, pxPerPt: number): ScanAnalysis {
  const lum = luminance(r);
  const level = backgroundLevel(lum);
  const bg = backgroundColor(r, lum, level);
  const detected = detectRules(r, lum, level, { minH: Math.round(36 * pxPerPt), minV: Math.round(14 * pxPerPt), maxThick: Math.max(2, Math.round(3.5 * pxPerPt)) });
  const snapped = snapCorners(detected, Math.round(12 * pxPerPt));
  // A short vertical stroke is a rule only as the side of a box or a table — meeting horizontal rules at
  // both ends. Alone it is more likely a letter's stem in large bold type (an "l", a "T", a "b").
  const tol = 4 * pxPerPt;
  const hs = snapped.filter((q) => q.y0 === q.y1);
  const meets = (x: number, y: number) => hs.some((h) => Math.abs(h.y0 - y) <= tol && x >= h.x0 - tol && x <= h.x1 + tol);
  const rules = snapped.filter((q) => q.y0 === q.y1 || q.y1 - q.y0 >= 48 * pxPerPt || (meets(q.x0, q.y0) && meets(q.x0, q.y1)));
  const bars = solidBars(r, lum, level, Math.round(60 * pxPerPt), Math.round(8 * pxPerPt));
  // A band that a table's vertical lines run through is that table's header row: its edges are the grid's
  // lines there (drawn in the band's colour, so they disappear into its shading).
  for (const b of bars) {
    const crossing = rules.filter((q) => q.x0 === q.x1 && q.x0 >= b.x - tol && q.x0 <= b.x + b.w + tol && q.y0 <= b.y + tol && q.y1 >= b.y + b.h - tol);
    // A band on top of a stack of row lines of its own width is that table's header row: its top and bottom
    // edges join the rows (the table has no verticals to cross it).
    const rowsBelow = rules.filter((q) => q.y0 === q.y1 && q.y0 > b.y + b.h - tol && q.y0 < b.y + b.h + 80 * pxPerPt && Math.abs(q.x0 - b.x) <= tol * 2 && Math.abs(q.x1 - (b.x + b.w)) <= tol * 2);
    if (crossing.length < 2 && rowsBelow.length >= 2) {
      for (const y of [b.y, b.y + b.h]) {
        if (rules.some((q) => q.y0 === q.y1 && Math.abs(q.y0 - y) <= tol && q.x0 <= b.x + tol && q.x1 >= b.x + b.w - tol)) continue;
        rules.push({ x0: b.x, x1: b.x + b.w, y0: y, y1: y, thickness: 1, weight: 1, color: b.color });
      }
      continue;
    }
    if (crossing.length < 2) {
      // A band on its own (a section heading bar) is a box of its own colour: a one-cell table with exactly
      // its height, shaded — not a paragraph whose shading only covers its line.
      const edge = (x0: number, y0: number, x1: number, y1: number) => rules.push({ x0, x1, y0, y1, thickness: 1, weight: 1, color: b.color });
      edge(b.x, b.y, b.x + b.w, b.y);
      edge(b.x, b.y + b.h, b.x + b.w, b.y + b.h);
      edge(b.x, b.y, b.x, b.y + b.h);
      edge(b.x + b.w, b.y, b.x + b.w, b.y + b.h);
      continue;
    }
    for (const y of [b.y, b.y + b.h]) {
      if (rules.some((q) => q.y0 === q.y1 && Math.abs(q.y0 - y) <= tol && q.x0 <= b.x + tol && q.x1 >= b.x + b.w - tol)) continue;
      rules.push({ x0: b.x, x1: b.x + b.w, y0: y, y1: y, thickness: 1, weight: 1, color: b.color });
    }
  }
  const fills = [...enclosedFills(r, lum, rules, bg).filter((f) => !bars.some((b) => f.x >= b.x - tol && f.x + f.w <= b.x + b.w + tol && f.y >= b.y - tol && f.y + f.h <= b.y + b.h + tol)), ...bars.map(({ x, y, w, h, color }) => ({ x, y, w, h, color }))];
  const checkboxes = checkBoxes(r, lum, level, pxPerPt);
  return { background: level, backgroundColor: `${hex(bg[0])}${hex(bg[1])}${hex(bg[2])}`, rules, fills, bars, checkboxes };
}
