/** zlib (FlateDecode) through the platform's streaming codecs — no extra library in the bundle. */

async function pipe(data: Uint8Array, transform: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const writer = transform.writable.getWriter();
  void writer
    .write(data as Uint8Array<ArrayBuffer>)
    .then(() => writer.close())
    .catch(() => {});
  const reader = transform.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

export const inflate = (data: Uint8Array) => pipe(data, new DecompressionStream("deflate"));
export const deflate = (data: Uint8Array) => pipe(data, new CompressionStream("deflate"));
