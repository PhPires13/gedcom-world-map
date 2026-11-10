# Map data, imagery, flags and fonts: licensing for commercial printed products

**As of: 2026-11-10**

> Research notes, not legal advice. Have a lawyer check at least: (a) the GPL-3.0 status of Historical Basemaps data, (b) flag/national-symbol laws of Brazil, Portugal and Italy for printed decorative products, (c) any ODbL "derived database" question if OSM data is ever merged with your own data, (d) MapTiler/Stadia commercial terms if used.

**How quotes were obtained.** Pages were opened with a fetch tool that returns a model-generated extract of the page, not raw HTML. Quoted strings below are the strings that tool returned inside quotation marks. Before relying on any wording in a contract or on a print, re-open the linked page and copy the exact text. Items I could not open are marked **UNVERIFIED**.

## 0. Bottom line for the product

| Need | Verdict |
|---|---|
| Base geography (coastlines, countries) | **Natural Earth**: public domain, commercial OK, no credit required. Best choice. |
| OSM-derived data | Usable commercially under ODbL with visible credit. **Do not** use `tile.openstreetmap.org` images for print (offline use not permitted). |
| Antique-look boundaries | **CShapes = NC (not allowed)**. **Historical Basemaps = GPL-3.0** (unusual for data; get legal advice). |
| Old-map imagery for textures | **David Rumsey = NC and defines commercial use as "selling reproductions"** (do not use). Prefer Wikimedia PD-old-100 scans and British Library Flickr PD images, checked per file. LoC and Gallica could not be opened. |
| Flags | Flagpedia says "public domain"; Wikimedia Commons SVGs are PD-shape but carry an "insignia" warning. Brazil's Lei 5.700 has rules worth a lawyer's look. flag-icons / country-flag-icons are MIT-licensed code. Twemoji needs CC BY credit. OpenMoji is CC BY-SA (share-alike). |
| Fonts | All checked families are SIL OFL 1.1. Commercial print and PDF embedding allowed. Several declare a Reserved Font Name (matters only if you modify/subset and redistribute the font). |

---

## 1. Natural Earth

