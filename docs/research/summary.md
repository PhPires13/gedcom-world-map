# Market research summary: what this changes in the plan

As of: 2026-11-10. Detail, quotes and source links are in the five sibling notes: [vestigee.md](vestigee.md), [competitors.md](competitors.md), [record-sources.md](record-sources.md), [print-partners.md](print-partners.md), [map-data-licensing.md](map-data-licensing.md). Several pages were read through a summarising fetch tool; each note flags which. This is research, not legal advice.

## 1. Positioning

- **Vestigee is not the competitor the plan feared.** It is an AI genealogy subscription (GEDCOM import, AI record hints, 32 UI languages incl. pt-BR and it-IT) with a France-weighted catalogue. Its shop sells only fill-in family-tree posters and notebooks. No migration map print, no flags, no citizenship pack, no named Portuguese/Brazilian/Italian collection, no visible per-relationship confidence ([vestigee.md](vestigee.md)).
- **Its weak spot is trust:** Trustpilot 4.0 on 925 reviews, 23% 1-star, mostly trial-to-paid auto-conversion charges (R$5,90 trial, then R$101,50 per 28 days). Win on transparent pricing and one-off packages.
- **White space is real but narrow:** relationship-level evidence with a stated confidence, aimed at Luso-Brazilian families, plus a data-driven antique map print. The nearest adjacent offer is a new Etsy shop (TruescaleMaps, 3 sales), digital only ([competitors.md](competitors.md)).
- **Do not sell "AI reads the archive for you" as a headline.** No source allows it today (section 3). Lead with: documents the family already holds or orders, plus a reviewable evidence graph.

## 2. Pricing hypotheses vs. what was found

| Hypothesis | Verdict |
|---|---|
| Digital map $19-29 | Too high stand-alone: plain digital heritage maps on Etsy are BRL 32-98. Hold only if bundled with research or evidence. |
| Framed print $129-249 | Mid-market and supported (Etsy framed migration prints BRL 240-1,198; Vestigee blank framed A3 about $104). Real cost per A2 print is unknown until a partner quote (section 4). |
| Subscription $12-25/mo | Below Ancestry (USD 39.99/mo) and Vestigee; FamilySearch is free, which caps willingness to pay. |
| Research package $199-499/line | Squeezed: AI single-ancestor package about BRL 342 below it, firms from R$650-2,000 per person above it. |
| Citizenship pack $500-1,500/line | Works only as an evidence pack. Whole-process figures published are R$5,000-15,000. |

Currency was not normalised in the competitor note (BRL vs USD); re-check with a sourced rate.

## 3. Which sources to rely on

- **Do not plan on automated reading of any archive's images without a written licence.** FamilySearch's Terms ban bulk download and scraping without written permission, and its developer docs bar AI use of its data (verified live against the Terms page). Antenati's Note legali say "esclusa ogni utilizzazione a fini di lucro delle immagini" (verified live). DGLAB (Portugal) requires express authorisation for commercial use or any use beyond the one authorised (Despacho 6852/2015); Digitarq's per-image licence could not be read.
- **Rely on, for now:** user-uploaded documents and certificates, the user's own GEDCOM, and certificates ordered by the customer in their own name (Brazil's portal bans resale or mark-up intermediation). Portuguese civil certificates can be requested by anyone (EUR 10 online, summary-tool read).
- **Start partnership requests in parallel, in this order:** DGLAB (protocol under art. 5.4; their sites were down from about 2026-10-26, so phone or e-mail), Antenati / DG Archivi (dg-a@pec.cultura.gov.it), FamilySearch ("Request Permission", about 45 days).
- **Citizenship market is narrower and moving.** Italy: Art. 3-bis (DL 36/2025, L. 74/2025) cut jure sanguinis; Constitutional Court upheld it (judgment 63/2026); an EU-law question was referred to the CJEU (order 147/2026), no ruling found. Portugal: Lei Orgânica 1/2026 (in force 2026-05-19) adds language/culture and other requirements for grandchildren, and gives great-grandchildren only discretionary naturalisation. Every eligibility statement in a pack needs an "as of" date. Prioritise the Portuguese grandchild route; the Italian pack should wait for the CJEU outcome.

## 4. Print partner to start with

- **Prodigi** first (EU labs, v5 API with quotes and tax lines, sandbox key, giclée on Hahnemühle, antique-style frame colours, white-label inserts) for Portugal; run `POST /quotes/order` to get real A2/A3 framed prices. **No partner publishes exact framed A2/A3 wholesale prices;** all gate them behind login or API.
- **Brazil is the hard part.** Printful: 0 framed posters deliverable to Brazil. Prodigi and Gelato leave import tax to the recipient and require a CPF/CNPJ. Gelato is the only one with Brazil production evidence (economy 10-14 days, 27.86 BRL, framed poster of unknown size). No Brazilian framed-art partner with an API was verified. **First Brazilian customers: manual fulfilment through a local lab and framer**, then Gelato pilot.
- Brazil import-tax figures rest on one trade blog; the official rule was not read.
- Print from UK labs into the EU carries a flat EUR 3 per item duty from 2026-07-01 (Prodigi FAQ): prefer EU-made SKUs.

## 5. Map data and fonts: cleared, with three traps

- **Safe:** Natural Earth (public domain, use 1:10m), OSM data via your own render (ODbL; credit "OpenStreetMap" beside the map on the front, with the copyright URL), SIL OFL fonts (19 checked, e.g. IM Fell, Cinzel, EB Garamond; mind Reserved Font Names), Flagpedia flags (states public domain).
- **Traps:** do not render print files from `tile.openstreetmap.org` ("Offline use is not permitted"); do not use CShapes or David Rumsey imagery (non-commercial); Historical Basemaps is GPL-3.0 (ask a lawyer). Flags: Brazil's Lei 5.700 limits altering the flag, so check before stylising it; Commons historic-flag files carry mixed licences.

## 6. Remaining unknowns

1. Real wholesale cost of a framed A2/A3 print and landed cost to Brazil (needs a Prodigi/Gelato quote and one sample order each).
2. Digitarq per-image licence text and whether DGLAB will grant a commercial AI-reading licence; the fee schedule (DM 161/2023, DM 108/2024 annexes unread).
3. Whether FamilySearch's partner programme would allow any record access for a small commercial app.
4. Brazilian certificate prices (R$ by state), CNJ apostille rules, and whether ON-RCPN offers an integration.
5. Whether Italian comuni accept agency requests; comune fees; the CJEU outcome.
6. Brazilian import tax rules from an official source; any Brazilian or Portuguese giclée + framing lab with API.
7. Ancestry/MyHeritage per-relationship citation behaviour (pages blocked); Vestigee's in-app map and Brazil shipping (behind login).
8. Legal review: flag use, OSM attribution placement, Historical Basemaps GPL, GDPR/LGPD for living descendants in derived datasets.
