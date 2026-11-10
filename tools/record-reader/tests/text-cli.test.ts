import { describe, expect, it, vi } from "vitest";
import { main, parseHints } from "../src/cli.js";
import { matchHints } from "../src/postprocess.js";
import { cer, foldName, nameSimilarity, queryMatchScore, stripMarkup } from "../src/text.js";

describe("name folding", () => {
  it("treats historical and modern spellings as the same name", () => {
    expect(foldName("Thereza de Jesus")).toBe(foldName("Teresa de Jesus"));
    expect(foldName("Jozé")).toBe(foldName("José"));
    expect(foldName("Anna Rosa")).toBe(foldName("Ana Rosa"));
    expect(foldName("Manoel")).toBe(foldName("Manuel"));
    expect(foldName("Luiz")).toBe(foldName("Luís"));
    expect(foldName("Maria")).not.toBe(foldName("Mario"));
  });

  it("strips illegible markup but keeps uncertain readings", () => {
    expect(stripMarkup("Anna [illegible] da [?Silva?]")).toBe("Anna da Silva");
    expect(cer("Anna", "Ana [illegible]")).toBeCloseTo(0.25);
    expect(nameSimilarity("Joaquim Ferreira", "Joaquim Ferreyra")).toBe(1);
  });

  it("matches searched surnames against full names", () => {
    expect(queryMatchScore("Ferreira", "Joaquim Ferreira")).toBe(1);
    expect(queryMatchScore("Ferreira", "Antonio Gomes")).toBeLessThan(0.8);
    const entries = [{ people: [{ id: "e1.p1", name: { value: "Manuel Ferreira", as_written: "Manoel Ferreira" } }] }] as never;
    expect(matchHints({ names: ["Manoel Ferreira", "Cardinale"] }, entries)).toEqual([
      { query: "Manoel Ferreira", persona: "e1.p1", name: "Manuel Ferreira", score: 1 },
    ]);
  });
});

describe("CLI", () => {
  it("parses hints from JSON and from flags", () => {
    expect(parseHints({ hints: '{"parish":"Rates","names":["A"]}', years: "1840-1850", names: "Ferreira; Gomes", language: "pt" })).toEqual({
      parish: "Rates",
      names: ["Ferreira", "Gomes"],
      year_from: 1840,
      year_to: 1850,
      language: "pt",
    });
    expect(parseHints({ years: "1847" })).toEqual({ year_from: 1847, year_to: 1847 });
    expect(parseHints({})).toBeNull();
    expect(() => parseHints({ years: "the 1840s" })).toThrow(/years/);
    expect(() => parseHints({ hints: "{nope" })).toThrow(/JSON/);
  });

  it("returns usage errors and needs an API key", async () => {
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    try {
      expect(await main(["frobnicate"])).toBe(2);
      expect(await main(["read"])).toBe(2);
      expect(await main(["read", "x.png", "--effort", "extreme"])).toBe(2);
      expect(await main(["read", "x.png"])).toBe(1);
      expect(err.mock.calls.flat().join("")).toContain("missing_api_key");
      expect(await main(["schema"])).toBe(0);
      expect(String(out.mock.calls.at(-1)?.[0])).toContain('"claims"');
    } finally {
      err.mockRestore();
      out.mockRestore();
      vi.unstubAllEnvs();
    }
  });
});
