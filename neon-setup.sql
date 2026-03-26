-- =============================================================================
-- Ecom Ops Platform — Neon Schema + Seed Data
-- Run this in the Neon SQL Editor
-- =============================================================================

-- ENUMS
create type if not exists order_status as enum (
  'pending', 'processing', 'batched', 'in_production', 'completed', 'cancelled'
);

create type if not exists batch_status as enum (
  'open', 'submitted', 'in_production', 'completed'
);

-- FACTORIES
create table if not exists factories (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  production_cycle_weeks integer not null default 5,
  contact_email          text,
  notes                  text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- PRODUCTS
create table if not exists products (
  id                  uuid primary key default gen_random_uuid(),
  shopify_product_id  text unique,
  sku                 text not null unique,
  name                text not null,
  factory_id          uuid references factories(id) on delete set null,
  lead_time_weeks     integer not null default 5,
  safety_stock_units  integer not null default 0,
  is_bespoke          boolean not null default false,
  unit_cost           numeric(10,2),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- INVENTORY
create table if not exists inventory (
  id                 uuid primary key default gen_random_uuid(),
  product_id         uuid not null unique references products(id) on delete cascade,
  quantity_on_hand   integer not null default 0,
  quantity_reserved  integer not null default 0,
  last_restocked_at  timestamptz,
  updated_at         timestamptz not null default now()
);

create or replace view inventory_with_available as
  select
    i.*,
    p.sku,
    p.name as product_name,
    p.factory_id,
    (i.quantity_on_hand - i.quantity_reserved) as quantity_available
  from inventory i
  join products p on p.id = i.product_id;

-- ORDERS
create table if not exists orders (
  id                   uuid primary key default gen_random_uuid(),
  shopify_order_id     text unique,
  shopify_order_number text,
  status               order_status not null default 'pending',
  customer_email       text,
  customer_name        text,
  total_price          numeric(10,2),
  currency             text not null default 'GBP',
  is_bespoke           boolean not null default false,
  notes                text,
  raw_payload          jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- ORDER ITEMS
create table if not exists order_items (
  id                    uuid primary key default gen_random_uuid(),
  order_id              uuid not null references orders(id) on delete cascade,
  product_id            uuid references products(id) on delete set null,
  shopify_variant_id    text,
  sku                   text,
  product_name          text,
  quantity              integer not null,
  unit_price            numeric(10,2),
  customization_details jsonb,
  created_at            timestamptz not null default now()
);

-- =============================================================================
-- SEED DATA
-- =============================================================================

-- Factories
insert into factories (id, name, production_cycle_weeks)
values
  ('a1000000-0000-0000-0000-000000000001', 'London Atelier', 5),
  ('a1000000-0000-0000-0000-000000000002', 'Milan Studio', 12)
on conflict do nothing;

-- Products
insert into products (id, sku, name, factory_id, lead_time_weeks, safety_stock_units, is_bespoke)
values
  ('b1000000-0000-0000-0000-000000000001', 'RING-GOLD-S',   'Gold Ring — Small',          'a1000000-0000-0000-0000-000000000001', 5,  5,  false),
  ('b1000000-0000-0000-0000-000000000002', 'NECK-SILVER-M', 'Silver Necklace — Medium',   'a1000000-0000-0000-0000-000000000001', 7,  3,  false),
  ('b1000000-0000-0000-0000-000000000003', 'BRACE-ENGR-L',  'Engraved Bracelet — Large',  'a1000000-0000-0000-0000-000000000002', 12, 2,  true)
on conflict do nothing;

-- Inventory
insert into inventory (product_id, quantity_on_hand, quantity_reserved, last_restocked_at)
values
  ('b1000000-0000-0000-0000-000000000001', 50, 2,  now() - interval '8 days'),
  ('b1000000-0000-0000-0000-000000000002', 8,  1,  now() - interval '15 days'),
  ('b1000000-0000-0000-0000-000000000003', 3,  0,  null)
on conflict do nothing;
