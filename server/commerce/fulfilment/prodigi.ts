// Prodigi Print API v5 (https://www.prodigi.com/print-api/docs/). One base URL for sandbox and
// live: the key's prefix picks the mode (`sandbox_…` orders "are not printed, shipped, or
// charged"). This adapter refuses live keys, like payments.
//
// - Orders: POST /orders with submit:true and an Idempotency-Key header (retries never duplicate).
// - Status: signed webhooks (X-Prodigi-Signature: t=<unix>, v1=<hex HMAC-SHA256 of "t.body">), and
//   GET /orders/{id} for polling.
// - Quotes: POST /quotes/order.
// Field names follow the v5 OpenAPI spec as read on 2026-11-10; check them against the sandbox
// (see server/commerce/README.md) before the first real order.
//
// Gifts: no free-text gift or packing note field was found in the order request (the v4 docs had a
// `packingSlip` with only a `url` to an image), so the message is NOT sent to Prodigi: the order's
// history says so and the operator decides (e.g. a printed packing slip image, or an e-mail to the
// recipient). Prodigi ships white-label without retail prices; `recipientCost` is for customs only.

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FulfilmentAdapter, FulfilmentRequest, FulfilmentUpdate, ShippingAddress, ShippingQuote, Tracking } from './types';

export interface ProdigiOptions {
  apiKey: string;
  /** Secret of the webhook subscription (returned once by POST /webhooks). */
  webhookSecret?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  shippingMethod?: 'budget' | 'standard' | 'standardplus' | 'express' | 'overnight';
  now?: () => number;
}

type Json = Record<string, unknown>;

/** Prodigi's order status → ours (only the ones that move an order forward). */
export function mapProdigiStatus(s: string): Pick<FulfilmentUpdate, 'status' | 'problem'> {
  switch (s) {
    case 'submitted':
    case 'in_production':
      return { status: 'sent_to_production' };
    case 'shipped':
    case 'completed':
    case 'shipment.dispatched':
    case 'shipment.in_transit':
      return { status: 'shipped' };
    case 'shipment.delivered':
      return { status: 'delivered' };
    case 'cancelled':
    case 'failed':
    case 'order.cancelled':
    case 'order.failed':
      return { problem: `Prodigi reports the order as ${s.replace('order.', '')}` };
    case 'on_hold':
    case 'shipment.exception':
      return { problem: `Prodigi reports ${s.replace('shipment.', 'shipment ')}: check the order in the Prodigi dashboard` };
    default:
      return {};
  }
}

const money = (m: unknown): number => {
  const o = (m ?? {}) as Json;
  return Math.round(Number(o.amount ?? 0) * 100);
};

function address(a: ShippingAddress) {
  return {
    // Brazil: Prodigi has no tax-id field; its help centre says to put the CPF/CNPJ in the address.
    line1: a.line1,
    line2: [a.line2, a.taxId ? `CPF/CNPJ ${a.taxId}` : ''].filter(Boolean).join(', ') || undefined,
    townOrCity: a.city,
    stateOrCounty: a.state || undefined,
    postalOrZipCode: a.postalCode,
    countryCode: a.country,
  };
}

function tracking(order: Json): Tracking[] {
  const shipments = Array.isArray(order.shipments) ? (order.shipments as Json[]) : [];
  return shipments
    .map((s) => {
      const t = (s.tracking ?? {}) as Json;
      const carrier = (s.carrier ?? {}) as Json | string;
      return {
        carrier: typeof carrier === 'string' ? carrier : (carrier.name as string | undefined),
        number: t.number as string | undefined,
        url: t.url as string | undefined,
      };
    })
    .filter((t) => t.number || t.url);
}

