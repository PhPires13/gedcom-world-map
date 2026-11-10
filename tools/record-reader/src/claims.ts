/**
 * Maps a normalised reading onto neutral, evidence-linked claims.
 *
 * A claim is one statement the record makes about one persona (a person as
 * mentioned in this record; persona ids like `e1.p2` are local to the read).
 * Matching personas to people in the tree is a later, human-confirmed step.
 * Every claim carries its evidence (field path, words as written, box on the
 * page, reading confidence) and the status "proposed". See README → Claims.
 */
import type { Claim, Entry, EvidenceRef, Field, Persona, Person, RelationType, Role } from "./schema.js";

const PRINCIPAL_ROLES: Role[] = ["subject", "groom", "bride"];
/** Entry types where father/mother/grandparents/godparents relate to the subject. */
const CHILD_CENTRED: Entry["type"][] = ["baptism", "birth", "confirmation", "death", "burial"];

const ROLE_IMPLIED: Partial<Record<Role, RelationType>> = {
  father: "parent_of",
  mother: "parent_of",
  paternal_grandfather: "grandparent_of",
  paternal_grandmother: "grandparent_of",
  maternal_grandfather: "grandparent_of",
  maternal_grandmother: "grandparent_of",
  godfather: "godparent_of",
  godmother: "godparent_of",
  godparent: "godparent_of",
  spouse: "spouse_of",
  former_spouse: "former_spouse_of",
  sibling: "sibling_of",
};

const PERSON_FACT_FIELDS = ["age", "marital_status", "occupation", "residence", "origin"] as const;

export function personasFor(entries: Entry[]): Persona[] {
  return entries.flatMap((e) =>
    e.people.map((p) => ({
      id: p.id,
      entry_id: e.id,
      name: p.name.value,
      name_as_written: p.name.as_written,
      roles: p.roles,
      sex: p.sex,
      is_real_person: p.is_real_person,
    })),
  );
}

export function claimsFor(entries: Entry[]): Claim[] {
  return entries.flatMap((e, ei) => claimsForEntry(e, ei));
}

