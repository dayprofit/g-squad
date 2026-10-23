import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server/admin-auth';
import { ensureDatabaseSchema, getNeonSql } from '@/lib/server/neon';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { response } = await requireAdmin('activity.read');
  if (response) return response;
  try {
    const search = new URL(request.url).searchParams.get('search')?.trim().slice(0, 100) ?? '';
    const pattern = `%${search}%`;
    const params = new URL(request.url).searchParams;
    const eventType = params.get('eventType')?.trim().slice(0, 80) ?? '';
    const page = Math.max(1, Math.min(100_000, Number.parseInt(params.get('page') ?? '1', 10) || 1));
    const pageSize = 50;
    const from = params.get('from') ?? '';
    const to = params.get('to') ?? '';
    const fromDate = parseDate(from);
    const toDate = parseDate(to);
    if (from && !fromDate || to && !toDate) {
      return NextResponse.json({ error: 'Date filters must use valid YYYY-MM-DD dates.' }, { status: 400 });
    }
    await ensureDatabaseSchema();
    const sql = getNeonSql();
    const [activityResult, countResult] = await Promise.all([sql`
      SELECT a.id::text AS id, a.event_type AS "eventType", a.details,
        a.created_at::text AS "createdAt",
        actor.full_name AS "actorName", actor.email AS "actorEmail",
        subject.full_name AS "subjectName", subject.email AS "subjectEmail"
      FROM app_user_activity a
      LEFT JOIN app_users actor ON actor.id = a.actor_user_id
      LEFT JOIN app_users subject ON subject.id = a.subject_user_id
      WHERE (${search === ''} OR actor.email ILIKE ${pattern} OR subject.email ILIKE ${pattern}
        OR actor.full_name ILIKE ${pattern} OR subject.full_name ILIKE ${pattern}
        OR a.event_type ILIKE ${pattern})
        AND (${eventType === ''} OR a.event_type = ${eventType})
        AND (${fromDate === null} OR a.created_at >= ${fromDate}::date)
        AND (${toDate === null} OR a.created_at < (${toDate}::date + interval '1 day'))
      ORDER BY a.created_at DESC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `, sql`
      SELECT COUNT(*)::int AS total FROM app_user_activity a
      LEFT JOIN app_users actor ON actor.id = a.actor_user_id
      LEFT JOIN app_users subject ON subject.id = a.subject_user_id
      WHERE (${search === ''} OR actor.email ILIKE ${pattern} OR subject.email ILIKE ${pattern}
        OR actor.full_name ILIKE ${pattern} OR subject.full_name ILIKE ${pattern}
        OR a.event_type ILIKE ${pattern})
        AND (${eventType === ''} OR a.event_type = ${eventType})
        AND (${fromDate === null} OR a.created_at >= ${fromDate}::date)
        AND (${toDate === null} OR a.created_at < (${toDate}::date + interval '1 day'))
    `]) as [Record<string, unknown>[], Record<string, unknown>[]];
    const activities = activityResult;
    return NextResponse.json({
      total: Number(countResult[0]?.total ?? 0),
      page,
      pageSize,
      activities: activities.map((activity) => ({
        id: String(activity.id),
        eventType: String(activity.eventType),
        details: activity.eventType === 'auth.login_failed'
          ? {}
          : activity.details && typeof activity.details === 'object' ? activity.details : {},
        createdAt: String(activity.createdAt),
        actorName: activity.actorName ? String(activity.actorName) : 'System',
        actorEmail: activity.actorEmail ? String(activity.actorEmail) : null,
        subjectName: activity.subjectName ? String(activity.subjectName) : 'Deleted user',
        subjectEmail: activity.subjectEmail ? String(activity.subjectEmail) : null,
      })),
    });
  } catch (error) {
    console.error('Admin activity lookup failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not load account activity.' }, { status: 503 });
  }

  function parseDate(value: string): string | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? null : value;
  }
}
