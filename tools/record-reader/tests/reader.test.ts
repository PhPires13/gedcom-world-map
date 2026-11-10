import Anthropic from "@anthropic-ai/sdk";
import { writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RecordReaderError } from "../src/errors.js";
import { SYSTEM_PROMPT } from "../src/prompt.js";
import { readRecord } from "../src/reader.js";
import { ReadResult } from "../src/schema.js";
import { emptyReading, fakeClient, fixtureReading, message, SAMPLE_NONE, SAMPLE_PT, textMessage, tmp } from "./helpers.js";

const hdrs = (h: Record<string, string> = {}) => new Headers(h);
const apiError = (status: number, msg: string) => ({ type: "error", error: { type: "x", message: msg } });

async function expectCode(p: Promise<unknown>, code: string): Promise<RecordReaderError> {
  const err = await p.then(
    () => null,
    (e) => e,
  );
  expect(err).toBeInstanceOf(RecordReaderError);
  expect((err as RecordReaderError).code).toBe(code);
  return err as RecordReaderError;
}

describe("readRecord with a mocked API", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("sends the page and returns a validated, normalised result", async () => {
    const client = fakeClient([textMessage(fixtureReading())]);
    const result = await readRecord([SAMPLE_PT], { client, hints: { parish: "Rates", names: ["Joaquim Ferreira"] } });

    expect(ReadResult.safeParse(result).success).toBe(true);
    expect(result.status).toBe("partly_illegible"); // the ink blot
    expect(result.entries.map((e) => e.type)).toEqual(["baptism", "burial"]);
    expect(result.personas).toHaveLength(13);
    expect(result.claims.length).toBeGreaterThan(30);
    expect(result.source.pages[0]).toMatchObject({ width: 1600, height: 2200, sent_width: 1600, sent_height: 2200 });
    expect(result.source.files[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.hint_matches[0]).toMatchObject({ query: "Joaquim Ferreira", persona: "e1.p2" });
    expect(result.usage).toMatchObject({ requests: 1, zooms: 0, input_tokens: 1000, output_tokens: 2000 });
    // 1000*4 + 3000*4*1.25 + 2000*20 per million
    expect(result.usage.cost_usd).toBeCloseTo(0.059, 4);

    const req = client.calls[0];
    expect(req.model).toBe("claude-opus-5-5");
    expect(req.thinking).toEqual({ type: "adaptive" });
    expect(req.output_config?.effort).toBe("high");
    expect(req.output_config?.format?.type).toBe("json_schema");
    expect(req.system).toEqual([expect.objectContaining({ cache_control: { type: "ephemeral" } })]);
    expect(req.fallbacks).toBe("default");
    expect(req.betas).toContain("server-side-fallback-2026-07-01");
    const content = req.messages[0].content as Array<{ type: string; text?: string }>;
    expect(content.filter((b) => b.type === "image")).toHaveLength(1);
    const prompt = content.at(-1)!.text!;
    expect(prompt).toContain("page 1: 1600 × 2200");
    expect(prompt).toContain("expected parish: Rates");
    // The system prompt is the fixed text (hints go in the user turn), so it stays cached.
    expect((req.system as Array<{ text: string }>)[0].text).toBe(SYSTEM_PROMPT);
  });

  it("lets the model zoom into the original scan, then answer", async () => {
    const zoom = message(
      [{ type: "tool_use", id: "tu_1", name: "zoom", input: { page: 1, x0: 380, y0: 690, x1: 900, y1: 760, reason: "godmother surname" } }],
      "tool_use",
    );
    const client = fakeClient([zoom, textMessage(fixtureReading())]);
    const result = await readRecord([SAMPLE_PT], { client, zoomBudget: 2 });
    expect(result.usage).toMatchObject({ requests: 2, zooms: 1 });
    const second = client.calls[1].messages;
    expect(second).toHaveLength(3);
    expect(second[1].role).toBe("assistant");
    const toolResult = (second[2].content as Array<Record<string, unknown>>)[0];
    expect(toolResult).toMatchObject({ type: "tool_result", tool_use_id: "tu_1" });
    const parts = toolResult.content as Array<{ type: string }>;
    expect(parts.map((p) => p.type)).toEqual(["image", "text"]);
  });

  it("refuses zooms past the budget and bad zoom input without failing the read", async () => {
    const zooms = message(
      [
        { type: "tool_use", id: "a", name: "zoom", input: { page: 1, x0: 10, y0: 10, x1: 400, y1: 200, reason: "x" } },
        { type: "tool_use", id: "b", name: "zoom", input: { page: 1, x0: 10, y0: 10, x1: 400, y1: 200, reason: "y" } },
        { type: "tool_use", id: "c", name: "zoom", input: { page: 9, x0: 10, y0: 10, x1: 400, y1: 200, reason: "z" } },
        { type: "tool_use", id: "d", name: "rotate", input: {} },
      ],
      "tool_use",
    );
    const client = fakeClient([zooms, textMessage(fixtureReading())]);
    const result = await readRecord([SAMPLE_PT], { client, zoomBudget: 1 });
    const results = client.calls[1].messages[2].content as Array<{ tool_use_id: string; is_error?: boolean; content: unknown }>;
    expect(results.map((r) => !!r.is_error)).toEqual([false, true, true, true]);
    expect(String(results[1].content)).toContain("budget");
    expect(result.usage.zooms).toBe(1);
  });

  it("maps rate limits (after SDK retries) to a retryable error with retry-after", async () => {
    const client = fakeClient([new Anthropic.RateLimitError(429, apiError(429, "slow down"), "slow down", hdrs({ "retry-after": "30" }))]);
    const err = await expectCode(readRecord([SAMPLE_PT], { client }), "rate_limited");
    expect(err.retryAfter).toBe(30);
    expect(err.retryable).toBe(true);
  });

  it("maps overload, auth and connection errors", async () => {
    await expectCode(
      readRecord([SAMPLE_PT], { client: fakeClient([new Anthropic.InternalServerError(529, apiError(529, "overloaded"), "overloaded", hdrs())]) }),
      "overloaded",
    );
    await expectCode(
      readRecord([SAMPLE_PT], { client: fakeClient([new Anthropic.AuthenticationError(401, apiError(401, "bad key"), "bad key", hdrs())]) }),
      "auth_error",
    );
    await expectCode(readRecord([SAMPLE_PT], { client: fakeClient([new Anthropic.APIConnectionError({ message: "ECONNRESET" })]) }), "connection_error");
    await expectCode(
      readRecord([SAMPLE_PT], { client: fakeClient([new Anthropic.BadRequestError(400, apiError(400, "image too big"), "image too big", hdrs())]) }),
      "api_error",
    );
  });

  it("reports refusals, truncation and unparseable output", async () => {
    const refusal = message([], "refusal", { stop_details: { type: "refusal", category: null, explanation: "declined" } } as never);
    await expectCode(readRecord([SAMPLE_PT], { client: fakeClient([refusal]) }), "refused");
    await expectCode(readRecord([SAMPLE_PT], { client: fakeClient([message([{ type: "text", text: '{"document":' }], "max_tokens")]) }), "truncated");
    const notJson = await expectCode(readRecord([SAMPLE_PT], { client: fakeClient([message([{ type: "text", text: "Sorry, I can't" }])]) }), "invalid_output");
    expect(notJson.raw).toContain("Sorry");
    await expectCode(readRecord([SAMPLE_PT], { client: fakeClient([textMessage({ document: {} })]) }), "invalid_output");
  });

  it("returns not_a_record with no entries or claims for non-record images", async () => {
    const reading = emptyReading({ is_record: false, kind: "not_a_record", not_record_reason: "A drawing of a house.", script: "none" });
    // Even if the model put something in entries, a non-record yields no claims.
    reading.entries = fixtureReading().entries;
    const result = await readRecord([SAMPLE_NONE], { client: fakeClient([textMessage(reading)]) });
    expect(result.status).toBe("not_a_record");
    expect(result.entries).toEqual([]);
    expect(result.claims).toEqual([]);
  });

  it("returns illegible, without invented entries, for unreadable pages", async () => {
    const reading = emptyReading({ legibility: "illegible" });
    reading.transcription = [{ id: "l1", page: 1, text: "[illegible: whole page faded]", box: null, confidence: 0.1, has_illegible: true }];
    reading.illegible_regions = [{ page: 1, box: { page: 1, x0: 0, y0: 0, x1: 1600, y1: 2200 }, context: "", reason: "faded ink", candidate_readings: [] }];
    const result = await readRecord([SAMPLE_PT], { client: fakeClient([textMessage(reading)]) });
    expect(result.status).toBe("illegible");
    expect(result.claims).toEqual([]);
  });

  it("caps confidence and drops the value of illegible fields", async () => {
    const reading = fixtureReading();
    reading.entries[0].people[3].name = { ...reading.entries[0].people[3].name, value: "Manuel Ferreira", legibility: "illegible", confidence: 0.9 };
    const result = await readRecord([SAMPLE_PT], { client: fakeClient([textMessage(reading)]) });
    const p = result.entries[0].people[3];
    expect(p.name.value).toBeNull();
    expect(p.name.confidence).toBeLessThanOrEqual(0.2);
  });

  it("reports the fallback model when the requested one declined", async () => {
    const msg = textMessage(fixtureReading(), { model: "claude-opus-4-8" } as never);
    (msg.content as unknown[]).unshift({ type: "fallback", from: { model: "claude-opus-5-5" }, to: { model: "claude-opus-4-8" } });
    const result = await readRecord([SAMPLE_PT], { client: fakeClient([msg]) });
    expect(result.reader).toMatchObject({ model_requested: "claude-opus-5-5", model_served: "claude-opus-4-8", fallback_used: true });
    expect(result.warnings.join(" ")).toContain("claude-opus-4-8");
  });

  it("needs ANTHROPIC_API_KEY when no client is given", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    await expectCode(readRecord([SAMPLE_PT]), "missing_api_key");
  });

  it("rejects unsupported files and too many pages before calling the API", async () => {
    const dir = tmp();
    const txt = path.join(dir, "notes.txt");
    writeFileSync(txt, "hello");
    const client = fakeClient([]);
    await expectCode(readRecord([txt], { client }), "input_error");
    await expectCode(readRecord([path.join(dir, "missing.png")], { client }), "input_error");
    const png = path.join(dir, "p.png");
    await sharp({ create: { width: 50, height: 50, channels: 3, background: "#fff" } }).png().toFile(png);
    await expectCode(readRecord([png, png, png], { client, maxPages: 2 }), "too_many_pages");
    expect(client.calls).toHaveLength(0);
  });
});
