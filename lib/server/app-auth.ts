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
}

function toAppUser(record: Record<string, unknown>): AppUser {
  return {
    id: String(record.id),
    accountId: String(record.accountId),
    fullName: String(record.fullName),
    email: String(record.email),
    joinedAt: String(record.joinedAt),
  };
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

export async function findAppUserByEmail(email: string): Promise<(AppUser & { passwordHash: string }) | null> {
  await ensureDatabaseSchema();
  const result = await getNeonSql()`
    SELECT id::text AS id, account_id AS "accountId", full_name AS "fullName",
      email, password_hash AS "passwordHash", joined_at::text AS "joinedAt"
    FROM app_users WHERE email = ${email} LIMIT 1
  ` as Record<string, unknown>[];
  if (!result[0]) return null;
  return { ...toAppUser(result[0]), passwordHash: String(result[0].passwordHash) };
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
  const token = (await cookies()).get(APP_SESSION_COOKIE)?.value;
  if (!token) return null;
  await ensureDatabaseSchema();
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const result = await getNeonSql()`
    SELECT u.id::text AS id, u.account_id AS "accountId", u.full_name AS "fullName",
      u.email, u.joined_at::text AS "joinedAt"
    FROM app_sessions s JOIN app_users u ON u.id = s.user_id
    WHERE s.token_hash = ${tokenHash} AND s.expires_at > now() LIMIT 1
  ` as Record<string, unknown>[];
  return result[0] ? toAppUser(result[0]) : null;
}

export async function deleteAppSession(): Promise<void> {
  const token = (await cookies()).get(APP_SESSION_COOKIE)?.value;
  if (!token) return;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  await ensureDatabaseSchema();
  await getNeonSql()`DELETE FROM app_sessions WHERE token_hash = ${tokenHash}`;
}