// Marks a PNG as 300 dpi (or any resolution), so print shops and image editors read its print size.
// Browsers' canvas encoders don't write this, so the pHYs chunk is added to the file afterwards.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** The PNG with a pHYs chunk saying `dpi` (replacing any there was). */
export function setPngDpi(png: Uint8Array, dpi: number): Uint8Array {
  if (!SIGNATURE.every((b, i) => png[i] === b)) throw new Error('Not a PNG file');
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const chunks: Uint8Array[] = [png.subarray(0, 8)];
  const ppm = Math.round(dpi / 0.0254);
  const phys = new Uint8Array(4 + 4 + 9 + 4);
  const pv = new DataView(phys.buffer);
  pv.setUint32(0, 9);
  phys.set([112, 72, 89, 115], 4); // "pHYs"
  pv.setUint32(8, ppm);
  pv.setUint32(12, ppm);
  phys[16] = 1; // unit: metre
  pv.setUint32(17, crc32(phys.subarray(4, 17)));
  let pos = 8;
  while (pos < png.length) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(...png.subarray(pos + 4, pos + 8));
    const end = pos + 12 + len;
    if (type !== 'pHYs') chunks.push(png.subarray(pos, end));
    if (type === 'IHDR') chunks.push(phys);
    pos = end;
  }
  const out = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** The resolution a PNG declares, in dpi (undefined if it doesn't). */
export function readPngDpi(png: Uint8Array): number | undefined {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let pos = 8;
  while (pos < png.length) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(...png.subarray(pos + 4, pos + 8));
    if (type === 'pHYs' && png[pos + 16] === 1) return Math.round(view.getUint32(pos + 8) * 0.0254);
    pos += 12 + len;
  }
  return undefined;
}
