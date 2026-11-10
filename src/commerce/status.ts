// The life of an order. Every change of status goes through `canTransition`, on the server and in
// the operations page, so an order can't skip a step or come back from the dead.
//
//   created ─▶ paid ─▶ file_ready ─▶ sent_to_production ─▶ shipped ─▶ delivered
//      │         │          │  └──────────▶ delivered (digital: the download is the delivery)
//      ▼         ▼          ▼               ▼                 ▼           ▼
//   cancelled ◀──┴──────────┴───────────────┘                 │           │
//      │                                                       │           │
//      └──────────────────────────▶ refunded ◀─────────────────┴───────────┘

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
  paid: ['file_ready', 'cancelled', 'refunded'],
  file_ready: ['sent_to_production', 'delivered', 'cancelled', 'refunded'],
  sent_to_production: ['shipped', 'cancelled', 'refunded'],
  shipped: ['delivered', 'refunded'],
  delivered: ['refunded'],
  // A paid order that was cancelled still has to give the money back.
  cancelled: ['refunded'],
  refunded: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus, kind?: 'digital' | 'print' | 'framed'): boolean {
  if (!NEXT[from].includes(to)) return false;
  // Digital orders are delivered by the download link: they never go to production or shipping.
  if (kind === 'digital' && (to === 'sent_to_production' || to === 'shipped')) return false;
  // Physical orders can't skip production and shipping.
  if (kind && kind !== 'digital' && from === 'file_ready' && to === 'delivered') return false;
  return true;
}

export const allowedNext = (from: OrderStatus, kind?: 'digital' | 'print' | 'framed') =>
  NEXT[from].filter((to) => canTransition(from, to, kind));

/** Statuses after payment: the customer has been charged (and may be owed a refund if cancelled). */
export const PAID_STATUSES: readonly OrderStatus[] = ['paid', 'file_ready', 'sent_to_production', 'shipped', 'delivered'];

export const isFinal = (s: OrderStatus) => NEXT[s].length === 0;

/** The forward step an operator takes by hand for a manually fulfilled order, if any. */
export function nextManualStep(from: OrderStatus, kind: 'digital' | 'print' | 'framed'): OrderStatus | undefined {
  if (kind === 'digital') return undefined;
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
