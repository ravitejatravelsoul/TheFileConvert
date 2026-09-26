import { describe, expect, it } from "vitest";
import { generateUuidV4 } from "./id";

describe("generateUuidV4", () => {
  it("produces a v4 UUID", () => {
    expect(generateUuidV4()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it("produces unique values", () => {
    expect(new Set(Array.from({ length: 20 }, () => generateUuidV4())).size).toBe(20);
  });
});
