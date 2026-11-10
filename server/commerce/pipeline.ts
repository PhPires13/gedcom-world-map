// What happens after payment, one step at a time, each safe to run again:
//
//   paid ──render the print from the tree's public view, store PNG/PDF/SVG──▶ file_ready
//   file_ready ──digital──▶ delivered (the signed download link is the delivery)
//   file_ready ──prodigi──▶ submitted to Prodigi ──▶ sent_to_production (then Prodigi's webhooks)
//   file_ready ──manual───▶ waits for an operator (operations page, production sheet)
//
// Failures are written to the order's history and leave the status where it was, so an operator
// can retry (POST /api/ops/orders/:id/retry). The server also resumes unfinished orders at start.
//
// Rendering an A2 takes ~10 s of CPU on this thread; with real traffic move `processOrder` to a
// worker or a job queue (it only needs the database and storage).

import type { DesignSpec } from '../../src/commerce/design';
import type { TreeDetail } from '../../src/model';
import type { PaperSize } from '../../src/print/types';
import type { Db } from '../db';
import * as repo from '../repo';
import type { DocumentStorage } from '../storage';
import type { FulfilmentAdapter, FulfilmentUpdate } from './fulfilment/types';
import type { LinkSigner } from './links';
import * as orders from './orders';
import { canTransition, type OrderStatus } from '../../src/commerce/status';

export interface RenderedFiles {
  png: Uint8Array;
  pdf: Uint8Array;
  svg: string;
  widthPx: number;
  heightPx: number;
  peopleOnMap: number;
}

/** Makes the print files. The real one is server/print/render.ts; tests pass a fast fake. */
export type RenderFiles = (detail: TreeDetail, design: DesignSpec, paper: PaperSize) => Promise<RenderedFiles>;

export interface PipelineDeps {
  db: Db;
  storage: DocumentStorage;
  render: RenderFiles;
  fulfilment: Partial<Record<'prodigi' | 'manual', FulfilmentAdapter>>;
  links: LinkSigner;
  now: () => Date;
}

/** How long a partner's file link stays valid (labs may fetch it days later, or again for a reprint). */
const PARTNER_LINK_TTL = 30 * 24 * 3600;

