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

| File | What it does |
| --- | --- |
| `config/catalogue.json` | Products, sizes, prices per currency, markets and their fulfilment route. **Edit this to change prices.** |
| `src/commerce/catalogue.ts` | Catalogue validation and `quote()`, the only place prices are worked out. Shared with the browser. |
| `src/commerce/status.ts` | The order state machine (`canTransition`). |
| `src/commerce/design.ts` | The design stored on an order (the designer's choices, never people's data) and its validation. |
| `server/db/migrations/002_commerce.sql` | `orders`, `order_events` (history), `webhook_events` (de-duplication). |
| `orders.ts` | Database access; `transition()` locks the row, checks the state machine and writes history. |
| `routes.ts` | The HTTP routes (listed at the top of the file). |
| `payments.ts` | Stripe Checkout Sessions, webhook verification, refunds. |
| `pipeline.ts` | After payment: make the print file, then deliver / send to a partner / wait for an operator. |
| `fulfilment/` | `prodigi.ts` (v5 sandbox API), `manual.ts`, and the `FulfilmentAdapter` interface. |
| `links.ts` | Signed, expiring links to print files (for customers and for partners). |
| `sheet.ts` | The production sheet for manual orders. |
| `fake-stripe.ts` | The Stripe SDK with its network calls replaced: used by tests and by `FAKE_PAYMENTS=yes`. |
| `setup.ts` | Builds the shop from environment variables (all listed there). |
| `server/print/` | The server renderer: assets from `node_modules`, resvg raster, PDF, worker thread. |

## Running it

```bash
npm run dev:all                          # API on :8787, web on :5173 — payments are off
FAKE_PAYMENTS=yes npm run dev:all        # a local simulated Checkout instead of Stripe
```

Open `http://localhost:5173/print.html`, load a tree, fill in **Order**, and **Buy**. The order
page follows it; `http://localhost:5173/ops.html` is the operations page (the dev user is an
operator; set `OPERATOR_EMAILS` once there are accounts).

`npx tsx server/scripts/render-sample.ts A2 antique out/` renders a print file from
`public/sample.ged` without the API (about 25 s for A2).

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

1. **Prices.** Every price in `config/catalogue.json` is a placeholder (`placeholderPrices: true`).
   Research: plain digital migration maps sell for BRL 32–98 on Etsy (so BRL 69.90 / €14.90 is at
   the top); framed migration prints BRL 240–1,198. Real costs need a Prodigi quote
   (`POST /api/ops/quote` once a sandbox key is set) and a local lab quote in Brazil. Set
   `placeholderPrices` to false when done.
2. **Prodigi account**: create one, get a sandbox key, confirm the SKUs `GLOBAL-HPR-A1`,
   `GLOBAL-CFPM-A3`, `GLOBAL-CFPM-A2` (unverified; `GLOBAL-HPR-A3/A2` were seen), the frame
   colours and mount, and order one sample. Note that framed sizes are the glazed size: a mounted
   A2 shows a smaller print, so decide whether "framed A2" means an A2 print (bigger frame) or an
   A2 frame.
3. **Brazilian lab and framer** for the manual route: quotes for A3/A2 giclée with frame, lead
   times, shipping by Correios/courier.
4. **Stripe**: which entity sells (a Portuguese company can take cards and Pix in BRL; boleto
   would need a Brazilian entity); enable Pix; who absorbs Pix's 3.5% IOF.
5. **Tax and legal**: VAT/IVA on digital goods to EU consumers (OSS), invoices (Portugal requires
   certified invoicing software; Brazil an NF-e if selling through a Brazilian entity), Brazilian
   import duty when printing outside Brazil, terms of sale and refund policy (EU 14-day withdrawal
   right and its exception for personalised goods), privacy notice (GDPR/LGPD) for addresses and
   CPF, and the flag-use question noted in `src/print/README.md`. None of this is implemented.
6. **Production hardening** (not done): real accounts instead of the dev user, e-mail receipts with
   the order link, object storage for the files, a job queue for renders, retention of print files.
