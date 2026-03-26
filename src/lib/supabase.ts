import { createClient, SupabaseClient } from '@supabase/supabase-js';

// =============================================================================
// Supabase client — server-side only (service role key)
// Never import this in client components or expose to the browser.
// =============================================================================

// Validated at module load — cheap boolean check used by services before calling getDb()
export function isDbConfigured(): boolean {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function createDbClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

// Singleton — one client per process lifetime
let _client: SupabaseClient | null = null;

/**
 * Returns the Supabase client.
 * Throws if env vars are not set — use only when you've already checked isDbConfigured().
 */
export function getDb(): SupabaseClient {
  if (!isDbConfigured()) {
    throw new Error(
      'Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local'
    );
  }
  if (!_client) {
    _client = createDbClient();
  }
  return _client;
}

/**
 * Returns the Supabase client, or null if env vars are missing.
 * Use this in services so they can return a graceful error instead of crashing.
 */
export function tryGetDb(): SupabaseClient | null {
  if (!isDbConfigured()) return null;
  if (!_client) {
    _client = createDbClient();
  }
  return _client;
}
