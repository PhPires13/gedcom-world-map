import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { crc32, readPngDpi, setPngDpi } from '../../src/print/png';

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  out.set([...type].map((c) => c.charCodeAt(0)), 4);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** A 1×1 white PNG. */
function tinyPng(): Uint8Array {
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, 1);
  v.setUint32(4, 1);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const idat = deflateSync(Buffer.from([0, 255, 255, 255]));
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', new Uint8Array(idat)), chunk('IEND', new Uint8Array())];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) (out.set(p, o), (o += p.length));
  return out;
}

describe('PNG resolution', () => {
  it('computes CRC-32 like zlib', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('marks a PNG as 300 dpi, right after its header', () => {
    const png = tinyPng();
    expect(readPngDpi(png)).toBeUndefined();
    const out = setPngDpi(png, 300);
    expect(readPngDpi(out)).toBe(300);
    expect(String.fromCharCode(...out.subarray(37, 41))).toBe('pHYs'); // 8 signature + 25 IHDR + 4 length
    expect(out.length).toBe(png.length + 21);
  });

  it('replaces an existing resolution instead of adding a second one', () => {
    const out = setPngDpi(setPngDpi(tinyPng(), 72), 300);
    expect(readPngDpi(out)).toBe(300);
    expect(out.length).toBe(tinyPng().length + 21);
  });

  it('refuses files that are not PNGs', () => {
    expect(() => setPngDpi(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), 300)).toThrow();
  });
});
