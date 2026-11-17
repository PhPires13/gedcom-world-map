# The API server: accounts, sessions and e-mail

The shop itself (orders, Stripe, print files, fulfilment) is in `commerce/README.md`. This page is
about who is signed in, what each kind of visitor may reach, and the e-mails the server sends.

## Signing in (passwordless, by e-mail link)

```
login.html ──POST /api/auth/request {email, next, lang}──▶ login_tokens (hash, 15 min, single use)
                                                            │ e-mail: magic link (pt / en / es)
browser ◀──303 to APP_URL + next, Set-Cookie hm_session──── GET /api/auth/verify?token=…  (on PUBLIC_API_URL)
```

- **Link tokens**: 256 random bits; only the SHA-256 hash is stored, with the address, the `next`
  path and an expiry 15 minutes away. Verify marks the token used in the same `update … where
  used_at is null and expires_at > now` that checks it, so a link works once, even with two clicks.
  A bad, used or expired link lands on `login.html?error=link`.
- **Accounts** are created on first sign-in (the address is proven by then). Addresses are
  lower-cased; `users_email_lower_idx` keeps one account per address.
- **Sessions**: table `sessions` (hash of the id, user, expiry 30 days). Cookie `hm_session`:
  `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` in production (`COOKIE_SECURE`). Each sign-in
  replaces the browser's previous session (no session fixation). `POST /api/auth/logout` deletes it.
- **`next`** must be a same-site relative path (`/order.html?id=…`): absolute URLs, `//host`,
  backslashes and control characters are refused with 400 (no open redirect).
- **Rate limits** (in memory, per API process — `rate-limit.ts`): 5 link requests per address and
  20 per client IP per 15 minutes, then 429 with `Retry-After`. The IP is the socket's, or the first
  `X-Forwarded-For` entry with `TRUST_PROXY=yes`. With several API processes, move the counters to
  the database or Redis.
- `GET /api/me` → `{id, email, displayName, operator}` or 401.

## Who may call what

| Routes | Who |
| --- | --- |
| `/api/health`, webhooks, signed file links, `/api/auth/*`, `/api/shop/catalogue` | anyone (webhooks and file links carry their own proof) |
| `GET /api/orders/:id`, `…/checkout`, `…/cancel` | the order's owner, or anyone with the order link's key (`?k=`, in the order e-mails); otherwise 404. Non-owners don't see phone and tax id. |
| `/api/me`, `/api/trees/*`, `POST /api/orders`, `GET /api/orders` ("Meus pedidos") | a signed-in user (401 otherwise) |
| `/api/ops/*` and `ops.html` | a signed-in user whose e-mail is in `OPERATOR_EMAILS` (401 / 403) |

Orders are made from a tree saved on the server, and trees need an account, so buying needs a
(passwordless) sign-in; the order is linked to that account and listed in "Minha conta". The order
e-mails carry a link with the order's key, so the buyer can follow the order on any device
without signing in.

`AUTH_MODE=dev` (set by `npm run dev:all` and by `vitest.config.ts`): a request without a session
is the dev user (`dev@localhost`), who is also an operator. A real session still wins, so sign-in
can be tried in dev. **Never run a reachable server in dev mode.**

## Transactional e-mail (`mail/`)

| File | |
| --- | --- |
| `types.ts` | the `Mailer` interface (`send({to, subject, html, text, tag, idempotencyKey})`) |
| `console.ts` | dev / tests: logs one line (and the sign-in link), keeps every mail in memory (`sent`), writes `.eml` copies to `MAIL_DIR` |
| `resend.ts` | [Resend](https://resend.com) over its HTTP API with `fetch` (no dependency); `Idempotency-Key` per order mail |
| `templates.ts` | the mails in pt / en / es, HTML (tables + inline styles) and plain text |
| `order-mails.ts` | which status change sends which mail; sending that never throws |

Order mails speak the order's language (`design.lang`); the sign-in mail the language of the page.

| Status change | Mail |
| --- | --- |
| → `paid` | order confirmed |
| → `file_ready` (digital) | the map is ready: PDF / PNG download links (7 days), review request |
| → `shipped` | on its way, with the partner's tracking or the operator's note |
| → `delivered` (print, framed) | arrived, with a review request (`REVIEW_URL`, else "reply to this e-mail") |
| → `refunded` | refund made, with the amount |

They are hooked where every status change happens: `createCommerce` wraps `orders.transition`
and hands the wrapper to the pipeline, so webhooks, the pipeline and operators all go through it.
The mail is sent in the background after the change is committed; a failure is logged and noted in
the order's history (`E-mail to the customer (…) could not be sent: …`) and never changes the order.
Each sent mail is noted too (`E-mail sent to the customer: …`; the order page only shows status
changes, so customers don't see these notes).

## Environment

| Variable | Default | |
| --- | --- | --- |
| `AUTH_MODE` | `required` | `dev`: no session → the dev user. `npm run dev:all` sets `dev`. |
| `PUBLIC_API_URL` | `http://localhost:PORT` | the API as browsers see it: sign-in links point here |
| `APP_URL` | `http://localhost:5173` | the web app: where people land after signing in |
| `COOKIE_SECURE` | `yes` unless `AUTH_MODE=dev` | session cookie only over HTTPS |
| `TRUST_PROXY` | `no` | `yes`: client IP from `X-Forwarded-For` (only behind a proxy that sets it) |
| `CORS_ORIGINS` | any localhost port | browser origins allowed to call the API (with credentials) |
| `OPERATOR_EMAILS` | nobody (`dev@localhost` in dev mode) | comma-separated; may use `/api/ops/*` and `ops.html` |
| `MAIL_PROVIDER` | `console` | `console` or `resend` |
| `MAIL_FROM` | — | sender, e.g. `Mapa de família <pedidos@your-domain>` (required for `resend`) |
| `MAIL_REPLY_TO` | — | where replies go (review requests ask customers to reply) |
| `RESEND_API_KEY` | — | `re_…`, for `MAIL_PROVIDER=resend`; never commit it |
| `MAIL_DIR` | `<OS temp>/heritage-map-mail` | console mailer: `.eml` copies |
| `MAIL_BRAND` | "Mapa de família" / "Family map" / "Mapa familiar" | name at the top of every mail |
| `REVIEW_URL` | — | "Leave a review" button in the delivered mail |

The rest (`PORT`, `DATA_DIR`, Stripe, Prodigi, file links) is in `main.ts` and `commerce/setup.ts`.

### Production checklist (needs a human)

1. **Resend account**: create it, verify the sending domain (Resend shows the **SPF** (TXT/MX on a
   `send.` subdomain) and **DKIM** (TXT) records to add at the DNS host), add a **DMARC** record
   (`_dmarc` TXT, start with `p=none`), create an API key with "sending access" only, and set
   `MAIL_PROVIDER=resend`, `RESEND_API_KEY`, `MAIL_FROM` on that domain, `MAIL_REPLY_TO`.
2. Serve the API over **HTTPS**, same site as the web app (ideally the same origin, with the web
   app built with `VITE_API_URL=''`), set `PUBLIC_API_URL`, `APP_URL`, `CORS_ORIGINS`.
3. Set `OPERATOR_EMAILS` to the shop team's addresses.
4. Behind a reverse proxy, `TRUST_PROXY=yes` (so rate limits see real client IPs).
5. Privacy notice: e-mail addresses are now stored for accounts (GDPR / LGPD).

Known limits: some corporate mail scanners open links before the person does, which uses a
single-use link (the person then asks for another); sessions and rate limits are per process and
not shared; there is no "change e-mail" or "delete my account" yet.
