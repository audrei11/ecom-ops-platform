// =============================================================================
// Mock In-Memory Database
// Fallback when Supabase is not configured.
// All state lives in module-level arrays — persists for one server process lifetime.
// =============================================================================

import type {
  InventoryWithAvailable,
  Order,
  OrderItem,
  OrderStatus,
  FactoryBatch,
  BatchStatus,
} from './types';

console.log(
  '[mockDb] ⚠️  Using MOCK DB — Supabase is not configured. ' +
  'Data resets on server restart. Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to use real DB.'
);

// ---- ID generator -----------------------------------------------------------

function genId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// =============================================================================
// Internal types
// =============================================================================

interface MockFactory {
  id: string;
  name: string;
  production_cycle_weeks: number;  // how long a batch takes to produce
  contact_email: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface MockProduct {
  id: string;
  sku: string;
  name: string;
  factory_id: string | null;        // which factory makes this
  lead_time_weeks: number;          // weeks from order to delivery
  safety_stock_units: number;       // buffer to keep in stock
  is_bespoke: boolean;              // requires custom production
  unit_cost: number | null;
  shopify_product_id: string | null;
  created_at: string;
  updated_at: string;
}

interface MockInventory {
  id: string;
  product_id: string;
  quantity_on_hand: number;
  quantity_reserved: number;        // committed to open orders
  last_restocked_at: string | null;
  updated_at: string;
}

interface MockBatchOrderItem {
  id: string;
  batch_id: string;
  order_item_id: string;
  created_at: string;
}

// =============================================================================
// Seed data
// =============================================================================

const SEED_DATE     = new Date().toISOString();
const ONE_WEEK_AGO  = new Date(Date.now() - 7  * 24 * 60 * 60 * 1000).toISOString();
const TWO_WEEKS_AGO = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

// ---- Factories --------------------------------------------------------------

const factories: MockFactory[] = [
  {
    id:                     'mock-factory-001',
    name:                   'London Atelier',
    production_cycle_weeks: 5,
    contact_email:          'ops@london-atelier.example',
    notes:                  'Standard jewellery production. 5-week cycle.',
    created_at:             SEED_DATE,
    updated_at:             SEED_DATE,
  },
  {
    id:                     'mock-factory-002',
    name:                   'Milan Studio',
    production_cycle_weeks: 12,
    contact_email:          'production@milan-studio.example',
    notes:                  'Bespoke & engraved pieces. 12-week cycle.',
    created_at:             SEED_DATE,
    updated_at:             SEED_DATE,
  },
];

// ---- Products ---------------------------------------------------------------
// SKU format: {TYPE}-{VARIANT}-{SIZE}
// All are assigned to a factory so the batching system can work immediately.

const products: MockProduct[] = [
  {
    id:                   'mock-prod-001',
    sku:                  'RING-GOLD-S',
    name:                 'Gold Ring — Small',
    factory_id:           'mock-factory-001',   // London Atelier
    lead_time_weeks:      4,
    safety_stock_units:   10,
    is_bespoke:           false,
    unit_cost:            45.0,
    shopify_product_id:   null,
    created_at:           SEED_DATE,
    updated_at:           SEED_DATE,
  },
  {
    id:                   'mock-prod-002',
    sku:                  'NECK-SILVER-M',
    name:                 'Silver Necklace — Medium',
    factory_id:           'mock-factory-001',   // London Atelier
    lead_time_weeks:      6,
    safety_stock_units:   5,
    is_bespoke:           false,
    unit_cost:            35.0,
    shopify_product_id:   null,
    created_at:           SEED_DATE,
    updated_at:           SEED_DATE,
  },
  {
    id:                   'mock-prod-003',
    sku:                  'BRACE-ENGR-L',
    name:                 'Engraved Bracelet — Large',
    factory_id:           'mock-factory-002',   // Milan Studio (bespoke)
    lead_time_weeks:      8,
    safety_stock_units:   3,
    is_bespoke:           true,
    unit_cost:            75.0,
    shopify_product_id:   null,
    created_at:           SEED_DATE,
    updated_at:           SEED_DATE,
  },
];

// ---- Inventory (mutable) ----------------------------------------------------

const inventory: MockInventory[] = [
  {
    id:                 'mock-inv-001',
    product_id:         'mock-prod-001',
    quantity_on_hand:   50,
    quantity_reserved:  2,
    last_restocked_at:  ONE_WEEK_AGO,
    updated_at:         SEED_DATE,
  },
  {
    id:                 'mock-inv-002',
    product_id:         'mock-prod-002',
    quantity_on_hand:   8,
    quantity_reserved:  1,
    last_restocked_at:  TWO_WEEKS_AGO,
    updated_at:         SEED_DATE,
  },
  {
    id:                 'mock-inv-003',
    product_id:         'mock-prod-003',
    quantity_on_hand:   3,
    quantity_reserved:  0,
    last_restocked_at:  null,
    updated_at:         SEED_DATE,
  },
];

// ---- Orders (mutable) -------------------------------------------------------

const orders: Order[] = [];
const orderItems: OrderItem[] = [];

// ---- Factory batches (mutable) ----------------------------------------------

const batches: FactoryBatch[] = [];
const batchOrderItems: MockBatchOrderItem[] = [];

// =============================================================================
// Internal helpers
// =============================================================================

function buildInventoryRow(
  inv: MockInventory,
  product: MockProduct
): InventoryWithAvailable {
  return {
    id:                  inv.id,
    product_id:          inv.product_id,
    quantity_on_hand:    inv.quantity_on_hand,
    quantity_reserved:   inv.quantity_reserved,
    last_restocked_at:   inv.last_restocked_at,
    updated_at:          inv.updated_at,
    sku:                 product.sku,
    product_name:        product.name,
    factory_id:          product.factory_id,
    quantity_available:  inv.quantity_on_hand - inv.quantity_reserved,
  };
}

function getISOWeek(date: Date): number {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

// =============================================================================
// Inventory reads
// =============================================================================

export function getAllInventoryWithAvailable(): InventoryWithAvailable[] {
  return inventory
    .map((inv) => {
      const product = products.find((p) => p.id === inv.product_id);
      if (!product) return null;
      return buildInventoryRow(inv, product);
    })
    .filter((x): x is InventoryWithAvailable => x !== null)
    .sort((a, b) => a.product_name.localeCompare(b.product_name));
}

export function getInventoryByProductId(
  productId: string
): InventoryWithAvailable | null {
  const inv = inventory.find((i) => i.product_id === productId);
  if (!inv) return null;
  const product = products.find((p) => p.id === productId);
  if (!product) return null;
  return buildInventoryRow(inv, product);
}

// =============================================================================
// Product lookups
// =============================================================================

export function getProductsBySku(
  skus: string[]
): Map<string, { id: string; sku: string }> {
  const map = new Map<string, { id: string; sku: string }>();
  for (const sku of skus) {
    const product = products.find((p) => p.sku === sku);
    if (product) map.set(sku, { id: product.id, sku: product.sku });
  }
  return map;
}

/**
 * Returns true if the product with this ID has is_bespoke = true.
 * Used during order ingestion to tag orders that involve bespoke products.
 */
export function isProductBespoke(productId: string): boolean {
  return products.find((p) => p.id === productId)?.is_bespoke ?? false;
}

// =============================================================================
// Inventory mutations
// =============================================================================

export function reserveInventory(
  productId: string,
  quantity: number
): { success: boolean; available?: number } {
  const inv = inventory.find((i) => i.product_id === productId);
  if (!inv) return { success: false, available: 0 };

  const available = inv.quantity_on_hand - inv.quantity_reserved;
  if (available < quantity) return { success: false, available };

  inv.quantity_reserved += quantity;
  inv.updated_at = new Date().toISOString();
  return { success: true };
}

export function deductInventory(
  productId: string,
  quantity: number
): { success: boolean; available?: number } {
  const inv = inventory.find((i) => i.product_id === productId);
  if (!inv) return { success: false, available: 0 };

  const available = inv.quantity_on_hand - inv.quantity_reserved;
  if (available < quantity) return { success: false, available };

  inv.quantity_on_hand -= quantity;
  inv.updated_at = new Date().toISOString();
  return { success: true };
}

// =============================================================================
// Order mutations
// =============================================================================

export function findOrderByShopifyId(shopifyOrderId: string): Order | null {
  return orders.find((o) => o.shopify_order_id === shopifyOrderId) ?? null;
}

export function insertOrder(
  data: Omit<Order, 'id' | 'created_at' | 'updated_at'>
): Order {
  const now = new Date().toISOString();
  const order: Order = { ...data, id: genId(), created_at: now, updated_at: now };
  orders.push(order);
  return order;
}

export function updateOrderStatus(orderId: string, status: OrderStatus): void {
  const order = orders.find((o) => o.id === orderId);
  if (order) {
    order.status = status;
    order.updated_at = new Date().toISOString();
  }
}

export function insertOrderItems(
  items: Omit<OrderItem, 'id' | 'created_at'>[]
): void {
  const now = new Date().toISOString();
  for (const item of items) {
    orderItems.push({ ...item, id: genId(), created_at: now });
  }
}

// =============================================================================
// Order reads
// =============================================================================

export function getOrders(options: {
  status?: string;
  limit: number;
  offset: number;
}): Order[] {
  let result = [...orders].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  if (options.status) {
    result = result.filter((o) => o.status === options.status);
  }
  return result.slice(options.offset, options.offset + options.limit);
}

export function getOrderItemsByOrderIds(orderIds: string[]): OrderItem[] {
  return orderItems.filter((i) => orderIds.includes(i.order_id));
}

export function getOrderWithItemsById(
  id: string
): (Order & { items: OrderItem[] }) | null {
  const order = orders.find((o) => o.id === id);
  if (!order) return null;
  const items = orderItems.filter((i) => i.order_id === id);
  return { ...order, items };
}

// =============================================================================
// Restock helpers
// =============================================================================

export interface MockProductWithInventory {
  id: string;
  sku: string;
  name: string;
  lead_time_weeks: number;
  safety_stock_units: number;
  inventory: Array<{ quantity_on_hand: number; quantity_reserved: number }>;
}

export function getProductsWithInventory(
  productIds?: string[]
): MockProductWithInventory[] {
  const filtered =
    productIds && productIds.length > 0
      ? products.filter((p) => productIds.includes(p.id))
      : products;

  return filtered.map((p) => {
    const inv = inventory.find((i) => i.product_id === p.id);
    return {
      id:                 p.id,
      sku:                p.sku,
      name:               p.name,
      lead_time_weeks:    p.lead_time_weeks,
      safety_stock_units: p.safety_stock_units,
      inventory: inv
        ? [{ quantity_on_hand: inv.quantity_on_hand, quantity_reserved: inv.quantity_reserved }]
        : [],
    };
  });
}

export function getOrderItemsSince(
  productIds: string[],
  since: Date
): Array<{ product_id: string; quantity: number; created_at: string }> {
  return orderItems
    .filter(
      (i) =>
        i.product_id !== null &&
        productIds.includes(i.product_id) &&
        new Date(i.created_at) >= since
    )
    .map((i) => ({
      product_id: i.product_id!,
      quantity:   i.quantity,
      created_at: i.created_at,
    }));
}

// =============================================================================
// Factory helpers
// =============================================================================

export function getFactories(): MockFactory[] {
  return [...factories];
}

export function getFactoryById(id: string): MockFactory | null {
  return factories.find((f) => f.id === id) ?? null;
}

// =============================================================================
// Batching
// =============================================================================

/** Items from orders in the given statuses that are not yet assigned to a batch */
export interface UnbatchedItem {
  id: string;               // orderItem.id
  order_id: string;
  product_id: string;
  sku: string | null;
  quantity: number;
  factory_id: string;
  factory_name: string;
  production_cycle_weeks: number;
}

export function getUnbatchedItems(orderStatuses: string[]): UnbatchedItem[] {
  const eligibleOrderIds = new Set(
    orders.filter((o) => orderStatuses.includes(o.status)).map((o) => o.id)
  );

  const batchedItemIds = new Set(batchOrderItems.map((b) => b.order_item_id));

  const result: UnbatchedItem[] = [];

  for (const item of orderItems) {
    if (!eligibleOrderIds.has(item.order_id)) continue;
    if (batchedItemIds.has(item.id)) continue;
    if (!item.product_id) continue;

    const product = products.find((p) => p.id === item.product_id);
    if (!product?.factory_id) continue;

    const factory = factories.find((f) => f.id === product.factory_id);
    if (!factory) continue;

    result.push({
      id:                      item.id,
      order_id:                item.order_id,
      product_id:              item.product_id,
      sku:                     item.sku,
      quantity:                item.quantity,
      factory_id:              factory.id,
      factory_name:            factory.name,
      production_cycle_weeks:  factory.production_cycle_weeks,
    });
  }

  return result;
}

/** Returns the most recent open batch for the given factory, or null */
export function getOpenBatch(factoryId: string): FactoryBatch | null {
  return (
    [...batches]
      .filter((b) => b.factory_id === factoryId && b.status === 'open')
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] ??
    null
  );
}

/** Create a new factory batch */
export function createBatch(data: {
  factory_id: string;
  batch_reference: string;
  cycle_start_date: string;
  cycle_end_date: string;
  status: BatchStatus;
}): FactoryBatch {
  const now = new Date().toISOString();
  const batch: FactoryBatch = {
    id:               genId(),
    factory_id:       data.factory_id,
    batch_reference:  data.batch_reference,
    cycle_start_date: data.cycle_start_date,
    cycle_end_date:   data.cycle_end_date,
    status:           data.status,
    notes:            null,
    created_at:       now,
    updated_at:       now,
  };
  batches.push(batch);
  return batch;
}

/** Assign order items to a batch */
export function addItemsToBatch(
  items: Array<{ batch_id: string; order_item_id: string }>
): void {
  const now = new Date().toISOString();
  const existingIds = new Set(batchOrderItems.map((b) => b.order_item_id));

  for (const item of items) {
    if (existingIds.has(item.order_item_id)) continue; // idempotent
    batchOrderItems.push({ id: genId(), ...item, created_at: now });
  }
}

/** List all batches, optionally filtered by factory */
export function listBatches(factoryId?: string): FactoryBatch[] {
  const result = factoryId
    ? batches.filter((b) => b.factory_id === factoryId)
    : [...batches];

  return result.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

/**
 * Returns batch details enriched with factory name and item count.
 * Used by the dashboard.
 */
export interface BatchSummary extends FactoryBatch {
  factory_name: string;
  item_count: number;
  order_count: number;
}

export function listBatchSummaries(factoryId?: string): BatchSummary[] {
  return listBatches(factoryId).map((batch) => {
    const factory = factories.find((f) => f.id === batch.factory_id);
    const itemsInBatch = batchOrderItems.filter((b) => b.batch_id === batch.id);
    const orderIds = new Set(
      itemsInBatch
        .map((b) => orderItems.find((i) => i.id === b.order_item_id)?.order_id)
        .filter(Boolean)
    );

    return {
      ...batch,
      factory_name: factory?.name ?? batch.factory_id,
      item_count:   itemsInBatch.length,
      order_count:  orderIds.size,
    };
  });
}

/** Expose the ISO week helper for use in factoryService */
export { getISOWeek };
