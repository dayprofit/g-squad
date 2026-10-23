import 'server-only';
import { NextResponse } from 'next/server';
import { getCurrentAppSession, isAdminEmail } from './app-auth';
import { ensureDatabaseSchema, getNeonSql } from './neon';
import { isStaffScheduledNow, parseStaffSchedule } from '@/lib/admin-schedule';
import { ADMIN_PERMISSION_OPTIONS, type AdminPermission } from '@/lib/admin-permissions';

export type { AdminPermission } from '@/lib/admin-permissions';

export type AdminRole = 'owner' | 'support' | 'account_manager' | 'read_only';

const ROLE_PERMISSIONS: Record<AdminRole, readonly AdminPermission[]> = {
  owner: [
    'users.read', 'users.create', 'users.edit', 'users.suspend', 'users.settings', 'users.reset',
    'users.bulk', 'users.details', 'activity.read', 'sessions.read', 'sessions.revoke', 'staff.manage',
    'alerts.read', 'alerts.acknowledge', 'health.read', 'analytics.read', 'cases.read', 'cases.manage',
    'notes.manage', 'assignments.manage', 'staff.permissions', 'approvals.review', 'audit.export',
    'settings.manage', 'reviews.manage', 'chat.read', 'chat.manage',
  ],
  support: ['users.read', 'users.suspend', 'users.details', 'activity.read', 'sessions.read', 'sessions.revoke', 'alerts.read', 'alerts.acknowledge', 'cases.read', 'cases.manage', 'notes.manage', 'chat.read', 'chat.manage'],
  account_manager: ['users.read', 'users.create', 'users.edit', 'users.suspend', 'users.settings', 'users.reset', 'users.bulk', 'users.details', 'activity.read', 'sessions.read', 'sessions.revoke', 'alerts.read', 'alerts.acknowledge', 'cases.read', 'cases.manage', 'notes.manage', 'chat.read', 'chat.manage'],
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
      CASE WHEN ${isAdminEmail(session.user.email)} THEN 'owner' ELSE staff.role END AS role,
      staff.permissions AS permissions,
      staff.schedule_timezone AS "scheduleTimezone",
      staff.work_schedule AS "workSchedule",
      staff.role_starts_on::text AS "roleStartsOn",
      staff.role_ends_on::text AS "roleEndsOn",
      staff.temporary_access_expires_at::text AS "temporaryAccessExpiresAt"
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

  if (role !== 'owner' && !isScheduleAllowed(account[0])) {
    return {
      user: null,
      role,
      session,
      response: NextResponse.json({ error: 'Admin access is available only during your scheduled work hours.', code: 'ADMIN_SCHEDULE_BLOCKED' }, { status: 403 }),
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
  if (role !== 'owner') {
    const customPermissions = account[0]?.permissions;
    const allowed = Array.isArray(customPermissions)
      ? customPermissions.includes(permission)
      : ROLE_PERMISSIONS[role].includes(permission);
    if (!allowed) {
      return {
        user: null,
        role,
        session,
        response: NextResponse.json({ error: 'Your admin role does not permit this action.', code: 'ADMIN_PERMISSION_DENIED' }, { status: 403 }),
      };
    }
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

export function isScheduleAllowed(account: Record<string, unknown>): boolean {
  if (account.temporaryAccessExpiresAt && Date.parse(String(account.temporaryAccessExpiresAt)) <= Date.now()) return false;
  const schedule = parseStaffSchedule({
    timezone: account.scheduleTimezone,
    shifts: account.workSchedule,
    roleStartsOn: account.roleStartsOn ?? null,
    roleEndsOn: account.roleEndsOn ?? null,
  });
  return schedule !== null && isStaffScheduledNow(schedule);
}

export async function hasAssignedUserAccess(adminId: string, role: AdminRole, targetUserId: string): Promise<boolean> {
  if (role === 'owner') return true;
  const rows = await getNeonSql()`SELECT 1 FROM admin_user_assignments
    WHERE user_id = ${targetUserId}::uuid AND staff_user_id = ${adminId}::uuid LIMIT 1` as Record<string, unknown>[];
  return Boolean(rows[0]);
}
