import { NextResponse } from 'next/server';
import { hasAssignedUserAccess, requireAdmin } from '@/lib/server/admin-auth';
import { recordAppUserActivity } from '@/lib/server/app-auth';
import { ensureDatabaseSchema, getNeonSql } from '@/lib/server/neon';

export const runtime = 'nodejs';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = ['open', 'in_progress', 'waiting', 'resolved', 'closed'] as const;
const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

export async function GET() {
  const { user, role, response } = await requireAdmin('cases.read');
  if (response) return response;
  try {
    await ensureDatabaseSchema();
    const scoped = role !== 'owner';
    const rows = await getNeonSql()`SELECT c.id::text AS id, c.user_id::text AS "userId",
      u.full_name AS "userName", u.email AS "userEmail", c.subject, c.description,
      c.status, c.priority, c.assigned_to::text AS "assignedTo",
      staff_user.full_name AS "assignedName", c.created_at::text AS "createdAt",
      c.updated_at::text AS "updatedAt", c.due_at::text AS "dueAt"
      FROM admin_support_cases c
      JOIN app_users u ON u.id = c.user_id
      LEFT JOIN app_users staff_user ON staff_user.id = c.assigned_to
      WHERE (${!scoped} OR c.assigned_to = ${user!.id}::uuid)
      ORDER BY CASE c.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
        c.due_at NULLS LAST, c.updated_at DESC
      LIMIT 200` as Record<string, unknown>[];
    return NextResponse.json({
      cases: rows.map((row) => ({
        id: String(row.id), userId: String(row.userId), userName: String(row.userName),
        userEmail: String(row.userEmail), subject: String(row.subject), description: String(row.description),
        status: String(row.status), priority: String(row.priority),
        assignedTo: row.assignedTo ? String(row.assignedTo) : null,
        assignedName: row.assignedName ? String(row.assignedName) : null,
        createdAt: String(row.createdAt), updatedAt: String(row.updatedAt),
        dueAt: row.dueAt ? String(row.dueAt) : null,
        overdue: Boolean(row.dueAt && Date.parse(String(row.dueAt)) < Date.now() && !['resolved', 'closed'].includes(String(row.status))),
      })),
    });
  } catch (error) {
    console.error('Admin support cases lookup failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not load support cases.' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const { user: admin, role, response } = await requireAdmin('cases.manage', { recentReauthentication: true });
  if (response) return response;
  try {
    const body = await request.json();
    const userId = typeof body.userId === 'string' ? body.userId : '';
    const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    const priority = body.priority;
    const assignedTo = typeof body.assignedTo === 'string' ? body.assignedTo : '';
    if (!UUID_PATTERN.test(userId) || subject.length < 3 || subject.length > 160 || description.length < 3 || description.length > 5000) {
      return NextResponse.json({ error: 'Provide a valid user, case subject, and description.' }, { status: 400 });
    }
    if (!PRIORITIES.includes(priority)) return NextResponse.json({ error: 'Choose a supported case priority.' }, { status: 400 });
    if (assignedTo && !UUID_PATTERN.test(assignedTo)) return NextResponse.json({ error: 'Assignee is invalid.' }, { status: 400 });
    if (role !== 'owner' && assignedTo && assignedTo !== admin!.id) {
      return NextResponse.json({ error: 'Staff may assign new cases only to themselves.' }, { status: 403 });
    }
    await ensureDatabaseSchema();
    const userRows = await getNeonSql()`SELECT 1 FROM app_users WHERE id = ${userId}::uuid LIMIT 1` as Record<string, unknown>[];
    if (!userRows[0]) return NextResponse.json({ error: 'User was not found.' }, { status: 404 });
    if (assignedTo) {
      const staffRows = await getNeonSql()`SELECT 1 FROM admin_staff WHERE user_id = ${assignedTo}::uuid LIMIT 1` as Record<string, unknown>[];
      if (!staffRows[0]) return NextResponse.json({ error: 'Choose an active staff member to assign this case.' }, { status: 400 });
    }
    if (!await hasAssignedUserAccess(admin!.id, role!, userId)) {
      return NextResponse.json({ error: 'This account is outside your assigned scope.' }, { status: 403 });
    }
    const rows = await getNeonSql()`INSERT INTO admin_support_cases
      (user_id, subject, description, priority, assigned_to, created_by, due_at)
      VALUES (${userId}::uuid, ${subject}, ${description}, ${priority},
        ${assignedTo || admin!.id}::uuid, ${admin!.id}::uuid,
        CASE WHEN ${priority === 'urgent'} THEN now() + interval '4 hours'
          WHEN ${priority === 'high'} THEN now() + interval '1 day'
          ELSE now() + interval '3 days' END)
      RETURNING id::text AS id` as Record<string, unknown>[];
    await recordAppUserActivity({
      actorUserId: admin!.id,
      subjectUserId: userId,
      eventType: 'admin.case_created',
      details: { caseId: String(rows[0].id), priority },
    });
    return NextResponse.json({ id: String(rows[0].id) }, { status: 201 });
  } catch (error) {
    console.error('Admin support case creation failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not create support case.' }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const { user: admin, role, response } = await requireAdmin('cases.manage', { recentReauthentication: true });
  if (response) return response;
  try {
    const body = await request.json();
    const id = typeof body.id === 'string' ? body.id : '';
    const status = body.status;
    const priority = body.priority;
    const assignedTo = body.assignedTo === null ? null : typeof body.assignedTo === 'string' ? body.assignedTo : undefined;
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: 'Case ID is invalid.' }, { status: 400 });
    if (status !== undefined && !STATUSES.includes(status)) return NextResponse.json({ error: 'Choose a supported case status.' }, { status: 400 });
    if (priority !== undefined && !PRIORITIES.includes(priority)) return NextResponse.json({ error: 'Choose a supported priority.' }, { status: 400 });
    if (assignedTo !== undefined && assignedTo !== null && !UUID_PATTERN.test(assignedTo)) {
      return NextResponse.json({ error: 'Assignee is invalid.' }, { status: 400 });
    }
    if (assignedTo) {
      const staffRows = await getNeonSql()`SELECT 1 FROM admin_staff WHERE user_id = ${assignedTo}::uuid LIMIT 1` as Record<string, unknown>[];
      if (!staffRows[0]) return NextResponse.json({ error: 'Choose an active staff member to assign this case.' }, { status: 400 });
    }
    if (role !== 'owner' && assignedTo !== undefined && assignedTo !== admin!.id) {
      return NextResponse.json({ error: 'Staff may assign cases only to themselves.' }, { status: 403 });
    }
    const rows = await getNeonSql()`UPDATE admin_support_cases SET
      status = COALESCE(${status ?? null}, status),
      priority = COALESCE(${priority ?? null}, priority),
      assigned_to = CASE WHEN ${assignedTo !== undefined} THEN ${assignedTo}::uuid ELSE assigned_to END,
      updated_at = now()
      WHERE id = ${id}::bigint AND (${role === 'owner'} OR assigned_to = ${admin!.id}::uuid)
      RETURNING id::text AS id, user_id::text AS "userId", status, priority` as Record<string, unknown>[];
    if (!rows[0]) return NextResponse.json({ error: 'Case was not found or is outside your assignment.' }, { status: 404 });
    await recordAppUserActivity({
      actorUserId: admin!.id, subjectUserId: String(rows[0].userId), eventType: 'admin.case_updated',
      details: { caseId: id, status: rows[0].status, priority: rows[0].priority },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Admin support case update failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not update support case.' }, { status: 503 });
  }
}
