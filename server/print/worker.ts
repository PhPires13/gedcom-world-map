// Renders print files in a worker thread, so a 10–50 s render doesn't stop the API from answering.
// One worker per job: renders are rare and memory-heavy (an A1 is ~300 MB of pixels), and a fresh
// thread gives all of it back when it ends.

import { isMainThread, parentPort, Worker } from 'node:worker_threads';
import type { DesignSpec } from '../../src/commerce/design';
import type { TreeDetail } from '../../src/model';
import type { PaperSize } from '../../src/print/types';
import type { RenderedFiles } from '../commerce/pipeline';
import { preparePrint, renderPrintFiles } from './render';

interface Job {
  detail: Pick<TreeDetail, 'people' | 'relationships'>;
  design: DesignSpec;
  paper: PaperSize;
}

/** Renders in a worker thread; falls back to this thread if workers can't load TypeScript here. */
export function renderInWorker(detail: Job['detail'], design: DesignSpec, paper: PaperSize): Promise<RenderedFiles> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url));
    worker.once('message', (m: { ok: true; files: RenderedFiles } | { ok: false; error: string }) => {
      void worker.terminate();
      if (m.ok) resolve(m.files);
      else reject(new Error(m.error));
    });
    worker.once('error', reject);
    worker.postMessage({ detail: { people: detail.people, relationships: detail.relationships }, design, paper } satisfies Job);
  });
}

if (!isMainThread && parentPort) {
  const port = parentPort;
  port.once('message', async (job: Job) => {
    try {
      const f = await renderPrintFiles(preparePrint(job.detail, job.design, job.paper));
      const files: RenderedFiles = { png: f.png, pdf: f.pdf, svg: f.svg, widthPx: f.widthPx, heightPx: f.heightPx, peopleOnMap: f.peopleOnMap };
      port.postMessage({ ok: true, files }, [f.png.buffer as ArrayBuffer, f.pdf.buffer as ArrayBuffer]);
    } catch (e) {
      port.postMessage({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
}
