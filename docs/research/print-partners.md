# Print-on-demand partners for framed antique-style heritage maps (Brazil, Portugal, later Italy)

**As of: 2026-11-10**

Scope: partners that print AND frame fine-art prints, have an API for automated ordering from a web app, and ship to Brazil and Portugal. Price hypothesis to test: framed print retail $129-249.

Method note: every claim below comes from a page I opened in this session (a real browser for JS-rendered pages, WebFetch for static ones). Where WebFetch was used, its output is a model-extracted summary of the page, not a verbatim copy; I flag those in Sources. Anything I could not confirm from an opened page is marked **UNVERIFIED**. Most wholesale price lists are behind a login, so exact framed A2/A3 base prices for most partners are UNVERIFIED (see the price table).

---

## 1. Bottom line (read this first)

1. **No partner I checked publicly lists an exact wholesale price for a framed A2 or A3 fine-art print.** Prodigi, Gelato and Printful all gate SKU-level pricing behind an account/dashboard or the API quote endpoint. The only public numbers are "from" prices and one Gelato shipping-table row. A free sandbox account (Prodigi) or a Gelato account + `orders:quote` call is the fastest way to get real numbers.
2. **Brazil is the hard market.** No verified partner offers a framed fine-art print with documented in-country production in Brazil plus an API. Printful shows **0 framed posters deliverable to Brazil** (seen 2026-11-10, with a Brazil-geolocated catalogue). Prodigi's own help centre says customs charges are "most common for shipments to South America" and that the end customer pays. Gelato lists local production in Brazil and its shipping table shows a cheap, slower-than-EU Brazil rate for a "Ready to Hang" framed poster, but the product size/frame/paper behind that row are not stated.
3. **Portugal/EU is easy.** Prodigi (EU labs), Gelato (4-5 day economy delivery shown for Portugal) and theprintspace (Germany fulfilment for print-only) can all serve Portugal without customs if produced in the EU. UK-made framed items now attract a flat EUR 3 duty per item (<= EUR 150) from 1 July 2026 (Prodigi FAQ).
4. **Recommendation: start with Prodigi for Portugal/EU (and Italy later), pilot Gelato in parallel for Brazil, and run the first Brazilian customers through a local print+frame shop by hand** (fallback in section 9). Build the order layer behind a small "fulfilment provider" interface so a Brazilian provider can be swapped in later.

---

## 2. Comparison table

