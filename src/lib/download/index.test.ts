import { describe, expect, it } from "vitest";
import { uniqueNames } from "./index";

describe("uniqueNames", () => {
  it("keeps distinct names and numbers repeats", () => {
    expect(uniqueNames(["a.png", "b.png", "a.png", "A.png", "c"])).toEqual(["a.png", "b.png", "a (2).png", "A (3).png", "c"]);
  });
});
