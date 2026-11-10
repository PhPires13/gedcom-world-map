# record-reader

A standalone prototype that reads photographs and scans of old records with Claude and turns them into a structured, checkable reading. It is built for Portuguese and Brazilian parish registers (baptisms, marriages, burials, 1600s–1900s, Portuguese or Latin, mostly handwritten), Italian civil registration and modern civil certificates.

The reader never adds facts to a tree. It returns:

- a **transcription** that keeps the original spelling and abbreviations,
- an **expanded, modernised reading** and an **English translation**,
- one **entry** per act on the page, with every person, their roles, names as written and normalised, ages, occupations, residences and origins,
- for **every value**: a box on the page image, a reading confidence (0–1) and a legibility flag,
- the **illegible parts**, flagged with their location instead of being guessed,
- a list of **proposed claims** (one statement each, with its evidence), ready to be confirmed by a person and mapped onto the evidence model.

> **Status (2026-11-10):** the code, the tests (mocked API) and the evaluation harness are done. **No live run has been made yet.** No `ANTHROPIC_API_KEY` was available when it was built. See [First live run](#first-live-run).

## Install

```bash
cd tools/record-reader
npm install          # also builds dist/ (via "prepare")
export ANTHROPIC_API_KEY=sk-ant-...   # never commit it; the reader reads this variable only
```

You need Node 20 or later. `sharp` (images) and `pdfjs-dist` + `@napi-rs/canvas` (PDFs) ship prebuilt binaries, so there are no system packages to install.

## Usage

### CLI

```bash
# One page
npx record-reader read scan.jpg --out reading.json

# Two pages of the same record, with hints
npx record-reader read fl23.jpg fl23v.jpg --parish "São Pedro de Rates" --years 1840-1850 \
  --language pt --names "Ferreira; Gomes" --out reading.json

# Hints as JSON (inline or a file)
npx record-reader read certidao.pdf --hints '{"record_type":"marriage","names":["Cardinale"]}'

# Cheaper / faster, no zooming
npx record-reader read scan.jpg --effort medium --zoom 0

# JSON Schema of the output
npx record-reader schema > read-result.schema.json
```

Options: `--model` (default `claude-opus-5-5`), `--effort low|medium|high|xhigh|max` (default `high`), `--zoom N` (max zoom-tool calls, default 6), `--max-pages N` (default 10), `--no-fallback`, `--quiet`. All files given to one `read` count as pages of **one** read, so an entry that runs across a page break stays together. Read separate records separately.

Exit codes: `0` ok, `1` API or model error, `2` bad input or usage. Errors are printed as `record-reader: <code>: <message>`. Set `RECORD_READER_DEBUG=1` to also print the raw model output when it cannot be parsed.

### Library

```ts
import { readRecord, RecordReaderError, toOriginalPixels } from "record-reader";

try {
  const result = await readRecord(["scan.jpg"], {
    hints: { parish: "Rates", year_from: 1840, year_to: 1850, names: ["Ferreira"] },
    effort: "high",
  });
  for (const claim of result.claims) console.log(claim.statement, claim.reading_confidence);
} catch (err) {
  if (err instanceof RecordReaderError && err.retryable) {
    // rate_limited / overloaded / connection_error: try again later (err.retryAfter seconds, if known)
  }
  throw err;
}
```

`readRecord(files, options)` returns a `ReadResult` (validated with zod before it is returned). Options: `hints`, `model`, `effort`, `zoomBudget`, `maxPages`, `maxTokens`, `fallbacks`, `apiKey` (defaults to `ANTHROPIC_API_KEY`), `maxRetries`, `onProgress`, and `client` (inject a fake client in tests). `readPages()` takes pages already loaded with `loadPages()`. All the schemas (`ReadResult`, `Claim`, `ModelReading`, …) are exported.

## How it works

1. **Pages.** Each image (JPEG, PNG, WebP, TIFF including multi-page TIFF, GIF) or PDF page (rendered at 300 dpi) is kept at full resolution, and a copy is scaled to fit Claude's high-resolution image limit (2576 px long edge, ~3.75 MP) and sent as JPEG. At that size the model's pixel coordinates map 1:1 onto the image it saw, and the reader converts them to page fractions.
2. **One request per record.** The pages go to `claude-opus-5-5` with adaptive thinking at `high` effort, a fixed system prompt (palaeography and record conventions, cached), and the hints in the user turn. The answer is constrained to the reading schema with structured outputs (`output_config.format`).
3. **Zoom tool.** The model can call `zoom(page, box)` up to 6 times. The reader cuts that region **from the original scan** (not the downscaled copy) and returns it enlarged. This is where most of the gain on small or faded handwriting should come from. A large archive scan carries 2–3× more detail than the copy the model sees first.
4. **Checks.** Boxes are normalised and sanity-checked: corners swapped, outside the page, wrong page, no area. Bad boxes are dropped with a warning, never silently "fixed". Person ids and relations are made consistent. An illegible value loses its `value` and has its confidence capped at 0.2. Dates must be ISO, and ages plausible. Each problem becomes a warning.
5. **Claims.** The reading is mapped onto neutral claims (below), and searched names are matched against the people found (accent- and old-spelling-insensitive: Thereza = Teresa, Jozé = José, Manoel = Manuel).

Refusals have a server-side fallback (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`). If Claude Opus 5.5 declines a page, the API re-runs it on its default fallback model. The result then records `reader.model_served` and `fallback_used`, and adds a warning. Turn it off with `--no-fallback`. Rate limits (429), overload (529) and connection errors are retried with backoff by the SDK (4 retries), then raised as `RecordReaderError` with `retryable: true`.

## Output format

Top level of `ReadResult` (`schema_version: "record-reader/0.1"`; full JSON Schema via `npx record-reader schema`). A complete example is in [`examples/synthetic-pt-1847.MOCK-output.json`](examples/synthetic-pt-1847.MOCK-output.json), which comes from a **mocked** model response, not a live run (see [`examples/README.md`](examples/README.md)).

| Field | What it holds |
|---|---|
| `status` | `ok`, `partly_illegible` (something important could not be read), `illegible` (no reliable entries), `not_a_record` (not a genealogical record: no entries, no claims) |
| `source` | Input files (path, sha256, media type), pages (`page` 1..N across all files, `file`, `file_page`, original `width`/`height`, `sent_width`/`sent_height`), hints |
| `reader` | Reader version, model requested / served, `fallback_used`, effort, time |
| `usage` | Requests, zooms, tokens (input, output, cache write, cache read), estimated `cost_usd` |
| `document` | `is_record`, `kind` (parish_register, civil_register, civil_certificate, …), `languages`, `script`, `period_estimate`, overall `legibility`, `repository_marks` (folio, stamps) |
| `transcription[]` | Diplomatic lines `{id, page, text, box, confidence, has_illegible}`. `[illegible]`, `[illegible: ~3 words]`, `[?uncertain?]`, superscripts as `Fr.^co` |
| `expanded_text`, `translation_en` | Abbreviations expanded, spelling modernised; English translation |
| `illegible_regions[]` | `{page, box, context, reason, candidate_readings}` |
| `entries[]` | One per act, see below |
| `personas[]` | Every person mentioned, flattened: `{id, entry_id, name, name_as_written, roles, sex, is_real_person}` |
| `claims[]` | Proposed claims, see below |
| `hint_matches[]` | `{query, persona, name, score}` for searched names found on the page |
| `reader_notes[]`, `warnings[]` | Notes from the model for the checker, and problems found by the post-processing checks |

**Field.** Every extracted value has the same shape:

```json
{ "as_written": "Joaq.m Ferreira", "value": "Joaquim Ferreira",
  "box": { "page": 1, "x": 0.6338, "y": 0.1764, "w": 0.165, "h": 0.0214 },
  "confidence": 0.95, "legibility": "clear", "note": null }
```

`box` is in **page fractions** (origin top-left; `x`/`w` in widths, `y`/`h` in heights). For pixels of the original scan, use `toOriginalPixels(box, result.source.pages[box.page - 1])`. `legibility` is `clear | unclear | partly_illegible | illegible`. Dates in `value` are ISO 8601 (`YYYY`, `YYYY-MM` or `YYYY-MM-DD`), and the words stay in `as_written`.

**Entry.**

| Field | |
|---|---|
| `id` | `e1`, `e2`, … |
| `type` | `baptism`, `birth`, `marriage`, `banns`, `death`, `burial`, `confirmation` or `other` |
| `jurisdiction` | `parish`, `civil`, `notarial`, … |
| `date` | The date of the act itself: baptism date, civil birth date, burial date |
| `other_dates[]` | `{kind: birth\|death\|registration\|…, field}` |
| `place` | Field |
| `margin_note` | Field |
| `facts[]` | `{key, field}`, e.g. `legitimacy`, `cause_of_death`, `burial_place`, `sacraments`, `testament` |
| `people[]` | See below |
| `line_ids` | The transcription lines of this entry |
| `box`, `summary_en`, `confidence` | |

**Person.**

| Field | |
|---|---|
| `id` | `e1.p1`, … |
| `roles[]` | subject, groom, bride, father, mother, paternal/maternal_grandfather/grandmother, godfather, godmother, godparent, spouse, former_spouse, sibling, child, other_relative, witness, officiant, registrar, declarant, informant, physician, other |
| `name` | Field. `value` keeps what is written, with normalised spelling; no surnames are added |
| `given_names`, `surnames` | |
| `sex` | |
| `is_real_person` | `false` for e.g. "Nossa Senhora" as godmother |
| `age`, `marital_status`, `occupation`, `residence`, `origin` | Fields, or null |
| `other_facts[]` | |
| `relations[]` | `{type: parent_of\|spouse_of\|former_spouse_of\|grandparent_of\|godparent_of\|sibling_of\|relative_of, to: person id, evidence: Field}`, i.e. what the text states |

### Claims

A claim is **one statement the record makes about one persona**. A persona is a person *as mentioned in this record*. Persona ids (`e1.p2`) are local to the read. Deciding which tree `Person` a persona is, is a later, human-confirmed step.

```json
{
  "id": "e1.c38", "entry_id": "e1",
  "kind": "relationship",            // event | name | person_fact | relationship | record_fact
  "subject": "e1.p4",                // persona the claim is about (or the entry id if no principal)
  "predicate": "parent_of",          // event: entry/event type; relationship: relation; facts: key
  "statement": "Manuel Ferreira is a parent of Joaquim Ferreira.",
  "object": { "persona": "e1.p2", "value": null, "as_written": null, "date": null, "place": null, "participants": null },
  "evidence": [ { "entry_id": "e1", "path": "entries[0].people[3].name", "as_written": "Manoel Ferreira",
                  "box": { "page": 1, "x": 0.62, "y": 0.23, "w": 0.17, "h": 0.02 },
                  "reading_confidence": 0.95, "legibility": "clear" } ],
  "reading_confidence": 0.95,        // lowest among the evidence
  "inferred": true,                  // follows from the wording rather than stated outright
  "note": "Paternal/maternal grandparent of e1.p1, so parent of the father.",
  "status": "proposed"
}
```

What gets emitted per entry:

- **event**: the act, with date, place and every participant with their role. Also any other dated events stated in the entry, e.g. the birth date inside a baptism or the death date inside a burial.
- **name**, plus **person_fact** `sex`, `age`, `marital_status`, `occupation`, `residence`, `origin` and other facts, for each real persona.
- **relationship**: every relation the text states (`inferred: false`). Then, only if the model left them out, the ones implied by roles in child-centred acts: father/mother → `parent_of` the subject, grandparents → `grandparent_of`, godparents → `godparent_of`. A paternal grandparent is also `parent_of` the father, and a maternal one `parent_of` the mother. For a marriage, groom `spouse_of` bride. All of these are `inferred: true`. Relationships with devotional godparents are skipped.
- **record_fact**: facts about the act (legitimacy, sacraments, burial place, registration date…), attached to the principal persona.

### Mapping onto the evidence model

Based on `src/model/types.ts` on the `claude/evidence-tree-*` branch as of 2026-11-10:

| record-reader | evidence model |
|---|---|
| `ReadResult.source.files[]` + `document` | `Source` (kind `original` for registers, `derivative` for certificates and extracts; `language`, `transcription`, `document.sha256`). Archive / book / folio come from the uploader. `repository_marks` is a hint |
| `claims[]` (kind `event`, predicate baptism/birth/marriage/death/burial) | `Claim.kind` = same, `eventDate` = `object.date.as_written`, `eventYear` from `object.date.value`, `eventPlace` = `object.place.value` |
| `relationship` `parent_of` / `spouse_of` | `Claim.kind` `parentage` / `marriage`, plus a `ClaimRelationshipLink` (`stance: supports`; `evidence: direct` when `inferred` is false, `indirect` when true) to a `parent` / `spouse` `Relationship` |
| `relationship` grandparent_of, godparent_of, sibling_of, former_spouse_of | `Claim.kind` `other`, with persons in roles `grandparent` / `godparent`. The evidence model has no relationship kind for these (grandparent_of can support the two `parent` links through the middle generation) |
| `name`, `person_fact` occupation / residence | `Claim.kind` `name` / `occupation` / `residence` |
| other `person_fact`, `record_fact` | `Claim.kind` `other` |
| `roles` | `ClaimRole`: subject/groom/bride → `subject`; father, mother, child, witness; paternal_/maternal_* → `grandparent`; godfather/godmother/godparent → `godparent`; spouse/former_spouse → `spouse`; officiant, registrar, declarant, … → `other` |
| `reading_confidence` (0–1) | `ReadingConfidence`: ≥ 0.9 `clear`, ≥ 0.6 `likely`, else `uncertain` (suggested thresholds) |
| `reader.model_served` | `Extractor { kind: "ai", name: model id }`; `review: "proposed"` |
| `statement` | `Claim.statement` |
| `evidence[].box` | No home yet; see open questions |

The reader does not judge **information quality** (primary / secondary). That depends on who supplied each fact (a priest at a baptism versus ages on a burial), so the reviewer sets it, or a later step proposes it. Per the evidence model, AI proposals count only towards `possible` until someone accepts them.

## Evaluation

The harness measures field-level accuracy against hand-checked pages, per record type, century and script.

```bash
npx record-reader eval                       # read every sample (costs API calls), save results, score
npx record-reader eval --score-only          # re-score saved results, no API calls
npx record-reader eval --only my-sample --rerun --out eval/report.json
```

### Folder format

```
eval/samples/<sample-id>/
  page-1.jpg, page-2.jpg …    the page images or PDFs (read in name order, or as listed in expected.files)
  expected.json               hand-checked expectations
eval/results/<sample-id>.json saved reader output (git-ignored; reused until --rerun)
```

`expected.json` (schema in `src/eval/expected.ts`). Only what you write down is scored:

```json
{
  "id": "rates-1847-fl23",
  "meta": { "origin": "ADP, Paróquia de Rates, Mistos 1840-1850, fl. 23", "record_types": ["baptism", "burial"],
            "century": 19, "year": 1847, "language": "pt", "script": "handwritten", "jurisdiction": "parish" },
  "hints": { "parish": "Rates" },
  "expect_record": true,
  "entries": [
    { "type": "baptism", "date": "1847-03-23", "place": "São Pedro de Rates",
      "other_dates": [{ "kind": "birth", "date": "1847-03-19" }],
      "people": [
        { "roles": ["subject"], "name": "Maria", "sex": "female" },
        { "roles": ["father"], "name": "Joaquim Ferreira", "occupation": "lavrador" },
        { "roles": ["godmother"], "name": "Anna", "legibility": "partly_illegible" }
      ] }
  ],
  "illegible": [{ "box": { "page": 1, "x": 0.2, "y": 0.3, "w": 0.06, "h": 0.03 }, "note": "blot over surname" }]
}
```

Write names in any spelling: accents, case and old spellings are folded (Thereza = Teresa). People are matched by name similarity. Person `box` is optional and only needed for box scoring. `legibility` on a person, and `illegible` regions, check that the reader **flags** the problem.

### Metrics

Each expected value is one observation. A missing entry or person counts as wrong for all of its fields (end-to-end accuracy).

| Metric | Correct when |
|---|---|
| `record_detected` | Record vs non-record decided right |
| `entry_found`, `entry_type` | Expected act found; type right |
| `date` | Act date and other dates, exact ISO match |
| `place` | Same place (folded, containment) |
| `person_found` | Expected person present |
| `name` | Folded name equal |
| `role` | All expected roles present (godparent ≈ godfather/godmother, registrar ≈ officiant) |
| `sex`, `age`, `occupation`, `marital_status` | Per value |
| `name_box` | IoU ≥ 0.4 with the expected box |
| `illegible_flagged` | The region or name is marked illegible / partly illegible |
| `name_cer` | Mean character error rate of names after folding (lower is better) |
| `extra` | Unexpected entries and people (hallucination check) |

The report groups everything **overall, by entry type, by century, by script and by sample**, and lists every miss, e.g. `name: … father "Joaquim Ferreira": got "Joaquim Pereira"`.

### Bundled synthetic samples

These are rendered by `npm run make-synthetic` (`src/scripts/make-synthetic.ts`) with exact ground-truth boxes, so the harness runs without archive data:

| Sample | What it tests |
|---|---|
| `synthetic-pt-1847` | A handwriting-style (Apple Chancery font) Portuguese parish page: a baptism with parents, four grandparents, godparents and the abbot, and a burial ("no dia antecedente" → death date). Has abbreviations (Joaq.m, Ant.o, Fr.co, freg.a) and an **ink blot over the godmother's surname**, which must be flagged, not guessed |
| `synthetic-it-1888` | A typewritten Italian atto di nascita: father who is also the declarant, witnesses with ages, registration date vs birth date, a signature line that must not create duplicate people |
| `synthetic-not-a-record` | A drawing of a house; must come back `not_a_record` |

They are much easier than real registers: a clean font, no bleed-through, no faded ink, modern layout. Treat their scores as a smoke test, not as accuracy.

### Adding real pages

1. Make a folder `eval/samples/<archive>-<year>-<folio>/` and put the page image(s) in it at the resolution you downloaded (do not shrink them; the zoom tool uses the full scan).
2. Read the page yourself, or take a reading you have already checked. Write `expected.json` with the entries, people (name, roles, plus age/sex/occupation where stated), dates and places. You do not need boxes. Add `legibility` / `illegible` where the page is damaged.
3. Put the archive reference in `meta.origin`, and set `century` and `script` so the report can group by them.
4. Run `npx record-reader eval --only <id>` and read the misses. A fast way to write `expected.json` is to run the reader first, correct its output and copy the checked values. Only do that if you really check every value, or the eval only measures agreement with the model.
5. Aim for a spread: for example 5 pages each of 18th-century handwritten baptisms, 19th-century marriages and burials, Latin entries, Italian civil acts and Brazilian certidões. Results from 5–10 pages per group start to be informative.

Real archive pages may carry reuse restrictions (many Portuguese district archives allow private research use only), and the people in recent records may be living. Keep such samples out of git, for example in a git-ignored `eval/samples/private-*` folder, unless you know they can be shared.

## Cost per page

These are estimates from token sizes, not measurements (no live run yet). They use Claude Opus 5.5 at $4 / $20 per million input/output tokens, with cache reads at $0.20.

| Part | Tokens (one dense page, 2 entries, 13 people) |
|---|---|
| Page image (≤ 2576 px, ≤ 3.75 MP) | ~4,700 input |
| System prompt + schema + tool (cached after the first read) | ~4,000 input |
| Reading JSON (transcription, expansion, translation, entries with boxes) | ~5,500–8,000 output |
| Thinking at `high` effort | ~3,000–8,000 output (varies a lot) |
| Each zoom | ~1,000–1,600 input (crop) + ~500–1,500 output; earlier turns are re-read from cache |

| Configuration | Estimated cost per page |
|---|---|
| Opus 5.5, `high`, up to 6 zooms (default) | **≈ $0.25–0.45** for a dense register page; ≈ $0.10–0.20 for a single short entry or certificate |
| Opus 5.5, `medium`, `--zoom 0` | ≈ $0.15–0.25 |
| Sonnet 5.5 (`--model claude-sonnet-5-5`), same settings | about half of Opus |
| Message Batches API (not wired in yet) | −50%, results within hours: good for bulk-reading a whole register |

Output tokens are ~80% of the bill. Every result reports its real `usage` and `cost_usd`, and the eval report sums them, so the first eval run replaces these estimates with measured numbers.

## Limitations

- **Unmeasured accuracy.** Nothing has been measured on real pages. On clear typed or printed records, names and dates should be read well. On 18th-century handwriting, faded iron-gall ink, bleed-through, tight binding and heavy abbreviation, expect many more `unclear` / `partly_illegible` fields and some wrong readings. Only the eval on real pages will tell.
- **Box precision.** Boxes are the model's own estimates: good enough to highlight a word or line for a checker, not word-exact. The post-processing rejects impossible boxes but cannot tell a plausible-but-wrong box from a right one. `name_box` IoU in the eval measures this.
- **Confidence is self-reported.** The 0–1 reading confidence comes from the model and is not calibrated yet. Once there are real samples, compare confidence with correctness and adjust the thresholds.
- **One read = one record.** All files in a read are pages of one record, up to 10 pages. Whole registers must be split, and entries continued on the next image need both pages in the same read.
- **Hints can bias.** The prompt forbids changing what is written to fit a hint, but a strong hint can still tip a truly ambiguous reading. The eval can measure this by running samples with and without hints.
- **Not covered yet:** marginal annotations added decades later, such as marriage or death notes in a baptism margin, are captured as lines and facts but not linked as separate events. There is no cross-page linking of the same person, no batch mode, no deskew or contrast enhancement, and no handwriting-specific model tuning. Synthetic samples need the macOS fonts (Apple Chancery, Courier New) to regenerate; the committed PNGs do not.
- **Privacy.** Pages are sent to the Claude API. Modern civil certificates name living people, so make sure the owner's terms cover it.

## Development

```bash
npm test            # vitest, API fully mocked (no key needed)
npm run typecheck
npm run build
npm run make-synthetic   # re-render eval/samples/synthetic-* and tests/fixtures/
```

Layout: `src/reader.ts` (API loop, zoom tool, error mapping), `src/prompt.ts` (system prompt, tool), `src/schema.ts` (zod schemas), `src/pages.ts` (images, PDFs, crops), `src/postprocess.ts` (boxes, checks, status), `src/claims.ts` (claims), `src/eval/` (harness), `src/cli.ts`.

## First live run

```bash
cd tools/record-reader && npm install
export ANTHROPIC_API_KEY=sk-ant-...
npx record-reader read eval/samples/synthetic-pt-1847/page-1.png --out examples/synthetic-pt-1847.output.json
npx record-reader eval --out eval/report.json   # 3 samples, roughly $1 in total
```

Then check: is the ink blot flagged? Are the boxes on the right words? What are the real token counts and cost? After that, add 5–10 real pages.
