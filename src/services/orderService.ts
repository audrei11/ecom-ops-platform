import { tryGetDb } from '@/lib/supabase';
import * as mockDb from '@/lib/mockDb';

import {
  bulkReserveInventory,
  resolveProductsBySku,
} from './inventoryService';
import type {
  IngestOrderRequest,
  IngestOrderResponse,
  Order,
  OrderItem,
  ShopifyLineItem,
  ShopifyOrderPayload,
  ServiceResult,
} from '@/lib/types';

// =============================================================================
// Order Service
// Handles ingestion, normalisation, and idempotent storage of orders.
// =============================================================================

// ---------------------------
// Normalised intermediate shape
// ---------------------------

interface NormalisedOrder {
  shopify_order_id: string | null;
  shopify_order_number: string | null;
  customer_email: string | null;
  customer_name: string | null;
  total_price: number | null;
  currency: string;
  is_bespoke: boolean;
  notes: string | null;
  raw_payload: ShopifyOrderPayload | Record<string, unknown> | null;
  items: NormalisedItem[];
}

interface NormalisedItem {
  shopify_variant_id: string | null;
  sku: string | null;
  product_name: string;
  quantity: number;
  unit_price: number | null;
  customization_details: Record<string, unknown> | null;
}

// ---------------------------
// Normalisation helpers
// ---------------------------

function normaliseShopifyOrder(payload: ShopifyOrderPayload): NormalisedOrder {
  const customerName = payload.customer
    ? `${payload.customer.first_name} ${payload.customer.last_name}`.trim()
    : null;

  const items: NormalisedItem[] = payload.line_items.map(
    (li: ShopifyLineItem) => {
      const customization: Record<string, unknown> | null =
        li.properties?.length > 0
          ? Object.fromEntries(li.properties.map((p) => [p.name, p.value]))
          : null;

      return {
        shopify_variant_id: li.variant_id ? String(li.variant_id) : null,
        sku: li.sku ?? null,
        product_name: li.title,
        quantity: li.quantity,
        unit_price: parseFloat(li.price),
        customization_details: customization,
      };
    }
  );

  const isBespoke = items.some((i) => i.customization_details !== null);

  return {
    shopify_order_id: String(payload.id),
    shopify_order_number: payload.name,
    customer_email: payload.email,
    customer_name: customerName,
    total_price: parseFloat(payload.total_price),
    currency: payload.currency,
    is_bespoke: isBespoke,
    notes: payload.note ?? null,
    raw_payload: payload,
    items,
  };
}

function normaliseManualOrder(
  manual: NonNullable<IngestOrderRequest['manual']>
): NormalisedOrder {
  const items: NormalisedItem[] = manual.items.map((i) => ({
    shopify_variant_id: null,
    sku: i.sku,
    product_name: i.sku,
    quantity: i.quantity,
    unit_price: i.unit_price ?? null,
    customization_details: i.customization_details ?? null,
  }));

  const isBespoke =
    manual.is_bespoke ?? items.some((i) => i.customization_details !== null);

  return {
    shopify_order_id: null,
    shopify_order_number: null,
    customer_email: manual.customer_email ?? null,
    customer_name: manual.customer_name ?? null,
    total_price: null,
    currency: manual.currency ?? 'GBP',
    is_bespoke: isBespoke,
    notes: manual.notes ?? null,
    raw_payload: null,
    items,
  };
}

// ---------------------------
// Enrich product names from DB
// ---------------------------

async function enrichItemsWithProductData(
  items: NormalisedItem[]
): Promise<{
  enriched: Array<NormalisedItem & { product_id: string | null }>;
  unknownSkus: string[];
}> {
  const skus = items
    .map((i) => i.sku)
    .filter((s): s is string => s !== null);

  if (skus.length === 0) {
    return {
      enriched: items.map((i) => ({ ...i, product_id: null })),
      unknownSkus: [],
    };
  }

  const resolveResult = await resolveProductsBySku(skus);
  const productMap = resolveResult.success ? resolveResult.data : new Map();
  const unknownSkus: string[] = [];

  const enriched = items.map((item) => {
    if (!item.sku) return { ...item, product_id: null };

    const product = productMap.get(item.sku);
    if (!product) {
      unknownSkus.push(item.sku);
      return { ...item, product_id: null };
    }

    return {
      ...item,
      product_id: product.id,
      product_name: item.product_name === item.sku ? product.id : item.product_name,
    };
  });

  return { enriched, unknownSkus };
}

// ---------------------------
// Core ingest logic
// ---------------------------

