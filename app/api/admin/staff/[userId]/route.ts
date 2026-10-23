import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server/admin-auth';
import { recordAppUserActivity } from '@/lib/server/app-auth';
import { ensureDatabaseSchema, getNeonSql } from '@/lib/server/neon';
import { parseStaffSchedule } from '@/lib/admin-schedule';
import { ADMIN_PERMISSION_OPTIONS, type AdminPermission } from '@/lib/admin-permissions';

export const runtime = 'nodejs';
type StaffRole = 'support' | 'account_manager' | 'read_only';
const staffRoles: StaffRole[] = ['support', 'account_manager', 'read_only'];

export async function PATCH(request: Request, context: { params: Promise<{ userId: string }> }) {
  const { user: admin, role, response } = await requireAdmin('staff.manage', { recentReauthentication: true });
  if (response) return response;
  if (role !== 'owner') return NextResponse.json({ error: 'Only an Owner can change staff roles and permissions.' }, { status: 403 });
  try {
    const { userId } = await context.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
      return NextResponse.json({ error: 'Staff ID is invalid.' }, { status: 400 });
    }
    const body = await request.json();
    if (!staffRoles.includes(body.role)) return NextResponse.json({ error: 'Choose a supported staff role.' }, { status: 400 });
    const schedule = parseStaffSchedule(body.schedule);
    if (!schedule) return NextResponse.json({ error: 'Provide a valid timezone, weekly work schedule, and role date range.' }, { status: 400 });
    const permissions = body.permissions === undefined ? null : body.permissions;
    if (permissions !== null && (!Array.isArray(permissions) || permissions.some((permission: unknown) => !ADMIN_PERMISSION_OPTIONS.includes(permission as AdminPermission)))) {
      return NextResponse.json({ error: 'Choose only supported administrator permissions.' }, { status: 400 });
    }
    if (role !== 'owner' && Array.isArray(permissions)) {
      return NextResponse.json({ error: 'Only an Owner can assign custom permissions.' }, { status: 403 });
    }
    const teamName = typeof body.teamName === 'string' ? body.teamName.trim() : '';
    const regionName = typeof body.regionName === 'string' ? body.regionName.trim() : '';
    const temporaryAccessExpiresAt = body.temporaryAccessExpiresAt === null || body.temporaryAccessExpiresAt === ''
      ? null
      : typeof body.temporaryAccessExpiresAt === 'string' && Number.isFinite(Date.parse(body.temporaryAccessExpiresAt))
        ? new Date(body.temporaryAccessExpiresAt)
        : undefined;
    if (teamName.length > 80 || regionName.length > 80 || temporaryAccessExpiresAt === undefined) {
      return NextResponse.json({ error: 'Team, region, or temporary access expiration is invalid.' }, { status: 400 });
    }
    await ensureDatabaseSchema();
    const target = await getNeonSql()`SELECT 1 FROM admin_staff WHERE user_id = ${userId}::uuid LIMIT 1` as Record<string, unknown>[];
    if (!target[0]) return NextResponse.json({ error: 'Staff member was not found.' }, { status: 404 });
    const pending = await getNeonSql()`SELECT 1 FROM admin_approvals
      WHERE requested_by = ${admin!.id}::uuid AND target_user_id = ${userId}::uuid
        AND action_type = 'staff.role_change' AND status = 'pending' LIMIT 1` as Record<string, unknown>[];
    if (pending[0]) return NextResponse.json({ error: 'A role-change approval is already pending for this staff member.' }, { status: 409 });
    const payload = {
      role: body.role,
      schedule: {
        timezone: schedule.timezone,
        shifts: schedule.shifts,
        roleStartsOn: schedule.roleStartsOn,
        roleEndsOn: schedule.roleEndsOn,
      },
      permissions,
      teamName,
      regionName,
      temporaryAccessExpiresAt: temporaryAccessExpiresAt?.toISOString() ?? null,
    };
    const approval = await getNeonSql()`INSERT INTO admin_approvals
      (requested_by, action_type, target_user_id, payload)
      VALUES (${admin!.id}::uuid, 'staff.role_change', ${userId}::uuid, ${JSON.stringify(payload)}::jsonb)
      RETURNING id::text AS id` as Record<string, unknown>[];
    await recordAppUserActivity({
      actorUserId: admin!.id, subjectUserId: userId, eventType: 'admin.staff_role_change_requested',
      details: { approvalId: String(approval[0].id), role: body.role, permissions, schedule },
    });
    return NextResponse.json({ approvalId: String(approval[0].id), status: 'pending' }, { status: 202 });
  } catch (error) {
    console.error('Admin staff role update failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not update staff role.' }, { status: 503 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ userId: string }> }) {
  const { user: admin, role, response } = await requireAdmin('staff.manage', { recentReauthentication: true });
  if (response) return response;
  if (role !== 'owner') return NextResponse.json({ error: 'Only an Owner can revoke staff access.' }, { status: 403 });
  try {
    const { userId } = await context.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
      return NextResponse.json({ error: 'Staff ID is invalid.' }, { status: 400 });
    }
    if (userId === admin!.id) return NextResponse.json({ error: 'You cannot revoke your own staff role.' }, { status: 400 });
    await ensureDatabaseSchema();
    const staff = await getNeonSql()`SELECT user_id::text AS id FROM admin_staff WHERE user_id = ${userId}::uuid LIMIT 1` as Record<string, unknown>[];
    if (!staff[0]) return NextResponse.json({ error: 'Staff member was not found.' }, { status: 404 });
    const offboarding = await getNeonSql()`INSERT INTO admin_offboarding (staff_user_id, started_by)
      VALUES (${userId}::uuid, ${admin!.id}::uuid) RETURNING id::text AS id` as Record<string, unknown>[];
    await getNeonSql()`DELETE FROM app_sessions WHERE user_id = ${userId}::uuid`;
    await getNeonSql()`DELETE FROM admin_user_assignments WHERE staff_user_id = ${userId}::uuid`;
    await getNeonSql()`UPDATE admin_offboarding SET checklist = '{"access_revoked":true,"sessions_ended":true,"cases_reassigned":false,"review_complete":false}'::jsonb
      WHERE id = ${String(offboarding[0].id)}::bigint`;
    const result = await getNeonSql()`DELETE FROM admin_staff WHERE user_id = ${userId}::uuid
      RETURNING user_id::text AS id` as Record<string, unknown>[];
    if (!result[0]) return NextResponse.json({ error: 'Staff member was not found.' }, { status: 404 });
    await recordAppUserActivity({
      actorUserId: admin!.id, subjectUserId: userId, eventType: 'admin.staff_access_revoked',
      details: { offboardingId: String(offboarding[0].id) },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Admin staff access revocation failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not revoke staff access.' }, { status: 503 });
  }
}
