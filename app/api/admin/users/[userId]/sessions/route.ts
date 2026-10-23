import { NextResponse } from 'next/server';
import { hasAssignedUserAccess, requireAdmin } from '@/lib/server/admin-auth';
import { getCurrentAppSession, isAdminEmail, recordAppUserActivity } from '@/lib/server/app-auth';
import { ensureDatabaseSchema, getNeonSql } from '@/lib/server/neon';

export const runtime = 'nodejs';
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function DELETE(_request: Request, context: { params: Promise<{ userId: string }> }) {
  const { user: admin, role, response } = await requireAdmin('sessions.revoke', { recentReauthentication: true });
  if (response) return response;
  try {
    const { userId } = await context.params;
    if (!uuidPattern.test(userId)) return NextResponse.json({ error: 'User ID is invalid.' }, { status: 400 });
    const session = await getCurrentAppSession();
    await ensureDatabaseSchema();
    if (!await hasAssignedUserAccess(admin!.id, role!, userId)) {
      return NextResponse.json({ error: 'This account is outside your assigned scope.' }, { status: 403 });
    }
    const target = await getNeonSql()`SELECT email,
      EXISTS (SELECT 1 FROM admin_staff WHERE user_id = app_users.id) AS "isStaff"
      FROM app_users WHERE id = ${userId}::uuid LIMIT 1` as Record<string, unknown>[];
    if (!target[0]) return NextResponse.json({ error: 'User was not found.' }, { status: 404 });
    if ((target[0].isStaff === true || isAdminEmail(String(target[0].email))) && role !== 'owner') {
      return NextResponse.json({ error: 'Only an Owner can revoke administrator sessions.' }, { status: 403 });
    }
    const result = await getNeonSql()`DELETE FROM app_sessions
      WHERE user_id = ${userId}::uuid AND session_id <> ${session!.sessionId}::uuid
      RETURNING session_id` as Record<string, unknown>[];
    await recordAppUserActivity({
      actorUserId: admin!.id, subjectUserId: userId,
      eventType: 'admin.user_sessions_revoked', details: { count: result.length },
    });
    return NextResponse.json({ revoked: result.length });
  } catch (error) {
    console.error('Admin session revocation failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not revoke user sessions.' }, { status: 503 });
  }
}
