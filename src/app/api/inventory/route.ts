import { NextRequest, NextResponse } from 'next/server';
import { getAllInventory, getInventoryByProductId } from '@/services/inventoryService';
import { getNeonSql } from '@/lib/neon';
import { Errors } from '@/lib/errors';

// =============================================================================
// GET /api/inventory
// Returns current stock levels for all products (or a single product).
//
// Query params:
//   ?product_id=uuid   → single product lookup
// =============================================================================

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const productId = searchParams.get('product_id');

  if (productId) {
    const result = await getInventoryByProductId(productId);

    if (!result.success) {
      if (result.error === 'Product not found in inventory') {
        return Errors.notFound(result.error);
      }
      return Errors.internal(result.error);
    }

    return NextResponse.json({ item: result.data }, { status: 200 });
  }

  const result = await getAllInventory();

  if (!result.success) {
    return Errors.internal(result.error);
  }

  return NextResponse.json(
    { items: result.data, total: result.data.length },
    { status: 200 }
  );
}

// =============================================================================
// POST /api/inventory
// Restock a product by SKU
// Body: { sku: string, quantity: number }
// =============================================================================

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    const text = await req.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return Errors.badRequest('Invalid JSON body');
  }

  const sku = String(body.sku ?? '');
  const quantity = Number(body.quantity ?? 0);

  if (!sku) return Errors.badRequest('sku is required');
  if (!quantity || quantity < 1) return Errors.badRequest('quantity must be at least 1');

  const sql = getNeonSql();
  if (!sql) return Errors.internal('Database not configured');

  const [product] = await sql`
    select p.id from products p
    join inventory i on i.product_id = p.id
    where p.sku = ${sku}
  `;

  if (!product) return Errors.notFound(`SKU not found: ${sku}`);

  await sql`
    update inventory
    set quantity_on_hand = quantity_on_hand + ${quantity},
        last_restocked_at = now(),
        updated_at = now()
    where product_id = ${product.id as string}
  `;

  const [updated] = await sql`
    select quantity_on_hand, quantity_reserved,
           (quantity_on_hand - quantity_reserved) as quantity_available
    from inventory where product_id = ${product.id as string}
  `;

  return NextResponse.json({ success: true, sku, added: quantity, inventory: updated }, { status: 200 });
}
