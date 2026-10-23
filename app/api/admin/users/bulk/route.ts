import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server/admin-auth';
import { isAdminEmail, recordAppUserActivity } from '@/lib/server/app-auth';
import { ensureDatabaseSchema, getNeonSql } from '@/lib/server/neon';

export const runtime = 'nodejs';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const { user: admin, role, response } = await requireAdmin('users.bulk', { recentReauthentication: true });
  if (response) return response;
  try {
    const body = await request.json();
    const userIds: unknown = body.userIds;
    const isSuspended: unknown = body.isSuspended;
    if (!Array.isArray(userIds) || userIds.length < 1 || userIds.length > 50 ||
      !userIds.every((id) => typeof id === 'string' && uuidPattern.test(id)) ||
      typeof isSuspended !== 'boolean') {
      return NextResponse.json({ error: 'Choose up to 50 users and a valid suspend or restore action.' }, { status: 400 });
    }
    const uniqueIds = [...new Set(userIds as string[])];
    if (isSuspended && uniqueIds.includes(admin!.id)) {
      return NextResponse.json({ error: 'Bulk suspension cannot include your own account.' }, { status: 400 });
    }
    await ensureDatabaseSchema();
    if (role !== 'owner') {
      const sql = getNeonSql();
      const targetResults = await Promise.all(uniqueIds.map((userId) => sql`
        SELECT email, EXISTS (SELECT 1 FROM admin_staff WHERE user_id = app_users.id) AS "isStaff"
        FROM app_users WHERE id = ${userId}::uuid LIMIT 1
      `)) as Record<string, unknown>[][];
      if (targetResults.some((rows) => rows[0] && (rows[0].isStaff === true || isAdminEmail(String(rows[0].email))))) {
        return NextResponse.json({ error: 'Only an Owner can change administrator accounts.' }, { status: 403 });
      }
    }
    let updated = 0;
    const missing: string[] = [];
    for (const userId of uniqueIds) {
      const result = await getNeonSql()`UPDATE app_users SET is_suspended = ${isSuspended}
        WHERE id = ${userId}::uuid RETURNING id::text AS id` as Record<string, unknown>[];
      if (!result[0]) {
        missing.push(userId);
        continue;
      }
      updated += 1;
      if (isSuspended) {
        await getNeonSql()`DELETE FROM app_sessions WHERE user_id = ${userId}::uuid`;
        await getNeonSql()`DELETE FROM deriv_oauth_flows WHERE user_id = ${userId}::uuid`;
      }
      await recordAppUserActivity({
        actorUserId: admin!.id, subjectUserId: userId, eventType: 'admin.user_updated',
        details: { fields: isSuspended ? 'suspended' : 'restored', bulk: true },
      });
    }
    return NextResponse.json({ updated, notFound: missing.length, partial: missing.length > 0 });
  } catch (error) {
    console.error('Admin bulk user action failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Bulk user action could not be completed.' }, { status: 503 });
  }
}
