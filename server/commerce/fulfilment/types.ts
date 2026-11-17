// Who makes and ships a physical print. Each market in config/catalogue.json names its route;
// the pipeline only talks to this interface, so a Brazilian partner (Gelato, a local lab with an
// API) can be added as another adapter without touching orders or payments.

import type { FulfilmentRoute } from '../../../src/commerce/catalogue';
import type { GiftDetails } from '../../../src/commerce/gift';
import type { Address } from '../../../src/commerce/order';
import type { OrderStatus } from '../../../src/commerce/status';

export type ShippingAddress = Address;

/** What a partner needs to make one order. */
export interface FulfilmentRequest {
  orderId: string;
  orderNumber: string;
  sku?: string;
  kind: 'print' | 'poster' | 'framed' | 'canvas';
  size: string;
  frameColour?: string;
  /** The product's fixed partner options from the catalogue (e.g. a canvas's wrap). */
  attributes?: Record<string, string>;
  /** A present: the parcel must carry no prices, and the card's message if the partner can print it. */
  gift?: GiftDetails;
  email: string;
  address: ShippingAddress;
  /** Public, signed, long-lived link to the print file (PNG 300 dpi). */
  fileUrl: string;
  /** Customs value of the goods (what the customer paid), for international parcels. */
  value: { amount: number; currency: string };
}

export interface Tracking {
  carrier?: string;
  number?: string;
  url?: string;
}

/** A change reported by a partner (webhook or poll). */
export interface FulfilmentUpdate {
  /** The partner's order id. */
  ref: string;
  /** The partner's own status word, kept for operations. */
  partnerStatus: string;
  /** The order status this means for us, if it moves the order forward. */
  status?: Extract<OrderStatus, 'sent_to_production' | 'shipped' | 'delivered'>;
  /** The partner can't make it (cancelled or failed): an operator must look at the order. */
  problem?: string;
  tracking?: Tracking[];
  /** For webhook de-duplication. */
  eventId?: string;
}

export interface SubmitResult {
  /** The partner's order id (none for manual orders). */
  ref?: string;
  partnerStatus: string;
  /** True when the partner has the order and production starts without anyone's help. */
  sentToProduction: boolean;
  note?: string;
  /** For gift orders: what the partner does (or can't do) with the gift message, for the history. */
  giftNote?: string;
}

export interface ShippingQuote {
  method: string;
  currency: string;
  /** Minor units. */
  items: number;
  shipping: number;
  tax: number;
  total: number;
}

export interface FulfilmentAdapter {
  route: FulfilmentRoute;
  submit(req: FulfilmentRequest): Promise<SubmitResult>;
  /** Fetches the partner's current status (polling, or to confirm an unsigned callback). */
  status?(ref: string): Promise<FulfilmentUpdate>;
  /** The partner's cost of making and shipping an order (to check margins against the catalogue). */
  quote?(req: { sku: string; frameColour?: string; country: string; currency: string; address?: ShippingAddress }): Promise<ShippingQuote[]>;
  /** Verifies and reads a webhook; null when the event doesn't concern an order's status. Throws on a bad signature. */
  parseWebhook?(rawBody: string, headers: (name: string) => string | undefined): FulfilmentUpdate | null;
}
