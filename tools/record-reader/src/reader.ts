/**
 * The record reader: sends page images to Claude, lets it zoom into the
 * original scan, and validates/normalises its structured reading.
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaToolResultBlockParam,
  MessageCreateParamsStreaming,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";
import { claimsFor, personasFor } from "./claims.js";
import { estimateCost, type TokenUsage } from "./cost.js";
import { RecordReaderError } from "./errors.js";
import { cropForZoom, loadPages, type LoadedFile, type PageImage } from "./pages.js";
import { matchHints, normaliseReading } from "./postprocess.js";
import { buildUserText, SYSTEM_PROMPT, ZOOM_TOOL } from "./prompt.js";
import { Hints, ModelReading, ReadResult, SCHEMA_VERSION } from "./schema.js";

export const READER_VERSION = "0.1.0";
export const DEFAULT_MODEL = "claude-opus-5-5";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** The part of the Anthropic client the reader uses (lets tests inject a fake). */
export interface ClientLike {
  beta: {
    messages: {
      stream(params: MessageCreateParamsStreaming): { finalMessage(): Promise<BetaMessage> };
    };
  };
}

export interface ReadOptions {
  hints?: Hints | null;
  /** Claude model id. Default claude-opus-5-5. */
  model?: string;
  /** Thinking depth / token spend. Default "high" — old handwriting rewards it. */
  effort?: Effort;
  /** Max zoom-tool calls per read (0 disables zooming). Default 6. */
  zoomBudget?: number;
  /** Max pages per read. Default 10. */
  maxPages?: number;
  maxTokens?: number;
  /** Server-side fallback to another model if the requested one declines. Default true. */
  fallbacks?: boolean;
  /** API key; defaults to the ANTHROPIC_API_KEY environment variable. */
  apiKey?: string;
  /** Retries for 429/5xx/connection errors, with backoff (handled by the SDK). Default 4. */
  maxRetries?: number;
  client?: ClientLike;
  onProgress?: (message: string) => void;
}

const ZoomInput = z.object({
  page: z.number().int(),
  x0: z.number(),
  y0: z.number(),
  x1: z.number(),
  y1: z.number(),
  reason: z.string(),
});

export function createClient(opts: Pick<ReadOptions, "apiKey" | "maxRetries"> = {}): ClientLike {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new RecordReaderError(
      "missing_api_key",
      "ANTHROPIC_API_KEY is not set. Export it in your shell (never commit it) and try again.",
    );
  }
  // authToken: null so only ANTHROPIC_API_KEY is ever used.
  return new Anthropic({ apiKey, authToken: null, maxRetries: opts.maxRetries ?? 4 });
}

/** Reads one record (one or more pages) from image/PDF files. */
export async function readRecord(files: string[], opts: ReadOptions = {}): Promise<ReadResult> {
  const hints = opts.hints ? Hints.parse(opts.hints) : null;
  const client = opts.client ?? createClient(opts);
  const { files: loaded, pages } = await loadPages(files, opts.maxPages ?? 10);
  return readPages(loaded, pages, { ...opts, hints, client });
}

