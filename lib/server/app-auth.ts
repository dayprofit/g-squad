import 'server-only';
import { createHash, randomBytes, randomInt, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { cookies } from 'next/headers';
import { ensureDatabaseSchema, getNeonSql } from './neon';

const scryptAsync = promisify(scrypt);
export const APP_SESSION_COOKIE = 'g_squad_session';
const SESSION_DAYS = 30;

export class AppEmailConflictError extends Error {
  constructor() {
    super('An account with this email already exists.');
    this.name = 'AppEmailConflictError';
  }
}

export interface AppUser {
  id: string;
  accountId: string;
  fullName: string;
  email: string;
  joinedAt: string;
  isAdmin: boolean;
  adminRole: string | null;
}

export interface CurrentAppSession {
  user: AppUser;
  tokenHash: string;
  sessionId: string;
  adminMfaVerifiedAt: string | null;
  adminReauthenticatedAt: string | null;
}

export function isAdminEmail(email: string): boolean {
  const allowlist = process.env.ADMIN_EMAILS?.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean) ?? [];
  return allowlist.includes(email.trim().toLowerCase());
}

function toAppUser(record: Record<string, unknown>): AppUser {
  const email = String(record.email);
  return {
    id: String(record.id),
    accountId: String(record.accountId),
    fullName: String(record.fullName),
    email,
    joinedAt: String(record.joinedAt),
    isAdmin: isAdminEmail(email) || record.isStaff === true,
    adminRole: isAdminEmail(email) ? 'owner' : record.adminRole ? String(record.adminRole) : null,
  };
}

