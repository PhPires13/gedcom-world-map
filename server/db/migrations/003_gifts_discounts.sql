-- More to sell: gift orders (a card and no prices in the parcel), Stripe promotion codes,
-- gift cards (vale-presente) and the poster and canvas formats.

-- New product kinds; a gift card's "size" is its value tier (V1–V3) and it has no design or tree.
alter table orders drop constraint if exists orders_kind_check;
alter table orders add constraint orders_kind_check check (kind in ('digital', 'print', 'poster', 'framed', 'canvas', 'giftcard'));
alter table orders drop constraint if exists orders_size_check;
alter table orders add constraint orders_size_check check (size in ('A3', 'A2', 'A1', 'V1', 'V2', 'V3'));
alter table orders alter column design drop not null;
alter table orders add constraint orders_design_check check (design is not null or kind = 'giftcard');

-- The customer's language (the design's for maps), for Checkout and the pages of a gift card order.
alter table orders add column lang text not null default 'pt' check (lang in ('pt', 'en', 'es'));
update orders set lang = design ->> 'lang' where design ->> 'lang' in ('pt', 'en', 'es');

-- A present: { recipientName, message? }. Null when the order is not a gift.
alter table orders add column gift jsonb;

-- Money (minor units). total_amount stays the catalogue price; what Stripe charges is
-- total_amount - gift_card_amount - discount_amount, recorded as amount_paid by the webhook.
alter table orders add column gift_card_amount integer not null default 0 check (gift_card_amount >= 0);
alter table orders add column discount_amount integer not null default 0 check (discount_amount >= 0);
-- The Stripe promotion code id (promo_…) used at Checkout.
alter table orders add column discount_code text;
alter table orders add column amount_paid integer check (amount_paid >= 0);

-- Gift cards. One per gift card order, issued when that order is paid. The code is single use:
-- it is reserved by the map order that spends it (status redeemed, in the same transaction that
-- creates that order, under a row lock), and given back if that order is cancelled or refunded.
create table gift_cards (
  id uuid primary key,
  -- Normalised: 12 characters, upper case, no dashes (shown as XXXX-XXXX-XXXX).
  code text not null unique,
  -- The order that bought it (deleted with it, like every order of a deleted account).
  order_id uuid not null unique references orders (id) on delete cascade,
  currency text not null check (currency in ('BRL', 'EUR', 'USD')),
  amount integer not null check (amount > 0),
  -- active: can be spent · redeemed: spent on redeemed_order_id · void: its purchase was refunded
  status text not null default 'active' check (status in ('active', 'redeemed', 'void')),
  redeemed_order_id uuid references orders (id) on delete set null,
  redeemed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index gift_cards_redeemed_order_idx on gift_cards (redeemed_order_id);
