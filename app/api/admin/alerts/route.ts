import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server/admin-auth';
import { recordAppUserActivity } from '@/lib/server/app-auth';
import { ensureDatabaseSchema, getNeonSql } from '@/lib/server/neon';

export const runtime = 'nodejs';

export async function GET() {
  const { response } = await requireAdmin('alerts.read');
  if (response) return response;
  try {
    await ensureDatabaseSchema();
    await getNeonSql()`
      INSERT INTO admin_alerts (alert_type, severity, message, fingerprint)
      SELECT 'repeated_failed_signins', 'warning',
        'Repeated failed sign-in attempts were recorded for an account identifier.',
        'failed-login:' || failures.fingerprint || ':' || date_trunc('hour', now())::text
      FROM (
        SELECT details->>'emailFingerprint' AS fingerprint, COUNT(*) AS attempts
        FROM app_user_activity
        WHERE event_type = 'auth.login_failed' AND created_at >= now() - interval '1 hour'
        GROUP BY details->>'emailFingerprint'
        HAVING COUNT(*) >= 5
      ) failures
      ON CONFLICT (fingerprint) WHERE fingerprint IS NOT NULL DO NOTHING
    `;
    const rows = await getNeonSql()`
      SELECT id::text AS id, alert_type AS "alertType", severity, message,
        created_at::text AS "createdAt", acknowledged_at::text AS "acknowledgedAt"
      FROM admin_alerts ORDER BY acknowledged_at NULLS FIRST, created_at DESC LIMIT 100
    ` as Record<string, unknown>[];
    return NextResponse.json({
      alerts: rows.map((row) => ({
        id: String(row.id), alertType: String(row.alertType), severity: String(row.severity),
        message: String(row.message), createdAt: String(row.createdAt),
        acknowledgedAt: row.acknowledgedAt ? String(row.acknowledgedAt) : null,
      })),
    });
  } catch (error) {
    console.error('Admin alert lookup failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not load administrator alerts.' }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const { user: admin, response } = await requireAdmin('alerts.acknowledge');
  if (response) return response;
  try {
    const body = await request.json();
    const alertId = typeof body.alertId === 'string' ? body.alertId : '';
    if (!/^\d+$/.test(alertId)) return NextResponse.json({ error: 'Alert ID is invalid.' }, { status: 400 });
    await ensureDatabaseSchema();
    const rows = await getNeonSql()`UPDATE admin_alerts SET acknowledged_at = now(), acknowledged_by = ${admin!.id}::uuid
      WHERE id = ${alertId}::bigint AND acknowledged_at IS NULL RETURNING id` as Record<string, unknown>[];
    if (!rows[0]) return NextResponse.json({ error: 'Alert was not found or already acknowledged.' }, { status: 404 });
    await recordAppUserActivity({
      actorUserId: admin!.id, eventType: 'admin.alert_acknowledged',
      details: { alertId },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Admin alert acknowledgement failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not acknowledge alert.' }, { status: 503 });
  }
}
