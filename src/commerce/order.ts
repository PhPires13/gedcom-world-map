// Order shapes shared by the API (server/commerce) and the web pages (order status, operations).

import type { Currency, FulfilmentRoute, ProductKind, VariantSize } from './catalogue';
import type { DesignSpec } from './design';
import type { GiftDetails } from './gift';
import type { OrderStatus } from './status';

export interface Address {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postalCode: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
  phone?: string;
  /** Brazil: CPF or CNPJ, needed by carriers and customs. */
  taxId?: string;
}

export interface OrderEvent {
  id: number;
  fromStatus?: OrderStatus;
  toStatus?: OrderStatus;
  actor: 'customer' | 'stripe' | 'system' | 'operator' | 'prodigi';
  note?: string;
  createdAt: string;
}

export interface Order {
  id: string;
  number: string;
  treeId?: string;
  productId: string;
  kind: ProductKind;
  /** A paper size, or a gift card's value tier (V1–V3). */
  size: VariantSize;
  frameColour?: string;
  /** The map's design; undefined for a gift card. */
  design?: DesignSpec;
  /** The customer's language (the design's, or the shop's for a gift card). */
  lang: 'pt' | 'en' | 'es';
  currency: Currency;
  unitAmount: number;
  shippingAmount: number;
  /** The catalogue price (product + shipping), before any discount or gift card. */
  totalAmount: number;
  /** Paid with a gift card (minor units); the rest goes through Stripe. */
  giftCardAmount: number;
  /** Taken off by a Stripe promotion code (from the webhook: subtotal − total). */
  discountAmount: number;
  /** The Stripe promotion code id (promo_…) that gave the discount. */
  discountCode?: string;
  /** What Stripe actually charged; undefined until paid through Stripe (or for older orders). */
  amountPaid?: number;
  refundedAmount: number;
  country: string;
  market: string;
  fulfilment?: FulfilmentRoute;
  sku?: string;
  email: string;
  shippingAddress?: Address;
  /** A present: the card's recipient and message. The parcel goes to `shippingAddress` without prices. */
  gift?: GiftDetails;
  status: OrderStatus;
  /** Which print files exist (png, pdf, svg). */
  files: { png?: boolean; pdf?: boolean; svg?: boolean; widthPx?: number; heightPx?: number; peopleOnMap?: number };
  fileError?: string;
  fulfilmentRef?: string;
  fulfilmentStatus?: string;
  tracking: { carrier?: string; number?: string; url?: string }[];
  paid: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OrderDetail extends Order {
  events: OrderEvent[];
  /** Signed, expiring links to the files: for digital orders once paid, and for operators. */
  downloads?: { png?: string; pdf?: string; svg?: string; expiresAt: string };
  /** The code a gift card order bought, once paid (its owner only; operators see it masked). */
  giftCard?: IssuedGiftCard;
}

export interface IssuedGiftCard {
  /** XXXX-XXXX-XXXX, or ••••-••••-XXXX for operators. */
  code: string;
  amount: number;
  currency: Currency;
  status: 'active' | 'redeemed' | 'void';
  /** The order it was spent on. */
  redeemedOrderNumber?: string;
}

/** What Stripe has to charge: the price less the gift card. (A promotion code may take off more at Checkout.) */
export const amountDue = (o: Pick<Order, 'totalAmount' | 'giftCardAmount'>) => Math.max(0, o.totalAmount - o.giftCardAmount);

/** The money Stripe took, which is what can be refunded. */
export const amountCharged = (o: Pick<Order, 'totalAmount' | 'giftCardAmount' | 'discountAmount' | 'amountPaid'>) =>
  o.amountPaid ?? Math.max(0, o.totalAmount - o.giftCardAmount - o.discountAmount);
