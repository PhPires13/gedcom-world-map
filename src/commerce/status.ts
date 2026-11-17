// The life of an order. Every change of status goes through `canTransition`, on the server and in
// the operations page, so an order can't skip a step or come back from the dead.
//
//   created ─▶ paid ─▶ file_ready ─▶ sent_to_production ─▶ shipped ─▶ delivered
//      │         │          │  └──────────▶ delivered (digital: the download is the delivery)
//      ▼         ▼          ▼               ▼                 ▼           ▼
//   cancelled ◀──┴──────────┴───────────────┘                 │           │
//      │                                                       │           │
//      └──────────────────────────▶ refunded ◀─────────────────┴───────────┘
//
// A gift card has nothing to make: paid ─▶ delivered as soon as its code is issued.

import type { ProductKind } from './catalogue';

export const ORDER_STATUSES = [
  'created',
  'paid',
  'file_ready',
  'sent_to_production',
  'shipped',
  'delivered',
  'cancelled',
  'refunded',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

const NEXT: Record<OrderStatus, readonly OrderStatus[]> = {
  created: ['paid', 'cancelled'],
  paid: ['file_ready', 'delivered', 'cancelled', 'refunded'],
  file_ready: ['sent_to_production', 'delivered', 'cancelled', 'refunded'],
  sent_to_production: ['shipped', 'cancelled', 'refunded'],
  shipped: ['delivered', 'refunded'],
  delivered: ['refunded'],
  // A paid order that was cancelled still has to give the money back.
  cancelled: ['refunded'],
  refunded: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus, kind?: ProductKind): boolean {
  if (!NEXT[from].includes(to)) return false;
  // Only a gift card is delivered straight after payment (its code is the delivery), and it is never printed.
  if (from === 'paid' && to === 'delivered') return kind === 'giftcard';
  if (kind === 'giftcard' && (to === 'file_ready' || to === 'sent_to_production' || to === 'shipped')) return false;
  // Digital orders are delivered by the download link: they never go to production or shipping.
  if (kind === 'digital' && (to === 'sent_to_production' || to === 'shipped')) return false;
  // Physical orders can't skip production and shipping.
  if (kind && kind !== 'digital' && from === 'file_ready' && to === 'delivered') return false;
  return true;
}

export const allowedNext = (from: OrderStatus, kind?: ProductKind) =>
  NEXT[from].filter((to) => canTransition(from, to, kind));

/** Statuses after payment: the customer has been charged (and may be owed a refund if cancelled). */
export const PAID_STATUSES: readonly OrderStatus[] = ['paid', 'file_ready', 'sent_to_production', 'shipped', 'delivered'];

export const isFinal = (s: OrderStatus) => NEXT[s].length === 0;

/** The forward step an operator takes by hand for a manually fulfilled order, if any. */
export function nextManualStep(from: OrderStatus, kind: ProductKind): OrderStatus | undefined {
  if (kind === 'digital' || kind === 'giftcard') return undefined;
  return ({ file_ready: 'sent_to_production', sent_to_production: 'shipped', shipped: 'delivered' } as Partial<Record<OrderStatus, OrderStatus>>)[from];
}

export const STATUS_LABELS: Record<OrderStatus, { en: string; pt: string }> = {
  created: { en: 'Awaiting payment', pt: 'A aguardar pagamento' },
  paid: { en: 'Paid', pt: 'Pago' },
  file_ready: { en: 'Print file ready', pt: 'Ficheiro de impressão pronto' },
  sent_to_production: { en: 'In production', pt: 'Em produção' },
  shipped: { en: 'Shipped', pt: 'Enviado' },
  delivered: { en: 'Delivered', pt: 'Entregue' },
  cancelled: { en: 'Cancelled', pt: 'Cancelado' },
  refunded: { en: 'Refunded', pt: 'Reembolsado' },
};