export async function recordAppUserActivity(input: {
  actorUserId?: string | null;
  subjectUserId?: string | null;
  eventType: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  await ensureDatabaseSchema();
  await getNeonSql()`INSERT INTO app_user_activity (actor_user_id, subject_user_id, event_type, details)
    VALUES (${input.actorUserId ?? null}::uuid, ${input.subjectUserId ?? null}::uuid,
      ${input.eventType}, ${JSON.stringify(input.details ?? {})}::jsonb)`;
  const notification = ({
    'admin.case_created': ['New support case', 'A support case was added to the administrator queue.'],
    'admin.approval_requested': ['Action approval requested', 'A privileged administrator action is waiting for review.'],
    'admin.staff_access_revoked': ['Staff access revoked', 'An administrator revoked a staff account.'],
    'admin.retention_cleanup': ['Audit cleanup completed', 'An Owner ran the configured audit-retention cleanup.'],
  } as Record<string, [string, string]>)[input.eventType];
  if (!notification) return;
  const recipients = await getNeonSql()`SELECT u.id::text AS id, u.email
    FROM app_users u JOIN admin_staff staff ON staff.user_id = u.id` as Record<string, unknown>[];
  for (const email of (process.env.ADMIN_EMAILS ?? '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean)) {
    const owner = await getNeonSql()`SELECT id::text AS id, email FROM app_users WHERE lower(email) = ${email} LIMIT 1` as Record<string, unknown>[];
    if (owner[0] && !recipients.some((recipient) => recipient.id === owner[0].id)) recipients.push(owner[0]);
  }
  for (const recipient of recipients) {
    if (recipient.id === input.actorUserId) continue;
    await getNeonSql()`INSERT INTO admin_notifications (recipient_id, notification_type, title, message)
      VALUES (${String(recipient.id)}::uuid, ${input.eventType}, ${notification[0]}, ${notification[1]})`;
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const [saltHex, hashHex] = storedHash.split(':');
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  if (salt.length !== 16 || expected.length !== 64) return false;
  const actual = (await scryptAsync(password, salt, expected.length)) as Buffer;
  return timingSafeEqual(actual, expected);
}

export async function createAppUser(input: {
  fullName: string;
  email: string;
  password: string;
}): Promise<AppUser> {
  await ensureDatabaseSchema();
  const sql = getNeonSql();
  const passwordHash = await hashPassword(input.password);
  const userId = randomUUID();

  const existing = await sql`SELECT id FROM app_users WHERE email = ${input.email} LIMIT 1` as Record<string, unknown>[];
  if (existing.length) throw new AppEmailConflictError();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const accountId = `GQD-${randomInt(10_000_000, 100_000_000)}`;
    try {
      const result = await sql`
        INSERT INTO app_users (id, account_id, full_name, email, password_hash)
        VALUES (${userId}::uuid, ${accountId}, ${input.fullName}, ${input.email}, ${passwordHash})
        ON CONFLICT (account_id) DO NOTHING
        RETURNING id::text AS id, account_id AS "accountId", full_name AS "fullName",
          email, joined_at::text AS "joinedAt"
      ` as Record<string, unknown>[];
      if (result[0]) return toAppUser(result[0]);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new AppEmailConflictError();
      throw error;
    }
  }
  throw new Error('Could not allocate a unique account ID.');
}

export async function findAppUserByEmail(email: string): Promise<(AppUser & { passwordHash: string; isSuspended: boolean }) | null> {
  await ensureDatabaseSchema();
  const result = await getNeonSql()`
    SELECT id::text AS id, account_id AS "accountId", full_name AS "fullName",
      email, password_hash AS "passwordHash", joined_at::text AS "joinedAt",
      is_suspended AS "isSuspended", (staff.user_id IS NOT NULL) AS "isStaff",
      staff.role AS "adminRole"
    FROM app_users LEFT JOIN admin_staff staff ON staff.user_id = app_users.id
    WHERE email = ${email} LIMIT 1
  ` as Record<string, unknown>[];
  if (!result[0]) return null;
  return {
    ...toAppUser(result[0]),
    passwordHash: String(result[0].passwordHash),
    isSuspended: result[0].isSuspended === true,
  };
}

export async function createAppSession(userId: string): Promise<string> {
  await ensureDatabaseSchema();
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const sql = getNeonSql();
  await sql`DELETE FROM app_sessions WHERE expires_at <= now()`;
  await sql`INSERT INTO app_sessions (token_hash, user_id, expires_at)
    VALUES (${tokenHash}, ${userId}::uuid, ${expiresAt})`;
  return token;
}

export async function getCurrentAppUser(): Promise<AppUser | null> {
  const session = await getCurrentAppSession();
  return session?.user ?? null;
}

export async function getCurrentAppSession(): Promise<CurrentAppSession | null> {
  const token = (await cookies()).get(APP_SESSION_COOKIE)?.value;
  if (!token) return null;
  await ensureDatabaseSchema();
  const tokenHash = createHash('sha256').update(token).digest('hex');
  await getNeonSql()`UPDATE app_sessions SET last_seen_at = now()
    WHERE token_hash = ${tokenHash} AND expires_at > now()`;
  const result = await getNeonSql()`
    SELECT u.id::text AS id, u.account_id AS "accountId", u.full_name AS "fullName",
      u.email, u.joined_at::text AS "joinedAt", s.token_hash AS "tokenHash",
      s.session_id::text AS "sessionId",
      s.admin_mfa_verified_at::text AS "adminMfaVerifiedAt",
      s.admin_reauthenticated_at::text AS "adminReauthenticatedAt",
      (staff.user_id IS NOT NULL) AS "isStaff", staff.role AS "adminRole"
    FROM app_sessions s JOIN app_users u ON u.id = s.user_id
    LEFT JOIN admin_staff staff ON staff.user_id = u.id
    WHERE s.token_hash = ${tokenHash} AND s.expires_at > now() AND u.is_suspended = false LIMIT 1
  ` as Record<string, unknown>[];
  if (!result[0]) return null;
  return {
    user: toAppUser(result[0]),
    tokenHash: String(result[0].tokenHash),
    sessionId: String(result[0].sessionId),
    adminMfaVerifiedAt: result[0].adminMfaVerifiedAt ? String(result[0].adminMfaVerifiedAt) : null,
    adminReauthenticatedAt: result[0].adminReauthenticatedAt ? String(result[0].adminReauthenticatedAt) : null,
  };
}

export async function recordSuccessfulAppLogin(userId: string): Promise<void> {
  await ensureDatabaseSchema();
  await getNeonSql()`UPDATE app_users SET last_login_at = now() WHERE id = ${userId}::uuid`;
  const user = await getNeonSql()`SELECT email FROM app_users WHERE id = ${userId}::uuid LIMIT 1` as Record<string, unknown>[];
  if (user[0]) {
    const fingerprint = createHash('sha256').update(String(user[0].email).trim().toLowerCase()).digest('hex').slice(0, 24);
    await getNeonSql()`DELETE FROM app_login_attempts WHERE email_fingerprint = ${fingerprint}`;
  }
  await recordAppUserActivity({ actorUserId: userId, subjectUserId: userId, eventType: 'user.login' });
}

export async function isAppLoginRateLimited(email: string): Promise<boolean> {
  await ensureDatabaseSchema();
  const fingerprint = createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 24);
  const rows = await getNeonSql()`SELECT COUNT(*)::int AS attempts FROM app_login_attempts
    WHERE email_fingerprint = ${fingerprint} AND created_at >= now() - interval '15 minutes'` as Record<string, unknown>[];
  return Number(rows[0]?.attempts ?? 0) >= 10;
}

export async function recordFailedAppLogin(email: string): Promise<void> {
  await ensureDatabaseSchema();
  const fingerprint = createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 24);
  await getNeonSql()`INSERT INTO app_login_attempts (email_fingerprint) VALUES (${fingerprint})`;
  await getNeonSql()`INSERT INTO app_user_activity (event_type, details)
    VALUES ('auth.login_failed', ${JSON.stringify({ emailFingerprint: fingerprint })}::jsonb)`;
}

export async function deleteAppSession(): Promise<void> {
  const token = (await cookies()).get(APP_SESSION_COOKIE)?.value;
  if (!token) return;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  await ensureDatabaseSchema();
  await getNeonSql()`DELETE FROM app_sessions WHERE token_hash = ${tokenHash}`;
}