import { neon } from '@neondatabase/serverless';

// Returns a Neon SQL client if DATABASE_URL is set, otherwise null (falls back to mock DB)
export function getNeonSql() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  return neon(url);
}

export function isNeonConfigured() {
  return !!process.env.DATABASE_URL;
}
