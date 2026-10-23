import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server/admin-auth';
import { recordAppUserActivity } from '@/lib/server/app-auth';
import { ensureDatabaseSchema, getNeonSql } from '@/lib/server/neon';

export const runtime = 'nodejs';

const CHECKLIST_KEYS = ['cases_reassigned', 'review_complete'] as const;

export async function GET() {
  const { role, response } = await requireAdmin('staff.manage');
  if (response) return response;
  if (role !== 'owner') return NextResponse.json({ error: 'Only an Owner can view offboarding records.' }, { status: 403 });
  try {
    await ensureDatabaseSchema();
    const rows = await getNeonSql()`SELECT o.id::text AS id, o.staff_user_id::text AS "staffUserId",
      u.full_name AS "staffName", u.email, o.checklist, o.created_at::text AS "createdAt",
      o.completed_at::text AS "completedAt"
      FROM admin_offboarding o JOIN app_users u ON u.id = o.staff_user_id
      ORDER BY o.completed_at NULLS FIRST, o.created_at DESC LIMIT 100` as Record<string, unknown>[];
    return NextResponse.json({ offboarding: rows.map((row) => ({
      id: String(row.id), staffUserId: String(row.staffUserId), staffName: String(row.staffName),
      email: String(row.email), checklist: row.checklist && typeof row.checklist === 'object' ? row.checklist : {},
      createdAt: String(row.createdAt), completedAt: row.completedAt ? String(row.completedAt) : null,
    })) });
  } catch (error) {
    console.error('Admin offboarding lookup failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not load offboarding records.' }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const { user: admin, role, response } = await requireAdmin('staff.manage', { recentReauthentication: true });
  if (response) return response;
  if (role !== 'owner') return NextResponse.json({ error: 'Only an Owner can update offboarding records.' }, { status: 403 });
  try {
    const body = await request.json();
    const id = typeof body.id === 'string' ? body.id : '';
    const key = body.key;
    const checked = body.checked;
    if (!/^\d+$/.test(id) || !CHECKLIST_KEYS.includes(key) || typeof checked !== 'boolean') {
      return NextResponse.json({ error: 'Offboarding checklist update is invalid.' }, { status: 400 });
    }
    await ensureDatabaseSchema();
    const rows = await getNeonSql()`UPDATE admin_offboarding SET
      checklist = jsonb_set(checklist, ARRAY[${key}], ${JSON.stringify(checked)}::jsonb, true),
      completed_at = CASE WHEN (
        CASE WHEN ${key} = 'cases_reassigned' THEN ${checked} ELSE COALESCE((checklist->>'cases_reassigned')::boolean, false) END
        AND CASE WHEN ${key} = 'review_complete' THEN ${checked} ELSE COALESCE((checklist->>'review_complete')::boolean, false) END
        AND COALESCE((checklist->>'access_revoked')::boolean, false)
        AND COALESCE((checklist->>'sessions_ended')::boolean, false)
      ) THEN COALESCE(completed_at, now()) ELSE NULL END
      WHERE id = ${id}::bigint RETURNING staff_user_id::text AS "staffUserId"` as Record<string, unknown>[];
    if (!rows[0]) return NextResponse.json({ error: 'Offboarding record was not found.' }, { status: 404 });
    await recordAppUserActivity({
      actorUserId: admin!.id, subjectUserId: String(rows[0].staffUserId),
      eventType: 'admin.offboarding_checklist_updated', details: { recordId: id, key, checked },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Admin offboarding update failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not update offboarding checklist.' }, { status: 503 });
  }
}
