import { NextRequest, NextResponse } from 'next/server';
import { getAllInventory, getInventoryByProductId } from '@/services/inventoryService';
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
