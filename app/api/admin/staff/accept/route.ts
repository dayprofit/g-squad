import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getCurrentAppSession, recordAppUserActivity } from '@/lib/server/app-auth';
import { ensureDatabaseSchema, getNeonSql } from '@/lib/server/neon';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const session = await getCurrentAppSession();
    if (!session) return NextResponse.json({ error: 'Sign in to accept this invitation.' }, { status: 401 });
    const body = await request.json();
    const token = typeof body.token === 'string' ? body.token : '';
    if (token.length < 32 || token.length > 128) return NextResponse.json({ error: 'Invitation link is invalid.' }, { status: 400 });
    await ensureDatabaseSchema();
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const rows = await getNeonSql()`
      WITH accepted AS (
        UPDATE admin_invitations SET accepted_at = now()
        WHERE token_hash = ${tokenHash} AND accepted_at IS NULL AND expires_at > now()
          AND lower(email) = lower(${session.user.email})
        RETURNING role, invited_by
      ), membership AS (
        INSERT INTO admin_staff (user_id, role, invited_by)
        SELECT ${session.user.id}::uuid, role, invited_by FROM accepted
        ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role, invited_by = EXCLUDED.invited_by
        RETURNING user_id
      )
      SELECT accepted.role FROM accepted JOIN membership ON membership.user_id = ${session.user.id}::uuid
    ` as Record<string, unknown>[];
    if (!rows[0]) return NextResponse.json({ error: 'Invitation is expired, already used, or belongs to another email.' }, { status: 409 });
    await recordAppUserActivity({
      actorUserId: session.user.id,
      subjectUserId: session.user.id,
      eventType: 'admin.staff_invitation_accepted',
      details: { role: String(rows[0].role) },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Admin staff invitation acceptance failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not accept this invitation.' }, { status: 503 });
  }
}
