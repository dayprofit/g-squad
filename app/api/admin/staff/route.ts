import { createHash, randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server/admin-auth';
import { isAdminEmail, recordAppUserActivity } from '@/lib/server/app-auth';
import { ensureDatabaseSchema, getNeonSql } from '@/lib/server/neon';
import { getAppUrl } from '@/lib/server/app-url';

export const runtime = 'nodejs';
type StaffRole = 'support' | 'account_manager' | 'read_only';
const staffRoles: StaffRole[] = ['support', 'account_manager', 'read_only'];

export async function GET() {
  const { user: admin, response } = await requireAdmin('staff.manage');
  if (response) return response;
  try {
    await ensureDatabaseSchema();
    const rows = await getNeonSql()`
      SELECT u.id::text AS id, u.full_name AS "fullName", u.email,
        staff.role, staff.created_at::text AS "createdAt",
        inviter.full_name AS "invitedBy", u.admin_totp_enabled AS "mfaEnabled"
      FROM admin_staff staff
      JOIN app_users u ON u.id = staff.user_id
      LEFT JOIN app_users inviter ON inviter.id = staff.invited_by
      ORDER BY staff.created_at DESC
    ` as Record<string, unknown>[];
    const ownerEmails = process.env.ADMIN_EMAILS?.split(',').map((email) => email.trim().toLowerCase()).filter(Boolean) ?? [];
    const ownerResults = await Promise.all(ownerEmails.map((email) => getNeonSql()`
      SELECT id::text AS id, full_name AS "fullName", email, joined_at::text AS "createdAt",
        admin_totp_enabled AS "mfaEnabled"
      FROM app_users WHERE lower(email) = ${email} LIMIT 1
    `)) as Record<string, unknown>[][];
    const owners = ownerResults.flatMap((rows) => rows).filter((row) => isAdminEmail(String(row.email)));
    const invitations = await getNeonSql()`
      SELECT id::text AS id, email, role, expires_at::text AS "expiresAt",
        created_at::text AS "createdAt"
      FROM admin_invitations WHERE accepted_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC
    ` as Record<string, unknown>[];
    return NextResponse.json({
      staff: [
        ...owners.map((row) => ({
          id: String(row.id), fullName: String(row.fullName), email: String(row.email),
          role: 'owner', createdAt: String(row.createdAt), invitedBy: 'ADMIN_EMAILS',
          mfaEnabled: row.mfaEnabled === true, isOwner: true, isCurrent: String(row.id) === admin!.id,
        })),
        ...rows.map((row) => ({
          id: String(row.id), fullName: String(row.fullName), email: String(row.email),
          role: String(row.role), createdAt: String(row.createdAt),
          invitedBy: row.invitedBy ? String(row.invitedBy) : 'Owner',
          mfaEnabled: row.mfaEnabled === true, isOwner: false, isCurrent: String(row.id) === admin!.id,
        })),
      ],
      invitations: invitations.map((row) => ({
        id: String(row.id), email: String(row.email), role: String(row.role),
        expiresAt: String(row.expiresAt), createdAt: String(row.createdAt),
      })),
    });
  } catch (error) {
    console.error('Admin staff list failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not load staff access.' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const { user: admin, response } = await requireAdmin('staff.manage', { recentReauthentication: true });
  if (response) return response;
  try {
    const body = await request.json();
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const role = body.role as StaffRole;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !staffRoles.includes(role)) {
      return NextResponse.json({ error: 'Enter a valid email and staff role.' }, { status: 400 });
    }
    if (isAdminEmail(email)) return NextResponse.json({ error: 'This address already has Owner access.' }, { status: 409 });
    await ensureDatabaseSchema();
    const existing = await getNeonSql()`SELECT id FROM app_users WHERE email = ${email} LIMIT 1` as Record<string, unknown>[];
    if (!existing[0]) {
      return NextResponse.json({ error: 'The staff member must first create an app account with this email.' }, { status: 404 });
    }
    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    await getNeonSql()`INSERT INTO admin_invitations (token_hash, email, role, invited_by, expires_at)
      VALUES (${tokenHash}, ${email}, ${role}, ${admin!.id}::uuid, now() + interval '7 days')`;
    await recordAppUserActivity({
      actorUserId: admin!.id,
      subjectUserId: String(existing[0].id),
      eventType: 'admin.staff_invited',
      details: { role },
    });
    const url = getAppUrl('/admin/accept-invite');
    url.searchParams.set('token', rawToken);
    return NextResponse.json({ invitationUrl: url.toString(), expiresInDays: 7 }, { status: 201 });
  } catch (error) {
    console.error('Admin staff invitation failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not invite staff.' }, { status: 503 });
  }
}
