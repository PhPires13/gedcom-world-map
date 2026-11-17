# The shop: heritage map orders

Selling the heritage map print: catalogue and prices, orders, Stripe Checkout (test mode only),
print files made on the server, and fulfilment by Prodigi or by hand.

```
print.html (designer) ──Buy──▶ POST /api/orders ──▶ POST /api/orders/:id/checkout ──▶ Stripe Checkout
                                                                                         │
order.html ◀── success_url                    POST /api/webhooks/stripe ◀── signed event ┘
                                                     │ paid
                                                     ▼
                         render from the tree's PUBLIC view (worker thread) ─▶ PNG 300 dpi, PDF, SVG
                                                     │ file_ready                 (DocumentStorage)
                    ┌────────────────────────────────┼─────────────────────────────────┐
                 digital                          prodigi                            manual
             delivered: signed                POST /v5/orders with              ops.html: production
             download links                   a signed file URL;                sheet for the local lab,
                                              webhooks → shipped → delivered    operator marks each step
```

Every map order (digital or printed) gets the signed download links on its order page once the
file is made: physical orders include the digital file. A **gift card** order has no design: once
paid, its code is issued and it is delivered (no file, no partner).

| File | What it does |
| --- | --- |
| `config/catalogue.json` | Products, sizes, prices per currency, markets and their fulfilment route. **Edit this to change prices.** |
| `src/commerce/catalogue.ts` | Catalogue validation and `quote()`, the only place prices are worked out. Shared with the browser. |
| `src/commerce/status.ts` | The order state machine (`canTransition`). |
| `src/commerce/design.ts` | The design stored on an order (the designer's choices, never people's data) and its validation. |
| `src/commerce/gift.ts` | Gift details (recipient, card message) validation; gift card code format. Shared with the browser. |
| `server/db/migrations/002_commerce.sql` | `orders`, `order_events` (history), `webhook_events` (de-duplication). |
| `server/db/migrations/004_gifts_discounts.sql` | New kinds and gift card value tiers, `orders.gift`, `lang`, `gift_card_amount`, `discount_amount`, `discount_code`, `amount_paid`; the `gift_cards` table. |
| `giftcards.ts` | Gift cards: issue a code, check one, reserve it on an order (row lock), give it back or void it. |
| `orders.ts` | Database access; `transition()` locks the row, checks the state machine and writes history. |
| `routes.ts` | The HTTP routes (listed at the top of the file). |
| `payments.ts` | Stripe Checkout Sessions, webhook verification, refunds. |
| `pipeline.ts` | After payment: make the print file, then deliver / send to a partner / wait for an operator. |
| `fulfilment/` | `prodigi.ts` (v5 sandbox API), `manual.ts`, and the `FulfilmentAdapter` interface. |
| `links.ts` | Signed, expiring links to print files (for customers and for partners). |
| `sheet.ts` | The production sheet for manual orders. |
| `fake-stripe.ts` | The Stripe SDK with its network calls replaced: used by tests and by `FAKE_PAYMENTS=yes`. Has promotion codes (`TESTE10`, `TESTE20REAIS`). |
| `setup.ts` | Builds the shop from environment variables (all listed there). |
| `server/mail/` | Customer e-mails on status changes (`order-mails.ts`), templates, Resend / console mailers. See `server/README.md`. |
| `server/print/` | The server renderer: assets from `node_modules`, resvg raster, PDF, worker thread. |

## What is sold

| Product (`config/catalogue.json`) | Kind | Sizes | Made by |
| --- | --- | --- | --- |
| Digital heritage map | `digital` | A1 | the server (download) |
| Fine-art print (unframed) | `print` | A3, A2, A1 | Prodigi / local lab |
| Framed fine-art print | `framed` | A3, A2 | Prodigi / local lab and framer |
| Poster (unframed, matte paper) | `poster` | A3, A2, A1 | Prodigi / local lab |
| Canvas (stretched, mirrored edges) | `canvas` | A3, A2 | Prodigi / local lab |
| Gift card (vale-presente) | `giftcard` | value tiers V1–V3 (BRL 200/350/500, EUR/USD 50/90/130) | the server (a code) |

