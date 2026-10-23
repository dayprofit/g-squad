import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server/admin-auth';
import { recordAppUserActivity } from '@/lib/server/app-auth';
import { ensureDatabaseSchema, getNeonSql } from '@/lib/server/neon';

export const runtime = 'nodejs';
type StaffRole = 'support' | 'account_manager' | 'read_only';
const staffRoles: StaffRole[] = ['support', 'account_manager', 'read_only'];

export async function PATCH(request: Request, context: { params: Promise<{ userId: string }> }) {
  const { user: admin, response } = await requireAdmin('staff.manage', { recentReauthentication: true });
  if (response) return response;
  try {
    const { userId } = await context.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
      return NextResponse.json({ error: 'Staff ID is invalid.' }, { status: 400 });
    }
    const body = await request.json();
    if (!staffRoles.includes(body.role)) return NextResponse.json({ error: 'Choose a supported staff role.' }, { status: 400 });
    await ensureDatabaseSchema();
    const result = await getNeonSql()`UPDATE admin_staff SET role = ${body.role}
      WHERE user_id = ${userId}::uuid RETURNING user_id::text AS id` as Record<string, unknown>[];
    if (!result[0]) return NextResponse.json({ error: 'Staff member was not found.' }, { status: 404 });
    await getNeonSql()`UPDATE app_sessions SET admin_mfa_verified_at = NULL, admin_reauthenticated_at = NULL WHERE user_id = ${userId}::uuid`;
    await recordAppUserActivity({
      actorUserId: admin!.id, subjectUserId: userId, eventType: 'admin.staff_role_changed',
      details: { role: body.role },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Admin staff role update failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not update staff role.' }, { status: 503 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ userId: string }> }) {
  const { user: admin, response } = await requireAdmin('staff.manage', { recentReauthentication: true });
  if (response) return response;
  try {
    const { userId } = await context.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
      return NextResponse.json({ error: 'Staff ID is invalid.' }, { status: 400 });
    }
    if (userId === admin!.id) return NextResponse.json({ error: 'You cannot revoke your own staff role.' }, { status: 400 });
    await ensureDatabaseSchema();
    const result = await getNeonSql()`DELETE FROM admin_staff WHERE user_id = ${userId}::uuid
      RETURNING user_id::text AS id` as Record<string, unknown>[];
    if (!result[0]) return NextResponse.json({ error: 'Staff member was not found.' }, { status: 404 });
    await getNeonSql()`UPDATE app_sessions SET admin_mfa_verified_at = NULL, admin_reauthenticated_at = NULL WHERE user_id = ${userId}::uuid`;
    await recordAppUserActivity({ actorUserId: admin!.id, subjectUserId: userId, eventType: 'admin.staff_access_revoked' });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Admin staff access revocation failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not revoke staff access.' }, { status: 503 });
  }
}
