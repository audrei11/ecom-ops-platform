import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    supabase_configured: !!(
      process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ),
  });
}
