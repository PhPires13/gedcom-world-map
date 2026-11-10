/**
 * Renders the synthetic evaluation samples (no archive data needed):
 *   eval/samples/synthetic-pt-1847/        handwriting-style Portuguese parish page:
 *                                           a baptism and a burial, one ink blot
 *   eval/samples/synthetic-it-1888/        typed Italian civil birth registration
 *   eval/samples/synthetic-not-a-record/   a drawing with no text
 * and, for the Portuguese page, the "perfect" model reading used by the tests
 * (tests/fixtures/synthetic-pt-1847.reading.json).
 *
 * Text is laid out word by word, so every labelled span has an exact box.
 * Fonts: macOS "Apple Chancery" and "Courier New" (falls back to serif/monospace).
 *
 * Run: npm run make-synthetic
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, GlobalFonts, type SKRSContext2D } from "@napi-rs/canvas";
import type { ModelReading, NormBox, PixelBox } from "../schema.js";
import type { ExpectedSample } from "../eval/expected.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");

function registerFont(file: string, family: string): string | null {
  return existsSync(file) && GlobalFonts.registerFromPath(file, family) ? family : null;
}
const HAND = registerFont("/System/Library/Fonts/Supplemental/Apple Chancery.ttf", "SynthHand") ?? "serif";
const TYPE = registerFont("/System/Library/Fonts/Supplemental/Courier New.ttf", "SynthType") ?? "monospace";

// Deterministic randomness so re-running gives the same images.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

interface Px {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Layout {
  lines: Array<{ text: string; box: Px }>;
  labels: Map<string, Px>;
  y: number;
}

const union = (a: Px | undefined, b: Px): Px =>
  a ? { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) } : { ...b };

/**
 * Lays out and draws a paragraph. Markup: {label|words} records the words' box
 * under `label`; {!label|words} also draws an ink blot over them (and they are
 * transcribed as "[illegible]").
 */
function paragraph(
  ctx: SKRSContext2D,
  layout: Layout,
  src: string,
  opts: { x: number; width: number; lineHeight: number; font: string; ink: string; jitter: number; rand: () => number; align?: "left" | "right" },
): void {
  type Tok = { word: string; label: string | null; blot: boolean };
  const toks: Tok[] = [];
  const re = /\{(!?)([^|{}]+)\|([^{}]+)\}|(\S+)/g;
  let lastEnd = -1;
  for (const m of src.matchAll(re)) {
    const glued = m.index === lastEnd && toks.length > 0;
    lastEnd = m.index + m[0].length;
    if (m[4] && glued && /^[,;.:]+/.test(m[4])) {
      // Punctuation right after "{label|…}" belongs to the previous word: "{x|Rosa}," → "Rosa,".
      const punct = m[4].match(/^[,;.:]+/)![0];
      toks[toks.length - 1].word += punct;
      if (m[4].length > punct.length) toks.push({ word: m[4].slice(punct.length), label: null, blot: false });
    } else if (m[4]) {
      toks.push({ word: m[4], label: null, blot: false });
    } else {
      for (const w of m[3].split(/\s+/)) toks.push({ word: w, label: m[2], blot: m[1] === "!" });
    }
  }
  ctx.font = opts.font;
  const space = ctx.measureText(" ").width;
  let line: Array<Tok & { w: number }> = [];
  let lineWidth = 0;
  const flush = () => {
    if (!line.length) return;
    const total = line.reduce((s, t) => s + t.w, 0) + space * (line.length - 1);
    let x = opts.align === "right" ? opts.x + opts.width - total : opts.x;
    const baseline = layout.y + opts.lineHeight * 0.75;
    const ascent = opts.lineHeight * 0.55;
    const descent = opts.lineHeight * 0.2;
    const text: string[] = [];
    let lineBox: Px | undefined;
    for (const t of line) {
      const dy = (opts.rand() - 0.5) * opts.jitter;
      ctx.fillStyle = opts.ink;
      ctx.globalAlpha = 0.82 + opts.rand() * 0.18;
      ctx.fillText(t.word, x, baseline + dy);
      ctx.globalAlpha = 1;
      const box: Px = { x0: x, y0: baseline + dy - ascent, x1: x + t.w, y1: baseline + dy + descent };
      lineBox = union(lineBox, box);
      if (t.label) {
        // Trailing punctuation is not part of the label's box.
        const clean = t.word.replace(/[,;.:]+$/, "");
        const w = ctx.measureText(clean).width;
        layout.labels.set(t.label, union(layout.labels.get(t.label), { ...box, x1: x + w }));
      }
      if (t.blot) {
        drawBlot(ctx, box, opts.rand);
        text.push(t.word.match(/[,;.:]+$/) ? `[illegible]${t.word.match(/[,;.:]+$/)![0]}` : "[illegible]");
      } else {
        text.push(t.word);
      }
      x += t.w + space;
    }
    layout.lines.push({ text: text.join(" "), box: lineBox! });
    layout.y += opts.lineHeight;
    line = [];
    lineWidth = 0;
  };
  for (const t of toks) {
    const w = ctx.measureText(t.word).width;
    if (line.length && lineWidth + space + w > opts.width) flush();
    line.push({ ...t, w });
    lineWidth += (line.length > 1 ? space : 0) + w;
  }
  flush();
}

