import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server/admin-auth';
import { recordAppUserActivity } from '@/lib/server/app-auth';
import { ensureDatabaseSchema, getNeonSql } from '@/lib/server/neon';

export const runtime = 'nodejs';

export async function DELETE(_request: Request, context: { params: Promise<{ invitationId: string }> }) {
  const { user: admin, role, response } = await requireAdmin('staff.manage', { recentReauthentication: true });
  if (response) return response;
  if (role !== 'owner') return NextResponse.json({ error: 'Only an Owner can revoke staff invitations.' }, { status: 403 });
  try {
    const { invitationId } = await context.params;
    if (!/^\d+$/.test(invitationId)) return NextResponse.json({ error: 'Invitation ID is invalid.' }, { status: 400 });
    await ensureDatabaseSchema();
    const rows = await getNeonSql()`DELETE FROM admin_invitations WHERE id = ${invitationId}::bigint
      AND accepted_at IS NULL RETURNING email` as Record<string, unknown>[];
    if (!rows[0]) return NextResponse.json({ error: 'Pending invitation was not found.' }, { status: 404 });
    await recordAppUserActivity({
      actorUserId: admin!.id, eventType: 'admin.staff_invitation_revoked',
      details: { email: String(rows[0].email) },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Admin invitation revocation failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not revoke this invitation.' }, { status: 503 });
  }
}
