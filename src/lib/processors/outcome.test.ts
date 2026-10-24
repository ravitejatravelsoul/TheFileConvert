import { describe, expect, it } from "vitest";
import { decideOutcome } from "./outcome";

const blob = (n: number) => new Blob([new Uint8Array(n)]);

describe("decideOutcome", () => {
  it("reports a reached target with the compressed file", () => {
    const out = blob(400);
    const o = decideOutcome(blob(1000), 500, { blob: out, newBytes: 400, targetAchieved: true });
    expect(o).toEqual({ kind: "reached", blob: out, bytes: 400 });
  });

  it("returns the untouched original when it already fits and re-saving made it bigger", () => {
    const original = blob(300);
    const o = decideOutcome(original, 500, { blob: blob(320), newBytes: 320, targetAchieved: true });
    expect(o.kind).toBe("already-small");
    expect(o.blob).toBe(original);
    expect(o.bytes).toBe(300);
  });

  it("offers the closest smaller result when the target can't be reached", () => {
    const out = blob(700);
    const o = decideOutcome(blob(1000), 500, { blob: out, newBytes: 700, targetAchieved: false });
    expect(o).toEqual({ kind: "closest", blob: out, bytes: 700 });
  });

  it("never offers a bigger file as the closest result", () => {
    const original = blob(1000);
    const o = decideOutcome(original, 500, { blob: blob(1100), newBytes: 1100, targetAchieved: false });
    expect(o.kind).toBe("no-gain");
    expect(o.blob).toBe(original);
  });

  it("does not trust a targetAchieved flag that contradicts the bytes", () => {
    const o = decideOutcome(blob(1000), 500, { blob: blob(600), newBytes: 600, targetAchieved: true });
    expect(o.kind).toBe("closest");
  });
});

describe("decideOutcome — small-file target contract (regression)", () => {
  it("an unchanged original over the target is never a success, even if the engine claims one", () => {
    const original = blob(324_000);
    const o = decideOutcome(original, 200_000, { blob: original, newBytes: 324_000, targetAchieved: true });
    expect(o.kind).not.toBe("reached");
    expect(o.kind).not.toBe("already-small");
  });

  it("an original at or under the target is returned unchanged", () => {
    const original = blob(180_000);
    const o = decideOutcome(original, 200_000, { blob: original, newBytes: 180_000, targetAchieved: true });
    expect(o).toEqual({ kind: "already-small", blob: original, bytes: 180_000 });
  });
});
