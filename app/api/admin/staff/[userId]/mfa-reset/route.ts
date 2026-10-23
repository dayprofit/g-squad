import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server/admin-auth';
import { isAdminEmail, recordAppUserActivity } from '@/lib/server/app-auth';
import { ensureDatabaseSchema, getNeonSql } from '@/lib/server/neon';

export const runtime = 'nodejs';

export async function POST(_request: Request, context: { params: Promise<{ userId: string }> }) {
  const { user: admin, role, response } = await requireAdmin('staff.manage', { recentReauthentication: true });
  if (response) return response;
  if (role !== 'owner') return NextResponse.json({ error: 'Only an owner can request an MFA reset.' }, { status: 403 });
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
    const pending = await getNeonSql()`SELECT 1 FROM admin_approvals
      WHERE requested_by = ${admin!.id}::uuid AND target_user_id = ${userId}::uuid
        AND action_type = 'staff.mfa_reset' AND status = 'pending' LIMIT 1` as Record<string, unknown>[];
    if (pending[0]) return NextResponse.json({ error: 'An MFA-reset approval is already pending for this administrator.' }, { status: 409 });
    const rows = await getNeonSql()`INSERT INTO admin_approvals (requested_by, action_type, target_user_id)
      VALUES (${admin!.id}::uuid, 'staff.mfa_reset', ${userId}::uuid)
      RETURNING id::text AS id` as Record<string, unknown>[];
    await recordAppUserActivity({
      actorUserId: admin!.id, subjectUserId: userId, eventType: 'admin.approval_requested',
      details: { approvalId: String(rows[0].id), actionType: 'staff.mfa_reset' },
    });
    return NextResponse.json({ approvalId: String(rows[0].id), status: 'pending' }, { status: 202 });
  } catch (error) {
    console.error('Admin staff MFA reset failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not reset staff MFA.' }, { status: 503 });
  }
}
