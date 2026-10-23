import { NextResponse } from 'next/server';
import { getCurrentAppSession, isAdminEmail, recordAppUserActivity } from '@/lib/server/app-auth';
import { AdminMfaConfigurationError, consumeBackupCode, createBackupCodes, createTotpUri, decryptTotpSecret, encryptTotpSecret, createTotpSecret, verifyTotp } from '@/lib/server/admin-mfa';
import { ensureDatabaseSchema, getNeonSql } from '@/lib/server/neon';
import { verifyPassword } from '@/lib/server/app-auth';
import { isScheduleAllowed } from '@/lib/server/admin-auth';

export const runtime = 'nodejs';

async function getAdminAccount(userId: string, email: string) {
  const result = await getNeonSql()`
    SELECT u.admin_totp_enabled AS "mfaEnabled",
      u.admin_totp_secret AS "mfaSecret",
      u.admin_totp_pending_secret AS "pendingSecret",
      CASE WHEN ${isAdminEmail(email)} THEN 'owner' ELSE staff.role END AS role,
      staff.schedule_timezone AS "scheduleTimezone",
      staff.work_schedule AS "workSchedule",
      staff.role_starts_on::text AS "roleStartsOn",
      staff.role_ends_on::text AS "roleEndsOn"
    FROM app_users u LEFT JOIN admin_staff staff ON staff.user_id = u.id
    WHERE u.id = ${userId}::uuid LIMIT 1
  ` as Record<string, unknown>[];
  return result[0];
}

async function isRateLimited(userId: string, eventType: string) {
  const rows = await getNeonSql()`SELECT COUNT(*)::int AS attempts FROM admin_auth_attempts
    WHERE user_id = ${userId}::uuid AND event_type = ${eventType} AND created_at >= now() - interval '15 minutes'` as Record<string, unknown>[];
  return Number(rows[0]?.attempts ?? 0) >= 5;
}

async function recordAttempt(userId: string, eventType: string) {
  await getNeonSql()`INSERT INTO admin_auth_attempts (user_id, event_type) VALUES (${userId}::uuid, ${eventType})`;
}