/** Same as readRecord, for pages already loaded with loadPages(). */
export async function readPages(
  files: LoadedFile[],
  pages: PageImage[],
  opts: ReadOptions & { client: ClientLike },
): Promise<ReadResult> {
  const model = opts.model ?? DEFAULT_MODEL;
  const effort = opts.effort ?? "high";
  const zoomBudget = Math.max(0, opts.zoomBudget ?? 6);
  const hints = opts.hints ?? null;
  const progress = opts.onProgress ?? (() => {});
  const useFallbacks = opts.fallbacks ?? true;

  const userContent: BetaContentBlockParam[] = [];
  for (const p of pages) {
    userContent.push({ type: "text", text: `Page ${p.info.page}:` });
    userContent.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: p.sent.toString("base64") } });
  }
  userContent.push({ type: "text", text: buildUserText(pages.map((p) => p.info), hints, zoomBudget) });
  const messages: BetaMessageParam[] = [{ role: "user", content: userContent }];

  const usage: TokenUsage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  let requests = 0;
  let zooms = 0;
  let servedBy = model;
  let fallbackUsed = false;
  const maxTurns = zoomBudget + 3;

  for (let turn = 0; ; turn++) {
    if (turn >= maxTurns) {
      throw new RecordReaderError("invalid_output", `No final reading after ${maxTurns} model turns.`);
    }
    progress(turn === 0 ? `Reading ${pages.length} page(s) with ${model}…` : `Continuing after zoom (${zooms}/${zoomBudget})…`);
    const params: MessageCreateParamsStreaming = {
      model,
      max_tokens: opts.maxTokens ?? 64000,
      stream: true,
      // Stable instructions first and cached; the top-level breakpoint caches the growing conversation across zoom turns.
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      cache_control: { type: "ephemeral" },
      messages,
      thinking: { type: "adaptive" },
      output_config: { effort, format: betaZodOutputFormat(ModelReading) },
      tools: [ZOOM_TOOL],
      tool_choice: { type: "auto" },
      ...(useFallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    };
    const response = await callModel(opts.client, params);
    requests++;
    addUsage(usage, response);
    servedBy = response.model ?? servedBy;
    if (response.content.some((b) => (b as { type: string }).type === "fallback")) fallbackUsed = true;
    if (response.usage?.iterations?.some((it) => it.type === "fallback_message")) fallbackUsed = true;

    switch (response.stop_reason) {
      case "refusal": {
        const d = response.stop_details;
        throw new RecordReaderError(
          "refused",
          `The model declined to read this page${d?.category ? ` (${d.category})` : ""}${d?.explanation ? `: ${d.explanation}` : "."}`,
        );
      }
      case "max_tokens":
        throw new RecordReaderError(
          "truncated",
          "The reading hit max_tokens before it was complete. Read fewer pages at once or raise maxTokens.",
        );
      case "tool_use":
      case "pause_turn": {
        messages.push({ role: "assistant", content: response.content as BetaContentBlockParam[] });
        if (response.stop_reason === "pause_turn") continue;
        const results: BetaToolResultBlockParam[] = [];
        for (const block of response.content) {
          if (block.type !== "tool_use") continue;
          results.push(await runTool(block, pages, () => zooms < zoomBudget, () => zooms++));
        }
        messages.push({ role: "user", content: results });
        continue;
      }
      default: {
        const reading = parseReading(response.content);
        return assemble(reading, { files, pages, hints, model, servedBy, fallbackUsed, effort, usage, requests, zooms });
      }
    }
  }
}

async function callModel(client: ClientLike, params: MessageCreateParamsStreaming): Promise<BetaMessage> {
  try {
    return await client.beta.messages.stream(params).finalMessage();
  } catch (err) {
    throw mapApiError(err);
  }
}

export function mapApiError(err: unknown): unknown {
  if (err instanceof RecordReaderError) return err;
  if (err instanceof Anthropic.RateLimitError) {
    const ra = Number(err.headers?.get?.("retry-after"));
    return new RecordReaderError(
      "rate_limited",
      `Rate limited by the Claude API after retries${Number.isFinite(ra) && ra > 0 ? `; retry in ${ra}s` : ""}.`,
      { retryAfter: Number.isFinite(ra) && ra > 0 ? ra : null, cause: err },
    );
  }
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new RecordReaderError("auth_error", `The Claude API rejected the API key: ${err.message}`, { cause: err });
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new RecordReaderError("connection_error", `Could not reach the Claude API: ${err.message}`, { cause: err });
  }
  if (err instanceof Anthropic.APIError) {
    if (err.status === 529) {
      return new RecordReaderError("overloaded", "The Claude API is overloaded; try again in a few minutes.", { cause: err });
    }
    return new RecordReaderError("api_error", `Claude API error ${err.status ?? ""}: ${err.message}`, { cause: err });
  }
  return err;
}

