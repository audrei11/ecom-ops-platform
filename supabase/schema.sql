-- =============================================================================
-- Ecom Ops Platform — Supabase Schema
-- =============================================================================

-- Enable UUID generation
create extension if not exists "pgcrypto";

-- =============================================================================
-- ENUMS
-- =============================================================================

create type order_status as enum (
  'pending',
  'processing',
  'batched',
  'in_production',
  'completed',
  'cancelled'
);

create type batch_status as enum (
  'open',
  'submitted',
  'in_production',
  'completed'
);

create type restock_status as enum (
  'pending',
  'approved',
  'ordered',
  'received'
);

-- =============================================================================
-- FACTORIES
-- Must exist before products (FK dependency)
-- =============================================================================

create table factories (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  production_cycle_weeks integer not null default 5,  -- e.g., 5 or 12 weeks
  contact_email         text,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- =============================================================================
-- PRODUCTS
-- =============================================================================

create table products (
  id                    uuid primary key default gen_random_uuid(),
  shopify_product_id    text unique,                  -- null for non-Shopify products
  sku                   text not null unique,
  name                  text not null,
  factory_id            uuid references factories(id) on delete set null,
  lead_time_weeks       integer not null default 5,
  safety_stock_units    integer not null default 0,
  is_bespoke            boolean not null default false,
  unit_cost             numeric(10, 2),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index idx_products_sku on products(sku);
create index idx_products_shopify_id on products(shopify_product_id);
create index idx_products_factory on products(factory_id);

-- =============================================================================
-- INVENTORY
-- One row per product — single source of truth for stock levels
-- =============================================================================

create table inventory (
  id                    uuid primary key default gen_random_uuid(),
  product_id            uuid not null unique references products(id) on delete cascade,
  quantity_on_hand      integer not null default 0 check (quantity_on_hand >= 0),
  quantity_reserved     integer not null default 0 check (quantity_reserved >= 0),
  -- quantity_available is computed: on_hand - reserved
  last_restocked_at     timestamptz,
  updated_at            timestamptz not null default now(),

  constraint chk_reserved_lte_on_hand
    check (quantity_reserved <= quantity_on_hand)
);

create index idx_inventory_product on inventory(product_id);

-- Computed column helper (readable view)
create view inventory_with_available as
  select
    i.*,
    p.sku,
    p.name as product_name,
    p.factory_id,
    (i.quantity_on_hand - i.quantity_reserved) as quantity_available
  from inventory i
  join products p on p.id = i.product_id;

-- =============================================================================
-- ORDERS
-- =============================================================================

create table orders (
  id                    uuid primary key default gen_random_uuid(),
  shopify_order_id      text unique,                  -- idempotency key
  shopify_order_number  text,                         -- human-readable (#1001)
  status                order_status not null default 'pending',
  customer_email        text,
  customer_name         text,
  total_price           numeric(10, 2),
  currency              text not null default 'GBP',
  is_bespoke            boolean not null default false,
  notes                 text,
  raw_payload           jsonb,                        -- full Shopify webhook payload
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index idx_orders_shopify_id on orders(shopify_order_id);
create index idx_orders_status on orders(status);
create index idx_orders_created on orders(created_at desc);

-- =============================================================================
-- ORDER ITEMS
-- =============================================================================

create table order_items (
  id                        uuid primary key default gen_random_uuid(),
  order_id                  uuid not null references orders(id) on delete cascade,
  product_id                uuid references products(id) on delete set null,
  shopify_variant_id        text,
  sku                       text,                     -- denormalised for resilience
  product_name              text,                     -- denormalised for resilience
  quantity                  integer not null check (quantity > 0),
  unit_price                numeric(10, 2),
  customization_details     jsonb,                    -- bespoke order specs
  created_at                timestamptz not null default now()
);

create index idx_order_items_order on order_items(order_id);
create index idx_order_items_product on order_items(product_id);

-- =============================================================================
-- FACTORY BATCHES
-- =============================================================================

create table factory_batches (
  id                    uuid primary key default gen_random_uuid(),
  factory_id            uuid not null references factories(id) on delete restrict,
  batch_reference       text unique,                  -- e.g., "FAC001-2025-W14"
  cycle_start_date      date,
  cycle_end_date        date,
  status                batch_status not null default 'open',
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index idx_factory_batches_factory on factory_batches(factory_id);
create index idx_factory_batches_status on factory_batches(status);

-- =============================================================================
-- BATCH ORDER ITEMS (junction: batches ↔ order_items)
-- Tracks which specific line items are in each batch
-- =============================================================================

create table batch_order_items (
  id                    uuid primary key default gen_random_uuid(),
  batch_id              uuid not null references factory_batches(id) on delete cascade,
  order_item_id         uuid not null references order_items(id) on delete cascade,
  created_at            timestamptz not null default now(),

  unique (batch_id, order_item_id)
);

create index idx_batch_order_items_batch on batch_order_items(batch_id);
create index idx_batch_order_items_item on batch_order_items(order_item_id);

-- =============================================================================
-- RESTOCK RECOMMENDATIONS
-- =============================================================================

create table restock_recommendations (
  id                    uuid primary key default gen_random_uuid(),
  product_id            uuid not null references products(id) on delete cascade,
  current_stock         integer not null,
  avg_daily_sales       numeric(8, 4) not null,
  lead_time_days        integer not null,
  safety_stock          integer not null,
  recommended_quantity  integer not null,
  calculation_window_days integer not null default 30,  -- days of sales data used
  status                restock_status not null default 'pending',
  calculated_at         timestamptz not null default now(),
  approved_at           timestamptz,
  notes                 text
);

create index idx_restock_product on restock_recommendations(product_id);
create index idx_restock_status on restock_recommendations(status);
create index idx_restock_calculated on restock_recommendations(calculated_at desc);

-- =============================================================================
-- AUTO-UPDATE updated_at TRIGGER
-- =============================================================================

create or replace function trigger_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_updated_at before update on factories
  for each row execute function trigger_set_updated_at();

create trigger set_updated_at before update on products
  for each row execute function trigger_set_updated_at();

create trigger set_updated_at before update on inventory
  for each row execute function trigger_set_updated_at();

create trigger set_updated_at before update on orders
  for each row execute function trigger_set_updated_at();

create trigger set_updated_at before update on factory_batches
  for each row execute function trigger_set_updated_at();

-- =============================================================================
-- ATOMIC INVENTORY DEDUCTION (RPC — called from application layer)
-- Uses advisory lock to prevent race conditions on concurrent order processing
-- =============================================================================

create or replace function deduct_inventory(
  p_product_id  uuid,
  p_quantity    integer
)
returns jsonb
language plpgsql
as $$
declare
  v_available integer;
  v_on_hand   integer;
  v_reserved  integer;
begin
  -- Row-level lock to prevent concurrent deductions on same product
  select quantity_on_hand, quantity_reserved
  into v_on_hand, v_reserved
  from inventory
  where product_id = p_product_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'product_not_found');
  end if;

  v_available := v_on_hand - v_reserved;

  if v_available < p_quantity then
    return jsonb_build_object(
      'success',   false,
      'error',     'insufficient_stock',
      'available', v_available,
      'requested', p_quantity
    );
  end if;

  update inventory
  set
    quantity_on_hand  = quantity_on_hand - p_quantity,
    updated_at        = now()
  where product_id = p_product_id;

  return jsonb_build_object(
    'success',       true,
    'deducted',      p_quantity,
    'remaining',     v_on_hand - p_quantity - v_reserved
  );
end;
$$;

-- =============================================================================
-- RESERVE INVENTORY (soft reserve — does not reduce on_hand)
-- Used when order is accepted but not yet fulfilled
-- =============================================================================

create or replace function reserve_inventory(
  p_product_id  uuid,
  p_quantity    integer
)
returns jsonb
language plpgsql
as $$
declare
  v_available integer;
begin
  select quantity_on_hand - quantity_reserved
  into v_available
  from inventory
  where product_id = p_product_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'product_not_found');
  end if;

  if v_available < p_quantity then
    return jsonb_build_object(
      'success',   false,
      'error',     'insufficient_stock',
      'available', v_available,
      'requested', p_quantity
    );
  end if;

  update inventory
  set
    quantity_reserved = quantity_reserved + p_quantity,
    updated_at        = now()
  where product_id = p_product_id;

  return jsonb_build_object('success', true, 'reserved', p_quantity);
end;
$$;

-- =============================================================================
-- ROW LEVEL SECURITY (enable but keep permissive for service-role key usage)
-- Tighten these policies before going to production
-- =============================================================================

alter table orders enable row level security;
alter table order_items enable row level security;
alter table products enable row level security;
alter table inventory enable row level security;
alter table factories enable row level security;
alter table factory_batches enable row level security;
alter table batch_order_items enable row level security;
alter table restock_recommendations enable row level security;

-- Service role bypasses RLS — these policies are for anon/authenticated roles
-- Add specific policies here when you introduce user auth

-- Example: allow service role full access (Supabase service_role key bypasses RLS by default)
