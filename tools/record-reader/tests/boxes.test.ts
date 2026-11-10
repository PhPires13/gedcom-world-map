import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { cropForZoom, fitWithinLimits, loadPages, MAX_LONG_EDGE, MAX_PIXELS } from "../src/pages.js";
import { iou, normaliseBox, normaliseReading, toOriginalPixels } from "../src/postprocess.js";
import type { PageInfo } from "../src/schema.js";
import { fixtureReading, SAMPLE_PT, tmp } from "./helpers.js";
import { readFileSync } from "node:fs";
import path from "node:path";

const page: PageInfo = { page: 1, file: "a.jpg", file_page: 1, width: 4000, height: 3000, sent_width: 2000, sent_height: 1500 };

describe("bounding boxes", () => {
  it("normalises pixel boxes to page fractions", () => {
    const warnings: string[] = [];
    const b = normaliseBox({ page: 1, x0: 200, y0: 150, x1: 600, y1: 300 }, { pages: [page], warnings }, "t");
    expect(b).toEqual({ page: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.1 });
    expect(toOriginalPixels(b!, page)).toEqual({ x0: 400, y0: 300, x1: 1200, y1: 600 });
    expect(warnings).toEqual([]);
  });

  it("fixes swapped corners and clamps small overshoots, with a warning for swaps", () => {
    const warnings: string[] = [];
    const b = normaliseBox({ page: 1, x0: 600, y0: 300, x1: 200, y1: 150 }, { pages: [page], warnings }, "t");
    expect(b).toEqual({ page: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.1 });
    expect(warnings[0]).toContain("swapped");
    const edge = normaliseBox({ page: 1, x0: 1900, y0: 1400, x1: 2030, y1: 1520 }, { pages: [page], warnings: [] }, "t");
    expect(edge!.x + edge!.w).toBeLessThanOrEqual(1);
    expect(edge!.y + edge!.h).toBeLessThanOrEqual(1);
  });

  it("drops boxes outside the page, on missing pages, without area or with NaN", () => {
    const warnings: string[] = [];
    const ctx = { pages: [page], warnings };
    expect(normaliseBox({ page: 1, x0: 2500, y0: 0, x1: 2900, y1: 100 }, ctx, "a")).toBeNull();
    expect(normaliseBox({ page: 2, x0: 0, y0: 0, x1: 10, y1: 10 }, ctx, "b")).toBeNull();
    expect(normaliseBox({ page: 1, x0: 10, y0: 10, x1: 10, y1: 50 }, ctx, "c")).toBeNull();
    expect(normaliseBox({ page: 1, x0: Number.NaN, y0: 0, x1: 10, y1: 10 }, ctx, "d")).toBeNull();
    expect(warnings).toHaveLength(4);
  });

  it("warns when a field's box falls outside its entry", () => {
    const r = fixtureReading();
    r.entries[0].people[0].name.box = { page: 1, x0: 100, y0: 2000, x1: 300, y1: 2050 };
    const n = normaliseReading(r, [{ ...page, width: 1600, height: 2200, sent_width: 1600, sent_height: 2200 }]);
    expect(n.warnings.some((w) => w.includes("e1.p1 name box lies outside the entry"))).toBe(true);
  });

  it("ground-truth boxes of the synthetic page land on the expected words", () => {
    const expected = JSON.parse(readFileSync(path.join(path.dirname(SAMPLE_PT), "expected.json"), "utf8"));
    const n = normaliseReading(fixtureReading(), [{ ...page, width: 1600, height: 2200, sent_width: 1600, sent_height: 2200 }]);
    expect(n.warnings).toEqual([]);
    const p = n.entries[0].people[1];
    expect(iou(p.name.box!, expected.entries[0].people[1].box)).toBeGreaterThan(0.95);
  });

  it("iou is 1 for identical boxes, 0 for disjoint or other pages", () => {
    const a = { page: 1, x: 0.1, y: 0.1, w: 0.2, h: 0.2 };
    expect(iou(a, a)).toBeCloseTo(1, 10);
    expect(iou(a, { ...a, x: 0.5 })).toBe(0);
    expect(iou(a, { ...a, page: 2 })).toBe(0);
  });
});

describe("page images", () => {
  it("scales pages to the model's image limits without upscaling", () => {
    expect(fitWithinLimits(1600, 2200)).toEqual({ width: 1600, height: 2200 });
    const big = fitWithinLimits(6000, 4500);
    expect(Math.max(big.width, big.height)).toBeLessThanOrEqual(MAX_LONG_EDGE);
    expect(big.width * big.height).toBeLessThanOrEqual(MAX_PIXELS);
    expect(big.width / big.height).toBeCloseTo(6000 / 4500, 2);
  });

  it("loads a large scan, keeps the original for zooms and sends a fitted JPEG", async () => {
    const file = path.join(tmp(), "scan.jpg");
    await sharp({ create: { width: 5000, height: 3500, channels: 3, background: "#e8dcc0" } }).jpeg().toFile(file);
    const { pages } = await loadPages([file], 10);
    const p = pages[0];
    expect(p.info).toMatchObject({ width: 5000, height: 3500 });
    expect(p.info.sent_width * p.info.sent_height).toBeLessThanOrEqual(MAX_PIXELS);
    const meta = await sharp(p.sent).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(p.info.sent_width);
    // A zoom on a small region is cut from the original, so it is magnified.
    const crop = await cropForZoom(p, { x0: 100, y0: 100, x1: 300, y1: 160 });
    expect(crop.width).toBeGreaterThanOrEqual(800);
    expect(crop.scale).toBeGreaterThan(2);
    await expect(cropForZoom(p, { x0: 99999, y0: 99999, x1: 100000, y1: 100000 })).rejects.toThrow(/outside/);
  });

  it("renders PDF pages", async () => {
    const file = path.join(tmp(), "doc.pdf");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(file, minimalPdf());
    const { pages, files } = await loadPages([file], 10);
    expect(files[0].media_type).toBe("application/pdf");
    expect(pages).toHaveLength(2);
    expect(pages[1].info).toMatchObject({ page: 2, file_page: 2 });
    // A4 at 300 dpi ≈ 2480 × 3508
    expect(pages[0].info.width).toBeGreaterThan(2000);
  });
});

/** A two-page A4 PDF with a line of text on each page. */
function minimalPdf(): Buffer {
  const objs: string[] = [];
  objs.push("<< /Type /Catalog /Pages 2 0 R >>");
  objs.push("<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>");
  objs.push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 5 0 R /Resources << /Font << /F1 7 0 R >> >> >>");
  objs.push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 6 0 R /Resources << /Font << /F1 7 0 R >> >> >>");
  const s1 = "BT /F1 24 Tf 72 760 Td (Certidao de nascimento) Tj ET";
  const s2 = "BT /F1 24 Tf 72 760 Td (Averbacoes) Tj ET";
  objs.push(`<< /Length ${s1.length} >>\nstream\n${s1}\nendstream`);
  objs.push(`<< /Length ${s2.length} >>\nstream\n${s2}\nendstream`);
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