async function runTool(
  block: Extract<BetaContentBlock, { type: "tool_use" }>,
  pages: PageImage[],
  canZoom: () => boolean,
  countZoom: () => void,
): Promise<BetaToolResultBlockParam> {
  const fail = (text: string): BetaToolResultBlockParam => ({
    type: "tool_result",
    tool_use_id: block.id,
    is_error: true,
    content: text,
  });
  if (block.name !== ZOOM_TOOL.name) return fail(`Unknown tool "${block.name}".`);
  if (!canZoom()) return fail("Zoom budget used up. Answer now with the JSON reading, marking anything still unreadable as illegible.");
  const input = ZoomInput.safeParse(block.input);
  if (!input.success) return fail(`Invalid zoom input: ${input.error.message}`);
  const page = pages.find((p) => p.info.page === input.data.page);
  if (!page) return fail(`There is no page ${input.data.page}; pages are 1..${pages.length}.`);
  try {
    const crop = await cropForZoom(page, input.data);
    countZoom();
    return {
      type: "tool_result",
      tool_use_id: block.id,
      content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: crop.data.toString("base64") } },
        {
          type: "text",
          text: `Page ${page.info.page}, region (${Math.round(input.data.x0)},${Math.round(input.data.y0)})–(${Math.round(input.data.x1)},${Math.round(input.data.y1)}) in page pixels, shown at ${crop.scale.toFixed(1)}× (slightly padded). Boxes in your answer stay in full-page pixels.`,
        },
      ],
    };
  } catch (err) {
    return fail(`Zoom failed: ${(err as Error).message}`);
  }
}

function addUsage(total: TokenUsage, response: BetaMessage): void {
  const u = response.usage;
  if (!u) return;
  total.input_tokens += u.input_tokens ?? 0;
  total.output_tokens += u.output_tokens ?? 0;
  total.cache_creation_input_tokens += u.cache_creation_input_tokens ?? 0;
  total.cache_read_input_tokens += u.cache_read_input_tokens ?? 0;
}

export function parseReading(content: BetaContentBlock[]): ModelReading {
  const text = content
    .filter((b): b is Extract<BetaContentBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");
  if (!text.trim()) throw new RecordReaderError("invalid_output", "The model returned no reading.");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new RecordReaderError("invalid_output", "The model's answer is not valid JSON.", { raw: text });
  }
  const parsed = ModelReading.safeParse(json);
  if (!parsed.success) {
    throw new RecordReaderError("invalid_output", `The model's answer does not match the schema: ${parsed.error.message}`, { raw: text });
  }
  return parsed.data;
}

function assemble(
  reading: ModelReading,
  ctx: {
    files: LoadedFile[];
    pages: PageImage[];
    hints: Hints | null;
    model: string;
    servedBy: string;
    fallbackUsed: boolean;
    effort: string;
    usage: TokenUsage;
    requests: number;
    zooms: number;
  },
): ReadResult {
  const pageInfos = ctx.pages.map((p) => p.info);
  const n = normaliseReading(reading, pageInfos);
  const result: ReadResult = {
    schema_version: SCHEMA_VERSION,
    status: n.status,
    source: { files: ctx.files, pages: pageInfos, hints: ctx.hints },
    reader: {
      version: READER_VERSION,
      model_requested: ctx.model,
      model_served: ctx.servedBy,
      fallback_used: ctx.fallbackUsed,
      effort: ctx.effort,
      read_at: new Date().toISOString(),
    },
    usage: {
      requests: ctx.requests,
      zooms: ctx.zooms,
      ...ctx.usage,
      cost_usd: estimateCost(ctx.servedBy, ctx.usage),
    },
    document: n.document,
    transcription: n.transcription,
    expanded_text: n.expanded_text,
    translation_en: n.translation_en,
    illegible_regions: n.illegible_regions,
    entries: n.status === "not_a_record" ? [] : n.entries,
    personas: n.status === "not_a_record" ? [] : personasFor(n.entries),
    claims: n.status === "not_a_record" ? [] : claimsFor(n.entries),
    hint_matches: matchHints(ctx.hints, n.entries),
    reader_notes: n.reader_notes,
    warnings: n.warnings,
  };
  if (ctx.fallbackUsed) result.warnings.push(`The requested model declined; ${ctx.servedBy} produced this reading.`);
  // Final guard: the result we hand out always matches the published schema.
  return ReadResult.parse(result);
}