function claimsForEntry(e: Entry, ei: number): Claim[] {
  const claims: Claim[] = [];
  const base = `entries[${ei}]`;
  const personPath = (p: Person) => `${base}.people[${e.people.indexOf(p)}]`;
  const ev = (f: Field | null, path: string): EvidenceRef[] =>
    f
      ? [
          {
            entry_id: e.id,
            path,
            as_written: f.as_written,
            box: f.box,
            reading_confidence: f.confidence,
            legibility: f.legibility,
          },
        ]
      : [];

  const push = (c: Omit<Claim, "id" | "entry_id" | "reading_confidence" | "status" | "statement">) => {
    const conf = c.evidence.length ? Math.min(...c.evidence.map((x) => x.reading_confidence)) : e.confidence;
    claims.push({
      id: `${e.id}.c${claims.length + 1}`,
      entry_id: e.id,
      reading_confidence: conf,
      status: "proposed",
      statement: statement(c, e),
      ...c,
    });
  };
  const emptyObject = { persona: null, value: null, as_written: null, date: null, place: null, participants: null };

  const real = e.people.filter((p) => p.is_real_person);
  const principals = real.filter((p) => p.roles.some((r) => PRINCIPAL_ROLES.includes(r)));
  const principal = principals[0] ?? null;
  const subjectId = principal?.id ?? e.id;

  // 1. The act itself.
  push({
    kind: "event",
    subject: subjectId,
    predicate: e.type,
    object: {
      ...emptyObject,
      date: { value: e.date.value, as_written: e.date.as_written },
      place: e.place ? { value: e.place.value, as_written: e.place.as_written } : null,
      participants: real.flatMap((p) => p.roles.map((role) => ({ persona: p.id, role }))),
    },
    evidence: [...ev(e.date, `${base}.date`), ...ev(e.place, `${base}.place`)],
    inferred: false,
    note: principal ? null : "No principal person identified; claim attached to the entry.",
  });

  // 2. Other events stated in the entry (birth date inside a baptism, death inside a burial…).
  e.other_dates.forEach((d, di) => {
    const path = `${base}.other_dates[${di}].field`;
    if (d.kind === "registration" || d.kind === "other") {
      push({
        kind: "record_fact",
        subject: subjectId,
        predicate: d.kind === "registration" ? "registration_date" : "other_date",
        object: { ...emptyObject, value: d.field.value, as_written: d.field.as_written },
        evidence: ev(d.field, path),
        inferred: false,
        note: d.field.note,
      });
      return;
    }
    push({
      kind: "event",
      subject: subjectId,
      predicate: d.kind,
      object: { ...emptyObject, date: { value: d.field.value, as_written: d.field.as_written } },
      evidence: ev(d.field, path),
      inferred: false,
      note: d.field.note,
    });
  });

  // 3. Names and facts about each persona.
  for (const p of real) {
    const pp = personPath(p);
    push({
      kind: "name",
      subject: p.id,
      predicate: "name",
      object: { ...emptyObject, value: p.name.value, as_written: p.name.as_written },
      evidence: ev(p.name, `${pp}.name`),
      inferred: false,
      note: p.name.note,
    });
    if (p.sex !== "unknown") {
      push({
        kind: "person_fact",
        subject: p.id,
        predicate: "sex",
        object: { ...emptyObject, value: p.sex },
        evidence: ev(p.name, `${pp}.name`),
        inferred: true,
        note: "From the record's wording (filho/filha, role, gender agreement).",
      });
    }
    for (const key of PERSON_FACT_FIELDS) {
      const f = p[key];
      if (!f) continue;
      push({
        kind: "person_fact",
        subject: p.id,
        predicate: key,
        object: { ...emptyObject, value: f.value, as_written: f.as_written },
        evidence: ev(f, `${pp}.${key}`),
        inferred: false,
        note: f.note,
      });
    }
    p.other_facts.forEach((f, fi) =>
      push({
        kind: "person_fact",
        subject: p.id,
        predicate: f.key,
        object: { ...emptyObject, value: f.field.value, as_written: f.field.as_written },
        evidence: ev(f.field, `${pp}.other_facts[${fi}].field`),
        inferred: false,
        note: f.field.note,
      }),
    );
  }

  // 4. Relationships stated in the text, then ones implied by roles if the model left them out.
  const seen = new Set<string>();
  const relKey = (type: RelationType, from: string, to: string) =>
    type === "spouse_of" || type === "sibling_of" || type === "former_spouse_of" || type === "relative_of"
      ? `${type}:${[from, to].sort().join("|")}`
      : `${type}:${from}>${to}`;
  const realIds = new Set(real.map((p) => p.id));

  for (const p of real) {
    p.relations.forEach((r, ri) => {
      if (!realIds.has(r.to)) return; // e.g. godparent_of where one side is devotional
      const k = relKey(r.type, p.id, r.to);
      if (seen.has(k)) return;
      seen.add(k);
      push({
        kind: "relationship",
        subject: p.id,
        predicate: r.type,
        object: { ...emptyObject, persona: r.to },
        evidence: [...ev(r.evidence, `${personPath(p)}.relations[${ri}].evidence`), ...ev(p.name, `${personPath(p)}.name`)],
        inferred: false,
        note: null,
      });
    });
  }

  const subject = real.find((p) => p.roles.includes("subject"));
  if (subject && CHILD_CENTRED.includes(e.type)) {
    for (const p of real) {
      for (const role of p.roles) {
        const type = ROLE_IMPLIED[role];
        if (!type || p.id === subject.id) continue;
        const k = relKey(type, p.id, subject.id);
        if (seen.has(k)) continue;
        seen.add(k);
        push({
          kind: "relationship",
          subject: p.id,
          predicate: type,
          object: { ...emptyObject, persona: subject.id },
          evidence: ev(p.name, `${personPath(p)}.name`),
          inferred: true,
          note: `Implied by the role "${role}" in this ${e.type}.`,
        });
      }
    }
    // "neto paterno de X" also says X is a parent of the father (and "materno" of the mother).
    const father = real.find((p) => p.roles.includes("father"));
    const mother = real.find((p) => p.roles.includes("mother"));
    for (const p of real) {
      const parent = p.roles.some((r) => r.startsWith("paternal_"))
        ? father
        : p.roles.some((r) => r.startsWith("maternal_"))
          ? mother
          : undefined;
      if (!parent) continue;
      const k = relKey("parent_of", p.id, parent.id);
      if (seen.has(k)) continue;
      seen.add(k);
      push({
        kind: "relationship",
        subject: p.id,
        predicate: "parent_of",
        object: { ...emptyObject, persona: parent.id },
        evidence: [...ev(p.name, `${personPath(p)}.name`), ...ev(parent.name, `${personPath(parent)}.name`)],
        inferred: true,
        note: `Paternal/maternal grandparent of ${subject.id}, so parent of the ${parent === father ? "father" : "mother"}.`,
      });
    }
  }

  if (e.type === "marriage") {
    const groom = real.find((p) => p.roles.includes("groom"));
    const bride = real.find((p) => p.roles.includes("bride"));
    if (groom && bride && !seen.has(relKey("spouse_of", groom.id, bride.id))) {
      seen.add(relKey("spouse_of", groom.id, bride.id));
      push({
        kind: "relationship",
        subject: groom.id,
        predicate: "spouse_of",
        object: { ...emptyObject, persona: bride.id },
        evidence: [...ev(groom.name, `${personPath(groom)}.name`), ...ev(bride.name, `${personPath(bride)}.name`), ...ev(e.date, `${base}.date`)],
        inferred: true,
        note: "Married in this act.",
      });
    }
  }

  // 5. Facts about the act (legitimacy, cause of death, burial place…), attached to the principal.
  e.facts.forEach((f, fi) =>
    push({
      kind: "record_fact",
      subject: subjectId,
      predicate: f.key,
      object: { ...emptyObject, value: f.field.value, as_written: f.field.as_written },
      evidence: ev(f.field, `${base}.facts[${fi}].field`),
      inferred: false,
      note: f.field.note,
    }),
  );

  return claims;
}

