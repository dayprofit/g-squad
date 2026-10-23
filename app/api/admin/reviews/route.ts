import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server/admin-auth';
import { recordAppUserActivity } from '@/lib/server/app-auth';
import { ensureDatabaseSchema, getNeonSql } from '@/lib/server/neon';

export const runtime = 'nodejs';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET() {
  const { role, response } = await requireAdmin('reviews.manage');
  if (response) return response;
  if (role !== 'owner') return NextResponse.json({ error: 'Only an Owner can view permission reviews.' }, { status: 403 });
  try {
    await ensureDatabaseSchema();
    const rows = await getNeonSql()`SELECT r.id::text AS id, r.staff_user_id::text AS "staffUserId",
      u.full_name AS "staffName", u.email, s.role, r.due_at::text AS "dueAt",
      r.reviewed_at::text AS "reviewedAt", r.decision, reviewer.full_name AS "reviewerName"
      FROM admin_permission_reviews r
      JOIN app_users u ON u.id = r.staff_user_id
      LEFT JOIN admin_staff s ON s.user_id = r.staff_user_id
      LEFT JOIN app_users reviewer ON reviewer.id = r.reviewer_id
      ORDER BY r.reviewed_at NULLS FIRST, r.due_at LIMIT 100` as Record<string, unknown>[];
    return NextResponse.json({ reviews: rows.map((row) => ({
      id: String(row.id), staffUserId: String(row.staffUserId), staffName: String(row.staffName),
      email: String(row.email), role: row.role ? String(row.role) : 'access revoked',
      dueAt: String(row.dueAt), reviewedAt: row.reviewedAt ? String(row.reviewedAt) : null,
      decision: row.decision ? String(row.decision) : null,
      reviewerName: row.reviewerName ? String(row.reviewerName) : null,
    })) });
  } catch (error) {
    console.error('Admin permission review lookup failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not load permission reviews.' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const { user: admin, role, response } = await requireAdmin('reviews.manage', { recentReauthentication: true });
  if (response) return response;
  if (role !== 'owner') return NextResponse.json({ error: 'Only an Owner can schedule permission reviews.' }, { status: 403 });
  try {
    const body = await request.json();
    const staffUserId = typeof body.staffUserId === 'string' ? body.staffUserId : '';
    const dueAt = typeof body.dueAt === 'string' ? new Date(body.dueAt) : null;
    if (!UUID_PATTERN.test(staffUserId) || !dueAt || Number.isNaN(dueAt.getTime()) || dueAt.getTime() <= Date.now()) {
      return NextResponse.json({ error: 'Choose a staff member and a future review date.' }, { status: 400 });
    }
    await ensureDatabaseSchema();
    const staff = await getNeonSql()`SELECT 1 FROM admin_staff WHERE user_id = ${staffUserId}::uuid LIMIT 1` as Record<string, unknown>[];
    if (!staff[0]) return NextResponse.json({ error: 'Active staff member was not found.' }, { status: 404 });
    const existing = await getNeonSql()`SELECT id::text AS id FROM admin_permission_reviews
      WHERE staff_user_id = ${staffUserId}::uuid AND reviewed_at IS NULL ORDER BY created_at DESC LIMIT 1` as Record<string, unknown>[];
    const row = existing[0]
      ? await getNeonSql()`UPDATE admin_permission_reviews SET due_at = ${dueAt.toISOString()}, reviewer_id = ${admin!.id}::uuid
          WHERE id = ${String(existing[0].id)}::bigint RETURNING id::text AS id` as Record<string, unknown>[]
      : await getNeonSql()`INSERT INTO admin_permission_reviews (staff_user_id, reviewer_id, due_at)
          VALUES (${staffUserId}::uuid, ${admin!.id}::uuid, ${dueAt.toISOString()})
          RETURNING id::text AS id` as Record<string, unknown>[];
    await recordAppUserActivity({
      actorUserId: admin!.id, subjectUserId: staffUserId,
      eventType: 'admin.permission_review_scheduled', details: { reviewId: String(row[0].id), dueAt: dueAt.toISOString() },
    });
    return NextResponse.json({ id: String(row[0].id) }, { status: 201 });
  } catch (error) {
    console.error('Admin permission review scheduling failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not schedule this permission review.' }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const { user: admin, role, response } = await requireAdmin('reviews.manage', { recentReauthentication: true });
  if (response) return response;
  if (role !== 'owner') return NextResponse.json({ error: 'Only an Owner can complete permission reviews.' }, { status: 403 });
  try {
    const body = await request.json();
    const id = typeof body.id === 'string' ? body.id : '';
    const decision = body.decision;
    if (!/^\d+$/.test(id) || !['confirmed', 'changed', 'revoked'].includes(decision)) {
      return NextResponse.json({ error: 'Review ID or decision is invalid.' }, { status: 400 });
    }
    await ensureDatabaseSchema();
    const rows = await getNeonSql()`UPDATE admin_permission_reviews SET
      reviewer_id = ${admin!.id}::uuid, reviewed_at = now(), decision = ${decision}
      WHERE id = ${id}::bigint AND reviewed_at IS NULL
      RETURNING staff_user_id::text AS "staffUserId"` as Record<string, unknown>[];
    if (!rows[0]) return NextResponse.json({ error: 'Open permission review was not found.' }, { status: 404 });
    const staffUserId = String(rows[0].staffUserId);
    if (decision === 'revoked') {
      await getNeonSql()`DELETE FROM app_sessions WHERE user_id = ${staffUserId}::uuid`;
      await getNeonSql()`DELETE FROM admin_user_assignments WHERE staff_user_id = ${staffUserId}::uuid`;
      await getNeonSql()`DELETE FROM admin_staff WHERE user_id = ${staffUserId}::uuid`;
    }
    await recordAppUserActivity({
      actorUserId: admin!.id, subjectUserId: staffUserId, eventType: 'admin.permission_review_completed',
      details: { reviewId: id, decision },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Admin permission review completion failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not complete this permission review.' }, { status: 503 });
  }
}
