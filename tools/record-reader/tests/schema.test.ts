import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ModelReading, ReadResult } from "../src/schema.js";
import { emptyReading, fixtureReading } from "./helpers.js";

function walk(node: unknown, visit: (o: Record<string, unknown>) => void): void {
  if (Array.isArray(node)) node.forEach((n) => walk(n, visit));
  else if (node && typeof node === "object") {
    visit(node as Record<string, unknown>);
    Object.values(node).forEach((v) => walk(v, visit));
  }
}

describe("model output schema", () => {
  it("accepts the ground-truth reading of the synthetic page", () => {
    expect(ModelReading.safeParse(fixtureReading()).success).toBe(true);
  });

  it("rejects readings with missing or wrongly typed fields", () => {
    const r = fixtureReading() as unknown as Record<string, unknown>;
    delete r.entries;
    expect(ModelReading.safeParse(r).success).toBe(false);
    const bad = fixtureReading();
    (bad.entries[0].people[0] as unknown as Record<string, unknown>).roles = ["pope"];
    expect(ModelReading.safeParse(bad).success).toBe(false);
    const badBox = fixtureReading();
    (badBox.entries[0].date as unknown as Record<string, unknown>).box = { page: 1, x0: "10" };
    expect(ModelReading.safeParse(badBox).success).toBe(false);
  });

  it("compiles to a JSON schema that structured outputs accept", () => {
    const { schema } = betaZodOutputFormat(ModelReading) as unknown as { schema: unknown };
    const s = JSON.stringify(schema);
    // Structured outputs: every object closed, no numeric/length constraints.
    walk(schema, (o) => {
      if (o.type === "object") {
        expect(o.additionalProperties).toBe(false);
        expect(o.required).toEqual(Object.keys(o.properties as object));
      }
    });
    for (const k of ["minimum", "maximum", "minLength", "maxLength", "multipleOf", "exclusiveMinimum"]) {
      expect(s).not.toContain(`"${k}"`);
    }
  });

  it("empty readings are valid (illegible or non-record pages)", () => {
    expect(ModelReading.safeParse(emptyReading()).success).toBe(true);
  });

  it("publishes a JSON schema for the result", () => {
    const js = z.toJSONSchema(ReadResult, { io: "output" }) as { properties: Record<string, unknown> };
    expect(Object.keys(js.properties)).toEqual(expect.arrayContaining(["entries", "claims", "personas", "transcription", "usage"]));
  });
});
