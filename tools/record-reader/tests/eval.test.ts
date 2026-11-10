import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ExpectedSample } from "../src/eval/expected.js";
import { loadSamples, runEval } from "../src/eval/run.js";
import { failures, formatReport, scoreSample, summarise } from "../src/eval/score.js";
import { readRecord } from "../src/reader.js";
import type { ReadResult } from "../src/schema.js";
import { emptyReading, fakeClient, fixtureReading, root, SAMPLE_NONE, SAMPLE_PT, textMessage, tmp } from "./helpers.js";

const samplesDir = path.join(root, "eval/samples");

async function resultFrom(reading = fixtureReading(), file = SAMPLE_PT): Promise<ReadResult> {
  return readRecord([file], { client: fakeClient([textMessage(reading)]) });
}

async function ptExpected() {
  const [s] = await loadSamples(samplesDir, ["synthetic-pt-1847"]);
  return s.expected;
}

const acc = (obs: ReturnType<typeof scoreSample>, metric: string) => summarise(obs, "all").all.counts[metric as never] as { accuracy: number; total: number } | undefined;

describe("evaluation harness", () => {
  it("finds the bundled samples and validates their expected files", async () => {
    const samples = await loadSamples(samplesDir);
    expect(samples.map((s) => s.id)).toEqual(["synthetic-it-1888", "synthetic-not-a-record", "synthetic-pt-1847"]);
    for (const s of samples) expect(s.files.length).toBeGreaterThan(0);
    expect(() => ExpectedSample.parse({ id: "x" })).toThrow();
  });

  it("scores a perfect reading at 100% on every field", async () => {
    const obs = scoreSample(await ptExpected(), await resultFrom());
    for (const m of ["record_detected", "entry_found", "entry_type", "date", "place", "person_found", "name", "role", "sex", "age", "occupation", "marital_status", "name_box", "illegible_flagged"]) {
      expect({ m, a: acc(obs, m)?.accuracy }).toEqual({ m, a: 1 });
    }
    expect(acc(obs, "date")!.total).toBe(4);
    expect(acc(obs, "person_found")!.total).toBe(13);
    expect(failures(obs)).toEqual([]);
    expect(summarise(obs, "all").all.means.name_cer).toBe(0);
  });

  it("counts wrong names, roles, dates and missing entries", async () => {
    const r = fixtureReading();
    r.entries[0].people[1].name.value = "Joaquim Pereira"; // wrong surname (still matched by similarity)
    r.entries[0].people[1].name.as_written = "Joaq.m Pereira";
    r.entries[0].people[3].roles = ["maternal_grandfather"];
    r.entries[0].date.value = "1847-03-24";
    r.entries.pop(); // burial not read
    const obs = scoreSample(await ptExpected(), await resultFrom(r));
    expect(acc(obs, "name")!.accuracy).toBeCloseTo(9 / 13, 3);
    expect(acc(obs, "role")!.accuracy).toBeCloseTo(9 / 13, 3);
    expect(acc(obs, "entry_found")!.accuracy).toBe(0.5);
    expect(acc(obs, "date")!.accuracy).toBe(0.25);
    const byType = summarise(obs, "entry_type");
    expect(byType.burial.counts.person_found!.accuracy).toBe(0);
    expect(byType.baptism.counts.person_found!.accuracy).toBe(1);
    expect(failures(obs).some((f) => f.includes('"Joaquim Ferreira": got "Joaquim Pereira"'))).toBe(true);
  });

  it("counts an unflagged ink blot as a miss and an invented person as extra", async () => {
    const r = fixtureReading();
    r.illegible_regions = [];
    r.transcription.forEach((l) => {
      l.has_illegible = false;
      l.text = l.text.replace("[illegible]", "Custodia");
    });
    r.entries[0].people[8].name = { ...r.entries[0].people[8].name, value: "Ana Custódia", as_written: "Anna Custodia", legibility: "clear" };
    r.entries[0].people.push({ ...r.entries[0].people[0], id: "e1.p11", name: { ...r.entries[0].people[0].name, value: "Pedro Alves", as_written: "Pedro Alves" }, roles: ["witness"] });
    const obs = scoreSample(await ptExpected(), await resultFrom(r));
    expect(acc(obs, "illegible_flagged")!.accuracy).toBe(0);
    // The invented witness, and the guessed "Ana Custódia" (too far from the checked "Anna" to match).
    expect(summarise(obs, "all").all.extra_people).toBe(2);
  });

  it("scores non-record detection", async () => {
    const [s] = await loadSamples(samplesDir, ["synthetic-not-a-record"]);
    const notRecord = await resultFrom(emptyReading({ is_record: false, kind: "not_a_record" }), SAMPLE_NONE);
    expect(acc(scoreSample(s.expected, notRecord), "record_detected")!.accuracy).toBe(1);
    const wrong = await resultFrom(fixtureReading(), SAMPLE_NONE);
    expect(acc(scoreSample(s.expected, wrong), "record_detected")!.accuracy).toBe(0);
  });

  it("runs from saved results with --score-only and reports by type, century and script", async () => {
    const results = tmp();
    mkdirSync(results, { recursive: true });
    writeFileSync(path.join(results, "synthetic-pt-1847.json"), JSON.stringify(await resultFrom()));
    const { report, text } = await runEval({ samplesDir, resultsDir: results, scoreOnly: true });
    expect(report.samples.find((s) => s.id === "synthetic-it-1888")?.status).toBe("skipped");
    expect(report.summary.century["19th c."].counts.name?.accuracy).toBe(1);
    expect(Object.keys(report.summary.entry_type)).toEqual(expect.arrayContaining(["baptism", "burial"]));
    expect(report.total_cost_usd).toBe(0); // nothing was read in this run
    expect(text).toContain("By entry type");
    expect(formatReport([])).toContain("overall");
  });
});
