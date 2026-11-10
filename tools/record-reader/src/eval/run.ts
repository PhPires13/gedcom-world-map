/**
 * Evaluation runner: reads every sample folder, runs the reader (or reuses a
 * saved result), scores it against expected.json and writes a report.
 *
 * Folder format (see README → Evaluation):
 *   eval/samples/<id>/expected.json   hand-checked expectations
 *   eval/samples/<id>/<page files>    images or PDFs, in name order unless expected.files says otherwise
 *   eval/results/<id>.json            saved reader output (written by the runner, git-ignored)
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { RecordReaderError } from "../errors.js";
import { mediaTypeFor } from "../pages.js";
import { readRecord, type ReadOptions } from "../reader.js";
import { ReadResult } from "../schema.js";
import { ExpectedSample, type ExpectedSampleParsed } from "./expected.js";
import { failures, formatReport, type Observation, scoreSample, summarise } from "./score.js";

export interface EvalOptions extends ReadOptions {
  samplesDir: string;
  resultsDir: string;
  only?: string[];
  /** Score saved results only; never call the API. */
  scoreOnly?: boolean;
  /** Re-run the reader even if a saved result exists (otherwise saved results are reused, at no cost). */
  rerun?: boolean;
  log?: (line: string) => void;
}

export interface Sample {
  id: string;
  dir: string;
  files: string[];
  expected: ExpectedSampleParsed;
}

export async function loadSamples(samplesDir: string, only?: string[]): Promise<Sample[]> {
  const ids = (await readdir(samplesDir, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((id) => !only?.length || only.includes(id))
    .sort();
  const samples: Sample[] = [];
  for (const id of ids) {
    const dir = path.join(samplesDir, id);
    const expectedPath = path.join(dir, "expected.json");
    if (!existsSync(expectedPath)) continue;
    let expected: ExpectedSampleParsed;
    try {
      expected = ExpectedSample.parse(JSON.parse(await readFile(expectedPath, "utf8")));
    } catch (err) {
      throw new RecordReaderError("input_error", `${expectedPath} is not a valid expected file: ${(err as Error).message}`);
    }
    const files = expected.files?.length
      ? expected.files.map((f) => path.join(dir, f))
      : (await readdir(dir)).filter((f) => mediaTypeFor(f)).sort().map((f) => path.join(dir, f));
    if (!files.length) throw new RecordReaderError("input_error", `Sample ${id} has no page images.`);
    samples.push({ id, dir, files, expected });
  }
  return samples;
}

export interface EvalReport {
  generated_at: string;
  samples: Array<{ id: string; status: string; cost_usd: number | null; error?: string }>;
  summary: Record<string, ReturnType<typeof summarise>>;
  failures: string[];
  total_cost_usd: number;
}

export async function runEval(opts: EvalOptions): Promise<{ report: EvalReport; text: string; observations: Observation[] }> {
  const log = opts.log ?? (() => {});
  const samples = await loadSamples(opts.samplesDir, opts.only);
  if (!samples.length) throw new RecordReaderError("input_error", `No samples found in ${opts.samplesDir}.`);
  await mkdir(opts.resultsDir, { recursive: true });
  const observations: Observation[] = [];
  const perSample: EvalReport["samples"] = [];
  let totalCost = 0;

  for (const s of samples) {
    const resultPath = path.join(opts.resultsDir, `${s.id}.json`);
    let result: ReadResult | null = null;
    let fresh = false;
    if (!opts.rerun && existsSync(resultPath)) {
      result = ReadResult.parse(JSON.parse(await readFile(resultPath, "utf8")));
      log(`${s.id}: using saved result`);
    } else if (opts.scoreOnly) {
      log(`${s.id}: no saved result, skipped (--score-only)`);
      perSample.push({ id: s.id, status: "skipped", cost_usd: null });
      continue;
    } else {
      log(`${s.id}: reading ${s.files.length} page(s)…`);
      try {
        result = await readRecord(s.files, { ...opts, hints: s.expected.hints ?? opts.hints ?? null });
        await writeFile(resultPath, JSON.stringify(result, null, 2) + "\n");
        fresh = true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`${s.id}: failed — ${msg}`);
        perSample.push({ id: s.id, status: "error", cost_usd: null, error: msg });
        if (err instanceof RecordReaderError && (err.code === "missing_api_key" || err.code === "auth_error")) throw err;
        continue;
      }
    }
    if (fresh) totalCost += result.usage.cost_usd ?? 0;
    perSample.push({ id: s.id, status: result.status, cost_usd: result.usage.cost_usd });
    observations.push(...scoreSample(s.expected, result));
  }

  const report: EvalReport = {
    generated_at: new Date().toISOString(),
    samples: perSample,
    summary: {
      all: summarise(observations, "all"),
      entry_type: summarise(observations, "entry_type"),
      century: summarise(observations, "century"),
      script: summarise(observations, "script"),
      language: summarise(observations, "language"),
      sample: summarise(observations, "sample"),
    },
    failures: failures(observations),
    total_cost_usd: Math.round(totalCost * 10000) / 10000,
  };
  const text = [
    formatReport(observations),
    "",
    `Samples: ${perSample.map((p) => `${p.id} (${p.status}${p.cost_usd != null ? `, $${p.cost_usd.toFixed(3)}` : ""})`).join(", ")}`,
    `Total cost of reads in this run: $${report.total_cost_usd.toFixed(3)}`,
    report.failures.length ? `\nMisses (${report.failures.length}):\n  ${report.failures.join("\n  ")}` : "\nNo misses.",
  ].join("\n");
  return { report, text, observations };
}
