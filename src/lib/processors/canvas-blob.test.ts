import { afterEach, describe, expect, it, vi } from "vitest";
import { encodeCanvas } from "./canvas-blob";

const fakeCanvas = (toBlob = vi.fn((cb: BlobCallback) => cb(new Blob(["via toBlob"])))) => ({ width: 4, height: 3, toBlob }) as unknown as HTMLCanvasElement;

afterEach(() => vi.unstubAllGlobals());

describe("encodeCanvas — encoding that doesn't depend on the tab being in front", () => {
  it("encodes on an OffscreenCanvas when the browser has one", async () => {
    const convertToBlob = vi.fn(async (options: unknown) => (void options, new Blob(["via offscreen"])));
    const drawImage = vi.fn();
    class FakeOffscreen {
      constructor(public width: number, public height: number) {}
      getContext() {
        return { drawImage };
      }
      convertToBlob(options: unknown) {
        return convertToBlob(options);
      }
    }
    vi.stubGlobal("OffscreenCanvas", FakeOffscreen);
    const canvas = fakeCanvas();
    const blob = await encodeCanvas(canvas, "image/jpeg", 0.9);
    expect(await blob!.text()).toBe("via offscreen");
    expect(convertToBlob).toHaveBeenCalledWith({ type: "image/jpeg", quality: 0.9 });
    expect(drawImage).toHaveBeenCalledWith(canvas, 0, 0);
    expect(canvas.toBlob).not.toHaveBeenCalled();
  });

  it("falls back to toBlob without OffscreenCanvas", async () => {
    vi.stubGlobal("OffscreenCanvas", undefined);
    const canvas = fakeCanvas();
    expect(await (await encodeCanvas(canvas, "image/png"))!.text()).toBe("via toBlob");
  });

  it("falls back to toBlob when the offscreen encode throws", async () => {
    class Broken {
      getContext() {
        return { drawImage: () => {} };
      }
      async convertToBlob() {
        throw new Error("nope");
      }
    }
    vi.stubGlobal("OffscreenCanvas", Broken);
    expect(await (await encodeCanvas(fakeCanvas(), "image/png"))!.text()).toBe("via toBlob");
  });
});
