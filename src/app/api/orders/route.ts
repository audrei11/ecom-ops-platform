import { NextRequest, NextResponse } from 'next/server';
import { getNeonSql } from '@/lib/neon';
import { listOrders } from '@/services/orderService';
import { Errors } from '@/lib/errors';
import * as mockDb from '@/lib/mockDb';

// =============================================================================
// GET /api/orders
// =============================================================================

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status') ?? undefined;
  const limit = parseInt(searchParams.get('limit') ?? '50', 10);
  const offset = parseInt(searchParams.get('offset') ?? '0', 10);

  if (isNaN(limit) || limit < 1 || limit > 200) {
    return Errors.badRequest('limit must be between 1 and 200');
  }

  const result = await listOrders({ status, limit, offset });

  if (!result.success) {
    return Errors.internal(result.error);
  }

  return NextResponse.json({ orders: result.data, total: result.data.length }, { status: 200 });
}

// =============================================================================
// POST /api/orders
// Accepts: { items: [{ sku, qty }], customer_name?, customer_email? }
// =============================================================================

export async function POST(req: Request) {
  console.log('[POST /api/orders] Request received');

  // ── 1. Parse body ─────────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    const text = await req.text();
    console.log('[POST /api/orders] Raw body:', text);
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch (err) {
    console.error('[POST /api/orders] Failed to parse body:', err);
    return new Response(
      JSON.stringify({ error: 'Invalid JSON body' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // ── 2. Validate items ──────────────────────────────────────────────────────
  const rawItems = body.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return new Response(
      JSON.stringify({ error: 'items must be a non-empty array' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const sql = getNeonSql();

  // ── 3a. NEON path (persistent DB) ─────────────────────────────────────────
  if (sql) {
    console.log('[POST /api/orders] Using Neon DB');
    try {
      const updated: Array<{
        sku: string;
        qty: number;
        status: string;
        stock_before?: number;
        stock_after?: number;
      }> = [];

      // Insert order record
      const customerName  = body.customer_name  as string ?? null;
      const customerEmail = body.customer_email as string ?? null;

      const [orderRow] = await sql`
        insert into orders (customer_name, customer_email, status, currency)
        values (${customerName}, ${customerEmail}, 'processing', 'GBP')
        returning id
      `;
      const orderId = orderRow.id as string;
      console.log('[POST /api/orders] Order created:', orderId);

      for (const raw of rawItems as Record<string, unknown>[]) {
        const sku = String(raw.sku ?? '');
        const qty = Number(raw.qty ?? raw.quantity ?? 0);

        console.log(`[POST /api/orders] Updating SKU: ${sku}  QTY: ${qty}`);

        if (!sku || qty < 1) {
          updated.push({ sku, qty, status: 'invalid' });
          continue;
        }

        // Find product by SKU
        const [product] = await sql`
          select p.id, i.quantity_on_hand, i.quantity_reserved
          from products p
          join inventory i on i.product_id = p.id
          where p.sku = ${sku}
        `;

        if (!product) {
          console.warn(`[POST /api/orders] SKU not found: ${sku}`);
          updated.push({ sku, qty, status: 'sku_not_found' });
          continue;
        }

        const availableBefore = (product.quantity_on_hand as number) - (product.quantity_reserved as number);
        console.log(`[POST /api/orders] Before: available=${availableBefore}`);

        if (availableBefore < qty) {
          console.warn(`[POST /api/orders] Insufficient stock for ${sku}`);
          updated.push({ sku, qty, status: 'insufficient_stock', stock_before: availableBefore });
          continue;
        }

        // Reserve inventory
        await sql`
          update inventory
          set quantity_reserved = quantity_reserved + ${qty},
              updated_at = now()
          where product_id = ${product.id as string}
        `;

        const availableAfter = availableBefore - qty;
        console.log(`[POST /api/orders] After: available=${availableAfter}`);

        // Insert order item
        await sql`
          insert into order_items (order_id, product_id, sku, product_name, quantity)
          select ${orderId}, p.id, p.sku, p.name, ${qty}
          from products p where p.sku = ${sku}
        `;

        updated.push({ sku, qty, status: 'reserved', stock_before: availableBefore, stock_after: availableAfter });
      }

      console.log('[POST /api/orders] Done:', JSON.stringify(updated));
      return new Response(
        JSON.stringify({ success: true, order_id: orderId, updated }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );

    } catch (err) {
      console.error('[POST /api/orders] Neon error:', err);
      return new Response(
        JSON.stringify({ error: 'Database error', detail: String(err) }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  }

  // ── 3b. Mock DB path (local dev only) ─────────────────────────────────────
  console.log('[POST /api/orders] Using mock DB');

  const skus = (rawItems as Record<string, unknown>[]).map((i) => String(i.sku ?? ''));
  const productMap = mockDb.getProductsBySku(skus);

  const updated: Array<{
    sku: string;
    qty: number;
    status: string;
    stock_before?: number;
    stock_after?: number;
    available?: number;
  }> = [];

  for (const raw of rawItems as Record<string, unknown>[]) {
    const sku = String(raw.sku ?? '');
    const qty = Number(raw.qty ?? raw.quantity ?? 0);

    console.log(`[POST /api/orders] Updating SKU: ${sku}  QTY: ${qty}`);

    if (!sku || qty < 1) {
      updated.push({ sku, qty, status: 'invalid' });
      continue;
    }

    const product = productMap.get(sku);
    if (!product) {
      updated.push({ sku, qty, status: 'sku_not_found' });
      continue;
    }

    const invBefore = mockDb.getInventoryByProductId(product.id);
    const availableBefore = invBefore
      ? invBefore.quantity_on_hand - invBefore.quantity_reserved
      : 0;

    console.log(`[POST /api/orders] Before: available=${availableBefore}`);

    const result = mockDb.reserveInventory(product.id, qty);
    if (!result.success) {
      updated.push({ sku, qty, status: 'insufficient_stock', available: result.available });
      continue;
    }

    const availableAfter = availableBefore - qty;
    console.log(`[POST /api/orders] After: available=${availableAfter}`);

    updated.push({ sku, qty, status: 'reserved', stock_before: availableBefore, stock_after: availableAfter });
  }

  console.log('[POST /api/orders] Done:', JSON.stringify(updated));
  return new Response(
    JSON.stringify({ success: true, updated }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
