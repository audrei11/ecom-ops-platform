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
// POST /api/orders — inventory deduction
// Accepts: { items: [{ sku, qty }] }
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

  // ── 3. Resolve all SKUs upfront ─────────────────────────────────────────────
  const skus = (rawItems as Record<string, unknown>[]).map((i) => String(i.sku ?? ''));
  const productMap = mockDb.getProductsBySku(skus);

  // ── 4. Loop through items and deduct inventory ──────────────────────────────
  const updated: Array<{
    sku: string;
    qty: number;
    status: 'deducted' | 'insufficient_stock' | 'sku_not_found';
    stock_before?: number;
    stock_after?: number;
    available?: number;
  }> = [];

  for (const raw of rawItems as Record<string, unknown>[]) {
    const sku = String(raw.sku ?? '');
    const qty = Number(raw.qty ?? raw.quantity ?? 0);

    console.log(`[POST /api/orders] Updating SKU: ${sku}  QTY: ${qty}`);

    if (!sku || qty < 1) {
      console.warn(`[POST /api/orders] Invalid item — sku="${sku}" qty=${qty}`);
      updated.push({ sku, qty, status: 'sku_not_found' });
      continue;
    }

    const product = productMap.get(sku);
    if (!product) {
      console.warn(`[POST /api/orders] SKU not found in DB: ${sku}`);
      updated.push({ sku, qty, status: 'sku_not_found' });
      continue;
    }

    // Get current inventory snapshot for logging
    const invBefore = mockDb.getInventoryByProductId(product.id);
    const availableBefore = invBefore
      ? invBefore.quantity_on_hand - invBefore.quantity_reserved
      : 0;

    console.log(`[POST /api/orders] Before: available=${availableBefore}`);

    // Deduct from on_hand + add to reserved
    const deductResult = mockDb.deductInventory(product.id, qty);

    if (!deductResult.success) {
      console.warn(`[POST /api/orders] Insufficient stock for ${sku} — available: ${deductResult.available}`);
      updated.push({ sku, qty, status: 'insufficient_stock', available: deductResult.available });
      continue;
    }

    // Also reserve so dashboard shows correct available count
    mockDb.reserveInventory(product.id, qty);

    const availableAfter = availableBefore - qty;
    console.log(`[POST /api/orders] After: available=${availableAfter}`);

    updated.push({
      sku,
      qty,
      status: 'deducted',
      stock_before: availableBefore,
      stock_after: availableAfter,
    });
  }

  console.log('[POST /api/orders] Complete:', JSON.stringify(updated));

  return new Response(
    JSON.stringify({ success: true, updated }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}
