import { describe, expect, it } from "vitest";
import { searchImageSettings } from "./image-search";

/** A fake encoder: size grows with pixel count and with quality, like real JPEG/WebP. */
const fake = (base: number) => async (scale: number, quality: number) => ({ size: Math.round(base * scale * scale * (0.2 + quality)) });

describe("searchImageSettings", () => {
  it("keeps full size and the highest quality that fits", async () => {
    // At 92% the image is 1,120,000 bytes; at 85% 1,050,000; target 1,060,000 → 85% plus a refinement step.
    const r = await searchImageSettings(1_060_000, fake(1_000_000), { lossy: true });
    expect(r.fits).toBe(true);
    expect(r.scale).toBe(1);
    expect(r.out.size).toBeLessThanOrEqual(1_060_000);
    expect(r.quality).toBeGreaterThanOrEqual(0.85);
  });

  it("never goes below 70% quality at full size — it shrinks instead", async () => {
    const r = await searchImageSettings(300_000, fake(1_000_000), { lossy: true });
    expect(r.fits).toBe(true);
    expect(r.quality).toBeGreaterThanOrEqual(0.7);
    expect(r.scale).toBeLessThan(1);
    expect(r.out.size).toBeLessThanOrEqual(300_000);
    expect(r.attempts.every((a) => a.scale < 1 || a.quality >= 0.7)).toBe(true);
  });

  it("uses most of the target rather than overshooting far below it", async () => {
    const r = await searchImageSettings(300_000, fake(1_000_000), { lossy: true });
    expect(r.out.size).toBeGreaterThan(300_000 * 0.8);
  });

  it("only lowers quality below 70% as a last resort, and reports an unreachable target honestly", async () => {
    const r = await searchImageSettings(10, fake(1_000_000), { lossy: true });
    expect(r.fits).toBe(false);
    expect(r.out.size).toBe(Math.min(...r.attempts.map((a) => a.bytes)));
    expect(r.attempts.some((a) => a.quality < 0.7)).toBe(true);
  });

  it("scales only (quality fixed) for lossless output", async () => {
    const r = await searchImageSettings(200_000, fake(1_000_000), { lossy: false });
    expect(r.fits).toBe(true);
    expect(r.attempts.every((a) => a.quality === 1)).toBe(true);
    expect(r.out.size).toBeLessThanOrEqual(200_000);
  });

  it("keeps the attempt count bounded", async () => {
    const r = await searchImageSettings(10, fake(50_000_000), { lossy: true });
    expect(r.attempts.length).toBeLessThanOrEqual(12);
  });
});
