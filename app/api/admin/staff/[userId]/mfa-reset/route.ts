import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server/admin-auth';
import { isAdminEmail, recordAppUserActivity } from '@/lib/server/app-auth';
import { ensureDatabaseSchema, getNeonSql } from '@/lib/server/neon';

export const runtime = 'nodejs';

export async function POST(_request: Request, context: { params: Promise<{ userId: string }> }) {
  const { user: admin, response } = await requireAdmin('staff.manage', { recentReauthentication: true });
  if (response) return response;
  if (admin!.adminRole !== 'owner') return NextResponse.json({ error: 'Only an owner can reset staff MFA.' }, { status: 403 });
  try {
    const { userId } = await context.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
      return NextResponse.json({ error: 'Staff ID is invalid.' }, { status: 400 });
    }
    if (userId === admin!.id) return NextResponse.json({ error: 'Use a recovery code to regain your own admin session.' }, { status: 400 });
    await ensureDatabaseSchema();
    const target = await getNeonSql()`SELECT email,
      EXISTS (SELECT 1 FROM admin_staff WHERE user_id = app_users.id) AS "isStaff"
      FROM app_users WHERE id = ${userId}::uuid LIMIT 1` as Record<string, unknown>[];
    if (!target[0] || (target[0].isStaff !== true && !isAdminEmail(String(target[0].email)))) {
      return NextResponse.json({ error: 'Administrator was not found.' }, { status: 404 });
    }
    const rows = await getNeonSql()`UPDATE app_users SET admin_totp_enabled = false,
      admin_totp_secret = NULL, admin_totp_pending_secret = NULL,
      admin_totp_last_step = NULL, admin_totp_backup_codes = '[]'::jsonb
      WHERE id = ${userId}::uuid
      RETURNING id::text AS id` as Record<string, unknown>[];
    if (!rows[0]) return NextResponse.json({ error: 'Staff member was not found.' }, { status: 404 });
    await getNeonSql()`UPDATE app_sessions SET admin_mfa_verified_at = NULL, admin_reauthenticated_at = NULL
      WHERE user_id = ${userId}::uuid`;
    await recordAppUserActivity({
      actorUserId: admin!.id, subjectUserId: userId, eventType: 'admin.staff_mfa_reset',
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Admin staff MFA reset failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not reset staff MFA.' }, { status: 503 });
  }
}