const RELATION_WORDS: Record<string, string> = {
  parent_of: "a parent of",
  spouse_of: "the spouse of",
  former_spouse_of: "the late spouse of",
  grandparent_of: "a grandparent of",
  godparent_of: "a godparent of",
  sibling_of: "a sibling of",
  relative_of: "a relative of",
};

/** One plain-English sentence for a claim (what a reviewer reads before accepting it). */
function statement(c: Omit<Claim, "id" | "entry_id" | "reading_confidence" | "status" | "statement">, e: Entry): string {
  const nameOf = (id: string) => {
    const p = e.people.find((x) => x.id === id);
    return p ? (p.name.value ?? p.name.as_written ?? "[illegible]") : `entry ${e.id}`;
  };
  const who = nameOf(c.subject);
  const v = c.object.value ?? c.object.as_written ?? "[illegible]";
  switch (c.kind) {
    case "event": {
      const date = c.object.date?.value ?? c.object.date?.as_written;
      const place = c.object.place?.value ?? c.object.place?.as_written;
      return `${who}: ${c.predicate}${date ? ` on ${date}` : ""}${place ? ` at ${place}` : ""}.`;
    }
    case "name":
      return `A person in this ${e.type} record is named ${v}${c.object.as_written && c.object.as_written !== v ? ` (written "${c.object.as_written}")` : ""}.`;
    case "relationship":
      return `${who} is ${RELATION_WORDS[c.predicate] ?? c.predicate} ${nameOf(c.object.persona ?? "")}.`;
    default:
      return `${who}: ${c.predicate.replace(/_/g, " ")} — ${v}.`;
  }
}
