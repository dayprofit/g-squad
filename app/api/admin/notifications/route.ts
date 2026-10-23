import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server/admin-auth';
import { ensureDatabaseSchema, getNeonSql } from '@/lib/server/neon';

export const runtime = 'nodejs';

export async function GET() {
  const { user, response } = await requireAdmin('alerts.read');
  if (response) return response;
  try {
    await ensureDatabaseSchema();
    const rows = await getNeonSql()`SELECT id::text AS id, notification_type AS type, title, message,
      read_at::text AS "readAt", created_at::text AS "createdAt"
      FROM admin_notifications WHERE recipient_id = ${user!.id}::uuid
      ORDER BY created_at DESC LIMIT 100` as Record<string, unknown>[];
    return NextResponse.json({ notifications: rows });
  } catch (error) {
    console.error('Admin notifications lookup failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not load notifications.' }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const { user, response } = await requireAdmin('alerts.read');
  if (response) return response;
  try {
    const body = await request.json();
    const id = typeof body.id === 'string' ? body.id : '';
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: 'Notification ID is invalid.' }, { status: 400 });
    await ensureDatabaseSchema();
    await getNeonSql()`UPDATE admin_notifications SET read_at = COALESCE(read_at, now())
      WHERE id = ${id}::bigint AND recipient_id = ${user!.id}::uuid`;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Admin notification update failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not update notification.' }, { status: 503 });
  }
}
