import 'server-only';
import { NextResponse } from 'next/server';
import { getCurrentAppSession, isAdminEmail } from './app-auth';
import { ensureDatabaseSchema, getNeonSql } from './neon';

export type AdminPermission =
  | 'users.read'
  | 'users.create'
  | 'users.edit'
  | 'users.suspend'
  | 'users.settings'
  | 'users.reset'
  | 'users.bulk'
  | 'users.details'
  | 'activity.read'
  | 'sessions.read'
  | 'sessions.revoke'
  | 'staff.manage'
  | 'alerts.read'
  | 'alerts.acknowledge'
  | 'health.read'
  | 'analytics.read';

export type AdminRole = 'owner' | 'support' | 'account_manager' | 'read_only';

const ROLE_PERMISSIONS: Record<AdminRole, readonly AdminPermission[]> = {
  owner: [
    'users.read', 'users.create', 'users.edit', 'users.suspend', 'users.settings', 'users.reset',
    'users.bulk', 'users.details', 'activity.read', 'sessions.read', 'sessions.revoke', 'staff.manage',
    'alerts.read', 'alerts.acknowledge', 'health.read', 'analytics.read',
  ],
  support: ['users.read', 'users.suspend', 'users.details', 'activity.read', 'sessions.read', 'sessions.revoke', 'alerts.read', 'alerts.acknowledge'],
  account_manager: ['users.read', 'users.create', 'users.edit', 'users.suspend', 'users.settings', 'users.reset', 'users.bulk', 'users.details', 'activity.read', 'sessions.read', 'sessions.revoke', 'alerts.read', 'alerts.acknowledge'],
  read_only: ['users.read', 'users.details', 'activity.read', 'sessions.read', 'alerts.read', 'health.read', 'analytics.read'],
};

export async function requireAdmin(
  permission: AdminPermission = 'users.read',
  options: { recentReauthentication?: boolean } = {},
) {
  const session = await getCurrentAppSession();
  if (!session) {
    return {
      user: null,
      role: null,
      session: null,
      response: NextResponse.json({ error: 'Authentication required.', code: 'AUTH_REQUIRED' }, { status: 401 }),
    };
  }

  await ensureDatabaseSchema();
  const account = await getNeonSql()`
    SELECT u.admin_totp_enabled AS "mfaEnabled",
      CASE WHEN ${isAdminEmail(session.user.email)} THEN 'owner' ELSE staff.role END AS role
    FROM app_users u
    LEFT JOIN admin_staff staff ON staff.user_id = u.id
    WHERE u.id = ${session.user.id}::uuid
    LIMIT 1
  ` as Record<string, unknown>[];
  const role = account[0]?.role as AdminRole | undefined;
  if (!role || !(role in ROLE_PERMISSIONS)) {
    return {
      user: null,
      role: null,
      session,
      response: NextResponse.json({ error: 'Admin access is not enabled for this account.', code: 'ADMIN_ACCESS_REQUIRED' }, { status: 403 }),
    };
  }

  if (account[0]?.mfaEnabled !== true) {
    return {
      user: null,
      role,
      session,
      response: NextResponse.json({ error: 'Set up an authenticator app to continue.', code: 'ADMIN_MFA_SETUP_REQUIRED' }, { status: 428 }),
    };
  }
  if (!session.adminMfaVerifiedAt || Date.now() - Date.parse(session.adminMfaVerifiedAt) > 12 * 60 * 60 * 1000) {
    return {
      user: null,
      role,
      session,
      response: NextResponse.json({ error: 'Enter your authenticator code to continue.', code: 'ADMIN_MFA_REQUIRED' }, { status: 428 }),
    };
  }
  if (!ROLE_PERMISSIONS[role].includes(permission)) {
    return {
      user: null,
      role,
      session,
      response: NextResponse.json({ error: 'Your admin role does not permit this action.', code: 'ADMIN_PERMISSION_DENIED' }, { status: 403 }),
    };
  }
  if (options.recentReauthentication && (
    !session.adminReauthenticatedAt ||
    Date.now() - Date.parse(session.adminReauthenticatedAt) > 5 * 60 * 1000
  )) {
    return {
      user: null,
      role,
      session,
      response: NextResponse.json({ error: 'Confirm your password and authenticator code to continue.', code: 'ADMIN_REAUTH_REQUIRED' }, { status: 428 }),
    };
  }
  return { user: session.user, role, session, response: null };
}

export function getAdminPermissions(role: AdminRole): readonly AdminPermission[] {
  return ROLE_PERMISSIONS[role];
}
