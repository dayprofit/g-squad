import { NextResponse } from 'next/server';
import { getCurrentAppSession, isAdminEmail, recordAppUserActivity, verifyPassword } from '@/lib/server/app-auth';
import { AdminMfaConfigurationError, consumeBackupCode, decryptTotpSecret, verifyTotp } from '@/lib/server/admin-mfa';
import { ensureDatabaseSchema, getNeonSql } from '@/lib/server/neon';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const session = await getCurrentAppSession();
    if (!session) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    await ensureDatabaseSchema();
    const accounts = await getNeonSql()`
      SELECT u.password_hash AS "passwordHash", u.admin_totp_enabled AS "mfaEnabled",
        u.admin_totp_secret AS "mfaSecret",
        CASE WHEN ${isAdminEmail(session.user.email)} THEN 'owner' ELSE staff.role END AS role
      FROM app_users u LEFT JOIN admin_staff staff ON staff.user_id = u.id
      WHERE u.id = ${session.user.id}::uuid LIMIT 1
    ` as Record<string, unknown>[];
    const account = accounts[0];
    if (!account?.role) return NextResponse.json({ error: 'Admin access is not enabled.' }, { status: 403 });
    const attemptRows = await getNeonSql()`SELECT COUNT(*)::int AS attempts FROM admin_auth_attempts
      WHERE user_id = ${session.user.id}::uuid AND event_type = 'reauth' AND created_at >= now() - interval '15 minutes'` as Record<string, unknown>[];
    if (Number(attemptRows[0]?.attempts ?? 0) >= 5) {
      return NextResponse.json({ error: 'Too many verification attempts. Try again in 15 minutes.' }, { status: 429 });
    }
    const body = await request.json();
    const password = typeof body.password === 'string' ? body.password : '';
    const code = typeof body.code === 'string' ? body.code : '';
    if (!(await verifyPassword(password, String(account.passwordHash)))) {
      await getNeonSql()`INSERT INTO admin_auth_attempts (user_id, event_type) VALUES (${session.user.id}::uuid, 'reauth')`;
      return NextResponse.json({ error: 'Password is incorrect.' }, { status: 401 });
    }
    if (account.mfaEnabled !== true || typeof account.mfaSecret !== 'string') {
      return NextResponse.json({ error: 'Set up your authenticator app before continuing.' }, { status: 428 });
    }
    const step = verifyTotp(decryptTotpSecret(account.mfaSecret), code);
    const backupAccepted = step === null && await consumeBackupCode(session.user.id, code);
    if (step === null && !backupAccepted) {
      await getNeonSql()`INSERT INTO admin_auth_attempts (user_id, event_type) VALUES (${session.user.id}::uuid, 'reauth')`;
      return NextResponse.json({ error: 'Authenticator code is invalid.' }, { status: 400 });
    }
    if (step !== null) {
      const used = await getNeonSql()`
        UPDATE app_users SET admin_totp_last_step = ${step}
        WHERE id = ${session.user.id}::uuid AND COALESCE(admin_totp_last_step, -1) < ${step}
        RETURNING id
      ` as Record<string, unknown>[];
      if (!used[0]) return NextResponse.json({ error: 'That code was already used. Wait for a new code.' }, { status: 409 });
    }
    await getNeonSql()`DELETE FROM admin_auth_attempts WHERE user_id = ${session.user.id}::uuid AND event_type = 'reauth'`;
    await getNeonSql()`UPDATE app_sessions SET admin_mfa_verified_at = now(), admin_reauthenticated_at = now()
      WHERE token_hash = ${session.tokenHash}`;
    await recordAppUserActivity({ actorUserId: session.user.id, subjectUserId: session.user.id, eventType: 'admin.reauthenticated' });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Admin reauthentication failed:', error instanceof Error ? error.message : 'Unknown error');
    if (error instanceof AdminMfaConfigurationError) {
      return NextResponse.json({ error: error.message, code: 'ADMIN_MFA_CONFIGURATION_REQUIRED' }, { status: 503 });
    }
    return NextResponse.json({ error: 'Could not verify your identity.' }, { status: 503 });
  }
}
