import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server/admin-auth';
import { recordAppUserActivity } from '@/lib/server/app-auth';
import { ensureDatabaseSchema, getNeonSql } from '@/lib/server/neon';

export const runtime = 'nodejs';

export async function GET() {
  const { role, response } = await requireAdmin('settings.manage');
  if (response) return response;
  if (role !== 'owner') return NextResponse.json({ error: 'Only an Owner can view audit-retention settings.' }, { status: 403 });
  try {
    await ensureDatabaseSchema();
    const rows = await getNeonSql()`SELECT setting_value AS value, updated_at::text AS "updatedAt"
      FROM admin_settings WHERE setting_key = 'audit_retention_days' LIMIT 1` as Record<string, unknown>[];
    return NextResponse.json({ auditRetentionDays: rows[0]?.value ?? null, updatedAt: rows[0]?.updatedAt ?? null });
  } catch (error) {
    console.error('Admin settings lookup failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not load admin settings.' }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const { user: admin, role, response } = await requireAdmin('settings.manage', { recentReauthentication: true });
  if (response) return response;
  if (role !== 'owner') return NextResponse.json({ error: 'Only an Owner can change audit-retention settings.' }, { status: 403 });
  try {
    const body = await request.json();
    const days = body.auditRetentionDays;
    if (days !== null && (!Number.isInteger(days) || days < 30 || days > 3650)) {
      return NextResponse.json({ error: 'Retention must be between 30 and 3650 days, or unset to retain records indefinitely.' }, { status: 400 });
    }
    await ensureDatabaseSchema();
    await getNeonSql()`INSERT INTO admin_settings (setting_key, setting_value, updated_by)
      VALUES ('audit_retention_days', ${JSON.stringify(days)}::jsonb, ${admin!.id}::uuid)
      ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value,
        updated_by = EXCLUDED.updated_by, updated_at = now()`;
    await recordAppUserActivity({ actorUserId: admin!.id, eventType: 'admin.retention_policy_changed', details: { days } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Admin settings update failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not update retention settings.' }, { status: 503 });
  }
}

export async function POST() {
  const { user: admin, role, response } = await requireAdmin('settings.manage', { recentReauthentication: true });
  if (response) return response;
  if (role !== 'owner') return NextResponse.json({ error: 'Only an Owner can run audit cleanup.' }, { status: 403 });
  try {
    await ensureDatabaseSchema();
    const rows = await getNeonSql()`SELECT setting_value AS value FROM admin_settings
      WHERE setting_key = 'audit_retention_days' LIMIT 1` as Record<string, unknown>[];
    const days = Number(rows[0]?.value);
    if (!Number.isInteger(days) || days < 30 || days > 3650) {
      return NextResponse.json({ error: 'Configure a retention period before running cleanup.' }, { status: 409 });
    }
    const deleted = await getNeonSql()`DELETE FROM app_user_activity
      WHERE created_at < now() - (${days}::text || ' days')::interval RETURNING id` as Record<string, unknown>[];
    await recordAppUserActivity({ actorUserId: admin!.id, eventType: 'admin.retention_cleanup', details: { deletedCount: deleted.length, days } });
    return NextResponse.json({ deletedCount: deleted.length });
  } catch (error) {
    console.error('Admin retention cleanup failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not run retention cleanup.' }, { status: 503 });
  }
}