| Partner | Framed fine-art? | Sizes (verified) | Frames / glazing / mount | API (docs) | Sandbox | Webhooks | Production (verified) | Brazil | Portugal/EU |
|---|---|---|---|---|---|---|---|---|---|
| **Prodigi** | Yes: Classic frame, box frame, aluminium, etc. Giclee print. Papers with ICC profiles include Hahnemuhle Photo Rag, Hahnemuhle German Etching, Enhanced Matt, Lustre | Classic frame: 6x6" to 40x40" (example SKUs 11x14, 12x16, 18x24, 24x32, 28x40 in). A2/A3 SKUs: UNVERIFIED (no account) | 8 colours (black, white, natural, antique silver, brown, antique gold, dark grey, light grey), 3 glazes (Perspex, float glass, moth-eye), optional mount (snow white, off-white, black) | REST v5, OpenAPI, quotes incl. tax | Yes (key prefix `sandbox_`) | Yes (v4 CloudEvents callbacks; v5 says "webhooks") | UK, EU, US, AU (+CA, SE for some SKUs). No Brazil lab listed | Cross-border; customer pays customs; CPF/CNPJ in address | EU lab: no customs. UK/US origin: EUR 3/item duty (<= EUR 150) |
| **Gelato** | Yes: wood and aluminium framed posters (matte/semi-gloss/archival paper); "Fine art" giclee 12-colour, framed with wood frame | Framed poster "20 different formats" (search snippet only, not verified on an opened page); A2 UNVERIFIED | Wood (pine) and aluminium; colours/glazing UNVERIFIED (catalogue needs login) | REST v4 (`order.gelatoapis.com`), quote, order, webhooks | `orderType` draft/order; no named sandbox seen (UNVERIFIED) | Yes: `order_status_updated`, `order_item_status_updated` | Network in 32 countries; Brazil and Portugal pages exist; the docs webhook example shows `fulfillmentCountry: "BR"` | Shipping table: economy 10-14 days, 27.86 BRL shipping (item = "Ready to Hang") | Economy 4-5 days, 47.05 BRL (same item) |
| **Printful** | Framed posters (Premium Luster, Enhanced Matte, Matte with mat, coloured frames) | cm version: 21x30, 30x40, 30x45, 40x50, **A2 (42x59.4)**, 45x61, 50x70, **A1 (59.4x84.1)**, 61x91 cm; inch version 8x10 to 24x36 | Frame colour/size selectable; glazing and mount details not on opened page | REST v1 (`api.printful.com`), OpenAPI download | No sandbox found; draft orders + `confirm=1` | Yes (e.g. `package_shipped`) | US-based company; framed-poster production sites UNVERIFIED | **0 framed posters deliverable to Brazil** (catalogue view, 2026-11-10) | Not checked (see Not verified) |
| **theprintspace / creativehub** (UK fine-art lab) | Yes: hand-made frames, bespoke sizes, mats, AR glass; 11 photo and giclee papers | Any size (print-only price table up to 50x75"); framed A2 base price UNVERIFIED | Traditional/float/tray/shadow box; oak, beech, black, white, walnut, "decorative" mouldings; standard or anti-reflective/UV glass; mat options | REST (`escher-v2.creativehub.io/v1`), quote and order | Not stated | "Not yet active" (docs) | London studio (framing), prints in UK, Germany (Dusseldorf), US | `delivery_zone_unavailable` 409 possible; Brazil support UNVERIFIED | Print-only from Germany: no import charges. Framed: 10 working days; bespoke frames may incur duties into EU |
| **Printify** (marketplace) | Framed posters from "Print Clever" (UK-made), 200 gsm semi-gloss, not giclee | 10x8" to 48x32", 32 sizes | Wooden frame, Perspex cover; colour options not on opened page | REST + webhooks | No sandbox keyword found in docs | Yes | Framed poster provider is UK-made; "no local providers" for US view | Not available for Brazil on opened data (UNVERIFIED for BR) | Not checked |
| **Cloudprinter** | **No framed prints** in its poster/wall-decor list (Alu-Dibond, canvas, photo tile, plexiglass, wood) | n/a | n/a | REST, PHP/Node SDKs | UNVERIFIED | "Webhooks and signals" (image caption only) | "381 print locations in 104 countries" | Not named | Not named |
| **WhiteWall** (DE, mainly B2C) | Yes: giclee on 18 papers (Hahnemuhle, Canson, Epson) + matted wooden frames | Custom sizes; framed with mat up to 43.3 x 27.5 in | Solid wood with passe-partout, many frames | No API found; reseller programme and Shopify app listed | n/a | n/a | Not stated | Country list excludes Brazil/Portugal as separate shops ("Other European country") | Via "Other European country" |
| **Pwinty** (= Prodigi's older brand) | Same stack as Prodigi | - | - | - | - | - | FAQ (undated): partner labs "mainland Europe, USA, China, Canada, India, UAE, Australia, Brazil" | Lists Brazil as a partner-lab location (undated page, framed availability UNVERIFIED) | - |
| **Brazilian partners** | **None verified** for framed fine-art + API | - | - | Printi: no public API (third-party profile); Montink, Dropify: no framed-art API found | - | - | - | - | - |

---

## 3. Prodigi (prodigi.com, formerly Pwinty)

**Products.** Product menu lists "Prints & posters" (art prints, photo prints, posters) and "Wall art" (framed prints, canvas, acrylic, metal, wood, photo tiles). Framed products page lists 14 framed lines incl. classic, box, spacer (coming soon), budget, aluminium, backloader frames; classic frame ships from AU, EU, UK, US.

**Classic frame (SKU prefix `GLOBAL-CFP`).** Giclee printing, "Museum-quality", with or without mount, 8 frame colours, 3 glazing options (Perspex, float glass, moth-eye), solid satin-laminated wood, UK/EU frames are obeche with painted/foil finish, natural/brown real wood with oak-effect laminate. Frame face 20 mm, depth from wall 22 mm. Mounts 2.4 mm conservation grade in snow white, black, off-white. Size listed is the glaze size, so mounted prints are smaller than the stated size. Cobra hook up to 70x100 cm, sawtooth above. Production time listed: 72 hours. "Wholesale cost (GBP) From £16.00*" (excludes taxes and shipping; seen 2026-11-10 on product page). Available sizes "6x6" to 40x40"". Example SKUs: `GLOBAL-CFP-11X14` (280x355 mm), `GLOBAL-CFP-12X16` (300x400), `GLOBAL-CFP-18X24` (450x600), `GLOBAL-CFP-24X32` (600x800), `GLOBAL-CFP-28X40` (700x1000), each "Get pricing" (login required). An exact A3/A2 SKU is UNVERIFIED; 12x16 in and 18x24 in bracket A3/A2 in the example list. 15% Pro discount on classic framed prints (Prodigi Pro).

**File requirements.** "jpg or pdf", "Optimal DPI 300dpi". ICC profiles downloadable for: Budget Art Paper, Cold Press Watercolour Paper, Enhanced Matt Art Paper, Hahnemuhle German Etching, Hahnemuhle Photo Rag, Lustre Photo Paper, Smooth Art Paper. v4 docs: the product endpoint returns the recommended pixel size per print area; image sizing modes `fillPrintArea` (default, centre-crop), `fitPrintArea`, `stretchToPrintArea`; only PNG/JPEG are resized, PDF is printed as received.

**API.** v5 docs at `https://www.prodigi.com/print-api/docs/` (OpenAPI 3.1, downloadable). Single base `https://api.prodigi.com/v5`; the key prefix picks the mode: `sandbox_...` creates test orders that "are not printed, shipped, or charged"; `live_...` is production. Flow: look up SKU in Catalogue, `POST /quotes/order` for cost estimate, `POST /orders` (draft or `submit: true`), `POST /orders/{orderId}:submit`, track via `GET /orders/{orderId}` or webhooks. Orders need catalogue SKUs and public artwork URLs. Rate limit 1,000 requests/hour per key. `Idempotency-Key` supported on `POST /orders`. v4 docs (still supported): sandbox host `api.sandbox.prodigi.com`; callbacks are CloudEvents POSTs on stage change and shipment, per-order `callbackUrl`; order has `recipientCost` ("highly recommended if you have international orders as it aids shipping companies with customs issues") and `attributes` (e.g. frame colour); branding object supports A6 postcard, A5 flyer, packing slips, exterior/interior stickers. v4 quote returns `totalTax` and `totalCost`.

**Shipping/lab routing.** Orders route automatically to the lab nearest the customer; the Quote endpoint shows where it will ship. Standard postal estimates: "EU to EU 5-7 working days", "UK/EU to Rest of the world 10-15 working days (considered lost after 28)", in addition to production time. Shipping prices are only in the dashboard "pricing and shipping tool" (CSV per product), so **shipping cost to Brazil/Portugal: UNVERIFIED**. Shipping methods: Budget, Standard, StandardPlus, Express, Overnight.

**White label.** "All our shipments are white-label. There is no Prodigi branding on the outer packaging or on any included paperwork."; branded inserts (stickers, flyers, thank-you cards) available, 75% discount on inserts with Pro.

**Customs.** Prodigi: "While the end customer is responsible for paying customs charges, some merchants choose to reimburse"; customs payments "most common for shipments to South America"; for Brazil put CPF/CNPJ in the address field (business shipments also State Tax ID and Registration State Code). EU: from 1 July 2026 the EUR 150 exemption ends; goods <= EUR 150 from outside the EU attract a flat EUR 3 customs duty per item (temporary until 1 July 2028); a ~EUR 2 handling fee is proposed (unconfirmed). Orders produced and fulfilled within the EU are not affected; "over 97% of our products are already produced in the right region". IOSS does not exempt customs duties or handling fees.

---

## 4. Gelato (gelato.com)

**Products.** Framed posters page: wood (pine, matte or semi-glossy paper), aluminium (matte, semi-glossy, archival paper), and "Fine art: Giclee art in a wooden frame" (12-colour giclee on matte fine art paper). "Ready-to-hang" only in selected sizes/countries (FAQ heading, content not expanded). Sizes/frame colours/glazing/mounts live in the logged-in catalogue (login required, not accessed): **UNVERIFIED**.

**API.** Docs `https://dashboard.gelato.com/docs/` (opened). Order v4: `POST https://order.gelatoapis.com/v4/orders` (header `X-API-KEY`); quote: `POST /v4/orders:quote` returns shipment methods with `price`, `minDeliveryDays`/`maxDeliveryDays`, `incoTerms` (example shows `"DDP"`), `fulfillmentCountry`. Order has `orderType` (`"order"` in the example; the docs also list "Delete draft order", so drafts exist) and `shipmentMethodUid`. Print files: JPEG, PNG, SVG, PDF (quote docs: PDF, PNG, TIFF, SVG, JPEG); single print file for Posters, Framed Posters, Canvas. No DPI number on the opened pages: **UNVERIFIED**. Currencies for quote include BRL and EUR. Brazil recipient fields: `federalTaxId` (CPF/CNPJ, "Mandatory for Brazil"), `isBusiness`, `stateTaxId`, `registrationStateCode`. Webhooks: HTTPS POST, 3 attempts 5 seconds apart, events `order_status_updated` and `order_item_status_updated` with tracking codes and `fulfillmentCountry`. The docs sidebar also lists a guide "Using Branded Inserts & Labels" (not opened).

**Public shipping table (shipping-and-delivery page, item selector "Ready to Hang" = a framed poster; seen 2026-11-10; item size not shown, so these numbers are indicative only):**

| Destination | Method | Avg delivery | Product price | Shipping price |
|---|---|---|---|---|
| Brazil | Economy | 10-14 days | 137.46 BRL | 27.86 BRL |
| Brazil | Express | 10-13 days | 137.46 BRL | 819.84 BRL |
| Portugal | Economy | 4-5 days | 161.93 BRL | 47.05 BRL |

The product price differs by destination, which suggests different producers per country (inference, not stated by Gelato). Gelato states delivery time includes order receipt, production and delivery, and that numbers are estimates.

**Where produced.** "250+ production partners in 32 countries"; "For information about which products are produced locally in which countries, please consult our product catalog." The Brazil and Portugal landing pages say local production exists in 32 countries but do not list framed products. Support: "About 95% of orders are produced in the same country as their delivery destination."

**Customs.** Gelato guarantees DDP for economy methods "within the European Union, UK, Norway, US, CA, AU/NZ, or Singapore". Elsewhere, "your end customer is responsible for covering any customs fees... paid directly to the respective customs agency". Brazil is not in the DDP list; Brazil "has additional requirements for local tax regulations" (linked article not opened).

---

## 5. Printful (printful.com)

- **Products.** Framed posters: Premium Luster Photo Paper (in), Enhanced Matte Paper (in and cm), Matte Paper With Mat (cm, in), Matte Colored Frame Posters. The cm Enhanced Matte version offers 21x30, 30x40, 30x45, 40x50, A2 (42x59.4), 45x61, 50x70, A1 (59.4x84.1), 61x91 cm. "From" prices shown with a Brazil locale: R$ 112.95 to R$ 198.45 (smallest sizes, seen 2026-11-10).
- **Brazil availability.** The framed-posters category page, with Brazil as the delivery country, shows "Showing 0 results that deliver to Brazil; 7 products available in other regions" and each product page says "This product is unavailable in your region". So **framed posters cannot currently be delivered to Brazil via Printful** (as seen from that locale).
- **Shipping.** The shipping page showed only shirts for Brazil (3-5 business days, R$ 68.69 first item, R$ 33.00 additional). Framed-poster rates are in a downloadable CSV (not downloaded): UNVERIFIED.
- **API.** `https://developers.printful.com/docs/` (OpenAPI 1.0 doc, limit 120 calls/minute, draft status then confirm, `?confirm=1`, webhooks such as `package_shipped`, `tax_number` field for CPF). Print-file example dpi 150 (generic example, not framed-poster specific). No sandbox found.
- **Brazil tax ID.** "Brazilian customs require a CPF or CNPJ number on all orders shipped to Brazil"; orders without it are held and cancelled after 30 days; Shopify and Nuvemshop orders can pass CPF automatically.

---

## 6. Other partners

- **theprintspace + creativehub (UK).** API marketed as "white-labelled fulfilment"; "11 professional photo and Giclee Fine Art papers"; frames "hand-made", bespoke sizes, decorative mouldings, optional mats/AR/UV glass. Framed: "ready in 10 working days"; mounted prints 5 days; print-only dispatch 1-2 business days, DHL Express 2-3 days or UPS Ground 4-10 days. Fulfilment in London, Dusseldorf (Germany), New York: print-only orders to UK/EU/US avoid import charges; "Customs duties may apply to bespoke hand made frames or bespoke mounting when being delivered into the USA or EU". Public print-only price table (USD, seen 2026-11-10): 16x24" giclee $45.24, 24x36" giclee $97.73. New API (`escher-v2.creativehub.io/v1`): quote returns `production_cost`, `delivery_cost`, `ddp_total`; place order with `external_reference` (e.g. Stripe session id); webhooks "not yet active" (poll). API access must be enabled by support. Frame variants include `frame_color: oak | black | white`.
- **Printify.** Framed Posters from "Print Clever", from USD 28.57, 32 sizes from 10x8" to 48x32", 200 gsm semi-gloss coated paper, Perspex, wooden frame, UK-made, avg production 3.6 days. Printify's Prodigi list (14 products incl. canvas, fine-art postcards, paper poster) has no framed item. Printify API: REST with webhooks and OAuth. Not fine-art-paper quality; useful only as a price comparison.
- **Cloudprinter.** API-first network ("381 print locations in 104 countries") but the catalogue under Wall Decorations is Alu-Dibond, canvas, photo tile, plexiglass, wood; no framed prints. Needs PDF/X-4 for almost all products.
- **WhiteWall.** High-end fine-art giclee (18 papers incl. Hahnemuhle, Canson, Epson; 1,440 dpi) with matted wooden frames (from $99.95 for framed fine-art print with mat, US site, seen 2026-11-10). Has Resellers and a Shopify app, but no ordering API found on the opened page; **API UNVERIFIED**.
- **Artelo.** Poster/framed-print API with webhooks and branding, "Made in the U.S.", no Brazil/Portugal info: not suitable.
- **Pwinty FAQ** (old Prodigi brand site, undated): lists partner labs including Brazil and says framed and canvas prints "are wrapped in a protective sleeve" and shipped in heavy cardboard boxes. Treat the Brazil lab as a lead to ask Prodigi about, not as verified current capacity.

---

## 7. Brazilian partner search (negative result so far)

- **Printi** (Cimpress brand): a third-party API profile says "There is no live, documented, self-serve public API today" and that the old developer portal appears decommissioned; integration is partner-gated through Cimpress / a reseller channel. I could not open an official Printi page for framed prints (the guessed URL returned 404). **Status: no verified API, no verified framed fine-art product.**
- **Montink, Camisadimona, Reservaink, Nicephotos, Digipix, Goimage:** appear in a Printkk comparison article as Brazilian POD providers; the article describes Montink as clothing/accessories, Nicephotos as photo books/canvas/calendars, and says it does not mention framed posters. Only Printkk is shown with an API link. I did not verify any framed-art product or public API for these.
- **Dropify** (Nuvemshop app): national dropshipping of 7,000+ items from 50+ manufacturers, not a custom-print framing service; one review complains about a R$ 500 activation fee.
- **Conclusion:** a Brazilian print + frame dropship partner with a documented API for custom art was not found. Best bet is to contact a few local giclee labs / "molduraria" shops directly and ask for a B2B/white-label arrangement with an email/spreadsheet or custom API (section 9), and to ask Gelato/Prodigi which Brazilian labs would produce a given SKU.

---

## 8. Import duties, taxes and who pays

**Brazil (distance-selling to individuals).**
- Portaria MF 1.342/2026 (published 12 May 2026, per Econet blog dated 2026-06-08): import tax is **zero for orders up to US$ 50 by a private person on a platform enabled in Remessa Conforme**; **US$ 50.01-3,000: 60% import tax with US$ 30 deduction** (was US$ 20). Example in the source: US$ 100 order, gross tax US$ 60, minus US$ 30 = US$ 30. **ICMS still applies**, rate varies by destination state, and its tax base includes the tax itself. Companies (CNPJ) do not get the US$ 50 relief.
- A Tecnoblog headline (opened, article body not readable) says purchases up to US$ 50 should pay federal tax again from 2027 under a new tax (CBS). Rule could change; treat as a risk.
- A framed A2 print will almost certainly exceed US$ 50 customs value, so expect 60% minus US$ 30 plus ICMS. The specific "ICMS 17-20%" range from the brief is **UNVERIFIED** (only "varies by state" confirmed).
- Who pays: with Prodigi, Gelato (Brazil not in the DDP list) and Printful, the recipient pays at import (effectively DAP). A tax ID (CPF/CNPJ) is mandatory: Prodigi (address field), Gelato (`federalTaxId`), Printful (`tax_number`). **Whether any of them can collect Brazilian taxes at checkout (true DDP for Brazil): none documented on pages I opened.**
- Practical consequence: for a US$/EUR 150-250 retail framed print produced outside Brazil, the buyer faces a surprise import bill of tens of dollars; the product must be produced in Brazil or the retail price must absorb it. This is the main reason to prefer in-country production for Brazil.

**Portugal/EU.**
- Standard VAT on mainland Portugal: 23% (PwC tax summaries).
- EU-produced goods shipped within the EU: no customs. UK/US-produced goods: flat EUR 3 duty per item (<= EUR 150) from 1 July 2026 until 1 July 2028 per Prodigi's FAQ, plus a proposed ~EUR 2 handling fee (unconfirmed). Prodigi says IOSS does not remove these customs charges. IOSS EUR 150 VAT threshold and OSS registration details: **UNVERIFIED** (Prodigi articles on IOSS/OSS were not opened).
- UK origin (theprintspace framing studio, Printify Print Clever framed posters made in UK): subject to the above. theprintspace states print-only orders from Germany avoid import charges while bespoke frames "may" attract duties into the EU.

---

## 9. Recommendation

**Which partner to start with.**
1. **Prodigi** as the first integration, for Portugal (and later Italy): EU fulfilment, v5 API with quotes and tax, a real `sandbox_` key, giclee on Hahnemuhle/lustre/matte with ICC profiles, eight frame colours including antique silver/gold/brown, three glazing options, mounts, white-label inserts, and a Pro tier with an account manager. Open a free account now, generate a sandbox key, call `POST /quotes/order` for A3/A2 classic-frame SKUs to Portugal and Brazil to get real prices, labs and tax lines.
2. **Gelato** as the Brazil pilot: the only partner for which I saw in-country evidence (BR in webhook example, Brazil-specific tax-ID fields, BRL quote support, Brazil-destination framed poster at 27.86 BRL shipping / 10-14 days). Verify in the dashboard catalogue that a framed fine-art product is produced locally in Brazil, in an A2-class size, before committing. Order one sample to Brazil.
3. **theprintspace** as the premium option for heirloom-style framing (bespoke moulding, mats, AR glass, certificates): best look, slower (10 working days) and UK-framed, so check duties into EU/Brazil; its public price table is for print only.
4. Skip Printful for Brazil (0 framed products deliverable), Cloudprinter (no framed range), Printify (not fine-art quality), and Printi/Montink until proven otherwise.

**What to ask a partner (custom / white-label).**
- Custom antique-style frame: gilded/ornate or dark-walnut mouldings beyond the standard "antique gold/silver/brown" line; mat colours (cream/off-white) and mat opening for map framing; museum/UV glass default; frame depth.
- Paper: confirm which SKUs use Hahnemuhle Photo Rag/German Etching or equivalent giclee paper in framed products, and the ICC profile; exact printable pixel size for A3/A2 (e.g. via the product endpoint) and recommended DPI.
- Branded packaging: unbranded outer box, branded postcard/flyer inserts, custom packing slip and sticker, certificate of authenticity card, "no price on documents" for gifts.
- Brazil: confirm local production site, who handles CPF, whether DDP / tax collection at checkout is possible (e.g. "Remessa Conforme" enabled carrier or importer of record), delivery SLA by state, damage/reprint policy, tracking in Portuguese.
- Commercial: volume tiers (Prodigi Pro 15% on classic framed), reprint-on-defect terms, minimum frame breakage SLAs, webhook coverage (status + tracking), API rate limits, sandbox parity, invoicing currency (BRL/EUR) and whether the partner will quote final landed cost (`ddp_total` in creativehub, `totalTax` in Prodigi).

**Fallback for the first customers.** Order a few prints from a local giclee printer and a local frame shop and ship by hand: in Brazil use a local lab and framer (no import tax, shipping 1-5 days, CPF not needed); in Portugal likewise. I did not find, via the searches I ran, a named Brazilian or Portuguese giclee + custom-framing lab with a public price list; the practical route is to email 3-5 local labs/molduraria shops with an A2 sample file for a quote, then keep the best as the manual supplier until volume justifies an API integration. A German option (Whitewall, from $99.95 framed with mat on its US site) is useful as a benchmark for framed fine-art pricing.

**Economic sanity check.** At the $129-249 retail hypothesis, Gelato's Brazil "Ready to Hang" product price of 137.46 BRL plus shipping 27.86 BRL (about 165 BRL total, size unknown) leaves large margin, but the item is probably a basic framed poster and not a giclee-on-Hahnemuhle A2; Prodigi's "From £16.00" is the smallest classic frame, so real A2 numbers must come from the API quote.

---

## Sources

Opened in full via real browser (get_page_text / page text) unless noted "WebFetch" (tool-summarised).

- https://www.prodigi.com/print-api/docs/ : Prodigi v5 API: sandbox/live keys, quote, order, submit, rate limit, idempotency.
- https://www.prodigi.com/print-api/docs/v4/ : v4 API: sandbox host, order object, callbacks (CloudEvents), branding, quote, product details/resolution, sizing modes.
- https://www.prodigi.com/products/wall-art/framed-prints/classic-frames/ : classic frame specs, colours, glazing, mounts, SKUs, "From £16.00", 300 dpi, jpg/pdf, ICC profiles, white-label, Pro discount.
- https://www.prodigi.com/print-api/ (WebFetch) and https://www.prodigi.com/products/ (WebFetch), https://www.prodigi.com/products/framed-prints/ (WebFetch) : product ranges, framed lines and ship-from labs, UK/EU/US production.
- https://support.prodigi.com/hc/en-us/articles/15758071490588 : customs responsibility, Brazil CPF/CNPJ.
- https://support.prodigi.com/hc/en-us/articles/13168908333212 : shipping cost = dashboard tool only.
- https://support.prodigi.com/hc/en-us/articles/13169433163676 : standard shipping time estimates.
- https://support.prodigi.com/hc/en-us/articles/13169782245020 : routing to nearest lab; Quote endpoint shows origin.
- https://support.prodigi.com/hc/en-us/articles/24939117383964 : EU customs changes from 1 July 2026 (EUR 3 flat duty, handling fee proposal).
- https://www.gelato.com/products/posters-frames : Gelato framed poster types, 250+ partners, 32 countries.
- https://www.gelato.com/products/fine-art-prints : giclee 12-colour, framed option.
- https://www.gelato.com/shipping-and-delivery : interactive shipping table (Brazil and Portugal rows, 2026-11-10).
- https://www.gelato.com/print-on-demand/brazil and https://www.gelato.com/print-on-demand/portugal : local production in 32 countries (generic).
- https://dashboard.gelato.com/docs/get-started/ , /docs/orders/v4/quote/ , /docs/webhooks/ : Gelato API v4, quote fields incl. `incoTerms`, Brazil tax fields, webhook events.
- https://support.gelato.com/en/articles/8996183 : DDP guarantee list, customer pays elsewhere.
- https://support.gelato.com/en/articles/8996174 (WebFetch) : 95% local production; Brazil has additional tax requirements; delivery estimates.
- https://www.printful.com/custom/wall-art/framed-posters and .../enhanced-matte-paper-framed-poster-cm : Printful catalogue, A2/A1 sizes, "0 results that deliver to Brazil".
- https://www.printful.com/shipping : Printful shipping (Brazil, shirts only), customs note.
- https://help.printful.com/hc/en-us/articles/50265102004497 : CPF/CNPJ requirement for Brazil.
- https://developers.printful.com/docs/ : Printful API (limits, draft/confirm, webhooks, tax_number).
- https://www.theprintspace.com/art-print-on-demand-api/ , /online-art-print-delivery-service/ , /custom-framed-photo-prints/ , /photo-art-printing-prices/ , /art-store-integrations/ (WebFetch) : theprintspace API, lab locations, framing options, timings, print prices.
- https://sell.creativehub.io/api-docs : creativehub order/quote API, `ddp_total`, webhooks "not yet active".
- https://printify.com/shipping-rates/prodigi/ , https://printify.com/app/products/764/generic-brand/framed-posters , https://developers.printify.com/ : Printify framed posters, API.
- https://www.cloudprinter.com/products/poster and https://www.cloudprinter.com/ (WebFetch) : Cloudprinter catalogue and network.
- https://www.whitewall.com/us/fine-art-giclee : WhiteWall fine art and frames.
- https://blog.pwinty.com/faqs/ : Pwinty FAQ (undated) listing Brazil lab.
- https://www.printkk.com/blog/articles/print-on-demand-brazil (WebFetch) : Brazilian POD providers named; no framed posters.
- https://providers.apievangelist.com/providers/printi/ (WebFetch) : Printi API status (third-party profile).
- https://www.nuvemshop.com.br/loja-aplicativos-nuvem/dropify : Dropify description.
- https://blog.econeteditora.com.br/remessa-conforme-o-que-muda-com-a-portaria-mf-1-342-2026/ : Brazil import tax rules after Portaria MF 1.342/2026 (secondary source, not gov.br).
- https://tecnoblog.net/noticias/compras-de-ate-us-50-devem-voltar-a-pagar-imposto-federal-em-2027/ : headline only; body not captured.
- https://taxsummaries.pwc.com/portugal/corporate/other-taxes (WebFetch) : Portugal standard VAT 23%.
- https://www.artelo.com/artelo-api (WebFetch) : Artelo API, US production.

---

## Not verified

- Exact wholesale prices for framed A3/A2 in Prodigi, Gelato, theprintspace (framed), Printful (framed) and WhiteWall (framed A2): behind logins, dashboards or API quotes. No A2 framed price in any currency is verified; only "from" prices and the Gelato table row.
- Shipping cost and lead time to Brazil and Portugal for Prodigi, Printful (framed) and theprintspace (framed). Only Gelato's "Ready to Hang" row is verified, with unknown size.
- Whether Prodigi or Gelato produces framed products in Brazil. Gelato's Brazil production is inferred from docs examples and pricing; Pwinty's old FAQ mentions a Brazil lab but is undated.
- Gelato framed-poster sizes (A2/A3), frame colours, glazing, mats and DPI requirement (catalogue login wall); Gelato's "20 formats" figure came only from a search snippet and is not relied upon.
- Printful framed poster availability, price and shipping for Portugal (the catalogue was viewed from a Brazil locale only).
- Whether any partner can collect Brazilian import taxes at checkout (DDP for Brazil). None documented in opened pages.
- Official Brazilian sources (gov.br / Receita Federal, Correios) were not read in full: the Correios PDF was binary and unreadable by WebFetch, and no gov.br page was opened. The 60%/US$ 30/zero-up-to-US$ 50 figures rely on one Brazilian trade blog (Econet, 2026-06-08), and the "ICMS 17-20%" range is UNVERIFIED. A possible return of federal tax on up to US$ 50 in 2027 (Tecnoblog headline) is not confirmed.
- IOSS EUR 150 VAT threshold and OSS registration rules: not read from an opened page.
- Brazilian print/frame partners with API: none verified; Printi, Montink and others were not opened on their own sites (only third-party descriptions). Portuguese/Italian local giclee + framing labs not identified.
- WhiteWall B2B/API availability; theprintspace API webhooks (docs say not yet active); Cloudprinter webhooks/sandbox details.
- Prodigi v5 webhook documentation details (only the v4 callback spec was read in full); Prodigi Brazil-bound SKU availability (`shipsTo` lists).
