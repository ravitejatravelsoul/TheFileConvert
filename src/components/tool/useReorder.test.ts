import { describe, expect, it } from "vitest";
import { moveKey } from "./useReorder";

const items = ["a", "b", "c", "d"].map((key) => ({ key }));
const keyOf = (i: { key: string }) => i.key;
const keys = (list: { key: string }[]) => list.map(keyOf).join("");

describe("moveKey", () => {
  it("moves an item to a new index", () => {
    expect(keys(moveKey(items, keyOf, "d", 0))).toBe("dabc");
    expect(keys(moveKey(items, keyOf, "a", 2))).toBe("bcad");
  });

  it("clamps out-of-range targets and leaves unknown keys alone", () => {
    expect(keys(moveKey(items, keyOf, "b", -5))).toBe("bacd");
    expect(keys(moveKey(items, keyOf, "b", 99))).toBe("acdb");
    expect(moveKey(items, keyOf, "z", 0)).toBe(items);
  });

  it("returns the same array when nothing moves", () => {
    expect(moveKey(items, keyOf, "c", 2)).toBe(items);
  });
});