- **Licence:** public domain. "All versions of _Natural Earth_ raster + vector map data found on this website are in the public domain." ([Terms of Use](https://www.naturalearthdata.com/about/terms-of-use/))
- **Commercial print:** allowed. The authors "renounce all financial claim to the maps and invites you to use them for personal, educational, and commercial purposes." (same page)
- **Attribution:** not required. "No permission is needed to use _Natural Earth._ Crediting the authors is unnecessary." Optional suggested text: "Made with Natural Earth." No placement rules, so a credit on the back, margin or legend is fine. (same page)
- **Share-alike / derived database:** none; public domain.
- **Scales** ([Downloads](https://www.naturalearthdata.com/downloads/)): 1:10m ("Show the world on a large wall poster"), 1:50m ("Show the world on a tabloid size page"), 1:110m ("Suitable for schematic maps of the world on a postcard or as a small locator globe"). **For large prints use 1:10m.** Even 1:10m is generalised (1 cm = 100 km on the source scale), so country-level close-ups on big prints will look coarse. Consider a different dataset or accept the stylised look.
- **Disputed boundaries** ([Disputed boundaries policy](https://www.naturalearthdata.com/about/disputed-boundaries-policy/)): "Natural Earth's editorial policy is to show political boundaries according to their de facto status." Version 5 added "official support for multiple points-of-view about boundaries (eg worldviews)", with Taiwan among the supported viewpoints. For disputed areas "we show the de facto boundary by default (marking it disputed)"; the de jure line is a separate "claim" line in an auxiliary download. The page names Taiwan, Western Sahara, Northern Cyprus and Kosovo as having no UN representation. Crimea is not mentioned on that page.

## 2. OpenStreetMap

### 2.1 Licence and attribution
- **Licence:** ODbL 1.0. "You are free to copy, distribute, transmit and adapt our data, as long as you credit OpenStreetMap and its contributors." Altering/building on the data may be distributed only under the same licence. ([openstreetmap.org/copyright](https://www.openstreetmap.org/copyright)) Commercial use is not restricted by the data licence itself (the page "does not directly address commercial use"; the grant is broad).
- **Attribution Guidelines** ([OSMF](https://osmfoundation.org/wiki/Licence/Attribution_Guidelines)):
  - "Attribution must be to “OpenStreetMap”."
  - "Attribution must also make it clear that the data is available under the Open Database License."
  - "Attribution must be placed in the vicinity of the produced work."
  - Printed maps: "the credit must appear beside the map if that is where other such credits appear." and "The URL to openstreetmap.org/copyright must be printed out."
  - "Attribution is only necessary when a Produced Work is used Publicly."
  - **Back/margin/legend:** the guideline says "in the vicinity" and "beside the map" where other credits appear. A margin or legend strip on the front is safest. A credit only on the back of a framed print is **not clearly sufficient** (UNVERIFIED whether the guideline accepts it). Put it on the front margin.
- **Suggested credit text** (the exact wording "© OpenStreetMap contributors" was not quoted from an opened page; the opened pages say credit "OpenStreetMap and its contributors"): `© OpenStreetMap contributors. Data available under the Open Database Licence: openstreetmap.org/copyright`.

### 2.2 Produced Work vs Derived Database
- ([Produced Work guideline](https://osmfoundation.org/wiki/Licence/Community_Guidelines/Produced_Work_-_Guideline)) A publication is "either a Produced Worked or a Derivative Database within the meaning of the ODbL." If the output is meant for extracting the data, "then it is a database and not a Produced Work." "a map in a physically printed work" is listed as usually a Produced Work; PNG, JPG, PDF, SVG images also usually; "Database dumps are usually not Produced Works."
- A printed/exported map image is a **Produced Work**: you need credit but **not** to release your own data under ODbL.
- **Caveat:** the same page also says "if you publish a produced work, the underlying database has to be published as well", which reads as referring to ODbL 4.6 (derivative databases). The ODbL text ([ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/), extract: "Using a derivative database to create a Produced Work doesn't make that work a derivative database") covers that nuance. If you only render unmodified OSM extracts, no derivative database arises. If you **modify or merge** OSM data into a database you publicly use, 4.4/4.6 may apply (share-alike plus an offer of a machine-readable copy). Ask a lawyer before ever publishing a modified OSM-derived dataset (e.g. an interactive map that ships merged geometry for download).
- **Horizontal Map Layers** ([guideline](https://osmfoundation.org/wiki/Licence/Community_Guidelines/Horizontal_Map_Layers_-_Guideline)): share-alike depends on feature type. If all data for a feature type comes from non-OSM sources, share-alike does not apply to that type; if OSM and non-OSM data cover the same feature type, share-alike applies. Overlaying unrelated data (e.g. migration paths) on an OSM base does not require sharing the overlay data. This supports putting family migration routes on an OSM base without opening them. Endorsed by OSMF board 2014-06-06 (per the page).
- **Collective Database guideline:** the URLs I tried returned 404; **UNVERIFIED**.

### 2.3 Tile Usage Policy ([operations.osmfoundation.org/policies/tiles](https://operations.osmfoundation.org/policies/tiles/))
- "Offline use is not permitted on `tile.openstreetmap.org`."
- "**Bulk downloading** is any pre-emptive fetching of tiles other than those a user is actively viewing."
- Not permitted: "Preloading entire towns/regions or multiple zoom stacks “just in case”." and "Automated scans across wide bounding boxes, especially at high zoom (z≥14)."
- Also prohibited: "Bulk download (“scrape”) tiles or offer prefetch features." Attribution: "Show OpenStreetMap licence attribution clearly on the map (typically bottom-right)."
- "Commercial services, or those that seek donations, should be especially aware that access may be withdrawn at any point."
- **Answer:** the standard tiles must not be used to assemble high-resolution print files. The policy extract does not mention print explicitly, but stitching tiles for print is bulk/offline use.

### 2.4 Alternatives
- **Self-render from extracts.** [Geofabrik downloads](https://download.geofabrik.de/) footer: "License: ODbL 1.0", credit "created by OpenStreetMap Contributors". Free of charge. Extracts exclude user names/IDs. Rendering yourself gives a Produced Work (section 2.2).
- **MapTiler** ([Terms](https://www.maptiler.com/terms/)): §4.3 "you may not produce commercial derivative works from MapTiler Services," unless a custom licence allows it; §3.3 free accounts limited to free-tier quota; §6.1 attribution "© MapTiler" (free accounts show the logo); §6.2 "© OpenStreetMap" for OSM-based data; §6.6 printed maps/images/video need visible attribution; §6.7 attribution must stay "visible and readable on any screen or medium". Print files made from MapTiler tiles **likely need a custom/commercial agreement**. Ask MapTiler in writing.
- **Stadia Maps** ([Terms](https://stadiamaps.com/terms-of-service/)): "Our free tier may only be used for non-commercial or evaluation purposes." (§13); §8 item 11 restricts use in "print, film, television, or other medium" unless non-commercial or an explicit commercial licence; §30.3.2 "Images may be printed and redistributed, up to 5,000 copies per Image, including for commercial use" (this appears to relate to a static-image product and larger runs need a quote); bulk downloads generally prohibited (§8 item 4), server-side caching prohibited (§8 item 5). Needs a paid subscription for commercial use.
- **Mapbox:** not checked. **UNVERIFIED**.

## 3. Historic map data and old-map imagery

| Source | Licence found | Commercial print? | Notes |
|---|---|---|---|
| **Historical Basemaps** (aourednik, [GitHub](https://github.com/aourednik/historical-basemaps)) | **GPL-3.0** (repo links "GPL-3.0 license"; LICENSE file is GNU GPL v3, [raw LICENSE](https://raw.githubusercontent.com/aourednik/historical-basemaps/master/LICENSE)) | Not prohibited, but GPL is a software copyleft licence applied to data. Whether a printed map or a shipped derived GeoJSON triggers copyleft is unclear. **Lawyer.** | README: "It is work in progress: verify the maps by comparison to other sources before using in academic work." "historical boundaries are even more disputed than contemporary ones." Credits: basemaps "collected, adapted and converted from diverse sources" (ThinkQuest Team C006628); upstream source terms **UNVERIFIED**. No formal attribution wording stated; give a credit anyway. |
| **CShapes 2.0** ([ICR ETH](https://icr.ethz.ch/data/cshapes/)) | "licensed under a Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License." | **No (NC).** | Coverage 1886 to 2019 per page (citation title says 1886-2017). Cite Schvitz et al. 2022, JCR. Not usable in a paid product without separate permission. |
| **Natural Earth "historical"** | Not opened/verified. | n/a | **UNVERIFIED** that Natural Earth offers historical boundary data. |
| **David Rumsey Map Collection** ([About](https://www.davidrumsey.com/about)) | "This work is licensed under a Creative Commons License" (linked CC BY-NC-SA 3.0 per URL); "Images from this web site and database may be reproduced or transmitted, but not for commercial use."; "Commercial use is selling reproductions of our images."; "For commercial use or commercial republication, contact" carto@davidrumsey.com. | **No (NC).** Selling prints made from their images is exactly their definition of commercial. | Requested credit: "David Rumsey Map Collection, David Rumsey Map Center, Stanford Libraries". Do not use their scans without a written licence. The `/rights` URL returned 404. |
| **Library of Congress** | **UNVERIFIED**: loc.gov returned 403 for every page I tried. | | Collections differ ("free to use and reuse" is stated only per collection/item). Check each item's Rights Advisory. |
| **Wikimedia Commons PD-old-100** ([template](https://commons.wikimedia.org/wiki/Template:PD-old-100)) | Work is "the public domain in its country of origin and other countries and areas where the copyright term is the author's life plus 100 years or fewer"; "You must also include a United States public domain tag". | Yes, if the file really carries PD-old-100 plus a US tag; verify per file. | Scans may be marked "Various" for digital-copy rights elsewhere; Commons policy is that faithful reproductions of 2D PD works carry no new copyright (not verified on an opened page). |
| **Gallica / BnF** ([BnF API portal](https://www.bnf.fr/fr/portail-bnf-api-et-jeux-de-donnees)) | "Digitized documents on Gallica are mostly public-domain reproductions. Non-commercial reuse is free with source citation. Commercial reuse is paid and requires a license." (extract/paraphrase of the page). Gallica's own conditions page returned 403. | **Paid licence needed for commercial reuse.** | Treat Gallica scans as not free for a paid product. |
| **British Library Flickr** ([Public Domain Review](https://publicdomainreview.org/collection/the-british-library-s-mechanical-curator-million/)) | Images "uploaded to Flickr Commons under the public domain mark, meaning complete freedom of re-use." Rights panel: "PD Worldwide" for the underlying work, "Various – see source links" for the digital copy. | Yes per the page; verify each Flickr item. | Good source for ornaments, cartouches, compass roses from 17th-19th century books. I did not open Flickr itself. |

## 4. Flags

### 4.1 Image sources
- **Flagpedia / flagcdn.** [Terms](https://flagpedia.net/terms): "The flag images provided on our website are in the public domain and can be used freely without restriction." No attribution required; commercial use not mentioned (unrestricted per "freely"). Other site content is copyrighted by the owner. [flagcdn.com](https://flagcdn.com/): flags "based on vector files from Wikipedia Commons"; "we appreciate backlink to https://flagpedia.net" (optional). Raster CDN output is low-res; for print use the SVGs.
- **Wikimedia Commons national flags.** [Flag of Portugal](https://commons.wikimedia.org/wiki/File:Flag_of_Portugal.svg): PD (author died 1929 / EU official journal), vector set commissioned by the Portuguese Presidential Office in 2004 "expressly to be released in public domain". [Flag of Italy](https://commons.wikimedia.org/wiki/File:Flag_of_Italy.svg): "ineligible for copyright and therefore in the public domain" (PD-shape). [Flag of Brazil](https://commons.wikimedia.org/wiki/File:Flag_of_Brazil.svg): PD-Brazil-Gov (published/commissioned by government before 1983, etc.), described as "SVG implementation of Lei n. 8.421 de 11 de maio de 1992". [PD-shape template](https://commons.wikimedia.org/wiki/Template:PD-shape): "consists entirely of information that is common property and contains no original authorship." **Every one of these pages carries the Insignia warning** ([Template:Insignia](https://commons.wikimedia.org/wiki/Template:Insignia)): "This image shows a flag, a coat of arms, a seal or some other official insignia." / "The use of such symbols is restricted in many countries. These restrictions are independent of the copyright status." Copyright-free does not mean legally unrestricted. Avoid coats of arms (not assessed; the Portuguese flag SVG includes the armillary sphere and shield, which is part of the national flag design).
- **flag-icons** ([lipis/flag-icons](https://github.com/lipis/flag-icons), [LICENSE](https://raw.githubusercontent.com/lipis/flag-icons/main/LICENSE)): "The MIT License (MIT)", "Copyright (c) 2013 Panayiotis Lipiridis". MIT requires keeping the copyright/permission notice in copies of the software (the licence says copies; whether that must appear on a printed map is unclear, and the repo says nothing about the flags' own legal status). Fine to use for the web app (keep notice in repo/About).
- **country-flag-icons** ([GitLab](https://gitlab.com/catamphetamine/country-flag-icons), [LICENSE](https://gitlab.com/catamphetamine/country-flag-icons/-/raw/master/LICENSE)): MIT, "(2020)" copyright by @catamphetamine. Same remarks as above.
- **Twemoji** ([jdecked/twemoji](https://github.com/jdecked/twemoji), community-maintained fork): "Graphics licensed under CC-BY 4.0"; code MIT. They will "accept a mention in a project README or an 'About' section or footer on a website" and in HTML/JS source. For a print this means a printed credit such as "Flag graphics: Twemoji, © Twitter, Inc. and other contributors, CC BY 4.0" (exact legal copyright holder line **UNVERIFIED**; check LICENSE-GRAPHICS). Emoji flags are small/stylised; not recommended for print.
- **OpenMoji** ([FAQ](https://openmoji.org/faq/)): "OpenMoji is published under the Creative Commons Share Alike License 4.0." Allowed "for any purpose, even commercially". Requires credit: "All emojis designed by OpenMoji – the open-source emoji and icon project. License: CC BY-SA 4.0". Remixes "must distribute your contributions under the same license CC BY-SA 4.0". Share-alike risk for adapted artwork: avoid in print products.

### 4.2 National symbol laws
- **Brazil, Lei 5.700/1971** ([planalto.gov.br](https://www.planalto.gov.br/ccivil_03/leis/l5700.htm)), as extracted by the fetch tool (page notes it does not replace the DOU publication, text has encoding errors): Art. 31 lists prohibited "manifestações de desrespeito": II "Mudar-lhe a forma, as cores, as proporções, o dístico ou acrescentar-lhe outras inscrições;" and IV (per extract) "Reproduzi-la em rótulos ou invólucros de produtos expostos à venda."; Art. 35 treats violations as "contravenção" with a fine; Art. 38 (paraphrased) copies sold or given away should bear the maker's mark, address and date. **Practical reading (not legal advice):** a decorative map where flags appear as small map symbols is not obviously a label/wrapping, but selling printed goods that reproduce the flag in Brazil should be checked; never alter colours, proportions or add inscriptions to the flag. Art. 28-29 per extract: the green and yellow colours may be used without restriction.
- **Portugal, Decreto-Lei 150/87:** **UNVERIFIED.** The diariodarepublica.pt page returned empty. A web search surfaced it as the governing decree, but I did not open the text.
- **Italy, Legge 5 febbraio 1998 n. 22** ([Normattiva](https://www.normattiva.it/eli/id/1998/02/14/098G0054/ORIGINAL)): only Article 1 was visible (general rules on use and display; Art. 12 of the Constitution: "La bandiera della Repubblica è il tricolore italiano: verde, bianco e rosso"). Provisions on private/commercial reproduction **UNVERIFIED**.

### 4.3 Historic flags on Wikimedia Commons
- **Kingdom of Portugal (1830-1910):** [file](https://commons.wikimedia.org/wiki/File:Flag_of_Portugal_(1830).svg). Uploader released it to the public domain worldwide; PD in country of origin; US PD tag needed; Insignia warning.
- **Empire of Brazil (19 stars, 1822-1853):** [file](https://commons.wikimedia.org/wiki/File:Flag_of_Brazil_(1822-1853).svg). PD-Brazil-Gov and "ineligible for copyright" statements; Insignia warning. For the 1853-1889 flag, [the overview page](https://commons.wikimedia.org/wiki/National_flags_of_the_Empire_of_Brazil) lists "Flag of Brazil (1853-1889).svg" as the best version but gives no licence; the individual file page was not opened. **UNVERIFIED** for 1853-1889.
- **Kingdom of Sardinia / Kingdom of Italy:** [File:Flag_of_Italy_(1861-1946).svg](https://commons.wikimedia.org/wiki/File:Flag_of_Italy_(1861-1946).svg) is described as covering Sardinia (1851-1861) and Italy (1861-1946) (civil flag and ensign), released to the public domain by the author, **but its structured data lists "Creative Commons Attribution-ShareAlike 2.5 Generic"**, which conflicts. The crowned version ([file](https://commons.wikimedia.org/wiki/File:Flag_of_Italy_(1861-1946)_crowned.svg)) has the same PD statement and the same CC BY-SA 2.5 structured-data licence entry. Treat the licence as ambiguous until checked, or redraw the flags yourself from the PD-shape geometry. The Sardinia file I opened (`Flag_of_the_Kingdom_of_Sardinia.svg`) is a 1783-1802 war ensign, not the 19th-century flag.
- **Portuguese Empire:** no distinct Commons file identified or opened. **UNVERIFIED**.

## 5. Fonts (SIL OFL 1.1)

OFL FAQ ([openfontlicense.org/ofl-faq](https://openfontlicense.org/ofl-faq/)): commercial use and printed materials, 1.1 "Yes. You are very welcome to do so." and 1.4 "Yes, you can do this with both the Original Version and a Modified Version of the fonts." Embedding in PDFs, 1.12: "The restrictions regarding font modification and redistribution do not apply". Selling: 1.5 "...so the OFL font is not sold by itself."; 1.6 "The intent is to keep people from making money by simply redistributing the fonts." Reserved Font Names: 5.3 "you cannot use the Reserved Font Names in any way to identify the font to the user". Documents: 1.13 "No. Referencing or embedding an OFL font in any document does not change the license of the document itself." Web: 2.1 "Yes! Go ahead!"; 2.10 "No. Unlike embedded fonts in a PDF, webfonts are not an integrated part of the document itself." (the restrictions therefore apply to webfonts you host/modify).

Licence text (e.g. [IM Fell English OFL.txt](https://raw.githubusercontent.com/google/fonts/main/ofl/imfellenglish/OFL.txt)): "Neither the Font Software nor any of its individual components, in Original or Modified Versions, may be sold by itself."; each copy contains the copyright notice and licence; derivatives "must be distributed entirely under this license".

For each font the `OFL.txt` in google/fonts was opened (URL pattern `https://raw.githubusercontent.com/google/fonts/main/ofl/<folder>/OFL.txt`). All are OFL 1.1; all allow commercial print and PDF embedding. "RFN" = Reserved Font Name declared (relevant only if you modify, convert or subset and **redistribute** the font under that name; embedding in a PDF is covered by FAQ 1.12; whether subsetting counts as modification is **UNVERIFIED** from the opened pages).

| Font | Folder | Copyright line (from OFL.txt) | RFN |
|---|---|---|---|
| IM Fell English | imfellenglish | Igino Marini, 2010 | none |
| IM Fell DW Pica | imfelldwpica | Igino Marini, 2010 | none |
| IM Fell Double Pica | imfelldoublepica | Igino Marini, 2010 | none |
| Cinzel | cinzel | The Cinzel Project Authors, 2020 | none |
| Cormorant | cormorant | Cormorant Project Authors, 2015 | none |
| EB Garamond | ebgaramond | EB Garamond Project Authors, 2017 | none |
| Pirata One | pirataone | Fuenzalida, Massi, 2012 | "Pirata" |
| UnifrakturMaguntia | unifrakturmaguntia | j. 'mach' wust, 2010; Peter Wiegel, 2009 | "UnifrakturMaguntia" |
| Fondamento | fondamento | Brian J. Bonislawsky DBA Astigmatic, 2011 | "Fondamento", "Fondamento Italic" |
| Almendra | almendra | Ana Sanfelippo, 2011-2012 | "Almendra" |
| Uncial Antiqua | uncialantiqua | Astigmatic, 2011 | "Uncial Antiqua" |
| Old Standard TT | oldstandardtt | Old Standard Project Authors, 2011 | none |
| Playfair Display | playfairdisplay | Playfair Display Project Authors, 2017 | "Playfair Display" |
| Cardo | cardo | David J. Perry, 2002-2011 | none |
| Great Vibes | greatvibes | Great Vibes Pro Project Authors, 2015 | none |
| Pinyon Script | pinyonscript | The Pinyon Project Authors, 2024 | none |
| Italianno | italianno | The Italianno Project Authors, 2009 | none |
| Rye | rye | Sorkin Type Co, 2011 | "Rye" |
| Metamorphous | metamorphous | Sorkin Type Co, 2011-2012 | "Metamorphous" |

I did not open the Google Fonts specimen pages (script-heavy); the OFL texts in the google/fonts repository are the source. Glyph coverage (Portuguese ã õ ç, Italian accents, old long-s/ligatures) was **not checked**; test your real place names in each font before committing.

### Recommended pairings (design suggestions, not licence facts)
1. **Classic letterpress:** IM Fell English (titles, italics for sea names) + IM Fell DW Pica (labels). Most authentically old-print texture, one designer, no RFN.
2. **Engraved atlas:** Cinzel (title/cartouche capitals) + EB Garamond (country/place labels) + Pinyon Script (family name flourish).
3. **19th-century atlas:** Old Standard TT (headings) + Cardo (labels) + Italianno (ocean/route captions).
4. **Gothic accent (optional, for a Germanic or medieval flavour):** UnifrakturMaguntia or Pirata One for a single title line only + Cormorant (body). Use unmodified; RFN applies if altered.

## 6. Practical checklist

- **Data credits line (example):** `Map data: Natural Earth (public domain). Flags: Wikimedia Commons (public domain). Fonts: IM Fell (Igino Marini), Cinzel and EB Garamond, SIL OFL 1.1. Route lines: created by the customer from their own records.` If OSM is ever used, add on the **front** margin: `© OpenStreetMap contributors. Data available under the Open Database Licence: openstreetmap.org/copyright`.
- Natural Earth credit is optional but harmless; OSM credit is mandatory and the guideline wants it beside the map plus the printed copyright URL.
- Keep a **licence register** per print template: source URL, licence, date checked, file hash.
- Do not use NC sources (CShapes, David Rumsey, Gallica commercial) in anything you sell.
- Avoid bulk-fetching from OSM tile servers or free-tier commercial tile APIs for print renders; self-render from Natural Earth or a Geofabrik extract.
- Historical boundaries: if Historical Basemaps are used, show only a "Boundaries approximate" legend line and credit the repo; resolve the GPL question first.
- Flag artwork: use unaltered flags; do not use coats of arms; have Brazil/Portugal/Italy rules confirmed for printed decorative products.
- Self-hosted fonts on the web app: ship each font's OFL.txt; do not rename modified fonts using an RFN.
- **Disputed borders and names.** Natural Earth's stance is to draw boundaries by de facto control, mark disputed areas as such, and offer alternative "worldview" boundaries (e.g. Taiwan) in version 5, with de jure claim lines separately. It says Taiwan, Western Sahara, Northern Cyprus and Kosovo lack UN representation. For a family-history product, decide a single worldview per print, add a one-line "Boundaries shown by de facto control; not a legal statement" in the credits, and choose label languages (local name plus Portuguese/English exonym) deliberately. Historical place names (e.g. "Constantinople", "Ceylon") are a design choice, not a data-licence issue. Crimea is not covered on the opened Natural Earth page, so check which worldview your chosen dataset version uses.

## Sources
Pages actually opened (extract returned by the fetch tool):
- https://www.naturalearthdata.com/about/terms-of-use/ (public domain, commercial use, no credit needed, "Made with Natural Earth")
- https://www.naturalearthdata.com/about/disputed-boundaries-policy/ (de facto policy, worldviews, Taiwan, Western Sahara)
- https://www.naturalearthdata.com/downloads/ (scale descriptions) ; https://www.naturalearthdata.com/about/ (scales)
- https://osmfoundation.org/wiki/Licence/Attribution_Guidelines (credit text, placement, printed maps)
- https://operations.osmfoundation.org/policies/tiles/ (tile policy: offline/bulk use not permitted)
- https://osmfoundation.org/wiki/Licence/Community_Guidelines/Produced_Work_-_Guideline (Produced Work vs Derivative Database)
- https://osmfoundation.org/wiki/Licence/Community_Guidelines/Horizontal_Map_Layers_-_Guideline (feature-type share-alike)
- https://www.openstreetmap.org/copyright (ODbL summary)
- https://opendatacommons.org/licenses/odbl/1-0/ (sections 4.2-4.6)
- https://download.geofabrik.de/ (ODbL, credit)
- https://www.maptiler.com/terms/ and https://stadiamaps.com/terms-of-service/ (commercial/print terms)
- https://github.com/aourednik/historical-basemaps and https://raw.githubusercontent.com/aourednik/historical-basemaps/master/LICENSE (GPL-3.0, disclaimers)
- https://icr.ethz.ch/data/cshapes/ (CC BY-NC-SA 4.0)
- https://www.davidrumsey.com/about (non-commercial; "Commercial use is selling reproductions of our images")
- https://www.bnf.fr/fr/portail-bnf-api-et-jeux-de-donnees (Gallica commercial reuse is paid)
- https://publicdomainreview.org/collection/the-british-library-s-mechanical-curator-million/ (BL Flickr PD mark)
- https://commons.wikimedia.org/wiki/Template:PD-old-100, Template:PD-shape, Template:Insignia
- Commons files: Flag_of_Portugal.svg, Flag_of_Italy.svg, Flag_of_Brazil.svg, Flag_of_Portugal_(1830).svg, Flag_of_Brazil_(1822-1853).svg, Flag_of_Italy_(1861-1946).svg, Flag_of_Italy_(1861-1946)_crowned.svg, Flag_of_the_Kingdom_of_Sardinia.svg, National_flags_of_the_Empire_of_Brazil
- https://flagpedia.net/terms and https://flagcdn.com/ (flag terms)
- https://raw.githubusercontent.com/lipis/flag-icons/main/LICENSE ; https://github.com/lipis/flag-icons ; https://gitlab.com/catamphetamine/country-flag-icons and its raw LICENSE (MIT)
- https://github.com/jdecked/twemoji (CC-BY 4.0 graphics) ; https://openmoji.org/faq/ (CC BY-SA 4.0)
- https://www.planalto.gov.br/ccivil_03/leis/l5700.htm (Lei 5.700) ; https://www.normattiva.it/eli/id/1998/02/14/098G0054/ORIGINAL (Italy L. 22/1998, Art. 1 only)
- https://openfontlicense.org/ofl-faq/ and the 19 `OFL.txt` files listed in section 5 (raw.githubusercontent.com/google/fonts/main/ofl/...)

## Not verified
- Library of Congress rights pages (all 403), Gallica's own conditions page (403): terms **UNVERIFIED** beyond the BnF portal summary.
- Natural Earth "historical" data existence; Natural Earth statement on Crimea; Natural Earth FAQ on print size.
- OSMF Collective Database guideline (404); whether a credit only on the back of a framed print satisfies the OSM guideline; exact "© OpenStreetMap contributors" wording on an opened page.
- Mapbox terms (not opened).
- Portugal Decreto-Lei 150/87 and Italy L. 22/1998 beyond Art. 1; Brazil Lei 5.700 article numbers are from a tool extract of a page with encoding errors; confirm against the official DOU text.
- Flag files: Empire of Brazil 1853-1889 file page, any Portuguese Empire flag file; Italian flag files' conflicting CC BY-SA 2.5 metadata.
- Twemoji exact copyright holder line (LICENSE-GRAPHICS not opened); flag-icons / country-flag-icons README notes on flag legal status.
- Whether subsetting/converting an OFL font counts as modification for Reserved Font Name purposes; glyph coverage for Portuguese/Italian diacritics in each font; Google Fonts specimen pages (not opened).
- Upstream licences of the sources behind Historical Basemaps.
- Everything is a tool-generated extract, not the verbatim raw page; re-verify quotes before relying on them.