function drawBlot(ctx: SKRSContext2D, b: Px, rand: () => number): void {
  const cx = (b.x0 + b.x1) / 2;
  const cy = (b.y0 + b.y1) / 2;
  const rx = (b.x1 - b.x0) / 2 + 10;
  const ry = (b.y1 - b.y0) / 2 + 8;
  ctx.fillStyle = "#24170d";
  for (let i = 0; i < 40; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand());
    ctx.globalAlpha = 0.55 + rand() * 0.45;
    ctx.beginPath();
    ctx.ellipse(cx + Math.cos(a) * rx * r * 0.8, cy + Math.sin(a) * ry * r * 0.7, rx * (0.25 + rand() * 0.3), ry * (0.35 + rand() * 0.35), rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function paper(ctx: SKRSContext2D, W: number, H: number, rand: () => number, tone: string): void {
  ctx.fillStyle = tone;
  ctx.fillRect(0, 0, W, H);
  // Foxing stains and speckles.
  for (let i = 0; i < 18; i++) {
    const x = rand() * W;
    const y = rand() * H;
    const r = 30 + rand() * 160;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(120, 85, 40, 0.10)");
    g.addColorStop(1, "rgba(120, 85, 40, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  ctx.fillStyle = "rgba(60, 40, 20, 0.25)";
  for (let i = 0; i < 2500; i++) ctx.fillRect(rand() * W, rand() * H, 1 + rand() * 1.5, 1 + rand() * 1.5);
}

const norm = (b: Px, W: number, H: number, page = 1): NormBox => ({
  page,
  x: round4(b.x0 / W),
  y: round4(b.y0 / H),
  w: round4((b.x1 - b.x0) / W),
  h: round4((b.y1 - b.y0) / H),
});
const round4 = (v: number) => Math.round(v * 10000) / 10000;
const px = (b: Px, page = 1): PixelBox => ({ page, x0: Math.round(b.x0), y0: Math.round(b.y0), x1: Math.round(b.x1), y1: Math.round(b.y1) });

function writeSample(id: string, png: Buffer, expected: ExpectedSample): void {
  const dir = path.join(root, "eval", "samples", id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "page-1.png"), png);
  writeFileSync(path.join(dir, "expected.json"), JSON.stringify(expected, null, 2) + "\n");
  console.log(`wrote eval/samples/${id}`);
}

// ------------------------------------------------------------ sample 1: PT parish page, 1847

function portuguese(): void {
  const W = 1600;
  const H = 2200;
  const rand = rng(1847);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  paper(ctx, W, H, rand, "#ece0c2");
  const ink = "#3a2716";
  const layout: Layout = { lines: [], labels: new Map(), y: 90 };
  const body = { x: 380, width: 1120, lineHeight: 62, font: `40px ${HAND}`, ink, jitter: 5, rand };
  const margin = { x: 90, width: 250, lineHeight: 56, font: `38px ${HAND}`, ink, jitter: 3, rand };

  paragraph(ctx, layout, "Livro dos Baptismos e Obitos da Freg.a de {header|S. Pedro de Rates} {folio|fl. 23}", { ...body, x: 160, width: 1300, font: `44px ${HAND}` });
  layout.y += 40;

  const e1Top = layout.y;
  const mLayout: Layout = { lines: [], labels: layout.labels, y: e1Top };
  paragraph(ctx, mLayout, "{e1.margin|Maria}", margin);
  paragraph(
    ctx,
    layout,
    "Aos {e1.date|vinte e tres dias do mez de Março de mil oitocentos e quarenta e sete} nesta Igreja Parochial de {e1.place|S. Pedro de Rates} baptizei solemnemente e puz os Santos Oleos a {e1.p1|Maria}, que nasceu aos {e1.birth|dezanove do dito mez}, filha legitima de {e1.p2|Joaq.m Ferreira}, {e1.p2.occ|lavrador}, e de sua mulher {e1.p3|Anna Rosa}, naturaes e moradores no lugar de {e1.res|Gestrins} desta freg.a; neta paterna de {e1.p4|Manoel Ferreira} e de {e1.p5|Maria Joaquina}, e materna de {e1.p6|Ant.o Gomes} e de {e1.p7|Thereza de Jesus}, do lugar da Pedreira. Forão padrinhos {e1.p8|Jozé Pereira}, solteiro, e {e1.p9|Anna} {!blot|Custodia}, sua irmã, os quaes sei serem os proprios. E para constar fiz este assento que assignei. Era ut supra.",
    body,
  );
  paragraph(ctx, layout, "O Abbade {e1.p10|Fr.co Ant.o Lopes}", { ...body, align: "right" });
  const e1Bottom = layout.y;
  layout.y += 50;

  const e2Top = layout.y;
  const m2: Layout = { lines: [], labels: layout.labels, y: e2Top };
  paragraph(ctx, m2, "{e2.margin|Manoel Ferr.a}", margin);
  paragraph(
    ctx,
    layout,
    "Aos {e2.date|dous dias do mez de Abril do dito anno de mil oitocentos e quarenta e sete} foi sepultado dentro desta Igreja {e2.p1|Manoel Ferreira}, {e2.p1.ms|viuvo} de {e2.p2|Maria Joaquina}, de idade de {e2.p1.age|setenta e oito annos}, morador no lugar de {e2.p1.res|Gestrins} desta freguezia, que faleceo {e2.death|no dia antecedente} com todos os Sacramentos; não fez testamento. E para constar fiz este assento. Era ut supra.",
    body,
  );
  paragraph(ctx, layout, "O Abbade {e2.p3|Fr.co Ant.o Lopes}", { ...body, align: "right" });
  const e2Bottom = layout.y;

  const L = (k: string) => {
    const b = layout.labels.get(k);
    if (!b) throw new Error(`label ${k} missing`);
    return b;
  };
  const N = (k: string) => norm(L(k), W, H);

  const expected: ExpectedSample = {
    id: "synthetic-pt-1847",
    meta: {
      origin: "synthetic",
      description: "Rendered handwriting-style page: a baptism and a burial from a Portuguese parish register, 1847, with an ink blot over the godmother's surname.",
      record_types: ["baptism", "burial"],
      century: 19,
      year: 1847,
      language: "pt",
      script: "handwritten",
      jurisdiction: "parish",
    },
    files: ["page-1.png"],
    expect_record: true,
    entries: [
      {
        type: "baptism",
        date: "1847-03-23",
        place: "São Pedro de Rates",
        other_dates: [{ kind: "birth", date: "1847-03-19" }],
        people: [
          { roles: ["subject"], name: "Maria", sex: "female", box: N("e1.p1") },
          { roles: ["father"], name: "Joaquim Ferreira", sex: "male", occupation: "lavrador", box: N("e1.p2") },
          { roles: ["mother"], name: "Anna Rosa", sex: "female", box: N("e1.p3") },
          { roles: ["paternal_grandfather"], name: "Manoel Ferreira", sex: "male", box: N("e1.p4") },
          { roles: ["paternal_grandmother"], name: "Maria Joaquina", sex: "female", box: N("e1.p5") },
          { roles: ["maternal_grandfather"], name: "Antonio Gomes", sex: "male", box: N("e1.p6") },
          { roles: ["maternal_grandmother"], name: "Thereza de Jesus", sex: "female", box: N("e1.p7") },
          { roles: ["godfather"], name: "José Pereira", sex: "male", marital_status: "solteiro", box: N("e1.p8") },
          { roles: ["godmother"], name: "Anna", sex: "female", box: N("e1.p9"), legibility: "partly_illegible" },
          { roles: ["officiant"], name: "Francisco Antonio Lopes", sex: "male", box: N("e1.p10") },
        ],
      },
      {
        type: "burial",
        date: "1847-04-02",
        place: "São Pedro de Rates",
        other_dates: [{ kind: "death", date: "1847-04-01" }],
        people: [
          { roles: ["subject"], name: "Manoel Ferreira", sex: "male", age: "78", marital_status: "viuvo", box: N("e2.p1") },
          { roles: ["former_spouse"], name: "Maria Joaquina", sex: "female", box: N("e2.p2") },
          { roles: ["officiant"], name: "Francisco Antonio Lopes", sex: "male", box: N("e2.p3") },
        ],
      },
    ],
    illegible: [{ box: N("blot"), note: "Ink blot over the godmother's surname (it reads 'Custodia' underneath)." }],
  };
  writeSample("synthetic-pt-1847", canvas.toBuffer("image/png"), expected);

  // ---- the "perfect" reading, as the model would return it (pixel boxes), for tests and the illustrative example.
  const lines = [...layout.lines];
  const lineIds = (top: number, bottom: number) =>
    lines.map((l, i) => ({ l, id: `l${i + 1}` })).filter(({ l }) => l.box.y0 >= top - 20 && l.box.y1 <= bottom + 20).map(({ id }) => id);
  const F = (k: string | null, as_written: string | null, value: string | null, extra: Partial<ModelReading["entries"][number]["date"]> = {}) => ({
    as_written,
    value,
    box: k ? px(L(k)) : null,
    confidence: 0.95,
    legibility: "clear" as const,
    note: null,
    ...extra,
  });
  const person = (
    id: string,
    roles: ModelReading["entries"][number]["people"][number]["roles"],
    label: string,
    as_written: string,
    value: string,
    sex: "male" | "female",
    more: Partial<ModelReading["entries"][number]["people"][number]> = {},
  ): ModelReading["entries"][number]["people"][number] => ({
    id,
    roles,
    name: F(label, as_written, value),
    given_names: value.split(" ")[0],
    surnames: value.split(" ").slice(1).join(" ") || null,
    sex,
    is_real_person: true,
    age: null,
    marital_status: null,
    occupation: null,
    residence: null,
    origin: null,
    other_facts: [],
    relations: [],
    ...more,
  });
  const rel = (type: ModelReading["entries"][number]["people"][number]["relations"][number]["type"], to: string, words: string | null = null) => ({
    type,
    to,
    evidence: words ? F(null, words, null) : null,
  });

  const reading: ModelReading = {
    document: {
      is_record: true,
      not_record_reason: null,
      kind: "parish_register",
      languages: ["pt", "la"],
      script: "handwritten",
      period_estimate: "1847",
      legibility: "good",
      repository_marks: "Livro dos Baptismos e Obitos da Freg.a de S. Pedro de Rates, fl. 23",
    },
    transcription: [
      ...lines.slice(0, 1).map((l, i) => ({ id: `l${i + 1}`, page: 1, text: l.text, box: px(l.box), confidence: 0.95, has_illegible: false })),
      ...lines.slice(1).map((l, i) => ({
        id: `l${i + 2}`,
        page: 1,
        text: l.text,
        box: px(l.box),
        confidence: l.text.includes("[illegible]") ? 0.7 : 0.93,
        has_illegible: l.text.includes("[illegible]"),
      })),
    ],
    expanded_text:
      "Book of Baptisms and Deaths of the parish of São Pedro de Rates, folio 23. Aos vinte e três dias do mês de Março de mil oitocentos e quarenta e sete, nesta Igreja Paroquial de São Pedro de Rates, baptizei solenemente e pus os Santos Óleos a Maria, que nasceu aos dezanove do dito mês, filha legítima de Joaquim Ferreira, lavrador, e de sua mulher Ana Rosa, naturais e moradores no lugar de Gestrins desta freguesia; neta paterna de Manuel Ferreira e de Maria Joaquina, e materna de António Gomes e de Teresa de Jesus, do lugar da Pedreira. Foram padrinhos José Pereira, solteiro, e Ana [illegible], sua irmã, os quais sei serem os próprios. E para constar fiz este assento que assinei. Era ut supra. O Abade Francisco António Lopes. — Aos dois dias do mês de Abril do dito ano de mil oitocentos e quarenta e sete foi sepultado dentro desta Igreja Manuel Ferreira, viúvo de Maria Joaquina, de idade de setenta e oito anos, morador no lugar de Gestrins desta freguesia, que faleceu no dia antecedente com todos os Sacramentos; não fez testamento. E para constar fiz este assento. Era ut supra. O Abade Francisco António Lopes.",
    translation_en:
      "On the twenty-third day of the month of March of the year one thousand eight hundred and forty-seven, in this Parish Church of São Pedro de Rates, I solemnly baptised and anointed with the Holy Oils Maria, born on the nineteenth of the said month, legitimate daughter of Joaquim Ferreira, farmer, and of his wife Anna Rosa, natives and residents of the place of Gestrins in this parish; paternal granddaughter of Manoel Ferreira and Maria Joaquina, and maternal granddaughter of Antonio Gomes and Thereza de Jesus, of the place of Pedreira. The godparents were José Pereira, single, and Anna [illegible], his sister, whom I know to be who they say. In witness whereof I made this entry, which I signed. Date as above. The Abbot Francisco Antonio Lopes. — On the second day of the month of April of the said year 1847, Manoel Ferreira, widower of Maria Joaquina, aged seventy-eight, resident in Gestrins in this parish, who died the day before having received all the Sacraments, was buried inside this Church; he made no will. In witness whereof I made this entry. Date as above. The Abbot Francisco Antonio Lopes.",
    illegible_regions: [
      { page: 1, box: px(L("blot")), context: "e Anna [illegible], sua irmã", reason: "ink blot", candidate_readings: [] },
    ],
    entries: [
      {
        id: "e1",
        type: "baptism",
        jurisdiction: "parish",
        box: px({ x0: 80, y0: e1Top, x1: 1510, y1: e1Bottom }),
        line_ids: lineIds(e1Top, e1Bottom),
        margin_note: F("e1.margin", "Maria", "Maria"),
        date: F("e1.date", "vinte e tres dias do mez de Março de mil oitocentos e quarenta e sete", "1847-03-23"),
        other_dates: [{ kind: "birth", field: F("e1.birth", "dezanove do dito mez", "1847-03-19", { note: "Month and year from the baptism date." }) }],
        place: F("e1.place", "S. Pedro de Rates", "São Pedro de Rates"),
        people: [
          person("e1.p1", ["subject"], "e1.p1", "Maria", "Maria", "female"),
          person("e1.p2", ["father"], "e1.p2", "Joaq.m Ferreira", "Joaquim Ferreira", "male", {
            occupation: F("e1.p2.occ", "lavrador", "lavrador (farmer)"),
            residence: F("e1.res", "Gestrins", "Gestrins, São Pedro de Rates"),
            relations: [rel("parent_of", "e1.p1", "filha legitima de"), rel("spouse_of", "e1.p3", "sua mulher")],
          }),
          person("e1.p3", ["mother"], "e1.p3", "Anna Rosa", "Ana Rosa", "female", {
            residence: F("e1.res", "Gestrins", "Gestrins, São Pedro de Rates"),
            relations: [rel("parent_of", "e1.p1", "filha legitima de … e de sua mulher")],
          }),
          person("e1.p4", ["paternal_grandfather"], "e1.p4", "Manoel Ferreira", "Manuel Ferreira", "male", { relations: [rel("grandparent_of", "e1.p1", "neta paterna de")] }),
          person("e1.p5", ["paternal_grandmother"], "e1.p5", "Maria Joaquina", "Maria Joaquina", "female", { relations: [rel("grandparent_of", "e1.p1", "neta paterna de")] }),
          person("e1.p6", ["maternal_grandfather"], "e1.p6", "Ant.o Gomes", "António Gomes", "male", { relations: [rel("grandparent_of", "e1.p1", "e materna de")] }),
          person("e1.p7", ["maternal_grandmother"], "e1.p7", "Thereza de Jesus", "Teresa de Jesus", "female", { relations: [rel("grandparent_of", "e1.p1", "e materna de")] }),
          person("e1.p8", ["godfather"], "e1.p8", "Jozé Pereira", "José Pereira", "male", {
            marital_status: F(null, "solteiro", "single"),
            relations: [rel("godparent_of", "e1.p1", "Forão padrinhos"), rel("sibling_of", "e1.p9", "sua irmã")],
          }),
          {
            ...person("e1.p9", ["godmother"], "e1.p9", "Anna [illegible]", "Ana [illegible]", "female", {
              relations: [rel("godparent_of", "e1.p1", "Forão padrinhos")],
            }),
            name: { ...F("e1.p9", "Anna [illegible]", "Ana [illegible]"), confidence: 0.6, legibility: "partly_illegible", note: "Surname under an ink blot." },
            surnames: null,
          },
          person("e1.p10", ["officiant"], "e1.p10", "Fr.co Ant.o Lopes", "Francisco António Lopes", "male", {
            other_facts: [{ key: "title", field: F(null, "O Abbade", "Abbot (parish priest)") }],
          }),
        ],
        facts: [{ key: "legitimacy", field: F(null, "filha legitima", "legitimate") }],
        summary_en: "Baptism of Maria, legitimate daughter of Joaquim Ferreira and Anna Rosa of Gestrins, São Pedro de Rates, 23 March 1847 (born 19 March).",
        confidence: 0.9,
      },
      {
        id: "e2",
        type: "burial",
        jurisdiction: "parish",
        box: px({ x0: 80, y0: e2Top, x1: 1510, y1: e2Bottom }),
        line_ids: lineIds(e2Top, e2Bottom),
        margin_note: F("e2.margin", "Manoel Ferr.a", "Manuel Ferreira"),
        date: F("e2.date", "dous dias do mez de Abril do dito anno de mil oitocentos e quarenta e sete", "1847-04-02"),
        other_dates: [{ kind: "death", field: F("e2.death", "no dia antecedente", "1847-04-01", { note: "The day before the burial." }) }],
        place: F("header", "S. Pedro de Rates", "São Pedro de Rates", { note: "From the register heading ('desta Igreja')." }),
        people: [
          person("e2.p1", ["subject"], "e2.p1", "Manoel Ferreira", "Manuel Ferreira", "male", {
            age: F("e2.p1.age", "setenta e oito annos", "78"),
            marital_status: F("e2.p1.ms", "viuvo", "widower"),
            residence: F("e2.p1.res", "Gestrins", "Gestrins, São Pedro de Rates"),
          }),
          person("e2.p2", ["former_spouse"], "e2.p2", "Maria Joaquina", "Maria Joaquina", "female", {
            relations: [rel("former_spouse_of", "e2.p1", "viuvo de")],
            other_facts: [{ key: "deceased", field: F("e2.p1.ms", "viuvo de", "deceased before 1847-04-02") }],
          }),
          person("e2.p3", ["officiant"], "e2.p3", "Fr.co Ant.o Lopes", "Francisco António Lopes", "male"),
        ],
        facts: [
          { key: "sacraments", field: F(null, "com todos os Sacramentos", "received all the sacraments") },
          { key: "testament", field: F(null, "não fez testamento", "no will") },
          { key: "burial_place", field: F(null, "dentro desta Igreja", "inside the parish church") },
        ],
        summary_en: "Burial of Manoel Ferreira, widower of Maria Joaquina, aged 78, of Gestrins, on 2 April 1847; he died the day before.",
        confidence: 0.9,
      },
    ],
    reader_notes: ["The godmother's surname is covered by an ink blot."],
  };
  const fixtures = path.join(root, "tests", "fixtures");
  mkdirSync(fixtures, { recursive: true });
  writeFileSync(path.join(fixtures, "synthetic-pt-1847.reading.json"), JSON.stringify(reading, null, 2) + "\n");
  console.log("wrote tests/fixtures/synthetic-pt-1847.reading.json");
}

// ------------------------------------------------------------ sample 2: Italian civil birth, 1888

function italian(): void {
  const W = 1700;
  const H = 2200;
  const rand = rng(1888);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  paper(ctx, W, H, rand, "#f1ead8");
  const ink = "#1d1d26";
  const layout: Layout = { lines: [], labels: new Map(), y: 110 };
  const body = { x: 330, width: 1240, lineHeight: 58, font: `34px ${TYPE}`, ink, jitter: 1.5, rand };
  paragraph(ctx, layout, "COMUNE DI PADULA — ATTI DI NASCITA — ANNO 1888", { ...body, x: 330, font: `38px ${TYPE}` });
  layout.y += 50;
  const mLayout: Layout = { lines: [], labels: layout.labels, y: layout.y };
  paragraph(ctx, mLayout, "{num|N. 47} {margin|Cardinale Michele}", { ...body, x: 80, width: 220, font: `30px ${TYPE}` });
  paragraph(
    ctx,
    layout,
    "L'anno {reg|milleottocentoottantotto, addì quindici di marzo}, a ore antimeridiane dieci e minuti trenta, nella Casa Comunale. Avanti di me {p6|Giuseppe Rinaldi}, Sindaco, Ufficiale dello Stato Civile del Comune di {place|Padula}, è comparso {p2|Vincenzo Cardinale}, di anni {p2.age|trentadue}, {p2.occ|contadino}, domiciliato in Padula, il quale mi ha dichiarato che alle ore tre e minuti quindici del dì {date|tredici del corrente mese}, nella casa posta in Via Croce al numero 12, da {p3|Rosa Tancredi}, sua moglie, contadina, seco lui convivente, è nato un bambino di sesso maschile che egli mi presenta, e a cui dà il nome di {p1|Michele}. A quanto sopra e a questo atto sono stati presenti quali testimoni {p4|Luigi Morello}, di anni {p4.age|quarantacinque}, calzolaio, e {p5|Pasquale Greco}, di anni {p5.age|cinquanta}, sarto, entrambi residenti in questo Comune. Letto il presente atto a tutti gli intervenuti, si è il medesimo da me e dai testimoni sottoscritto, avendo il dichiarante dichiarato di non saper scrivere.",
    body,
  );
  layout.y += 30;
  paragraph(ctx, layout, "Luigi Morello — Pasquale Greco — Giuseppe Rinaldi", { ...body, align: "right", font: `italic 34px ${TYPE}` });
  const N = (k: string) => norm(layout.labels.get(k)!, W, H);
  const expected: ExpectedSample = {
    id: "synthetic-it-1888",
    meta: {
      origin: "synthetic",
      description: "Rendered typewritten Italian civil birth registration (atto di nascita), Padula 1888.",
      record_types: ["birth"],
      century: 19,
      year: 1888,
      language: "it",
      script: "typewritten",
      jurisdiction: "civil",
    },
    files: ["page-1.png"],
    expect_record: true,
    entries: [
      {
        type: "birth",
        date: "1888-03-13",
        place: "Padula",
        other_dates: [{ kind: "registration", date: "1888-03-15" }],
        people: [
          { roles: ["subject"], name: "Michele", sex: "male", box: N("p1") },
          { roles: ["father", "declarant"], name: "Vincenzo Cardinale", sex: "male", age: "32", occupation: "contadino", box: N("p2") },
          { roles: ["mother"], name: "Rosa Tancredi", sex: "female", box: N("p3") },
          { roles: ["witness"], name: "Luigi Morello", sex: "male", age: "45", box: N("p4") },
          { roles: ["witness"], name: "Pasquale Greco", sex: "male", age: "50", box: N("p5") },
          { roles: ["registrar"], name: "Giuseppe Rinaldi", sex: "male", box: N("p6") },
        ],
      },
    ],
    illegible: [],
  };
  writeSample("synthetic-it-1888", canvas.toBuffer("image/png"), expected);
}

// ------------------------------------------------------------ sample 3: not a record

function notARecord(): void {
  const W = 1400;
  const H = 1000;
  const rand = rng(7);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#8ec5ea");
  sky.addColorStop(1, "#e9f4fb");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#6aa84f";
  ctx.fillRect(0, 700, W, 300);
  ctx.fillStyle = "#f4d03f";
  ctx.beginPath();
  ctx.arc(1150, 180, 90, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#e8e2d0";
  ctx.fillRect(420, 420, 420, 300);
  ctx.fillStyle = "#b03a2e";
  ctx.beginPath();
  ctx.moveTo(390, 430);
  ctx.lineTo(630, 260);
  ctx.lineTo(870, 430);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#5d4037";
  ctx.fillRect(590, 560, 80, 160);
  for (let i = 0; i < 12; i++) {
    ctx.fillStyle = "#2e7d32";
    ctx.beginPath();
    ctx.arc(80 + rand() * 1240, 690 + rand() * 30, 30 + rand() * 30, 0, Math.PI * 2);
    ctx.fill();
  }
  writeSample("synthetic-not-a-record", canvas.toBuffer("image/png"), {
    id: "synthetic-not-a-record",
    meta: { origin: "synthetic", description: "A drawing of a house; not a record.", record_types: [], century: null, year: null, language: null, script: "none", jurisdiction: null },
    files: ["page-1.png"],
    expect_record: false,
    entries: [],
    illegible: [],
  });
}

portuguese();
italian();
notARecord();
