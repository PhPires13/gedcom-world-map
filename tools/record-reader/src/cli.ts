import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { RecordReaderError } from "./errors.js";
import { runEval } from "./eval/run.js";
import { DEFAULT_MODEL, readRecord, type Effort, type ReadOptions } from "./reader.js";
import { Hints, ReadResult } from "./schema.js";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const USAGE = `record-reader — reads old parish and civil records with Claude and proposes evidence-linked claims.

Usage:
  record-reader read <file...> [options]     Read one record (all files are pages of the same read)
  record-reader eval [options]               Run the evaluation samples and report accuracy
  record-reader schema                       Print the JSON Schema of the output
  record-reader help

Read options:
  --out <file.json>        Write the result here (default: print to stdout)
  --hints <json|file>      Hints as JSON or a JSON file: {"parish","place","year_from","year_to","language","record_type","names":[…],"notes"}
  --parish <name>          Expected parish             --place <name>     Expected place
  --years <1840-1850>      Expected year range         --language <pt|la|it|…>
  --type <baptism|…>       Expected record type        --names <"A;B">    Names being searched for (; separated)

Model options (read and eval):
  --model <id>             Default ${DEFAULT_MODEL}
  --effort <level>         low | medium | high | xhigh | max (default high)
  --zoom <n>               Max zoom-tool calls per read, 0 to disable (default 6)
  --max-pages <n>          Max pages per read (default 10)
  --no-fallback            Do not let the API retry on a fallback model if the requested one declines
  --quiet                  No progress messages

Eval options:
  --samples <dir>          Default eval/samples          --results <dir>   Default eval/results
  --only <id,id>           Only these samples            --out <file>      Write the JSON report
  --score-only             Score saved results only (no API calls)
  --rerun                  Re-read samples even if a saved result exists

The API key is read from ANTHROPIC_API_KEY only.`;

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case "read":
        return await readCommand(rest);
      case "eval":
        return await evalCommand(rest);
      case "schema":
        process.stdout.write(JSON.stringify(z.toJSONSchema(ReadResult, { io: "output" }), null, 2) + "\n");
        return 0;
      case undefined:
      case "help":
      case "--help":
      case "-h":
        process.stdout.write(USAGE + "\n");
        return command === undefined ? 2 : 0;
      default:
        process.stderr.write(`Unknown command "${command}".\n\n${USAGE}\n`);
        return 2;
    }
  } catch (err) {
    if (err instanceof RecordReaderError) {
      process.stderr.write(`record-reader: ${err.code}: ${err.message}\n`);
      if (err.raw && process.env.RECORD_READER_DEBUG) process.stderr.write(`--- raw model output ---\n${err.raw}\n`);
      return err.code === "input_error" || err.code === "too_many_pages" ? 2 : 1;
    }
    if (err instanceof TypeError && /option|argument/i.test(err.message)) {
      process.stderr.write(`record-reader: ${err.message}\n`);
      return 2;
    }
    throw err;
  }
}

const modelOptions = {
  model: { type: "string" },
  effort: { type: "string" },
  zoom: { type: "string" },
  "max-pages": { type: "string" },
  "no-fallback": { type: "boolean" },
  quiet: { type: "boolean" },
} as const;

function readerOptions(values: Record<string, unknown>): ReadOptions {
  const effort = values.effort as string | undefined;
  if (effort && !["low", "medium", "high", "xhigh", "max"].includes(effort)) {
    throw new RecordReaderError("input_error", `--effort must be low, medium, high, xhigh or max (got "${effort}").`);
  }
  const int = (name: string): number | undefined => {
    const v = values[name] as string | undefined;
    if (v === undefined) return undefined;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) throw new RecordReaderError("input_error", `--${name} must be a whole number.`);
    return n;
  };
  return {
    model: values.model as string | undefined,
    effort: effort as Effort | undefined,
    zoomBudget: int("zoom"),
    maxPages: int("max-pages"),
    fallbacks: !values["no-fallback"],
    onProgress: values.quiet ? undefined : (m) => process.stderr.write(`${m}\n`),
  };
}

