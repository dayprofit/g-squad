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
    await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN NOT NULL DEFAULT false`;
    await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ`;
    await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS admin_totp_enabled BOOLEAN NOT NULL DEFAULT false`;
    await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS admin_totp_secret TEXT`;
    await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS admin_totp_pending_secret TEXT`;
    await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS admin_totp_last_step BIGINT`;
    await sql`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS admin_totp_backup_codes JSONB NOT NULL DEFAULT '[]'::jsonb`;
    await sql`CREATE TABLE IF NOT EXISTS app_sessions (
      session_id UUID NOT NULL DEFAULT gen_random_uuid(),
      token_hash TEXT PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      admin_mfa_verified_at TIMESTAMPTZ,
      admin_reauthenticated_at TIMESTAMPTZ
    )`;
    await sql`ALTER TABLE app_sessions ADD COLUMN IF NOT EXISTS session_id UUID NOT NULL DEFAULT gen_random_uuid()`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS app_sessions_session_id_idx ON app_sessions(session_id)`;
    await sql`ALTER TABLE app_sessions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now()`;
    await sql`ALTER TABLE app_sessions ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()`;
    await sql`ALTER TABLE app_sessions ADD COLUMN IF NOT EXISTS admin_mfa_verified_at TIMESTAMPTZ`;
    await sql`ALTER TABLE app_sessions ADD COLUMN IF NOT EXISTS admin_reauthenticated_at TIMESTAMPTZ`;
    await sql`CREATE INDEX IF NOT EXISTS app_sessions_user_id_idx ON app_sessions(user_id)`;
    await sql`CREATE TABLE IF NOT EXISTS admin_staff (
      user_id UUID PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('support', 'account_manager', 'read_only')),
      invited_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
    await sql`CREATE TABLE IF NOT EXISTS admin_invitations (
      id BIGSERIAL PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('support', 'account_manager', 'read_only')),
      invited_by UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      accepted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS admin_invitations_email_idx ON admin_invitations(email, expires_at DESC)`;
    await sql`CREATE TABLE IF NOT EXISTS app_password_resets (
      token_hash TEXT PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
    await sql`CREATE TABLE IF NOT EXISTS admin_auth_attempts (
      id BIGSERIAL PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS admin_auth_attempts_user_idx ON admin_auth_attempts(user_id, event_type, created_at DESC)`;
    await sql`CREATE TABLE IF NOT EXISTS app_login_attempts (
      id BIGSERIAL PRIMARY KEY,
      email_fingerprint TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS app_login_attempts_fingerprint_idx ON app_login_attempts(email_fingerprint, created_at DESC)`;
    await sql`CREATE TABLE IF NOT EXISTS admin_alerts (
      id BIGSERIAL PRIMARY KEY,
      alert_type TEXT NOT NULL,
      severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
      message TEXT NOT NULL,
      fingerprint TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      acknowledged_at TIMESTAMPTZ,
      acknowledged_by UUID REFERENCES app_users(id) ON DELETE SET NULL
    )`;
    await sql`ALTER TABLE admin_alerts ADD COLUMN IF NOT EXISTS fingerprint TEXT`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS admin_alerts_fingerprint_idx ON admin_alerts(fingerprint) WHERE fingerprint IS NOT NULL`;
    await sql`CREATE TABLE IF NOT EXISTS deriv_oauth_flows (
      state_hash TEXT PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      code_verifier TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    )`;
    await sql`CREATE TABLE IF NOT EXISTS app_user_activity (
      id BIGSERIAL PRIMARY KEY,
      actor_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
      subject_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS app_user_activity_subject_created_idx
      ON app_user_activity(subject_user_id, created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS app_user_activity_created_idx
      ON app_user_activity(created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS app_user_activity_type_created_idx
      ON app_user_activity(event_type, created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS app_user_activity_failed_fingerprint_idx
      ON app_user_activity((details->>'emailFingerprint'), created_at DESC)
      WHERE event_type = 'auth.login_failed'`;
    await sql`CREATE TABLE IF NOT EXISTS app_trading_config_history (
      id BIGSERIAL PRIMARY KEY,
      actor_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
      subject_user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      previous_config JSONB,
      new_config JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS app_trading_config_history_subject_idx
      ON app_trading_config_history(subject_user_id, created_at DESC)`;
  })().catch((error) => {
    schemaReady = undefined;
    throw error;
  });
  return schemaReady;
}