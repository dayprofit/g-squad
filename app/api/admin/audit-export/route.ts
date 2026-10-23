import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server/admin-auth';
import { ensureDatabaseSchema, getNeonSql } from '@/lib/server/neon';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { role, response } = await requireAdmin('audit.export', { recentReauthentication: true });
  if (response) return response;
  if (role !== 'owner') return NextResponse.json({ error: 'Only an Owner can export the audit log.' }, { status: 403 });
  try {
    const params = new URL(request.url).searchParams;
    const from = params.get('from') ?? '';
    const to = params.get('to') ?? '';
    if (from && !isDate(from) || to && !isDate(to)) {
      return NextResponse.json({ error: 'Date filters must be valid YYYY-MM-DD dates.' }, { status: 400 });
    }
    await ensureDatabaseSchema();
    const rows = await getNeonSql()`SELECT a.id::text AS id, a.event_type AS "eventType",
      a.created_at::text AS "createdAt",
      CASE WHEN a.event_type = 'auth.login_failed' THEN 'System' ELSE COALESCE(actor.full_name, 'System') END AS actor,
      COALESCE(subject.full_name, 'Deleted user') AS subject,
      CASE WHEN a.event_type = 'auth.login_failed' THEN '{}'::jsonb ELSE a.details END AS details
      FROM app_user_activity a
      LEFT JOIN app_users actor ON actor.id = a.actor_user_id
      LEFT JOIN app_users subject ON subject.id = a.subject_user_id
      WHERE (${from === ''} OR a.created_at >= ${from || null}::date)
        AND (${to === ''} OR a.created_at < (${to || null}::date + interval '1 day'))
      ORDER BY a.created_at DESC LIMIT 10000` as Record<string, unknown>[];
    const quote = (value: unknown) => {
      const text = String(value ?? '');
      const safeText = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
      return `"${safeText.replace(/"/g, '""')}"`;
    };
    const csv = [
      ['id', 'event_type', 'created_at', 'actor', 'subject', 'safe_details'].map(quote).join(','),
      ...rows.map((row) => [
        row.id, row.eventType, row.createdAt, row.actor, row.subject,
        JSON.stringify(row.details ?? {}),
      ].map(quote).join(',')),
    ].join('\r\n');
    return NextResponse.json({ csv }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Admin audit export failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not export audit activity.' }, { status: 503 });
  }
}

function isDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
