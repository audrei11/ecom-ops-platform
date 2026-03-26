import { NextRequest, NextResponse } from 'next/server';
import { batchOrdersByFactory, listFactoryBatches } from '@/services/factoryService';
import { Errors } from '@/lib/errors';

// =============================================================================
// GET /api/factory/batch
// Returns all existing factory batches.
//
// Query params:
//   ?factory_id=uuid   → filter to a specific factory
// =============================================================================

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const factoryId = searchParams.get('factory_id') ?? undefined;

  const result = await listFactoryBatches(factoryId);

  if (!result.success) {
    return Errors.internal(result.error);
  }

  return NextResponse.json(
    { batches: result.data, total: result.data.length },
    { status: 200 }
  );
}

// =============================================================================
// POST /api/factory/batch
// Runs the batching pass: assigns unbatched processing-order items to batches.
//
// Body (optional):
// {
//   factory_id?:     string     → limit to a specific factory
//   order_statuses?: string[]   → default: ['processing']
// }
// =============================================================================

export async function POST(req: NextRequest) {
  let body: { factory_id?: string; order_statuses?: string[] } = {};

  try {
    const text = await req.text();
    if (text) body = JSON.parse(text);
  } catch {
    return Errors.badRequest('Invalid JSON body');
  }

  const result = await batchOrdersByFactory({
    factory_id:     body.factory_id,
    order_statuses: body.order_statuses,
  });

  if (!result.success) {
    return Errors.internal(result.error);
  }

  return NextResponse.json(result.data, { status: 200 });
}
