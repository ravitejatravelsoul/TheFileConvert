/**
 * Finds encode settings (scale, quality) that bring an image under a byte target while looking as good
 * as possible. Pure — the encoder is passed in — so the search is unit-tested without a browser.
 *
 * Strategy, in order of how much it costs visually:
 *  1. Full size, quality stepping down from 92% but never below 70%.
 *  2. Still too big: shrink dimensions, estimating the scale from the last measured size (bytes grow
 *     roughly with pixel count), at a good quality (75%). Then nudge the scale back up between the size
 *     that fit and the one that didn't, to keep as many pixels as possible.
 *  3. Only if even small dimensions don't fit: lower quality (50%, then 35%) as a last resort.
 * Dimensions never go below `minScale`, and quality never below the last-resort floor: if nothing fits
 * within those limits, the smallest result is returned as the closest one — never labelled as success.
 */

export interface SearchAttempt {
  scale: number;
  quality: number;
  bytes: number;
}

export interface SearchOutcome<T> {
  out: T;
  scale: number;
  quality: number;
  fits: boolean;
  attempts: SearchAttempt[];
}

const FULL_SIZE_QUALITIES = [0.92, 0.85, 0.78, 0.7];
const SHRINK_QUALITY = 0.75;
const LAST_RESORT_QUALITIES = [0.5, 0.35];
const SHRINK_ROUNDS = 5;
/** Aim a little under the target when estimating a scale, since the estimate isn't exact. */
const AIM = 0.96;

export async function searchImageSettings<T extends { size: number }>(
  target: number,
  encode: (scale: number, quality: number) => Promise<T>,
  {
    lossy,
    onProgress,
    minScale = 0.08,
  }: {
    lossy: boolean;
    onProgress?: (label: string) => void;
    /** Smallest scale that still counts as a usable result. Below it the target is reported as not reached
     * rather than met with an image too small to use. */
    minScale?: number;
  }
): Promise<SearchOutcome<T>> {
  const attempts: SearchAttempt[] = [];
  let best: { out: T; scale: number; quality: number } | null = null; // smallest seen (fallback)
  let bestFit: { out: T; scale: number; quality: number } | null = null; // largest that fits

  async function tryAt(scale: number, quality: number): Promise<T> {
    onProgress?.(lossy ? `${Math.round(quality * 100)}% quality${scale < 1 ? `, ${Math.round(scale * 100)}% size` : ""}` : `${Math.round(scale * 100)}% size`);
    const out = await encode(scale, quality);
    attempts.push({ scale, quality, bytes: out.size });
    if (!best || out.size < best.out.size) best = { out, scale, quality };
    if (out.size <= target && (!bestFit || out.size > bestFit.out.size)) bestFit = { out, scale, quality };
    return out;
  }
  const done = (): SearchOutcome<T> => {
    const pick = bestFit ?? best!;
    return { out: pick.out, scale: pick.scale, quality: pick.quality, fits: Boolean(bestFit), attempts };
  };

  // 1. Full size, good qualities only.
  const qualities = lossy ? FULL_SIZE_QUALITIES : [1];
  let lastSize = 0;
  for (let i = 0; i < qualities.length; i++) {
    lastSize = (await tryAt(1, qualities[i])).size;
    if (lastSize <= target) {
      // One step between the quality that missed and this one, in case the gap was large.
      if (i > 0) await tryAt(1, (qualities[i] + qualities[i - 1]) / 2);
      return done();
    }
  }

  // 2. Shrink, estimating the scale from the last measured size.
  const shrinkQuality = lossy ? SHRINK_QUALITY : 1;
  let failScale = 1;
  let scale = 1;
  for (let round = 0; round < SHRINK_ROUNDS && scale > minScale; round++) {
    const estimate = scale * Math.sqrt(target / lastSize) * AIM;
    scale = Math.max(minScale, Math.min(scale * 0.95, estimate));
    lastSize = (await tryAt(scale, shrinkQuality)).size;
    if (lastSize <= target) {
      // Keep as many pixels as possible: bisect back toward the size that didn't fit.
      let fit = scale;
      let miss = failScale;
      for (let step = 0; step < 2 && miss - fit > 0.02; step++) {
        const between = (fit + miss) / 2;
        if ((await tryAt(between, shrinkQuality)).size <= target) fit = between;
        else miss = between;
      }
      return done();
    }
    failScale = scale;
  }

  // 3. Last resort: lower quality at the smallest size reached.
  if (lossy) {
    for (const q of LAST_RESORT_QUALITIES) {
      if ((await tryAt(scale, q)).size <= target) return done();
    }
  }
  return done();
}