export const fileKey = (orderId: string, file: 'png' | 'pdf' | 'svg') => `orders/${orderId}/print-${file}`;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class Pipeline {
  private running = new Set<string>();
  constructor(private deps: PipelineDeps) {}

  /** Moves a paid order as far as it can go on its own. Concurrent calls for one order are merged. */
  async processOrder(orderId: string): Promise<void> {
    if (this.running.has(orderId)) return;
    this.running.add(orderId);
    try {
      let order = await orders.getOrderById(this.deps.db, orderId);
      if (order.status === 'paid') order = (await this.makeFiles(order)) ?? order;
      if (order.status === 'file_ready') await this.fulfil(order);
    } finally {
      this.running.delete(orderId);
    }
  }

  private async makeFiles(order: orders.OrderRow): Promise<orders.OrderRow | undefined> {
    const { db, storage } = this.deps;
    try {
      if (!order.treeId) throw new Error('The tree this order was designed from has been deleted');
      const tree = await repo.getTree(db, order.ownerId, order.treeId);
      // Always the public view: presumed-living people are redacted before anything is drawn.
      const detail = await repo.treeDetail(db, tree, this.deps.now().getUTCFullYear(), 'public');
      const t0 = Date.now();
      const files = await this.deps.render(detail, order.design, order.size);
      await storage.put(fileKey(order.id, 'png'), files.png);
      await storage.put(fileKey(order.id, 'pdf'), files.pdf);
      await storage.put(fileKey(order.id, 'svg'), new TextEncoder().encode(files.svg));
      const { order: next } = await orders.transition(
        db,
        order.id,
        'file_ready',
        'system',
        `Print file made from the public view: ${files.widthPx}×${files.heightPx} px at 300 dpi, ${files.peopleOnMap} people on the map (${((Date.now() - t0) / 1000).toFixed(1)} s)`,
        { files: { png: true, pdf: true, svg: true, widthPx: files.widthPx, heightPx: files.heightPx, peopleOnMap: files.peopleOnMap }, file_error: null },
      );
      return next;
    } catch (e) {
      console.error(`Print file for order ${order.number} failed:`, e);
      await orders.updateOrder(db, order.id, { file_error: message(e) }, { actor: 'system', note: `Print file failed: ${message(e)}` });
      return undefined;
    }
  }

  private async fulfil(order: orders.OrderRow) {
    const { db, links } = this.deps;
    if (order.kind === 'digital') {
      await orders.transition(db, order.id, 'delivered', 'system', 'Download ready on the order page');
      return;
    }
    if (order.fulfilmentRef || order.fulfilmentStatus) return; // already with the partner / the operators
    const adapter = order.fulfilment && this.deps.fulfilment[order.fulfilment];
    if (!adapter) {
      await orders.addEvent(db, order.id, 'system', `No "${order.fulfilment}" fulfilment is configured on this server: fulfil by hand or set its keys`);
      return;
    }
    if (!order.shippingAddress) {
      await orders.addEvent(db, order.id, 'system', 'No shipping address on this order');
      return;
    }
    try {
      const res = await adapter.submit({
        orderId: order.id,
        orderNumber: order.number,
        sku: order.sku,
        kind: order.kind as 'print' | 'framed',
        size: order.size,
        frameColour: order.frameColour,
        email: order.email,
        address: order.shippingAddress,
        fileUrl: links.url(order.id, 'png', PARTNER_LINK_TTL).url,
        value: { amount: order.totalAmount, currency: order.currency },
      });
      const patch = { fulfilment_ref: res.ref, fulfilment_status: res.partnerStatus };
      if (res.sentToProduction) {
        await orders.transition(db, order.id, 'sent_to_production', 'system', `Sent to ${adapter.route}${res.ref ? ` (order ${res.ref})` : ''}`, patch);
      } else {
        await orders.updateOrder(db, order.id, patch, { actor: 'system', note: res.note ?? `Waiting for ${adapter.route} fulfilment` });
      }
    } catch (e) {
      console.error(`Fulfilment of order ${order.number} failed:`, e);
      await orders.addEvent(db, order.id, 'system', `Sending to ${adapter.route} failed: ${message(e)}`);
    }
  }

  /** Applies a partner's status report, stepping through intermediate statuses (file_ready → shipped passes sent_to_production). */
  async applyFulfilmentUpdate(update: FulfilmentUpdate, actor: orders.Actor = 'prodigi', orderId?: string): Promise<orders.OrderRow | undefined> {
    const { db } = this.deps;
    const order = orderId ? await orders.getOrderById(db, orderId) : await orders.findOrder(db, 'fulfilment_ref', update.ref);
    if (!order) return undefined;
    const patch: orders.OrderPatch = { fulfilment_status: update.partnerStatus, ...(update.tracking?.length ? { tracking: update.tracking } : {}) };
    let current = await orders.updateOrder(db, order.id, patch);
    if (update.problem) await orders.addEvent(db, order.id, actor, update.problem);
    if (update.status) {
      const path: OrderStatus[] = ['sent_to_production', 'shipped', 'delivered'];
      for (const step of path.slice(0, path.indexOf(update.status) + 1)) {
        if (current.status === step || !canTransition(current.status, step, current.kind)) continue;
        const tracking = step === 'shipped' && update.tracking?.length ? `: ${update.tracking.map((t) => [t.carrier, t.number].filter(Boolean).join(' ')).join(', ')}` : '';
        current = (await orders.transition(db, order.id, step, actor, `${actor} status ${update.partnerStatus}${tracking}`)).order;
      }
    }
    return current;
  }

  /** Orders left half-way (server restarted during a render, partner down): try them again. */
  async resume(): Promise<number> {
    const stuck = [...(await orders.listOrders(this.deps.db, { status: 'paid' })), ...(await orders.listOrders(this.deps.db, { status: 'file_ready' }))];
    const todo = stuck.filter((o) => o.status === 'paid' || o.kind === 'digital' || !o.fulfilmentStatus);
    for (const o of todo) await this.processOrder(o.id);
    return todo.length;
  }
}
