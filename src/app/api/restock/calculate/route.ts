import { NextRequest, NextResponse } from 'next/server';
import { calculateRestockRecommendations } from '@/services/restockService';
import { Errors } from '@/lib/errors';

// =============================================================================
// GET /api/restock/calculate
// Returns restock recommendations without requiring a body.
//
// Query params:
//   ?window_days=30           default 30, range 1–365
//   ?product_ids=id1,id2      optional CSV of product IDs
//   ?needs_restock=true       if present, filters to only products that need restock
// =============================================================================

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const windowDays = parseInt(searchParams.get('window_days') ?? '30', 10);
  if (isNaN(windowDays) || windowDays < 1 || windowDays > 365) {
    return Errors.badRequest('window_days must be a number between 1 and 365');
  }

  const productIdsParam = searchParams.get('product_ids');
  const inputs = productIdsParam
    ? productIdsParam.split(',').filter(Boolean).map((id) => ({ product_id: id.trim() }))
    : [];

  const onlyNeedsRestock = searchParams.get('needs_restock') === 'true';

  const result = await calculateRestockRecommendations(inputs, windowDays);

  if (!result.success) {
    return Errors.internal(result.error);
  }

  const recommendations = onlyNeedsRestock
    ? result.data.filter((r) => r.needs_restock)
    : result.data;

  const critical = recommendations.filter((r) => r.urgency === 'critical').length;
  const warning  = recommendations.filter((r) => r.urgency === 'warning').length;

  return NextResponse.json(
    {
      calculated_at:   new Date().toISOString(),
      window_days:     windowDays,
      total_products:  result.data.length,
      needs_restock:   result.data.filter((r) => r.needs_restock).length,
      critical,
      warning,
      recommendations,
    },
    { status: 200 }
  );
}

// =============================================================================
// POST /api/restock/calculate
// Same calculation, but accepts a JSON body for more control.
//
// Body (all optional):
// {
//   product_ids?: string[],
//   window_days?: number      default 30
// }
// =============================================================================

export async function POST(req: NextRequest) {
  let body: { product_ids?: string[]; window_days?: number } = {};

  try {
    const text = await req.text();
    if (text) body = JSON.parse(text);
  } catch {
    return Errors.badRequest('Invalid JSON body');
  }

  const windowDays = body.window_days ?? 30;
  if (typeof windowDays !== 'number' || windowDays < 1 || windowDays > 365) {
    return Errors.badRequest('window_days must be a number between 1 and 365');
  }

  const inputs = body.product_ids?.map((id: string) => ({ product_id: id })) ?? [];

  const result = await calculateRestockRecommendations(inputs, windowDays);

  if (!result.success) {
    return Errors.internal(result.error);
  }

  const critical = result.data.filter((r) => r.urgency === 'critical').length;
  const warning  = result.data.filter((r) => r.urgency === 'warning').length;

  return NextResponse.json(
    {
      calculated_at:  new Date().toISOString(),
      window_days:    windowDays,
      total_products: result.data.length,
      needs_restock:  result.data.filter((r) => r.needs_restock).length,
      critical,
      warning,
      recommendations: result.data,
    },
    { status: 200 }
  );
}
