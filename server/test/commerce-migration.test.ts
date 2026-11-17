// Migration 003 (gifts, discounts, gift cards, new formats) on a database that already has orders.

import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { migrate, openPglite, type Db } from '../db';
import { getOrderById } from '../commerce/orders';

const MIGRATIONS = fileURLToPath(new URL('../db/migrations/', import.meta.url));
const before = mkdtempSync(join(tmpdir(), 'migrations-002-'));
for (const f of readdirSync(MIGRATIONS).filter((f) => f < '003')) copyFileSync(join(MIGRATIONS, f), join(before, f));

let db: Db;
afterAll(async () => {
  await db?.close();
  rmSync(before, { recursive: true, force: true });
});

describe('migration 003', () => {
  it('keeps existing orders and opens the new kinds, gift cards and amounts', async () => {
    db = await openPglite();
    await migrate(db, before);
    await db.query("insert into users (id, email, display_name) values ('00000000-0000-4000-8000-000000000001', 'a@b.co', 'A')");
    await db.query(
      `insert into orders (id, owner_id, product_id, kind, size, design, currency, unit_amount, total_amount, country, market, email)
       values ('00000000-0000-4000-8000-0000000000aa', '00000000-0000-4000-8000-000000000001', 'digital', 'digital', 'A1',
               '{"lang": "es", "styleId": "antique"}', 'EUR', 1490, 1490, 'ES', 'EU', 'a@b.co')`,
    );
    expect(await migrate(db)).toEqual(['003_gifts_discounts.sql']);

    const old = await getOrderById(db, '00000000-0000-4000-8000-0000000000aa');
    expect(old).toMatchObject({ lang: 'es', giftCardAmount: 0, discountAmount: 0, amountPaid: undefined, gift: undefined });

    // A gift card order: no design, a value tier for a size.
    await db.query(
      `insert into orders (id, owner_id, product_id, kind, size, currency, unit_amount, total_amount, country, market, email)
       values ('00000000-0000-4000-8000-0000000000bb', '00000000-0000-4000-8000-000000000001', 'giftcard', 'giftcard', 'V1', 'BRL', 20000, 20000, 'BR', 'BR', 'a@b.co')`,
    );
    // …but a map order still needs its design.
    await expect(
      db.query(
        `insert into orders (id, owner_id, product_id, kind, size, currency, unit_amount, total_amount, country, market, email)
         values ('00000000-0000-4000-8000-0000000000cc', '00000000-0000-4000-8000-000000000001', 'canvas', 'canvas', 'A2', 'EUR', 13900, 13900, 'PT', 'EU', 'a@b.co')`,
      ),
    ).rejects.toThrow(/orders_design_check/);
    await expect(db.query("update orders set kind = 'mug' where id = '00000000-0000-4000-8000-0000000000aa'")).rejects.toThrow(/orders_kind_check/);
  });
});
