/**
 * Turns input files (images or PDFs) into page images:
 *  - `original`: the page at full resolution (used for zoom crops),
 *  - `sent`: a JPEG scaled to fit the model's high-resolution image limit
 *    (2576 px long edge, ~3.75 MP), so the model's pixel coordinates map 1:1
 *    onto the image it saw.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { RecordReaderError } from "./errors.js";
import type { PageInfo } from "./schema.js";

export const MAX_LONG_EDGE = 2576;
export const MAX_PIXELS = 3_750_000;
/** The API rejects images above 5 MB (base64 grows ~33%), so keep the binary well under. */
const MAX_IMAGE_BYTES = 3_600_000;
/** PDF pages are rendered at this resolution for the "original". */
const PDF_DPI = 300;
const PDF_MAX_LONG_EDGE = 6000;

const IMAGE_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".gif": "image/gif",
};

export interface PageImage {
  info: PageInfo;
  /** Full-resolution page (any sharp-readable format). */
  original: Buffer;
  /** JPEG sent to the model. */
  sent: Buffer;
}

export interface LoadedFile {
  path: string;
  sha256: string;
  media_type: string;
}

export function mediaTypeFor(file: string): string | null {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  return IMAGE_TYPES[ext] ?? null;
}

/** Size that fits both the long-edge and the total-pixel limits, never upscaling. */
export function fitWithinLimits(width: number, height: number): { width: number; height: number } {
  let scale = Math.min(1, MAX_LONG_EDGE / Math.max(width, height));
  if (width * height * scale * scale > MAX_PIXELS) {
    scale = Math.sqrt(MAX_PIXELS / (width * height));
  }
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

export async function encodeForModel(original: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  // .rotate() applies EXIF orientation so coordinates match what a viewer shows.
  const oriented = await sharp(original).rotate().toBuffer({ resolveWithObject: true });
  const { width, height } = fitWithinLimits(oriented.info.width, oriented.info.height);
  let quality = 90;
  for (;;) {
    const data = await sharp(oriented.data)
      .resize(width, height, { fit: "fill" })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();
    if (data.length <= MAX_IMAGE_BYTES || quality <= 50) return { data, width, height };
    quality -= 10;
  }
}

async function renderPdf(data: Buffer): Promise<Buffer[]> {
  // pdfjs + @napi-rs/canvas are only needed for PDFs, so load them lazily.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { createCanvas } = await import("@napi-rs/canvas");
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(data), verbosity: 0 });
  const doc = await loadingTask.promise;
  const out: Buffer[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      let scale = PDF_DPI / 72;
      const longEdge = Math.max(base.width, base.height) * scale;
      if (longEdge > PDF_MAX_LONG_EDGE) scale *= PDF_MAX_LONG_EDGE / longEdge;
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      // pdfjs draws on a @napi-rs/canvas in Node (it is canvas-API compatible); background is white by default.
      await page.render({ canvas: canvas as never, viewport }).promise;
      out.push(canvas.toBuffer("image/png"));
      page.cleanup();
    }
  } finally {
    await loadingTask.destroy();
  }
  return out;
}

export async function loadPages(
  files: string[],
  maxPages: number,
): Promise<{ files: LoadedFile[]; pages: PageImage[] }> {
  if (files.length === 0) throw new RecordReaderError("input_error", "No input files given.");
  const loaded: LoadedFile[] = [];
  const pages: PageImage[] = [];
  for (const file of files) {
    const media_type = mediaTypeFor(file);
    if (!media_type) {
      throw new RecordReaderError("input_error", `Unsupported file type: ${file} (use JPEG, PNG, WebP, TIFF, GIF or PDF).`);
    }
    let data: Buffer;
    try {
      data = await readFile(file);
    } catch (err) {
      throw new RecordReaderError("input_error", `Cannot read ${file}: ${(err as Error).message}`);
    }
    loaded.push({ path: file, sha256: createHash("sha256").update(data).digest("hex"), media_type });
    let originals: Buffer[];
    try {
      if (media_type === "application/pdf") {
        originals = await renderPdf(data);
      } else if (media_type === "image/tiff") {
        // Multi-page TIFFs are common for archive scans.
        const meta = await sharp(data).metadata();
        const n = meta.pages ?? 1;
        originals = [];
        for (let i = 0; i < n; i++) originals.push(await sharp(data, { page: i }).png().toBuffer());
      } else {
        originals = [data];
      }
    } catch (err) {
      throw new RecordReaderError("input_error", `Cannot decode ${file}: ${(err as Error).message}`);
    }
    for (let i = 0; i < originals.length; i++) {
      if (pages.length >= maxPages) {
        throw new RecordReaderError(
          "too_many_pages",
          `More than ${maxPages} pages in one read. Read the pages of one record together and split long registers into separate reads (or raise maxPages).`,
        );
      }
      const oriented = await sharp(originals[i]).rotate().png().toBuffer({ resolveWithObject: true });
      const sent = await encodeForModel(oriented.data);
      pages.push({
        info: {
          page: pages.length + 1,
          file,
          file_page: i + 1,
          width: oriented.info.width,
          height: oriented.info.height,
          sent_width: sent.width,
          sent_height: sent.height,
        },
        original: oriented.data,
        sent: sent.data,
      });
    }
  }
  return { files: loaded, pages };
}

/** Crops a region given in sent-image pixels from the original page and returns a JPEG for the model. */
export async function cropForZoom(
  page: PageImage,
  box: { x0: number; y0: number; x1: number; y1: number },
): Promise<{ data: Buffer; width: number; height: number; scale: number }> {
  const { width: W, height: H, sent_width: sw, sent_height: sh } = page.info;
  const fx = W / sw;
  const fy = H / sh;
  let x0 = Math.max(0, Math.min(box.x0, box.x1) * fx);
  let y0 = Math.max(0, Math.min(box.y0, box.y1) * fy);
  let x1 = Math.min(W, Math.max(box.x0, box.x1) * fx);
  let y1 = Math.min(H, Math.max(box.y0, box.y1) * fy);
  // Pad a little so letters on the edge are not cut, and enforce a minimum size.
  const padX = Math.max(8, (x1 - x0) * 0.05);
  const padY = Math.max(8, (y1 - y0) * 0.1);
  x0 = Math.max(0, x0 - padX);
  y0 = Math.max(0, y0 - padY);
  x1 = Math.min(W, x1 + padX);
  y1 = Math.min(H, y1 + padY);
  if (x1 - x0 < 16 || y1 - y0 < 16) throw new RecordReaderError("input_error", "Zoom region is empty or outside the page.");
  const left = Math.floor(x0);
  const top = Math.floor(y0);
  const width = Math.max(1, Math.min(W - left, Math.ceil(x1 - x0)));
  const height = Math.max(1, Math.min(H - top, Math.ceil(y1 - y0)));
  // Show the crop at 800–1568 px on its long edge: enlarged when small, capped to keep image tokens modest.
  const long = Math.max(width, height);
  const target = Math.min(1568, Math.max(800, long));
  const scale = target / long;
  const data = await sharp(page.original)
    .extract({ left, top, width, height })
    .resize(Math.round(width * scale), Math.round(height * scale))
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 90 })
    .toBuffer();
  // Effective magnification relative to what the model saw on the full page.
  return { data, width: Math.round(width * scale), height: Math.round(height * scale), scale: (scale * W) / sw };
}