export function parseHints(values: Record<string, unknown>): Hints | null {
  let hints: Record<string, unknown> = {};
  const raw = values.hints as string | undefined;
  if (raw) {
    const text = raw.trim().startsWith("{") ? raw : existsSync(raw) ? readFileSync(raw, "utf8") : null;
    if (text === null) throw new RecordReaderError("input_error", `--hints is neither JSON nor an existing file: ${raw}`);
    try {
      hints = JSON.parse(text);
    } catch {
      throw new RecordReaderError("input_error", "--hints is not valid JSON.");
    }
  }
  if (values.parish) hints.parish = values.parish;
  if (values.place) hints.place = values.place;
  if (values.language) hints.language = values.language;
  if (values.type) hints.record_type = values.type;
  if (values.names) hints.names = String(values.names).split(";").map((s) => s.trim()).filter(Boolean);
  if (values.years) {
    const m = String(values.years).match(/^(\d{3,4})(?:\s*[-–]\s*(\d{3,4}))?$/);
    if (!m) throw new RecordReaderError("input_error", `--years must look like 1840-1850 or 1847 (got "${values.years}").`);
    hints.year_from = Number(m[1]);
    hints.year_to = Number(m[2] ?? m[1]);
  }
  if (!Object.keys(hints).length) return null;
  const parsed = Hints.safeParse(hints);
  if (!parsed.success) throw new RecordReaderError("input_error", `Invalid hints: ${parsed.error.message}`);
  return parsed.data;
}

async function readCommand(args: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      ...modelOptions,
      out: { type: "string", short: "o" },
      hints: { type: "string" },
      parish: { type: "string" },
      place: { type: "string" },
      years: { type: "string" },
      language: { type: "string" },
      type: { type: "string" },
      names: { type: "string" },
    },
  });
  if (!positionals.length) throw new RecordReaderError("input_error", "Give at least one image or PDF to read.");
  const opts = readerOptions(values);
  const result = await readRecord(positionals, { ...opts, hints: parseHints(values) });
  const json = JSON.stringify(result, null, 2) + "\n";
  if (values.out) {
    await mkdir(path.dirname(path.resolve(values.out)), { recursive: true });
    await writeFile(values.out, json);
    if (!values.quiet) {
      const u = result.usage;
      process.stderr.write(
        `Wrote ${values.out}: ${result.status}, ${result.entries.length} entries, ${result.claims.length} proposed claims, ${result.warnings.length} warnings; ` +
          `${u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens} input / ${u.output_tokens} output tokens` +
          `${u.cost_usd != null ? `, ~$${u.cost_usd.toFixed(3)}` : ""}.\n`,
      );
    }
  } else {
    process.stdout.write(json);
  }
  return 0;
}

async function evalCommand(args: string[]): Promise<number> {
  const { values } = parseArgs({
    args,
    options: {
      ...modelOptions,
      samples: { type: "string" },
      results: { type: "string" },
      only: { type: "string" },
      out: { type: "string", short: "o" },
      "score-only": { type: "boolean" },
      rerun: { type: "boolean" },
    },
  });
  const opts = readerOptions(values);
  const { report, text } = await runEval({
    ...opts,
    samplesDir: values.samples ?? path.join(pkgRoot, "eval", "samples"),
    resultsDir: values.results ?? path.join(pkgRoot, "eval", "results"),
    only: values.only?.split(",").map((s) => s.trim()).filter(Boolean),
    scoreOnly: values["score-only"],
    rerun: values.rerun,
    log: values.quiet ? undefined : (l) => process.stderr.write(`${l}\n`),
  });
  process.stdout.write(text + "\n");
  if (values.out) await writeFile(values.out, JSON.stringify(report, null, 2) + "\n");
  return 0;
}
