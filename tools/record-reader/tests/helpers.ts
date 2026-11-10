import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BetaMessage, MessageCreateParamsStreaming } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { ClientLike } from "../src/reader.js";
import type { ModelReading } from "../src/schema.js";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SAMPLE_PT = path.join(root, "eval/samples/synthetic-pt-1847/page-1.png");
export const SAMPLE_IT = path.join(root, "eval/samples/synthetic-it-1888/page-1.png");
export const SAMPLE_NONE = path.join(root, "eval/samples/synthetic-not-a-record/page-1.png");

export function fixtureReading(): ModelReading {
  return JSON.parse(readFileSync(path.join(root, "tests/fixtures/synthetic-pt-1847.reading.json"), "utf8"));
}

export function tmp(): string {
  return mkdtempSync(path.join(tmpdir(), "record-reader-test-"));
}

type Block = Record<string, unknown> & { type: string };

export function message(content: Block[], stop_reason: string = "end_turn", extra: Partial<BetaMessage> = {}): BetaMessage {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content,
    stop_reason,
    stop_details: null,
    stop_sequence: null,
    usage: {
      input_tokens: 1000,
      output_tokens: 2000,
      cache_creation_input_tokens: 3000,
      cache_read_input_tokens: 0,
    },
    ...extra,
  } as unknown as BetaMessage;
}

export const textMessage = (obj: unknown, extra: Partial<BetaMessage> = {}) =>
  message([{ type: "thinking", thinking: "", signature: "sig" }, { type: "text", text: JSON.stringify(obj) }], "end_turn", extra);

/** Fake Anthropic client: returns (or throws) the queued responses in order and records each request. */
export function fakeClient(responses: Array<BetaMessage | Error>) {
  const calls: MessageCreateParamsStreaming[] = [];
  const client: ClientLike & { calls: typeof calls } = {
    calls,
    beta: {
      messages: {
        stream(params) {
          // Snapshot: the reader keeps appending to the same messages array.
          calls.push({ ...params, messages: JSON.parse(JSON.stringify(params.messages)) });
          const next = responses.shift();
          return {
            finalMessage: async () => {
              if (!next) throw new Error("fake client: no more responses queued");
              if (next instanceof Error) throw next;
              return next;
            },
          };
        },
      },
    },
  };
  return client;
}

export function emptyReading(overrides: Partial<ModelReading["document"]> = {}): ModelReading {
  return {
    document: {
      is_record: true,
      not_record_reason: null,
      kind: "parish_register",
      languages: ["pt"],
      script: "handwritten",
      period_estimate: null,
      legibility: "good",
      repository_marks: null,
      ...overrides,
    },
    transcription: [],
    expanded_text: "",
    translation_en: "",
    illegible_regions: [],
    entries: [],
    reader_notes: [],
  };
}
