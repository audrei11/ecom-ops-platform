import { NextRequest, NextResponse } from 'next/server';
import { listOrders } from '@/services/orderService';
import { Errors } from '@/lib/errors';

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
// POST /api/orders — MINIMAL DIAGNOSTIC VERSION
// Full business logic temporarily removed to confirm the endpoint responds.
// =============================================================================

export async function POST(req: Request) {
  try {
    const text = await req.text();
    console.log('RAW:', text);

    const body = text ? JSON.parse(text) : {};
    console.log('BODY:', body);

    return new Response(
      JSON.stringify({ success: true, received: body }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('ERROR:', err);
    return new Response(
      JSON.stringify({ error: 'failed' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