Every price is a placeholder. `partnerAttributes` sends fixed options with a product (the canvas's
`wrap: MirrorWrap`). The poster and canvas SKUs are guesses: see Decisions.

## Promotion codes, gifts and gift cards

**Promotion codes (coupons).** Checkout Sessions are created with `allow_promotion_codes: true`
(turn it off with `STRIPE_PROMOTION_CODES=no`), so Stripe's page shows a code field. The codes are
made in the Stripe Dashboard (Product catalogue → Coupons → create a coupon, then add a customer-facing
promotion code). The webhook checks the session's `amount_subtotal` against what the server asked
for and requires `amount_total = subtotal − total_details.amount_discount`, then records on the order
`discount_amount`, `discount_code` (the `promo_…` id: look it up in the Dashboard) and `amount_paid`.
The order page shows the discount and what was charged; the operations page shows them under the
total; refunds are capped at what Stripe took. `FAKE_PAYMENTS=yes` offers `TESTE10` (10 % off) and
`TESTE20REAIS` (R$ 20 off BRL orders) on the simulated Checkout.

**Gift orders.** Printed products only. The buy panel's *É um presente* adds the name on the card
(defaults to the delivery name) and a message (≤ 300 characters, ≤ 8 lines; control and invisible
characters dropped). The delivery address is the recipient's; the buyer's e-mail stays the contact.
Stored in `orders.gift`, validated by `parseGift` on the server. The production sheet gets a
*Presente* box (no prices, receipt or invoice with amounts in the parcel) and a 148 × 105 mm card
to print, cut out and put in the parcel; the declared value stays on the sheet for the carrier
only. **Prodigi**: no free-text gift or packing note field was found in its order API (v4 had a
`packingSlip` taking only an image URL), so the message is not sent to Prodigi and the order's
history says so; Prodigi ships white-label (its `recipientCost` is for customs).

**Gift cards.** Bought like any product but with no tree (the designer's panel once a tree is
loaded, or `gift-card.html` without one). When the order is paid, the pipeline issues a code (12
characters from 30 unambiguous symbols, ≈ 59 bits, `crypto.randomInt`, shown `XXXX-XXXX-XXXX`) in
`gift_cards`, and the order is delivered; the order page shows the code to its owner
(`OrderDetail.giftCard`, ready for a confirmation e-mail), operators see it masked.

Spending one: the buy panel's *Tenho um vale-presente* checks the code
(`POST /api/shop/gift-cards/check`) and shows what is left to pay; `POST /api/orders` takes
`giftCardCode`. In the transaction that creates the map order, the card row is locked
(`select … for update`) and marked `redeemed` by an update that only matches an active card, so two
orders can never spend one code (a refused order is rolled back whole). Same currency only (no
conversion). Single use: what the card doesn't need is not kept.

- **Covers everything**: the order goes `created → paid` at once (actor `system`, `amount_paid` 0),
  without Stripe, and the pipeline runs as usual.
- **Covers part**: Checkout charges the rest. The line amounts are lowered (product first, then
  shipping) and the line description says *vale-presente −R$ 200,00*. Chosen over a one-off Stripe
  coupon because `createCheckout` already takes the amounts, it needs no extra Stripe object to
  create and clean up, the webhook check stays "subtotal = what the server asked for", and a
  promotion code can still be used on top (Checkout refuses `discounts` together with
  `allow_promotion_codes`).
- **Undone**: when the map order is cancelled (by the customer before paying, Checkout expiring, an
  operator) or fully refunded, the card is given back (`transition` does it in the same transaction).
  Refunding a gift card's purchase voids it first, and is refused (409) once it is spent; a gift card
  is refunded whole or not at all.

Abandoned unpaid orders keep their card until cancelled from the order page or until their Checkout
expires (two hours after it was opened).

## Running it

```bash
npm run dev:all                          # API on :8787, web on :5173 — payments are off
FAKE_PAYMENTS=yes npm run dev:all        # a local simulated Checkout instead of Stripe
```

