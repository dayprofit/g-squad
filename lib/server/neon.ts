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
      schedule_timezone TEXT NOT NULL DEFAULT 'UTC',
      work_schedule JSONB NOT NULL DEFAULT '[]'::jsonb,
      role_starts_on DATE,
      role_ends_on DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
    await sql`ALTER TABLE admin_staff ADD COLUMN IF NOT EXISTS schedule_timezone TEXT NOT NULL DEFAULT 'UTC'`;
    await sql`ALTER TABLE admin_staff ADD COLUMN IF NOT EXISTS work_schedule JSONB NOT NULL DEFAULT '[]'::jsonb`;
    await sql`ALTER TABLE admin_staff ADD COLUMN IF NOT EXISTS role_starts_on DATE`;
    await sql`ALTER TABLE admin_staff ADD COLUMN IF NOT EXISTS role_ends_on DATE`;
    await sql`ALTER TABLE admin_staff ADD COLUMN IF NOT EXISTS permissions JSONB`;
    await sql`ALTER TABLE admin_staff ADD COLUMN IF NOT EXISTS team_name TEXT`;
    await sql`ALTER TABLE admin_staff ADD COLUMN IF NOT EXISTS region_name TEXT`;
    await sql`ALTER TABLE admin_staff ADD COLUMN IF NOT EXISTS temporary_access_expires_at TIMESTAMPTZ`;
    await sql`CREATE TABLE IF NOT EXISTS admin_chats (
      id BIGSERIAL PRIMARY KEY,
      user_id UUID NOT NULL UNIQUE REFERENCES app_users(id) ON DELETE CASCADE,
      department TEXT NOT NULL DEFAULT 'support' CHECK (department IN ('support', 'account_manager')),
      assigned_to UUID REFERENCES app_users(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'closed')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS admin_chats_queue_idx ON admin_chats(department, status, updated_at DESC)`;
    await sql`CREATE TABLE IF NOT EXISTS admin_chat_messages (
      id BIGSERIAL PRIMARY KEY,
      chat_id BIGINT NOT NULL REFERENCES admin_chats(id) ON DELETE CASCADE,
      sender_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
      sender_type TEXT NOT NULL CHECK (sender_type IN ('investor', 'staff')),
      sender_name TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS admin_chat_messages_chat_idx ON admin_chat_messages(chat_id, id)`;
    await sql`CREATE TABLE IF NOT EXISTS admin_chat_typing (
      chat_id BIGINT NOT NULL REFERENCES admin_chats(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      is_typing BOOLEAN NOT NULL DEFAULT true,
      expires_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (chat_id, user_id)
    )`;
    await sql`CREATE INDEX IF NOT EXISTS admin_chat_typing_expiry_idx ON admin_chat_typing(chat_id, expires_at)`;
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
    await sql`CREATE TABLE IF NOT EXISTS app_bot_trade_results (
      user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      contract_id BIGINT NOT NULL,
      account_type TEXT NOT NULL CHECK (account_type IN ('demo', 'real')),
      currency TEXT NOT NULL,
      profit NUMERIC(20, 8) NOT NULL,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, contract_id)
    )`;
    await sql`CREATE INDEX IF NOT EXISTS app_bot_trade_results_type_currency_idx
      ON app_bot_trade_results(account_type, currency)`;
    await sql`ALTER TABLE app_bot_trade_results ADD COLUMN IF NOT EXISTS deriv_account_id TEXT`;
    await sql`CREATE TABLE IF NOT EXISTS app_bot_sessions (
      user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      deriv_account_id TEXT NOT NULL,
      account_type TEXT NOT NULL CHECK (account_type IN ('demo', 'real')),
      currency TEXT NOT NULL,
      starting_balance NUMERIC(20, 8) NOT NULL,
      wins INTEGER NOT NULL DEFAULT 0 CHECK (wins >= 0),
      losses INTEGER NOT NULL DEFAULT 0 CHECK (losses >= 0),
      is_running BOOLEAN NOT NULL DEFAULT false,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, deriv_account_id)
    )`;
    await sql`CREATE TABLE IF NOT EXISTS admin_user_assignments (
      user_id UUID PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
      staff_user_id UUID NOT NULL REFERENCES admin_staff(user_id) ON DELETE CASCADE,
      assigned_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
      team_name TEXT,
      region_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS admin_user_assignments_staff_idx ON admin_user_assignments(staff_user_id)`;
    await sql`CREATE TABLE IF NOT EXISTS admin_support_cases (
      id BIGSERIAL PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      subject TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'waiting', 'resolved', 'closed')),
      priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
      assigned_to UUID REFERENCES admin_staff(user_id) ON DELETE SET NULL,
      created_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      due_at TIMESTAMPTZ
    )`;
    await sql`CREATE INDEX IF NOT EXISTS admin_support_cases_queue_idx ON admin_support_cases(status, priority, due_at)`;
    await sql`CREATE TABLE IF NOT EXISTS admin_user_notes (
      id BIGSERIAL PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      author_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
      note TEXT NOT NULL,
      flag TEXT CHECK (flag IN ('none', 'watch', 'high_risk')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS admin_user_notes_user_idx ON admin_user_notes(user_id, created_at DESC)`;
    await sql`CREATE TABLE IF NOT EXISTS admin_notifications (
      id BIGSERIAL PRIMARY KEY,
      recipient_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      notification_type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS admin_notifications_recipient_idx ON admin_notifications(recipient_id, created_at DESC)`;
    await sql`CREATE TABLE IF NOT EXISTS admin_saved_views (
      id BIGSERIAL PRIMARY KEY,
      owner_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      view_type TEXT NOT NULL CHECK (view_type IN ('users', 'activity', 'cases')),
      filters JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(owner_id, view_type, name)
    )`;
    await sql`CREATE TABLE IF NOT EXISTS admin_approvals (
      id BIGSERIAL PRIMARY KEY,
      requested_by UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      action_type TEXT NOT NULL,
      target_user_id UUID REFERENCES app_users(id) ON DELETE CASCADE,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
      reviewed_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
      review_note TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      reviewed_at TIMESTAMPTZ
    )`;
    await sql`CREATE INDEX IF NOT EXISTS admin_approvals_status_idx ON admin_approvals(status, created_at DESC)`;
    await sql`CREATE TABLE IF NOT EXISTS admin_permission_reviews (
      id BIGSERIAL PRIMARY KEY,
      staff_user_id UUID NOT NULL REFERENCES admin_staff(user_id) ON DELETE CASCADE,
      reviewer_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
      due_at TIMESTAMPTZ NOT NULL,
      reviewed_at TIMESTAMPTZ,
      decision TEXT CHECK (decision IN ('confirmed', 'changed', 'revoked')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
    await sql`CREATE TABLE IF NOT EXISTS admin_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value JSONB NOT NULL,
      updated_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
    await sql`CREATE TABLE IF NOT EXISTS admin_offboarding (
      id BIGSERIAL PRIMARY KEY,
      staff_user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      started_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
      checklist JSONB NOT NULL DEFAULT '{"access_revoked":false,"sessions_ended":false,"cases_reassigned":false,"review_complete":false}'::jsonb,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  })().catch((error) => {
    schemaReady = undefined;
    throw error;
  });
  return schemaReady;
}