export async function ingestOrder(
  request: IngestOrderRequest
): Promise<ServiceResult<IngestOrderResponse>> {
  const db = tryGetDb();

  // ---- Mock DB path ----------------------------------------------------------
  if (!db) {
    console.log('[orderService] Using MOCK DB');

    // 1. Normalise input
    let normalised: NormalisedOrder;
    if (request.shopify) {
      normalised = normaliseShopifyOrder(request.shopify);
    } else if (request.manual) {
      normalised = normaliseManualOrder(request.manual);
    } else {
      return { success: false, error: 'Request must include shopify or manual payload' };
    }

    // 2. Idempotency check
    if (normalised.shopify_order_id) {
      const existing = mockDb.findOrderByShopifyId(normalised.shopify_order_id);
      if (existing) {
        return {
          success: true,
          data: {
            success: true,
            order_id: existing.id,
            duplicate: true,
            message: 'Order already processed',
          },
        };
      }
    }

    // 3. Enrich items with product IDs
    const skus = normalised.items
      .map((i) => i.sku)
      .filter((s): s is string => s !== null);
    const productMap = skus.length > 0 ? mockDb.getProductsBySku(skus) : new Map();

    const enrichedItems = normalised.items.map((item) => {
      if (!item.sku) return { ...item, product_id: null };
      const product = productMap.get(item.sku);
      return {
        ...item,
        product_id: product?.id ?? null,
        product_name:
          item.product_name === item.sku && product ? product.sku : item.product_name,
      };
    });

    // 3b. Upgrade is_bespoke: inherit from product flag even if no customization_details
    const isBespoke =
      normalised.is_bespoke ||
      enrichedItems.some(
        (i) => i.product_id !== null && mockDb.isProductBespoke(i.product_id)
      );

    // 4. Insert order
    const order = mockDb.insertOrder({
      shopify_order_id:     normalised.shopify_order_id,
      shopify_order_number: normalised.shopify_order_number,
      status:               'pending',
      customer_email:       normalised.customer_email,
      customer_name:        normalised.customer_name,
      total_price:          normalised.total_price,
      currency:             normalised.currency,
      is_bespoke:           isBespoke,
      notes:                normalised.notes,
      raw_payload:          normalised.raw_payload,
    });

    // 5. Insert order items
    mockDb.insertOrderItems(
      enrichedItems.map((item) => ({
        order_id:              order.id,
        product_id:            item.product_id ?? null,
        shopify_variant_id:    item.shopify_variant_id,
        sku:                   item.sku,
        product_name:          item.product_name,
        quantity:              item.quantity,
        unit_price:            item.unit_price,
        customization_details: item.customization_details,
      }))
    );

    // 6. Reserve inventory for known products (non-fatal)
    const itemsWithProducts = enrichedItems.filter(
      (i): i is typeof i & { product_id: string; sku: string } =>
        i.product_id !== null && i.sku !== null
    );

    const inventoryErrors: IngestOrderResponse['errors'] = [];
    for (const item of itemsWithProducts) {
      const result = mockDb.reserveInventory(item.product_id, item.quantity);
      if (!result.success) {
        inventoryErrors.push({
          sku: item.sku,
          product_id: item.product_id,
          requested: item.quantity,
          available: result.available ?? 0,
        });
      }
    }

    // 7. Advance status to 'processing'
    mockDb.updateOrderStatus(order.id, 'processing');

    return {
      success: true,
      data: {
        success: true,
        order_id: order.id,
        duplicate: false,
        errors: inventoryErrors.length > 0 ? inventoryErrors : undefined,
        message:
          inventoryErrors.length > 0
            ? 'Order created with inventory warnings'
            : 'Order created successfully',
      },
    };
  }

  // ---- Supabase path ---------------------------------------------------------

  // 1. Normalise input
  let normalised: NormalisedOrder;

  if (request.shopify) {
    normalised = normaliseShopifyOrder(request.shopify);
  } else if (request.manual) {
    normalised = normaliseManualOrder(request.manual);
  } else {
    return { success: false, error: 'Request must include shopify or manual payload' };
  }

  // 2. Idempotency check — if we've seen this Shopify order before, return early
  if (normalised.shopify_order_id) {
    const { data: existing } = await db
      .from('orders')
      .select('id')
      .eq('shopify_order_id', normalised.shopify_order_id)
      .maybeSingle();

    if (existing) {
      return {
        success: true,
        data: {
          success: true,
          order_id: existing.id,
          duplicate: true,
          message: 'Order already processed',
        },
      };
    }
  }

  // 3. Enrich items with product IDs from our DB
  const { enriched: enrichedItems } = await enrichItemsWithProductData(
    normalised.items
  );

  // 4. Insert order row
  const { data: orderRow, error: orderError } = await db
    .from('orders')
    .insert({
      shopify_order_id:     normalised.shopify_order_id,
      shopify_order_number: normalised.shopify_order_number,
      status:               'pending',
      customer_email:       normalised.customer_email,
      customer_name:        normalised.customer_name,
      total_price:          normalised.total_price,
      currency:             normalised.currency,
      is_bespoke:           normalised.is_bespoke,
      notes:                normalised.notes,
      raw_payload:          normalised.raw_payload,
    })
    .select('id')
    .single();

  if (orderError || !orderRow) {
    console.error('[orderService] Failed to insert order:', orderError);
    return { success: false, error: orderError?.message ?? 'Failed to create order' };
  }

  const orderId = orderRow.id as string;

  // 5. Insert order items
  const itemInserts = enrichedItems.map((item) => ({
    order_id:               orderId,
    product_id:             item.product_id ?? null,
    shopify_variant_id:     item.shopify_variant_id,
    sku:                    item.sku,
    product_name:           item.product_name,
    quantity:               item.quantity,
    unit_price:             item.unit_price,
    customization_details:  item.customization_details,
  }));

  const { error: itemsError } = await db.from('order_items').insert(itemInserts);

  if (itemsError) {
    console.error('[orderService] Failed to insert order items:', itemsError);
    await db
      .from('orders')
      .update({ status: 'cancelled', notes: 'Item insertion failed' })
      .eq('id', orderId);
    return { success: false, error: itemsError.message };
  }

  // 6. Reserve inventory for known products
  const itemsWithProducts = enrichedItems.filter(
    (i): i is typeof i & { product_id: string; sku: string } =>
      i.product_id !== null && i.sku !== null
  );

  let inventoryErrors: IngestOrderResponse['errors'] = [];

  if (itemsWithProducts.length > 0) {
    const reserveResult = await bulkReserveInventory(
      itemsWithProducts.map((i) => ({
        product_id: i.product_id,
        sku: i.sku,
        quantity: i.quantity,
      }))
    );

    if (!reserveResult.success) {
      console.error('[orderService] Inventory reservation failed:', reserveResult.error);
    } else if (!reserveResult.data.allSucceeded) {
      inventoryErrors = reserveResult.data.errors;
    }
  }

  // 7. Advance order status to 'processing'
  await db
    .from('orders')
    .update({ status: 'processing' })
    .eq('id', orderId);

  return {
    success: true,
    data: {
      success: true,
      order_id: orderId,
      duplicate: false,
      errors: inventoryErrors.length > 0 ? inventoryErrors : undefined,
      message:
        inventoryErrors.length > 0
          ? 'Order created with inventory warnings'
          : 'Order created successfully',
    },
  };
}