Open `http://localhost:5173/print.html`, load a tree, fill in **Order**, and **Buy**. The order
page follows it; `http://localhost:5173/ops.html` is the operations page. `dev:all` runs with
`AUTH_MODE=dev`: without signing in you are the dev user, who is an operator. In production
(`AUTH_MODE=required`) customers sign in by e-mail link and only addresses in `OPERATOR_EMAILS`
reach `/api/ops/*` and `ops.html` (401 / 403 otherwise; the page offers to sign in). Accounts,
sessions and the customer e-mails (confirmed, download ready, shipped, delivered, refunded) are
described in `server/README.md`, with their environment variables.
`http://localhost:5173/gift-card.html` sells gift cards without a tree.

`npx tsx server/scripts/render-sample.ts A2 antique out/` renders a print file from
`public/sample.ged` without the API (about 25 s for A2); `LAYOUT=storybook BORDER=laurel
FINISH=aged FLAG_SCALE=1.3` choose the other options.

## Stripe in test mode

The server refuses live keys (`sk_live_…`): it is test mode only, and the prices are placeholders.

1. In the Stripe Dashboard, switch to **Test mode** and copy the secret key (`sk_test_…`).
2. Install the Stripe CLI and forward events to the local API; it prints the webhook secret:
   ```bash
   stripe listen --forward-to localhost:8787/api/webhooks/stripe \
     --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,checkout.session.expired,charge.refunded
   ```
3. Start the API with both (never commit them; `.env` files are not read, pass them in the shell):
   ```bash
   STRIPE_SECRET_KEY=sk_test_… STRIPE_WEBHOOK_SECRET=whsec_… npm run dev:all
   ```
