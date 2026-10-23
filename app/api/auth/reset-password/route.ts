import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { hashPassword } from '@/lib/server/app-auth';
import { ensureDatabaseSchema, getNeonSql } from '@/lib/server/neon';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const token = typeof body.token === 'string' ? body.token : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (token.length < 32 || token.length > 128) return NextResponse.json({ error: 'Reset link is invalid or expired.' }, { status: 400 });
    if (password.length < 10 || password.length > 128) {
      return NextResponse.json({ error: 'Password must be between 10 and 128 characters.' }, { status: 400 });
    }
    await ensureDatabaseSchema();
    const passwordHash = await hashPassword(password);
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const result = await getNeonSql()`
      WITH claimed AS (
        UPDATE app_password_resets SET used_at = now()
        WHERE token_hash = ${tokenHash} AND used_at IS NULL AND expires_at > now()
        RETURNING user_id
      )
      UPDATE app_users SET password_hash = ${passwordHash}
      WHERE id = (SELECT user_id FROM claimed)
      RETURNING id::text AS id
    ` as Record<string, unknown>[];
    if (!result[0]) return NextResponse.json({ error: 'Reset link is invalid, expired, or already used.' }, { status: 400 });
    const userId = String(result[0].id);
    const users = await getNeonSql()`SELECT email FROM app_users WHERE id = ${userId}::uuid LIMIT 1` as Record<string, unknown>[];
    const fingerprint = createHash('sha256').update(String(users[0]?.email ?? '').trim().toLowerCase()).digest('hex').slice(0, 24);
    await getNeonSql()`DELETE FROM app_password_resets WHERE user_id = ${userId}::uuid`;
    await getNeonSql()`DELETE FROM app_login_attempts WHERE email_fingerprint = ${fingerprint}`;
    await getNeonSql()`DELETE FROM app_sessions WHERE user_id = ${userId}::uuid`;
    await getNeonSql()`DELETE FROM deriv_oauth_flows WHERE user_id = ${userId}::uuid`;
    await getNeonSql()`INSERT INTO app_user_activity (actor_user_id, subject_user_id, event_type)
      VALUES (${userId}::uuid, ${userId}::uuid, 'user.password_reset')`;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Password reset failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not reset this password.' }, { status: 503 });
  }
}