// ---------------------------
// Query helpers
// ---------------------------

export interface ListOrdersOptions {
  status?: string;
  limit?: number;
  offset?: number;
}

export interface OrderSummary extends Order {
  items: OrderItem[];
}

export async function listOrders(
  options: ListOrdersOptions = {}
): Promise<ServiceResult<OrderSummary[]>> {
  const db = tryGetDb();
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;

  if (!db) {
    console.log('[orderService] Using MOCK DB');
    const rows = mockDb.getOrders({ status: options.status, limit, offset });
    const orderIds = rows.map((o) => o.id);
    const items = mockDb.getOrderItemsByOrderIds(orderIds);
    const itemsByOrder = new Map<string, OrderItem[]>();
    for (const item of items) {
      const existing = itemsByOrder.get(item.order_id) ?? [];
      existing.push(item);
      itemsByOrder.set(item.order_id, existing);
    }
    const result: OrderSummary[] = rows.map((o) => ({
      ...o,
      items: itemsByOrder.get(o.id) ?? [],
    }));
    return { success: true, data: result };
  }

  let query = db
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (options.status) {
    query = query.eq('status', options.status);
  }

  const { data: orders, error: ordersError } = await query;

  if (ordersError) {
    return { success: false, error: ordersError.message };
  }

  if (!orders || orders.length === 0) {
    return { success: true, data: [] };
  }

  const orderIds = orders.map((o: Order) => o.id);
  const { data: items, error: itemsError } = await db
    .from('order_items')
    .select('*')
    .in('order_id', orderIds);

  if (itemsError) {
    return { success: false, error: itemsError.message };
  }

  const itemsByOrder = new Map<string, OrderItem[]>();
  for (const item of items ?? []) {
    const existing = itemsByOrder.get(item.order_id) ?? [];
    existing.push(item as OrderItem);
    itemsByOrder.set(item.order_id, existing);
  }

  const result: OrderSummary[] = orders.map((o: Order) => ({
    ...(o as Order),
    items: itemsByOrder.get(o.id) ?? [],
  }));

  return { success: true, data: result };
}

export async function getOrderById(
  id: string
): Promise<ServiceResult<Order & { items: OrderItem[] }>> {
  const db = tryGetDb();

  if (!db) {
    console.log('[orderService] Using MOCK DB');
    const order = mockDb.getOrderWithItemsById(id);
    if (!order) return { success: false, error: 'Order not found' };
    return { success: true, data: order };
  }

  const { data: order, error: orderError } = await db
    .from('orders')
    .select('*')
    .eq('id', id)
    .single();

  if (orderError) {
    if (orderError.code === 'PGRST116') {
      return { success: false, error: 'Order not found' };
    }
    return { success: false, error: orderError.message };
  }

  const { data: items, error: itemsError } = await db
    .from('order_items')
    .select('*')
    .eq('order_id', id)
    .order('created_at', { ascending: true });

  if (itemsError) {
    return { success: false, error: itemsError.message };
  }

  return {
    success: true,
    data: { ...(order as Order), items: (items ?? []) as OrderItem[] },
  };
}