4. Pay with a [test card](https://docs.stripe.com/testing): `4242 4242 4242 4242` (success),
   `4000 0027 6000 3184` (always asks for 3-D Secure), `4000 0000 0000 0002` (declined); any
   future date and any CVC. A Brazilian Visa: `4000 0007 6000 0002`.
5. Pix (BRL orders only): enable Pix in the Dashboard and start the API with `STRIPE_PIX=yes`. In
   test mode use tax ID `000.000.000-00`; the email decides the outcome
   (`succeed_immediately@example.com`, `expire_immediately@example.com`, …,
   [Pix docs](https://docs.stripe.com/payments/pix/accept-a-payment?payment-ui=checkout)).

Payment is confirmed only by the signed webhook, never by the return page. Events are recorded
in `webhook_events` and the state machine ignores repeats, so redeliveries are harmless.
Refunds are made from the operations page (full or partial); `charge.refunded` keeps the amount
in step if a refund is made in the Dashboard.

Without keys, `FAKE_PAYMENTS=yes` swaps Stripe's servers for a local page: paying there sends a
`checkout.session.completed` event signed with a local secret to the same webhook route, so the
whole flow runs through the real signature check and order logic. All automated tests use it.

## What Stripe supports for Brazil (docs read 2026-11-10)

Full notes with quotes: `commerce-stripe-prodigi-research.md` in the sessions' shared notes.

| | From a Portuguese (or EU/US) Stripe account | Source |
| --- | --- | --- |
| **Cards in BRL** | Yes: BRL is a presentment currency for PT/EU/US accounts; settled in EUR after conversion. No Amex in BRL from any account. Minimum 0.50 BRL and the EUR equivalent. | [Currencies](https://docs.stripe.com/currencies) |
| **Pix** | Yes: available to PT, EU, US, GB… accounts for customers in Brazil, BRL only, in Checkout. The customer pays 3.5% IOF on a foreign merchant unless `amount_includes_iof: always`. US$3,000/day and US$10,000/month per customer. Refunds within 90 days. | [Pix](https://docs.stripe.com/payments/pix), [Pix in Checkout](https://docs.stripe.com/payments/pix/accept-a-payment?payment-ui=checkout) |
| **Boleto** | **No**: Brazilian Stripe accounts only (domestic). It is asynchronous (fulfil on `async_payment_succeeded`), needs the customer's CPF/CNPJ, and its guide says boleto payments can't be refunded. | [Boleto](https://docs.stripe.com/payments/boleto), [Boleto in Checkout](https://docs.stripe.com/payments/boleto/accept-a-payment?payment-ui=checkout) |
| **A Brazilian Stripe account** | Needs a CPF/CNPJ, a legal representative with a CPF resident in Brazil, a Brazilian address and a BRL bank account. A foreign business can't open one directly. | [Brazil account requirements](https://support.stripe.com/questions/brazil-specific-information-to-open-a-stripe-account) |
| **Stripe Tax** | Supports Portugal, **not Brazil**. | [Tax countries](https://docs.stripe.com/tax/supported-countries) |
| **Adaptive Pricing** | Can show EUR prices in BRL (customer pays a 2–4% conversion fee). Not used: the catalogue sets BRL prices directly. | [Adaptive Pricing](https://docs.stripe.com/payments/currencies/localize-prices/adaptive-pricing) |
| **API change** | Since API version 2026-09-30, Checkout Sessions no longer take `payment_method_types` (400); this code uses `allowed_payment_method_types` or the Dashboard's dynamic payment methods. | [Changelog](https://docs.stripe.com/changelog/endive/2026-09-30/remove-payment-method-types-checkout-sessions) |

So from a Portuguese company: cards and Pix in BRL work; boleto needs a Brazilian entity.

## Print files

Made by `server/print/render.ts` with the same `renderHeritageMap` as the designer, in a worker
thread (A2 ≈ 25 s, A1 ≈ 50 s of CPU):

- **PNG**: resvg at 300 dpi (A3 4961×3508, A2 7016×4961, A1 9933×7016 px), with the pHYs chunk.
- **PDF**: page of the exact paper size; the artwork as a lossless 300 dpi image (the paper
  grain, stains and ink wobble are SVG filters no SVG→PDF converter reproduces) with **every
  piece of text on top as real text in the style's fonts, embedded as subsets** (PDFKit +
  svg-to-pdfkit). A fully vector PDF would lose the paper effects, so it isn't offered.
- **SVG** with the fonts embedded.

Files are big because they are lossless: an A2 PNG is ~50 MB (PDF ~45 MB), an A1 ~100 MB. Fonts come from the
`@fontsource` WOFF files (converted with `woff.ts`; resvg's native build only loads font files,
so they are cached as TTF in the OS temp folder).

**Design options:** the order stores every choice the designer offers (`src/commerce/design.ts`):
style, layout (geographic, close-up, storybook, medallions), decorative border, paper finish, flag
choice and size, surnames on the routes, routes (essential — a few main routes, the direct line
ranked first — or detailed; optional `maxRoutes`), and the rest. The server builds the print data
with the designer's `buildPrintData`, so the direct line and the essential routes chosen are the
same as in the preview. Orders saved before the routes choice existed are drawn detailed, as
their preview was. The server checks the ids against the same
JSON files the designer lists (`src/print/{styles,layouts,borders,finishes}/*.json`, read by
`server/print/assets.ts`) and draws with exactly those options, picking map detail with
`topologyDetailFor()` (medallions use the 1:10m coastlines). `server/test/print-options.test.ts`
checks that the server's drawing equals the designer's preview for storybook + laurel + aged and
medallions + rope + deckled at A2. The order page, the operations list and the production sheet
show the chosen style, layout, border and finish.

**Privacy:** `preparePrint` runs `redactPerson` on every person itself, whatever it is given, so
presumed-living and private people never reach a print. The pipeline also loads the tree with
`view=public`. The designer previews the same public view, so what the customer sees is what is
printed. To put a living relative on a print, the owner marks them public in the tree view (the
consent decision). The cartouche title and dedication are free text the customer types.

Places: the designer sends the coordinates it found for place names (`design.places`); the server
uses only those of people in the public view. There is no server-side geocoder yet.

## Prodigi (sandbox)

`PRODIGI_API_KEY=sandbox_…` (live keys are refused) and `PRODIGI_WEBHOOK_SECRET` (returned once by
`POST /v5/webhooks` when you subscribe `https://<public api>/api/webhooks/prodigi`). Orders go to
`POST https://api.prodigi.com/v5/orders` with `submit: true`, an `Idempotency-Key`, the catalogue
SKU and a 30-day signed link to the PNG. **Prodigi must be able to download that link**: set
`PUBLIC_API_URL` to an address it can reach (a tunnel in development). Status comes from signed
webhooks (`X-Prodigi-Signature`) and from **Ask Prodigi** on the operations page (`GET /orders/{id}`).
`POST /api/ops/quote` asks Prodigi for its cost of a product, to check margins.

Before the first real order, check against the sandbox: the v5 response shapes this adapter reads
(`data.id`, `data.status`, `shipments[].tracking`), the frame-colour attribute key (`color` in the
order examples, `framecolour` in the catalogue schema) and the unverified SKUs below.

## Manual fulfilment (Brazil)

Brazil's market is `manual`: no Brazilian framed-print partner with an API was found, and Prodigi
ships prints to Brazil cross-border (the customer pays import duty). A paid Brazilian order waits
on the operations page at **Print file ready**. The operator opens the **production sheet** (size,
paper, frame, file links, address with CPF), sends it to the lab and framer, then marks the order
**in production**, **shipped** (with the tracking code as the note, shown to the customer) and
**delivered**.

## Decisions for the owner

1. **Prices.** Every price in `config/catalogue.json` is a placeholder (`placeholderPrices: true`),
   including the poster, canvas and gift card values.
   Research: plain digital migration maps sell for BRL 32–98 on Etsy (so BRL 69.90 / €14.90 is at
   the top); framed migration prints BRL 240–1,198. Real costs need a Prodigi quote
   (`POST /api/ops/quote` once a sandbox key is set) and a local lab quote in Brazil. Set
   `placeholderPrices` to false when done.
2. **Prodigi account**: create one, get a sandbox key, confirm the SKUs `GLOBAL-HPR-A1`,
   `GLOBAL-CFPM-A3`, `GLOBAL-CFPM-A2` (unverified; `GLOBAL-HPR-A3/A2` were seen), the frame
   colours and mount, and order one sample. Note that framed sizes are the glazed size: a mounted
   A2 shows a smaller print, so decide whether "framed A2" means an A2 print (bigger frame) or an
   A2 frame. Also check the **poster** (`GLOBAL-EMA-A3/A2/A1`) and **canvas** (`GLOBAL-CAN-A3/A2`)
   SKUs, which are unverified guesses, the canvas `wrap` attribute (`MirrorWrap`) and how much of
   the design a canvas's edge takes; and whether Prodigi can carry a gift message (a packing slip
   image?) — until then gift messages for Prodigi orders must be sent another way.
3. **Brazilian lab and framer** for the manual route: quotes for A3/A2 giclée with frame, lead
   times, shipping by Correios/courier.
4. **Stripe**: which entity sells (a Portuguese company can take cards and Pix in BRL; boleto
   would need a Brazilian entity); enable Pix; who absorbs Pix's 3.5% IOF.
5. **Tax and legal**: VAT/IVA on digital goods to EU consumers (OSS), invoices (Portugal requires
   certified invoicing software; Brazil an NF-e if selling through a Brazilian entity), Brazilian
   import duty when printing outside Brazil, terms of sale and refund policy (EU 14-day withdrawal
   right and its exception for personalised goods), privacy notice (GDPR/LGPD) for addresses and
   CPF, and the flag-use question noted in `src/print/README.md`. None of this is implemented.
6. **Production hardening**: accounts (e-mail link sign-in) and e-mails to customers are done
   (`server/README.md`: a Resend account and the domain's SPF / DKIM / DMARC records are needed).
   Not done: object storage for the files, a job queue for renders, retention of print files.
7. **Promotion codes**: create the coupons and promotion codes in the Stripe Dashboard (test mode
   first); none exist by default. Decide whether promotion codes may be combined with a gift card
   (they can now) and with 100 % discounts (Checkout then completes with nothing to pay).
8. **Gift cards**: expiry (none now; check consumer law in Brazil and the EU), whether an unused
   remainder should be kept (now: single use, the rest is lost, and the buy panel says so), whether
   a refunded map order paid partly by gift card should give the card back (it does now), and
   rate limits on `POST /api/shop/gift-cards/check` once there are real accounts (codes have ~59
   bits, so guessing is not practical, but limits are cheap). The confirmation e-mail should
   include `OrderDetail.giftCard.code`.
