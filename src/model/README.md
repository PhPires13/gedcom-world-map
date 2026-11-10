# Evidence model (`src/model/`)

The shared contract for the evidence-based family tree. The API server (`server/`), the tree view
(`src/tree/`) and later tools (the AI record reader, the print renderer) all speak these types.
Everything here is plain TypeScript with no I/O, so it runs the same in Node and in the browser.

```ts
import { computeConfidence, isPresumedLiving, type Relationship } from '../model';
```

| File | What it holds |
| --- | --- |
| `types.ts` | The entities (`Source`, `Claim`, `Person`, `Relationship`, `DocumentAttachment`, …) and API shapes (`TreeDetail`, `RelationshipEvidence`, `PersonEvidence`). |
| `confidence.ts` | `computeConfidence` (a link's level from its claims) and `treeHealth`. |
| `living.ts` | `isPresumedLiving`, `presumedLivingAll`, `isPrivate`, `redactPerson`. |
| `gedcom-bridge.ts` | GEDCOM ⇄ model: `gedcomToDrafts` (import), `localTreeDetail` (read-only tree without a server), `toGedcomTree` (feed the map). |

## The model

It follows the [Genealogical Proof Standard](https://bcgcertification.org/ethics-standards/):
conclusions (people, relationships) rest on evidence (claims), and evidence comes from sources.

```
Source ──makes──▶ Claim ──mentions (role)──▶ Person
                    │
                    └──supports / contradicts (direct / indirect)──▶ Relationship ──▶ Person, Person
```

- **Source**: one document or record. Title, GPS kind (`original`, `derivative`, `authored`),
  citation (archive, collection, book, folio, entry, URL), record date, language, transcription,
  and an optional `DocumentAttachment` (the scan or PDF; bytes live in object storage).
  A GEDCOM import is itself a Source, of kind `authored` and origin `gedcom`.
- **Claim**: one statement a source makes, e.g. "Miguel, son of Manuel Costa and Rosa Lima,
  baptised 3 Jan 1898". It records who read it (`extractedBy`: a person or the AI), how legible it
  was (`reading`: clear / likely / uncertain), the GPS information quality (`primary`, `secondary`,
  `undetermined`) and, for AI claims, a review state (`proposed`, `accepted`, `rejected`).
  A claim mentions people with roles (subject, father, mother, godparent, …) and is linked to
  relationships, each link saying whether it `supports` or `contradicts` the relationship and
  whether that is `direct` or `indirect` evidence for it.
- **Person**: a conclusion built from claims, with summary facts (name, birth, baptism, death,
  burial, occupation). People can be merged (`mergedInto` points at the survivor; nothing is
  deleted) or split (claims move to a new person).
- **Relationship**: `parent` (`from` = parent, `to` = child) or `spouse`. It stores its computed
  `confidence` (a cache, recomputed whenever its claims change) and the researcher's written
  `argument`.

## Confidence levels

| Level | Meaning | Line in the tree |
| --- | --- | --- |
| **Proven** | A primary document names the link directly, and nothing contradicts it. | solid |
| **Probable** | Several independent pieces agree, or one direct but second-hand / copied / hard-to-read statement. | dashed |
| **Possible** | One indirect piece, or an AI proposal nobody has confirmed. | dotted |
| **In conflict** | Sources disagree. | red |
| **Unsupported** | No source. Everything from a GEDCOM starts here. | grey |

`computeConfidence(items)` applies these rules in order (each item is one claim's link to the
relationship, with its source kind):

1. Rejected claims are ignored.
2. Unreviewed AI proposals can lift a link to *possible* at most; a pending contradiction does not
   cause a conflict (it is reported in `pendingProposals`).
3. Claims from `authored` sources (other people's trees, GEDCOMs) are conclusions, not evidence,
   and are ignored.
4. Any remaining contradicting claim → **in conflict**.
5. A supporting claim that is `direct`, `primary`, from an `original` source and not read with
   `uncertain` → **proven**.
6. Any other direct claim, or supporting claims from **two or more different sources** →
   **probable**. (Two claims from the same record are not independent.)
7. One supporting claim, or a pending AI proposal → **possible**.
8. Otherwise → **unsupported**.

It returns the level with plain-language `reasons`, shown in the evidence panel next to the
researcher's own argument.

`treeHealth(levels)` counts links per level; the tree's health indicator is the share of proven
links.

## The living rule and privacy

`isPresumedLiving(person, currentYear, relatives?)`:

1. Any death or burial record, even undated → not living.
2. Known birth year (or baptism year) → living if born less than **100** years ago (`LIVING_YEARS`).
3. Unknown → estimate the latest plausible birth year from relatives (a child's birth − 15; a
   parent's birth + 50; a spouse's birth + 20), erring young.
4. Still unknown → presumed living. Privacy is the default.

The result is computed at read time (it depends on the current year), never stored.
`isPrivate(override, presumedLiving)`: an explicit `privacyOverride` (`private` / `public`) wins,
otherwise private = presumed living. `redactPerson` is what anyone but the tree's owners sees of a
private person: the node stays (so the tree keeps its shape) but name, dates and places are gone.

## Changing the rules

The rules are deliberately small and fully covered by `tests/model/`. If you change one, update the
table above and the tests together; the server recomputes stored levels with
`POST /api/trees/:id/recompute`.
