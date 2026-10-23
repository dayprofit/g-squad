import { createHash, randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server/admin-auth';
import { createAppUser, isAdminEmail, recordAppUserActivity, AppEmailConflictError } from '@/lib/server/app-auth';
import { ensureDatabaseSchema, getNeonSql } from '@/lib/server/neon';
import { getAppUrl } from '@/lib/server/app-url';
import { validateTradingConfig } from '@/lib/trading-config';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { response } = await requireAdmin('users.read');
  if (response) return response;
  try {
    const params = new URL(request.url).searchParams;
    const search = params.get('search')?.trim().slice(0, 100) ?? '';
    const page = Math.max(1, Math.min(100_000, Number.parseInt(params.get('page') ?? '1', 10) || 1));
    const pageSize = 50;
    const pattern = `%${search}%`;
    await ensureDatabaseSchema();
    const sql = getNeonSql();
    const [users, countResult] = await Promise.all([sql`
      SELECT u.id::text AS id, u.account_id AS "accountId", u.full_name AS "fullName", u.email,
        u.joined_at::text AS "joinedAt", u.last_login_at::text AS "lastLoginAt",
        u.is_suspended AS "isSuspended", (u.deriv_access_token IS NOT NULL) AS "hasDerivConnection",
        u.trading_config AS "tradingConfig", staff.role AS "adminRole",
        (staff.user_id IS NOT NULL) AS "isStaff"
      FROM app_users u LEFT JOIN admin_staff staff ON staff.user_id = u.id
      WHERE ${search === ''} OR u.full_name ILIKE ${pattern} OR u.email ILIKE ${pattern} OR u.account_id ILIKE ${pattern}
      ORDER BY u.joined_at DESC
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `, sql`
      SELECT COUNT(*)::int AS total
      FROM app_users
      WHERE ${search === ''} OR full_name ILIKE ${pattern} OR email ILIKE ${pattern} OR account_id ILIKE ${pattern}
    `]) as [Record<string, unknown>[], Record<string, unknown>[]];
    return NextResponse.json({
      total: Number(countResult[0]?.total ?? 0),
      page,
      pageSize,
      users: users.map((row) => ({
        id: String(row.id),
        accountId: String(row.accountId),
        fullName: String(row.fullName),
        email: String(row.email),
        joinedAt: String(row.joinedAt),
        lastLoginAt: row.lastLoginAt ? String(row.lastLoginAt) : null,
        isSuspended: row.isSuspended === true,
        hasDerivConnection: row.hasDerivConnection === true,
        tradingConfig: validateTradingConfig(row.tradingConfig),
        isAdmin: isAdminEmail(String(row.email)) || row.isStaff === true,
        adminRole: isAdminEmail(String(row.email)) ? 'owner' : row.adminRole ? String(row.adminRole) : null,
      })),
    });
  } catch (error) {
    console.error('Admin user list failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not load users.' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const { user: admin, response } = await requireAdmin('users.create', { recentReauthentication: true });
  if (response) return response;
  try {
    const body = await request.json();
    const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (fullName.length < 2 || fullName.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Enter a valid name and email address.' }, { status: 400 });
    }
    if (isAdminEmail(email)) return NextResponse.json({ error: 'Owner addresses must be provisioned before being added to ADMIN_EMAILS.' }, { status: 409 });
    const password = randomBytes(32).toString('base64url');
    const created = await createAppUser({ fullName, email, password });
    const resetToken = randomBytes(32).toString('base64url');
    const resetHash = createHash('sha256').update(resetToken).digest('hex');
    await ensureDatabaseSchema();
    await getNeonSql()`INSERT INTO app_password_resets (token_hash, user_id, expires_at)
      VALUES (${resetHash}, ${created.id}::uuid, now() + interval '1 hour')`;
    await recordAppUserActivity({
      actorUserId: admin!.id,
      subjectUserId: created.id,
      eventType: 'admin.user_created',
      details: { email },
    });
    const resetUrl = getAppUrl('/reset-password');
    resetUrl.searchParams.set('token', resetToken);
    return NextResponse.json({ user: created, resetUrl: resetUrl.toString(), expiresInMinutes: 60 }, { status: 201 });
  } catch (error) {
    if (error instanceof AppEmailConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error('Admin user creation failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not create user.' }, { status: 503 });
  }
}
