// A small 256-colour PNG encoder, for link-preview pictures: chat apps (WhatsApp above all) drop
// previews heavier than a few hundred KB, and a full-colour PNG of a textured map is ~1 MB.
// The palette is the most common colours (at 5 bits per channel); every pixel takes the nearest.

import { deflateSync } from 'node:zlib';
import { crc32 } from '../src/print/png';

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Encodes opaque RGBA pixels (alpha ignored) as an indexed-colour PNG. */
export function encodePalettePng(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const key = (i: number) => ((rgba[i] >> 3) << 10) | ((rgba[i + 1] >> 3) << 5) | (rgba[i + 2] >> 3);
  const counts = new Uint32Array(1 << 15);
  for (let i = 0; i < rgba.length; i += 4) counts[key(i)]++;
  const used = [...counts.keys()].filter((k) => counts[k] > 0).sort((a, b) => counts[b] - counts[a]);
  const palette = used.slice(0, 256);
  const rgb = palette.map((k) => [((k >> 10) & 31) * 8 + 4, ((k >> 5) & 31) * 8 + 4, (k & 31) * 8 + 4]);

  // Nearest palette entry per 15-bit colour, worked out once per colour that occurs.
  const index = new Int16Array(1 << 15).fill(-1);
  palette.forEach((k, i) => (index[k] = i));
  const nearest = (k: number) => {
    if (index[k] >= 0) return index[k];
    const r = ((k >> 10) & 31) * 8 + 4;
    const g = ((k >> 5) & 31) * 8 + 4;
    const b = (k & 31) * 8 + 4;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < rgb.length; i++) {
      const d = (rgb[i][0] - r) ** 2 * 3 + (rgb[i][1] - g) ** 2 * 4 + (rgb[i][2] - b) ** 2 * 2;
      if (d < bestD) [best, bestD] = [i, d];
    }
    return (index[k] = best);
  };

  const raw = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width + 1)] = 0; // filter: none
    for (let x = 0; x < width; x++) raw[y * (width + 1) + 1 + x] = nearest(key((y * width + x) * 4));
  }

  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr.set([8, 3, 0, 0, 0], 8); // 8-bit, indexed colour
  const plte = new Uint8Array(rgb.flat());
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('PLTE', plte),
    chunk('IDAT', new Uint8Array(deflateSync(raw, { level: 9 }))),
    chunk('IEND', new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