export function prodigiFulfilment(opts: ProdigiOptions): FulfilmentAdapter {
  if (!opts.apiKey.startsWith('sandbox_')) throw new Error('Only Prodigi sandbox keys (sandbox_…) are allowed for now');
  const base = opts.baseUrl ?? 'https://api.prodigi.com/v5';
  const http = opts.fetch ?? fetch;
  const now = opts.now ?? (() => Date.now());

  async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Json> {
    const res = await http(`${base}${path}`, {
      method,
      headers: { 'X-API-Key': opts.apiKey, 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json: Json = {};
    try {
      json = text ? (JSON.parse(text) as Json) : {};
    } catch {
      /* not JSON */
    }
    if (!res.ok) {
      const issues = Array.isArray(json.issues) ? ` (${(json.issues as Json[]).map((i) => `${String(i.path ?? i.objectId ?? '')}: ${String(i.message ?? i.description ?? '')}`).join('; ')})` : '';
      throw new Error(`Prodigi ${method} ${path} → ${res.status}: ${String(json.message ?? text.slice(0, 200))}${issues}`);
    }
    // v5 wraps results in `data`; v4 used `order` / `quotes`.
    return ((json.data ?? json.order ?? json) as Json) || {};
  }

  const toUpdate = (order: Json, eventId?: string): FulfilmentUpdate => {
    const partnerStatus = String(order.status ?? 'unknown');
    return { ref: String(order.id ?? ''), partnerStatus, ...mapProdigiStatus(partnerStatus), tracking: tracking(order), eventId };
  };

  return {
    route: 'prodigi',
    async submit(req: FulfilmentRequest) {
      if (!req.sku) throw new Error(`No Prodigi SKU for ${req.kind} ${req.size} in the catalogue`);
      const order = await call(
        'POST',
        '/orders',
        {
          merchantReference: req.orderNumber,
          shippingMethod: opts.shippingMethod ?? 'standard',
          submit: true,
          recipient: { name: req.address.name, email: req.email, phoneNumber: req.address.phone || undefined, address: address(req.address) },
          items: [
            {
              merchantReference: `${req.orderNumber}-1`,
              sku: req.sku,
              quantity: 1,
              sizing: 'fillPrintArea',
              attributes: { ...(req.attributes ?? {}), ...(req.frameColour ? { color: req.frameColour } : {}) },
              recipientCost: { amount: (req.value.amount / 100).toFixed(2), currency: req.value.currency },
              assets: [{ printArea: 'default', url: req.fileUrl }],
            },
          ],
          metadata: { orderId: req.orderId, orderNumber: req.orderNumber },
        },
        { 'Idempotency-Key': `order-${req.orderId}` },
      );
      const u = toUpdate(order);
      return {
        ref: u.ref,
        partnerStatus: u.partnerStatus,
        sentToProduction: true,
        giftNote: req.gift?.message
          ? 'A gift: Prodigi has no field for the gift message, so it was not sent. Send the message another way (packing slip image or e-mail).'
          : undefined,
      };
    },
    async status(ref) {
      return toUpdate(await call('GET', `/orders/${encodeURIComponent(ref)}`));
    },
    async quote({ sku, frameColour, country, currency, address: a }) {
      const q = await call('POST', '/quotes/order', {
        items: [{ catalogueVariantId: sku, quantity: 1, attributes: frameColour ? { color: frameColour } : {}, assets: [{ printArea: 'default' }] }],
        shippingAddress: a ? address(a) : { countryCode: country },
        currencyCode: currency,
      });
      const options = Array.isArray(q.shippingOptions) && q.shippingOptions.length ? (q.shippingOptions as Json[]) : [q];
      return options.map(
        (o): ShippingQuote => ({
          method: String(o.method ?? q.shippingMethod ?? 'standard'),
          currency: String(((o.total ?? q.total) as Json | undefined)?.currency ?? currency),
          items: money(o.items ?? q.items),
          shipping: money(o.cost ?? o.shipping ?? q.shipping),
          tax: money(o.tax ?? q.tax),
          total: money(o.total ?? q.total),
        }),
      );
    },
    parseWebhook(rawBody, header) {
      if (!opts.webhookSecret) throw new Error('PRODIGI_WEBHOOK_SECRET is not set');
      const sig = header('x-prodigi-signature') ?? '';
      const parts = Object.fromEntries(sig.split(',').map((p) => p.trim().split('=') as [string, string]));
      const t = Number(parts.t);
      if (!parts.t || !parts.v1 || !Number.isFinite(t)) throw new Error('Missing Prodigi signature');
      if (Math.abs(now() / 1000 - t) > 300) throw new Error('Prodigi signature is too old');
      const expected = createHmac('sha256', opts.webhookSecret).update(`${parts.t}.${rawBody}`).digest();
      const given = Buffer.from(parts.v1, 'hex');
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new Error('Bad Prodigi signature');
      const event = JSON.parse(rawBody) as Json;
      const type = String(event.type ?? '');
      const data = (event.data ?? {}) as Json;
      const ref = String(data.orderId ?? (data.order as Json | undefined)?.id ?? '');
      if (!ref || !(type.startsWith('order.') || type.startsWith('shipment.'))) return null;
      const order = (data.order ?? {}) as Json;
      // Order events carry the new order status; shipment events are their own status.
      const partnerStatus = type.startsWith('shipment.') ? type : String(order.status ?? data.status ?? type);
      return { ref, partnerStatus, ...mapProdigiStatus(partnerStatus), tracking: tracking({ shipments: data.shipment ? [data.shipment] : order.shipments }), eventId: String(event.id ?? '') || undefined };
    },
  };
}
