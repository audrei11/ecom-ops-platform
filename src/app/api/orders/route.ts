import { NextRequest, NextResponse } from 'next/server';
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
// POST /api/orders — Step 1: inventory deduction
// Accepts: { items: [{ sku, qty }], order_id? }
// =============================================================================

export async function POST(req: Request) {
  console.log('[POST /api/orders] Request received');

  // ── 1. Read + parse body ────────────────────────────────────────────────────
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

  // ── 2. Validate items ───────────────────────────────────────────────────────
  const rawItems = body.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return new Response(
      JSON.stringify({ error: 'items must be a non-empty array' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // ── 3. Process each item ────────────────────────────────────────────────────
  const updated: Array<{
    sku: string;
    qty: number;
    status: 'reserved' | 'insufficient_stock' | 'sku_not_found';
    available?: number;
  }> = [];

  const skus = (rawItems as Record<string, unknown>[]).map((i) => String(i.sku));
  const productMap = mockDb.getProductsBySku(skus);

  console.log('[POST /api/orders] Processing', rawItems.length, 'items');

  for (const raw of rawItems as Record<string, unknown>[]) {
    const sku = String(raw.sku ?? '');
    const qty = Number(raw.qty ?? raw.quantity ?? 0);

    console.log(`[POST /api/orders] Item: sku=${sku} qty=${qty}`);

    if (!sku || qty < 1) {
      updated.push({ sku, qty, status: 'sku_not_found' });
      continue;
    }

    const product = productMap.get(sku);
    if (!product) {
      console.log(`[POST /api/orders] SKU not found: ${sku}`);
      updated.push({ sku, qty, status: 'sku_not_found' });
      continue;
    }

    const result = mockDb.reserveInventory(product.id, qty);
    console.log(`[POST /api/orders] reserveInventory(${sku}, ${qty}):`, result);

    if (!result.success) {
      updated.push({ sku, qty, status: 'insufficient_stock', available: result.available });
    } else {
      updated.push({ sku, qty, status: 'reserved' });
    }
  }

  console.log('[POST /api/orders] Done. Updated:', JSON.stringify(updated));

  return new Response(
    JSON.stringify({ success: true, updated }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
