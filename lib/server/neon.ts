import 'server-only';
import { neon, type NeonQueryFunction } from '@neondatabase/serverless';

type NeonSql = NeonQueryFunction<false, false>;

let client: NeonSql | undefined;
let schemaReady: Promise<void> | undefined;

export function getNeonSql(): NeonSql {
  if (client) return client;
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('Neon is not configured. Set DATABASE_URL.');
  client = neon(databaseUrl);
  return client;
}

export async function ensureDatabaseSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  const sql = getNeonSql();
  schemaReady = (async () => {
    await sql`CREATE TABLE IF NOT EXISTS app_users (
      id UUID PRIMARY KEY,
      account_id TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      trading_config JSONB,
      config_updated_at TIMESTAMPTZ,
      deriv_access_token TEXT,
      deriv_refresh_token TEXT,
      deriv_token_expires_at BIGINT,
      deriv_scope TEXT,
      deriv_account_id TEXT
    )`;
    await sql`CREATE TABLE IF NOT EXISTS app_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL
    )`;
    await sql`CREATE INDEX IF NOT EXISTS app_sessions_user_id_idx ON app_sessions(user_id)`;
    await sql`CREATE TABLE IF NOT EXISTS deriv_oauth_flows (
      state_hash TEXT PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      code_verifier TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    )`;
  })().catch((error) => {
    schemaReady = undefined;
    throw error;
  });
  return schemaReady;
}