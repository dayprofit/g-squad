import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server/admin-auth';
import { recordAppUserActivity } from '@/lib/server/app-auth';
import { ensureDatabaseSchema, getNeonSql } from '@/lib/server/neon';

export const runtime = 'nodejs';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const { role, response } = await requireAdmin('assignments.manage');
  if (response) return response;
  if (role !== 'owner') return NextResponse.json({ error: 'Only an Owner can view account assignments.' }, { status: 403 });
  try {
    const userId = new URL(request.url).searchParams.get('userId') ?? '';
    if (!UUID_PATTERN.test(userId)) return NextResponse.json({ error: 'User ID is invalid.' }, { status: 400 });
    await ensureDatabaseSchema();
    const [staff, assignment] = await Promise.all([
      getNeonSql()`SELECT u.id::text AS id, u.full_name AS "fullName", u.email, s.role
        FROM admin_staff s JOIN app_users u ON u.id = s.user_id ORDER BY u.full_name`,
      getNeonSql()`SELECT a.staff_user_id::text AS "staffUserId", a.team_name AS "teamName",
        a.region_name AS "regionName"
        FROM admin_user_assignments a WHERE a.user_id = ${userId}::uuid LIMIT 1`,
    ]) as [Record<string, unknown>[], Record<string, unknown>[]];
    return NextResponse.json({
      staff: staff.map((row) => ({ id: String(row.id), fullName: String(row.fullName), email: String(row.email), role: String(row.role) })),
      assignment: assignment[0] ? {
        staffUserId: String(assignment[0].staffUserId),
        teamName: String(assignment[0].teamName ?? ''),
        regionName: String(assignment[0].regionName ?? ''),
      } : null,
    });
  } catch (error) {
    console.error('Admin assignment lookup failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not load account assignment.' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const { user: admin, role, response } = await requireAdmin('assignments.manage', { recentReauthentication: true });
  if (response) return response;
  if (role !== 'owner') return NextResponse.json({ error: 'Only an Owner can manage account assignments.' }, { status: 403 });
  try {
    const body = await request.json();
    const userId = typeof body.userId === 'string' ? body.userId : '';
    const staffUserId = typeof body.staffUserId === 'string' ? body.staffUserId : '';
    const teamName = typeof body.teamName === 'string' ? body.teamName.trim() : '';
    const regionName = typeof body.regionName === 'string' ? body.regionName.trim() : '';
    if (!UUID_PATTERN.test(userId) || !UUID_PATTERN.test(staffUserId) || teamName.length > 80 || regionName.length > 80) {
      return NextResponse.json({ error: 'Provide a valid account, staff member, team, and region.' }, { status: 400 });
    }
    await ensureDatabaseSchema();
    const [user, staff] = await Promise.all([
      getNeonSql()`SELECT 1 FROM app_users WHERE id = ${userId}::uuid LIMIT 1`,
      getNeonSql()`SELECT 1 FROM admin_staff WHERE user_id = ${staffUserId}::uuid LIMIT 1`,
    ]) as [Record<string, unknown>[], Record<string, unknown>[]];
    if (!user[0]) return NextResponse.json({ error: 'User was not found.' }, { status: 404 });
    if (!staff[0]) return NextResponse.json({ error: 'Choose an active staff member.' }, { status: 400 });
    const rows = await getNeonSql()`INSERT INTO admin_user_assignments
      (user_id, staff_user_id, assigned_by, team_name, region_name)
      VALUES (${userId}::uuid, ${staffUserId}::uuid, ${admin!.id}::uuid, ${teamName || null}, ${regionName || null})
      ON CONFLICT (user_id) DO UPDATE SET
        staff_user_id = EXCLUDED.staff_user_id, assigned_by = EXCLUDED.assigned_by,
        team_name = EXCLUDED.team_name, region_name = EXCLUDED.region_name, updated_at = now()
      RETURNING user_id::text AS id` as Record<string, unknown>[];
    await recordAppUserActivity({
      actorUserId: admin!.id, subjectUserId: userId, eventType: 'admin.user_assigned',
      details: { staffUserId, teamName, regionName },
    });
    return NextResponse.json({ success: true, userId: String(rows[0].id) });
  } catch (error) {
    console.error('Admin assignment update failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not assign this account.' }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  const { user: admin, role, response } = await requireAdmin('assignments.manage', { recentReauthentication: true });
  if (response) return response;
  if (role !== 'owner') return NextResponse.json({ error: 'Only an Owner can manage account assignments.' }, { status: 403 });
  try {
    const userId = new URL(request.url).searchParams.get('userId') ?? '';
    if (!UUID_PATTERN.test(userId)) return NextResponse.json({ error: 'User ID is invalid.' }, { status: 400 });
    await ensureDatabaseSchema();
    await getNeonSql()`DELETE FROM admin_user_assignments WHERE user_id = ${userId}::uuid`;
    await recordAppUserActivity({ actorUserId: admin!.id, subjectUserId: userId, eventType: 'admin.user_unassigned' });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Admin assignment removal failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not remove this assignment.' }, { status: 503 });
  }
}
