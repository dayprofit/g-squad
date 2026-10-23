import { createHash, randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { hasAssignedUserAccess, requireAdmin } from '@/lib/server/admin-auth';
import { isAdminEmail, recordAppUserActivity } from '@/lib/server/app-auth';
import { ensureDatabaseSchema, getNeonSql } from '@/lib/server/neon';
import { getAppUrl } from '@/lib/server/app-url';

export const runtime = 'nodejs';

export async function POST(_request: Request, context: { params: Promise<{ userId: string }> }) {
  const { user: admin, role, response } = await requireAdmin('users.reset', { recentReauthentication: true });
  if (response) return response;
  try {
    const { userId } = await context.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
      return NextResponse.json({ error: 'User ID is invalid.' }, { status: 400 });
    }
    await ensureDatabaseSchema();
    if (!await hasAssignedUserAccess(admin!.id, role!, userId)) {
      return NextResponse.json({ error: 'This account is outside your assigned scope.' }, { status: 403 });
    }
    const user = await getNeonSql()`SELECT email,
      EXISTS (SELECT 1 FROM admin_staff WHERE user_id = app_users.id) AS "isStaff"
      FROM app_users WHERE id = ${userId}::uuid LIMIT 1` as Record<string, unknown>[];
    if (!user[0]) return NextResponse.json({ error: 'User was not found.' }, { status: 404 });
    if ((user[0].isStaff === true || isAdminEmail(String(user[0].email))) && role !== 'owner') {
      return NextResponse.json({ error: 'Only an Owner can issue recovery links for an administrator account.' }, { status: 403 });
    }
    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    await getNeonSql()`DELETE FROM app_password_resets WHERE user_id = ${userId}::uuid AND used_at IS NULL`;
    await getNeonSql()`INSERT INTO app_password_resets (token_hash, user_id, expires_at)
      VALUES (${tokenHash}, ${userId}::uuid, now() + interval '1 hour')`;
    await recordAppUserActivity({
      actorUserId: admin!.id, subjectUserId: userId, eventType: 'admin.password_reset_link_created',
    });
    const url = getAppUrl('/reset-password');
    url.searchParams.set('token', token);
    return NextResponse.json({ resetUrl: url.toString(), expiresInMinutes: 60 });
  } catch (error) {
    console.error('Admin password reset link creation failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not create a password reset link.' }, { status: 503 });
  }
}
