// WOFF (version 1) → plain TrueType/OpenType bytes. The @fontsource packages ship WOFF and WOFF2;
// resvg and PDFKit want the plain font, and WOFF 1 is just zlib-compressed tables, so Node's own
// zlib is enough (no extra dependency).

import { inflateSync } from 'node:zlib';

export function woffToSfnt(woff: Uint8Array): Uint8Array {
  const v = new DataView(woff.buffer, woff.byteOffset, woff.byteLength);
  if (v.getUint32(0) !== 0x774f4646) throw new Error('Not a WOFF 1 file'); // 'wOFF'
  const flavor = v.getUint32(4);
  const numTables = v.getUint16(12);
  const tables: { tag: number; checksum: number; data: Uint8Array }[] = [];
  for (let i = 0; i < numTables; i++) {
    const at = 44 + i * 20;
    const tag = v.getUint32(at);
    const offset = v.getUint32(at + 4);
    const compLength = v.getUint32(at + 8);
    const origLength = v.getUint32(at + 12);
    const checksum = v.getUint32(at + 16);
    const raw = woff.subarray(offset, offset + compLength);
    const data = compLength < origLength ? new Uint8Array(inflateSync(raw)) : raw;
    if (data.length !== origLength) throw new Error('Corrupt WOFF table');
    tables.push({ tag, checksum, data });
  }
  tables.sort((a, b) => a.tag - b.tag);
  const pad = (n: number) => (n + 3) & ~3;
  const headerSize = 12 + numTables * 16;
  const total = tables.reduce((s, t) => s + pad(t.data.length), headerSize);
  const out = new Uint8Array(total);
  const o = new DataView(out.buffer);
  let entrySelector = 0;
  while (1 << (entrySelector + 1) <= numTables) entrySelector++;
  const searchRange = (1 << entrySelector) * 16;
  o.setUint32(0, flavor);
  o.setUint16(4, numTables);
  o.setUint16(6, searchRange);
  o.setUint16(8, entrySelector);
  o.setUint16(10, numTables * 16 - searchRange);
  let offset = headerSize;
  tables.forEach((t, i) => {
    const rec = 12 + i * 16;
    o.setUint32(rec, t.tag);
    o.setUint32(rec + 4, t.checksum);
    o.setUint32(rec + 8, offset);
    o.setUint32(rec + 12, t.data.length);
    out.set(t.data, offset);
    offset += pad(t.data.length);
  });
  return out;
}
