import { describe, expect, it } from "vitest";
import { claimsFor } from "../src/claims.js";
import { normaliseReading } from "../src/postprocess.js";
import { Claim, type PageInfo } from "../src/schema.js";
import { fixtureReading } from "./helpers.js";

const pages: PageInfo[] = [{ page: 1, file: "page-1.png", file_page: 1, width: 1600, height: 2200, sent_width: 1600, sent_height: 2200 }];

function claims(mutate?: (r: ReturnType<typeof fixtureReading>) => void) {
  const r = fixtureReading();
  mutate?.(r);
  const n = normaliseReading(r, pages);
  return { claims: claimsFor(n.entries), entries: n.entries };
}

const find = (cs: Claim[], kind: string, predicate: string, subject?: string, persona?: string) =>
  cs.filter((c) => c.kind === kind && c.predicate === predicate && (!subject || c.subject === subject) && (!persona || c.object.persona === persona));

describe("mapping a reading to claims", () => {
  const { claims: cs } = claims();

  it("produces schema-valid, uniquely numbered, proposed claims", () => {
    for (const c of cs) expect(Claim.safeParse(c).success).toBe(true);
    expect(new Set(cs.map((c) => c.id)).size).toBe(cs.length);
    expect(cs.every((c) => c.status === "proposed")).toBe(true);
  });

  it("emits one event claim per act, with date, place and participants", () => {
    const [bap] = find(cs, "event", "baptism");
    expect(bap.subject).toBe("e1.p1");
    expect(bap.object.date?.value).toBe("1847-03-23");
    expect(bap.object.place?.value).toBe("São Pedro de Rates");
    expect(bap.object.participants).toContainEqual({ persona: "e1.p8", role: "godfather" });
    const [birth] = find(cs, "event", "birth", "e1.p1");
    expect(birth.object.date?.value).toBe("1847-03-19");
    const [burial] = find(cs, "event", "burial");
    expect(burial.subject).toBe("e2.p1");
    expect(find(cs, "event", "death", "e2.p1")[0].object.date?.value).toBe("1847-04-01");
  });

  it("keeps stated relationships and does not duplicate them with role-implied ones", () => {
    const parents = find(cs, "relationship", "parent_of", undefined, "e1.p1");
    expect(parents.map((c) => c.subject).sort()).toEqual(["e1.p2", "e1.p3"]);
    expect(parents.every((c) => !c.inferred)).toBe(true);
    expect(find(cs, "relationship", "spouse_of", "e1.p2", "e1.p3")).toHaveLength(1);
    expect(find(cs, "relationship", "former_spouse_of", "e2.p2", "e2.p1")).toHaveLength(1);
    expect(find(cs, "relationship", "parent_of", "e1.p2", "e1.p1")[0].statement).toBe("Joaquim Ferreira is a parent of Maria.");
    expect(find(cs, "event", "baptism")[0].statement).toBe("Maria: baptism on 1847-03-23 at São Pedro de Rates.");
  });

  it("infers parent-of-the-father from 'neto paterno', flagged as inferred", () => {
    const [c] = find(cs, "relationship", "parent_of", "e1.p4", "e1.p2");
    expect(c.inferred).toBe(true);
    expect(find(cs, "relationship", "parent_of", "e1.p7", "e1.p3")[0].inferred).toBe(true);
  });

  it("adds role-implied relationships when the model left them out", () => {
    const { claims: cs2 } = claims((r) => r.entries[0].people.forEach((p) => (p.relations = [])));
    const [father] = find(cs2, "relationship", "parent_of", "e1.p2", "e1.p1");
    expect(father.inferred).toBe(true);
    expect(father.note).toContain("father");
    expect(find(cs2, "relationship", "godparent_of", "e1.p9", "e1.p1")).toHaveLength(1);
  });

  it("skips relationships with devotional godparents", () => {
    const { claims: cs3 } = claims((r) => {
      r.entries[0].people[8].is_real_person = false;
      r.entries[0].people[8].name.value = "Nossa Senhora";
    });
    expect(find(cs3, "relationship", "godparent_of", "e1.p9")).toHaveLength(0);
    expect(cs3.some((c) => c.subject === "e1.p9")).toBe(false);
  });

  it("links every claim to its evidence on the page", () => {
    const [name] = find(cs, "name", "name", "e1.p2");
    expect(name.object).toMatchObject({ value: "Joaquim Ferreira", as_written: "Joaq.m Ferreira" });
    expect(name.evidence[0]).toMatchObject({ path: "entries[0].people[1].name", entry_id: "e1" });
    const box = name.evidence[0].box!;
    expect(box.page).toBe(1);
    expect(box.x).toBeGreaterThan(0);
    expect(box.x + box.w).toBeLessThanOrEqual(1);
    const withEvidence = cs.filter((c) => c.evidence.length > 0);
    expect(withEvidence.length).toBe(cs.length);
  });

  it("uses the weakest evidence as the claim's reading confidence", () => {
    const [godmother] = find(cs, "name", "name", "e1.p9");
    expect(godmother.reading_confidence).toBeCloseTo(0.6);
    expect(godmother.evidence[0].legibility).toBe("partly_illegible");
  });

  it("puts person facts and record facts on the right persona", () => {
    expect(find(cs, "person_fact", "age", "e2.p1")[0].object.value).toBe("78");
    expect(find(cs, "person_fact", "occupation", "e1.p2")[0].object.as_written).toBe("lavrador");
    expect(find(cs, "record_fact", "legitimacy", "e1.p1")[0].object.value).toBe("legitimate");
  });

  it("adds spouse_of for a marriage's bride and groom", () => {
    const { claims: cs4 } = claims((r) => {
      const e = r.entries[0];
      e.type = "marriage";
      e.people[0].roles = ["groom"];
      e.people[1].roles = ["bride"];
      e.people[1].relations = [];
    });
    const [m] = find(cs4, "relationship", "spouse_of", "e1.p1", "e1.p2");
    expect(m.inferred).toBe(true);
  });
});