export async function GET() {
  try {
    const session = await getCurrentAppSession();
    if (!session) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    await ensureDatabaseSchema();
    const account = await getAdminAccount(session.user.id, session.user.email);
    if (!account?.role) return NextResponse.json({ error: 'Admin access is not enabled.', code: 'ADMIN_ACCESS_REQUIRED' }, { status: 403 });
    if (account.role !== 'owner' && !isScheduleAllowed(account)) {
      return NextResponse.json({ error: 'Admin access is available only during your scheduled work hours.', code: 'ADMIN_SCHEDULE_BLOCKED' }, { status: 403 });
    }
    return NextResponse.json({
      mfaEnabled: account.mfaEnabled === true,
      mfaVerified: Boolean(session.adminMfaVerifiedAt && Date.now() - Date.parse(session.adminMfaVerifiedAt) <= 12 * 60 * 60 * 1000),
      pendingSetup: Boolean(account.pendingSecret),
    });
  } catch (error) {
    console.error('Admin MFA status lookup failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not check administrator security status.' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getCurrentAppSession();
    if (!session) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    await ensureDatabaseSchema();
    const account = await getAdminAccount(session.user.id, session.user.email);
    if (!account?.role) return NextResponse.json({ error: 'Admin access is not enabled.' }, { status: 403 });
    if (account.role !== 'owner' && !isScheduleAllowed(account)) {
      return NextResponse.json({ error: 'Admin access is available only during your scheduled work hours.', code: 'ADMIN_SCHEDULE_BLOCKED' }, { status: 403 });
    }
    const body = await request.json();
    const action = body.action;

    if (action === 'setup') {
      if (account.mfaEnabled === true) {
        return NextResponse.json({ error: 'Authenticator is already enabled. Use a recovery code or ask an Owner to reset staff MFA.' }, { status: 409 });
      }
      if (await isRateLimited(session.user.id, 'mfa_setup_password')) {
        return NextResponse.json({ error: 'Too many setup attempts. Try again in 15 minutes.' }, { status: 429 });
      }
      const password = typeof body.password === 'string' ? body.password : '';
      const userRows = await getNeonSql()`SELECT password_hash AS "passwordHash" FROM app_users WHERE id = ${session.user.id}::uuid LIMIT 1` as Record<string, unknown>[];
      if (!password || !userRows[0] || !(await verifyPassword(password, String(userRows[0].passwordHash)))) {
        await recordAttempt(session.user.id, 'mfa_setup_password');
        return NextResponse.json({ error: 'Password is incorrect.' }, { status: 401 });
      }
      await getNeonSql()`DELETE FROM admin_auth_attempts WHERE user_id = ${session.user.id}::uuid AND event_type = 'mfa_setup_password'`;
      const secret = createTotpSecret();
      await getNeonSql()`UPDATE app_users SET admin_totp_pending_secret = ${encryptTotpSecret(secret)} WHERE id = ${session.user.id}::uuid`;
      return NextResponse.json({ secret, uri: createTotpUri(secret, session.user.email) });
    }

    const code = typeof body.code === 'string' ? body.code : '';
    const attemptType = action === 'verify-setup' ? 'mfa_setup' : 'mfa_verify';
    if (await isRateLimited(session.user.id, attemptType)) {
      return NextResponse.json({ error: 'Too many authenticator attempts. Try again in 15 minutes.' }, { status: 429 });
    }
    if (action === 'verify-setup') {
      if (account.mfaEnabled === true) {
        return NextResponse.json({ error: 'Authenticator is already enabled.' }, { status: 409 });
      }
      const pending = typeof account.pendingSecret === 'string' ? decryptTotpSecret(account.pendingSecret) : null;
      if (!pending) return NextResponse.json({ error: 'Start authenticator setup first.' }, { status: 400 });
      const step = verifyTotp(pending, code);
      if (step === null) {
        await recordAttempt(session.user.id, attemptType);
        return NextResponse.json({ error: 'Authenticator code is invalid.' }, { status: 400 });
      }
      const backupCodes = createBackupCodes();
      const updated = await getNeonSql()`
        UPDATE app_users SET admin_totp_secret = admin_totp_pending_secret,
          admin_totp_pending_secret = NULL, admin_totp_enabled = true, admin_totp_last_step = ${step},
          admin_totp_backup_codes = ${JSON.stringify(backupCodes.hashes)}::jsonb
        WHERE id = ${session.user.id}::uuid AND admin_totp_pending_secret IS NOT NULL
        RETURNING id
      ` as Record<string, unknown>[];
      if (!updated[0]) return NextResponse.json({ error: 'Authenticator setup expired. Start again.' }, { status: 409 });
      await getNeonSql()`DELETE FROM admin_auth_attempts WHERE user_id = ${session.user.id}::uuid AND event_type = ${attemptType}`;
      await getNeonSql()`UPDATE app_sessions SET admin_mfa_verified_at = now(), admin_reauthenticated_at = now() WHERE token_hash = ${session.tokenHash}`;
      await recordAppUserActivity({ actorUserId: session.user.id, subjectUserId: session.user.id, eventType: 'admin.mfa_enabled' });
      return NextResponse.json({ success: true, backupCodes: backupCodes.codes });
    }

    if (action === 'verify') {
      if (account.mfaEnabled !== true || typeof account.mfaSecret !== 'string') {
        return NextResponse.json({ error: 'Set up an authenticator app first.' }, { status: 400 });
      }
      const step = verifyTotp(decryptTotpSecret(account.mfaSecret), code);
      const backupAccepted = step === null && await consumeBackupCode(session.user.id, code);
      if (step === null && !backupAccepted) {
        await recordAttempt(session.user.id, attemptType);
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
      await getNeonSql()`DELETE FROM admin_auth_attempts WHERE user_id = ${session.user.id}::uuid AND event_type = ${attemptType}`;
      await getNeonSql()`UPDATE app_sessions SET admin_mfa_verified_at = now(), admin_reauthenticated_at = now() WHERE token_hash = ${session.tokenHash}`;
      await recordAppUserActivity({ actorUserId: session.user.id, subjectUserId: session.user.id, eventType: 'admin.mfa_verified' });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Unsupported administrator security action.' }, { status: 400 });
  } catch (error) {
    console.error('Admin MFA action failed:', error instanceof Error ? error.message : 'Unknown error');
    if (error instanceof AdminMfaConfigurationError) {
      return NextResponse.json({ error: error.message, code: 'ADMIN_MFA_CONFIGURATION_REQUIRED' }, { status: 503 });
    }
    return NextResponse.json({ error: 'Administrator security could not be updated.' }, { status: 503 });
  }
}
