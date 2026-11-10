// Order shapes shared by the API (server/commerce) and the web pages (order status, operations).

import type { Currency, FulfilmentRoute, ProductKind, Size } from './catalogue';
import type { DesignSpec } from './design';
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
  size: Size;
  frameColour?: string;
  design: DesignSpec;
  currency: Currency;
  unitAmount: number;
  shippingAmount: number;
  totalAmount: number;
  refundedAmount: number;
  country: string;
  market: string;
  fulfilment?: FulfilmentRoute;
  sku?: string;
  email: string;
  shippingAddress?: Address;
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
}
