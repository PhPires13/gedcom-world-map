// Browser client for the shop routes (server/commerce/routes.ts).

import { API_BASE, ApiError } from '../tree/api';
import { countryForTimeZone } from '../i18n/core';
import type { Currency, PriceList } from './catalogue';
import type { Address, Order, OrderDetail } from './order';
import type { OrderStatus } from './status';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    // The session cookie (accounts); the API is on another port in dev.
    credentials: 'include',
    ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string } | undefined)?.error ?? res.statusText);
  return data as T;
}

export type ShopCatalogue = PriceList & { paymentsReady: boolean; paymentMode?: 'test' | 'live' };

export interface NewOrder {
  treeId: string;
  productId: string;
  size: string;
  frameColour?: string;
  design: unknown;
  country: string;
  currency?: Currency;
  email: string;
  shippingAddress?: Address;
}

export type OpsOrder = Order & { next: OrderStatus[]; manualNext?: OrderStatus; fileUrl?: string; pdfUrl?: string };

const withKey = (key?: string | null) => (key ? `?k=${encodeURIComponent(key)}` : '');

export const shop = {
  catalogue: (country: string, currency?: string) =>
    request<ShopCatalogue>('GET', `/api/shop/catalogue?country=${encodeURIComponent(country)}${currency ? `&currency=${currency}` : ''}`),
  createOrder: (o: NewOrder) => request<OrderDetail>('POST', '/api/orders', o),
  /** The signed-in customer's orders, newest first. */
  myOrders: () => request<Order[]>('GET', '/api/orders'),
  /** `key`: the order link's `k`, which opens the order without signing in (e-mailed links). */
  order: (id: string, key?: string | null) => request<OrderDetail>('GET', `/api/orders/${id}${withKey(key)}`),
  checkout: (id: string, key?: string | null) => request<{ url: string }>('POST', `/api/orders/${id}/checkout${withKey(key)}`),
  cancel: (id: string, key?: string | null) => request<OrderDetail>('POST', `/api/orders/${id}/cancel${withKey(key)}`),
  ops: {
    list: (status?: string) => request<OpsOrder[]>('GET', `/api/ops/orders${status ? `?status=${status}` : ''}`),
    advance: (id: string, body: { to?: OrderStatus; note?: string } = {}) => request<OrderDetail>('POST', `/api/ops/orders/${id}/advance`, body),
    refund: (id: string, amount?: number) => request<OrderDetail>('POST', `/api/ops/orders/${id}/refund`, amount ? { amount } : {}),
    retry: (id: string) => request<OrderDetail>('POST', `/api/ops/orders/${id}/retry`),
    sync: (id: string) => request<OrderDetail>('POST', `/api/ops/orders/${id}/sync`),
    sheetUrl: (id: string) => `${API_BASE}/api/ops/orders/${id}/sheet`,
  },
};

/**
 * A first guess at the visitor's country, by the same signals as the site's language: where they are
 * (the device's time zone, for the Portuguese- and Spanish-speaking countries it can name), then the
 * browser language's region (pt-BR → BR). They can change it.
 */
export function guessCountry(): string {
  let zone: string | undefined;
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    /* no time zone */
  }
  const fromZone = countryForTimeZone(zone);
  if (fromZone && fromZone !== 'ZZ') return fromZone;
  for (const l of navigator.languages ?? [navigator.language]) {
    const region = /^[a-z]{2,3}-([A-Z]{2})$/i.exec(l)?.[1];
    if (region) return region.toUpperCase();
    if (l.toLowerCase() === 'pt') return 'PT';
  }
  return 'US';
}
