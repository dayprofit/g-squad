import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server/admin-auth';
import { recordAppUserActivity } from '@/lib/server/app-auth';
import { ensureDatabaseSchema, getNeonSql } from '@/lib/server/neon';

export const runtime = 'nodejs';

export async function GET() {
  const { role, response } = await requireAdmin('approvals.review');
  if (response) return response;
  if (role !== 'owner') return NextResponse.json({ error: 'Only an Owner can view action approvals.' }, { status: 403 });
  try {
    await ensureDatabaseSchema();
    const rows = await getNeonSql()`SELECT a.id::text AS id, a.action_type AS "actionType",
      a.target_user_id::text AS "targetUserId", a.payload, a.status,
      a.review_note AS "reviewNote", a.created_at::text AS "createdAt",
      requester.full_name AS "requesterName", reviewer.full_name AS "reviewerName"
      FROM admin_approvals a
      JOIN app_users requester ON requester.id = a.requested_by
      LEFT JOIN app_users reviewer ON reviewer.id = a.reviewed_by
      ORDER BY CASE WHEN a.status = 'pending' THEN 0 ELSE 1 END, a.created_at DESC LIMIT 100` as Record<string, unknown>[];
    return NextResponse.json({ approvals: rows.map((row) => ({
      id: String(row.id), actionType: String(row.actionType),
      targetUserId: row.targetUserId ? String(row.targetUserId) : null,
      payload: row.payload && typeof row.payload === 'object' ? row.payload : {},
      status: String(row.status), reviewNote: row.reviewNote ? String(row.reviewNote) : null,
      createdAt: String(row.createdAt), requesterName: String(row.requesterName),
      reviewerName: row.reviewerName ? String(row.reviewerName) : null,
    })) });
  } catch (error) {
    console.error('Admin approvals lookup failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not load approvals.' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const { user: admin, role, response } = await requireAdmin('staff.permissions', { recentReauthentication: true });
  if (response) return response;
  if (role !== 'owner') return NextResponse.json({ error: 'Only an Owner can request a privileged action approval.' }, { status: 403 });
  try {
    const body = await request.json();
    const actionType = body.actionType;
    const targetUserId = typeof body.targetUserId === 'string' ? body.targetUserId : '';
    const payload = body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload) ? body.payload : {};
    if (!['staff.role_change', 'staff.mfa_reset', 'account.restore'].includes(actionType)
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetUserId)) {
      return NextResponse.json({ error: 'Choose a supported action and valid target account.' }, { status: 400 });
    }
    await ensureDatabaseSchema();
    const target = await getNeonSql()`SELECT u.is_suspended AS "isSuspended",
      EXISTS (SELECT 1 FROM admin_staff WHERE user_id = u.id) AS "isStaff"
      FROM app_users u WHERE u.id = ${targetUserId}::uuid LIMIT 1` as Record<string, unknown>[];
    if (!target[0]) return NextResponse.json({ error: 'Target account was not found.' }, { status: 404 });
    if (actionType === 'staff.role_change') {
      return NextResponse.json({ error: 'Staff role changes must be submitted through the staff-management workflow.' }, { status: 400 });
    }
    if (actionType === 'staff.mfa_reset' && target[0].isStaff !== true) {
      return NextResponse.json({ error: 'MFA reset approvals are only available for staff accounts.' }, { status: 400 });
    }
    if (actionType === 'account.restore' && target[0].isSuspended !== true) {
      return NextResponse.json({ error: 'Only suspended accounts can be submitted for restoration.' }, { status: 409 });
    }
    const pending = await getNeonSql()`SELECT 1 FROM admin_approvals
      WHERE target_user_id = ${targetUserId}::uuid AND action_type = ${actionType}
        AND status = 'pending' LIMIT 1` as Record<string, unknown>[];
    if (pending[0]) return NextResponse.json({ error: 'A matching approval is already pending for this account.' }, { status: 409 });
    const rows = await getNeonSql()`INSERT INTO admin_approvals (requested_by, action_type, target_user_id, payload)
      VALUES (${admin!.id}::uuid, ${actionType}, ${targetUserId}::uuid, ${JSON.stringify(payload)}::jsonb)
      RETURNING id::text AS id` as Record<string, unknown>[];
    await recordAppUserActivity({ actorUserId: admin!.id, subjectUserId: targetUserId, eventType: 'admin.approval_requested', details: { approvalId: String(rows[0].id), actionType } });
    return NextResponse.json({ id: String(rows[0].id), status: 'pending' }, { status: 201 });
  } catch (error) {
    console.error('Admin approval request failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not request this approval.' }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const { user: admin, role, response } = await requireAdmin('approvals.review', { recentReauthentication: true });
  if (response) return response;
  if (role !== 'owner') return NextResponse.json({ error: 'Only an Owner can review action approvals.' }, { status: 403 });
  try {
    const body = await request.json();
    const id = typeof body.id === 'string' ? body.id : '';
    const decision = body.decision;
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : '';
    if (!/^\d+$/.test(id) || !['approved', 'rejected'].includes(decision)) {
      return NextResponse.json({ error: 'Approval ID or decision is invalid.' }, { status: 400 });
    }
    await ensureDatabaseSchema();
    const rows = await getNeonSql()`SELECT id::text AS id, requested_by::text AS "requestedBy",
      action_type AS "actionType", target_user_id::text AS "targetUserId", payload
      FROM admin_approvals WHERE id = ${id}::bigint AND status = 'pending' LIMIT 1` as Record<string, unknown>[];
    const approval = rows[0];
    if (!approval) return NextResponse.json({ error: 'Pending approval was not found.' }, { status: 404 });
    if (String(approval.requestedBy) === admin!.id) return NextResponse.json({ error: 'A different Owner must review this request.' }, { status: 403 });
    if (decision === 'approved') {
      const targetUserId = String(approval.targetUserId);
      if (approval.actionType === 'staff.mfa_reset') {
        const updated = await getNeonSql()`UPDATE app_users SET admin_totp_enabled = false, admin_totp_secret = NULL,
          admin_totp_pending_secret = NULL, admin_totp_backup_codes = '[]'::jsonb, admin_totp_last_step = NULL
          WHERE id = ${targetUserId}::uuid RETURNING id` as Record<string, unknown>[];
        if (!updated[0]) return NextResponse.json({ error: 'Administrator account was not found.' }, { status: 404 });
        await getNeonSql()`UPDATE app_sessions SET admin_mfa_verified_at = NULL, admin_reauthenticated_at = NULL
          WHERE user_id = ${targetUserId}::uuid`;
      } else if (approval.actionType === 'account.restore') {
        const updated = await getNeonSql()`UPDATE app_users SET is_suspended = false
          WHERE id = ${targetUserId}::uuid RETURNING id` as Record<string, unknown>[];
        if (!updated[0]) return NextResponse.json({ error: 'Account was not found.' }, { status: 404 });
      } else if (approval.actionType === 'staff.role_change') {
        const payload = approval.payload && typeof approval.payload === 'object'
          ? approval.payload as Record<string, unknown>
          : {};
        const schedule = payload.schedule && typeof payload.schedule === 'object'
          ? payload.schedule as Record<string, unknown>
          : {};
        const shifts = Array.isArray(schedule.shifts) ? schedule.shifts : [];
        const role = payload.role;
        const permissions = Array.isArray(payload.permissions) ? payload.permissions : null;
        if (!['support', 'account_manager', 'read_only'].includes(String(role))) {
          return NextResponse.json({ error: 'The requested staff role is invalid.' }, { status: 409 });
        }
        const updated = await getNeonSql()`UPDATE admin_staff SET role = ${role},
          schedule_timezone = ${String(schedule.timezone ?? 'UTC')},
          work_schedule = ${JSON.stringify(shifts)}::jsonb,
          role_starts_on = ${typeof schedule.roleStartsOn === 'string' ? schedule.roleStartsOn : null}::date,
          role_ends_on = ${typeof schedule.roleEndsOn === 'string' ? schedule.roleEndsOn : null}::date,
          permissions = ${permissions ? JSON.stringify(permissions) : null}::jsonb,
          team_name = ${typeof payload.teamName === 'string' && payload.teamName ? payload.teamName : null},
          region_name = ${typeof payload.regionName === 'string' && payload.regionName ? payload.regionName : null},
          temporary_access_expires_at = ${typeof payload.temporaryAccessExpiresAt === 'string' ? payload.temporaryAccessExpiresAt : null}::timestamptz
          WHERE user_id = ${targetUserId}::uuid RETURNING user_id` as Record<string, unknown>[];
        if (!updated[0]) return NextResponse.json({ error: 'Staff member no longer has admin access.' }, { status: 409 });
        await getNeonSql()`UPDATE app_sessions SET admin_mfa_verified_at = NULL, admin_reauthenticated_at = NULL
          WHERE user_id = ${targetUserId}::uuid`;
      } else {
        return NextResponse.json({ error: 'This approval action is not executable.' }, { status: 409 });
      }
    }
    await getNeonSql()`UPDATE admin_approvals SET status = ${decision}, reviewed_by = ${admin!.id}::uuid,
      review_note = ${note || null}, reviewed_at = now() WHERE id = ${id}::bigint`;
    await recordAppUserActivity({
      actorUserId: admin!.id, subjectUserId: String(approval.targetUserId),
      eventType: decision === 'approved' ? 'admin.approval_approved' : 'admin.approval_rejected',
      details: { approvalId: id, actionType: String(approval.actionType) },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Admin approval review failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not review this approval.' }, { status: 503 });
  }
}
