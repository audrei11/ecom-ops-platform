import { NextResponse } from 'next/server';

// =============================================================================
// Standardised API error helpers
// =============================================================================

export interface ApiError {
  error: string;
  code: string;
  details?: unknown;
}

export function apiError(
  message: string,
  code: string,
  status: number,
  details?: unknown
): NextResponse<ApiError> {
  return NextResponse.json({ error: message, code, details }, { status });
}

export const Errors = {
  badRequest: (msg: string, details?: unknown) =>
    apiError(msg, 'BAD_REQUEST', 400, details),

  notFound: (msg: string) =>
    apiError(msg, 'NOT_FOUND', 404),

  conflict: (msg: string, details?: unknown) =>
    apiError(msg, 'CONFLICT', 409, details),

  unprocessable: (msg: string, details?: unknown) =>
    apiError(msg, 'UNPROCESSABLE', 422, details),

  internal: (msg = 'Internal server error') =>
    apiError(msg, 'INTERNAL_ERROR', 500),
};
