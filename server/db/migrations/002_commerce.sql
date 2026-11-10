-- Commerce: heritage map orders (one design, one product per order), their status history, and
-- the webhook events already handled (so a redelivered event changes nothing).

create sequence order_number_seq start 1001;

create table orders (
  id uuid primary key,
  -- Human-friendly reference shown to customers and labs, e.g. HM-1001.
  number text not null unique default ('HM-' || nextval('order_number_seq')),
  owner_id uuid not null references users (id) on delete cascade,
  -- Kept when the tree is deleted: the order (and its print file) is a business record.
  tree_id uuid references trees (id) on delete set null,
  product_id text not null,
  kind text not null check (kind in ('digital', 'print', 'framed')),
  size text not null check (size in ('A3', 'A2', 'A1')),
  frame_colour text,
  -- The designer's choices (DesignSpec, src/commerce/design.ts). Never people's data.
  design jsonb not null,
  currency text not null check (currency in ('BRL', 'EUR', 'USD')),
  -- Minor units (cents), worked out by the server from the catalogue.
  unit_amount integer not null check (unit_amount >= 0),
  shipping_amount integer not null default 0 check (shipping_amount >= 0),
  total_amount integer not null check (total_amount >= 0),
  refunded_amount integer not null default 0 check (refunded_amount >= 0),
  country text not null,
  market text not null,
  -- prodigi | manual for physical products, null for digital ones.
  fulfilment text check (fulfilment in ('prodigi', 'manual')),
  sku text,
  email text not null,
  -- { name, line1, line2, city, state, postalCode, country, phone, taxId }; null for digital.
  shipping_address jsonb,
  status text not null default 'created'
    check (status in ('created', 'paid', 'file_ready', 'sent_to_production', 'shipped', 'delivered', 'cancelled', 'refunded')),
  stripe_session_id text unique,
  stripe_payment_intent text,
  -- Storage keys of the print files (orders/<id>/print.png etc.).
  files jsonb not null default '{}',
  file_error text,
  -- The partner's order id and status, tracking numbers.
  fulfilment_ref text,
  fulfilment_status text,
  tracking jsonb not null default '[]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index orders_owner_idx on orders (owner_id, created_at desc);
create index orders_status_idx on orders (status);
create index orders_fulfilment_ref_idx on orders (fulfilment_ref);

create table order_events (
  id bigserial primary key,
  order_id uuid not null references orders (id) on delete cascade,
  from_status text,
  to_status text,
  -- customer | stripe | system | operator | prodigi
  actor text not null,
  note text,
  created_at timestamptz not null default now()
);
create index order_events_order_idx on order_events (order_id, id);

-- Webhook events already processed, per provider (Stripe and Prodigi retry deliveries).
create table webhook_events (
  provider text not null,
  event_id text not null,
  received_at timestamptz not null default now(),
  primary key (provider, event_id)
);
