import { NextResponse } from 'next/server';
import { hasAssignedUserAccess, requireAdmin } from '@/lib/server/admin-auth';
import { getCurrentAppSession, isAdminEmail, recordAppUserActivity } from '@/lib/server/app-auth';
import { ensureDatabaseSchema, getNeonSql } from '@/lib/server/neon';
import { validateTradingConfig } from '@/lib/trading-config';

export const runtime = 'nodejs';

export async function GET(_request: Request, context: { params: Promise<{ userId: string }> }) {
  const { user: admin, role, response } = await requireAdmin('users.details');
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
    const userRows = await getNeonSql()`SELECT id::text AS id, account_id AS "accountId",
      full_name AS "fullName", email, joined_at::text AS "joinedAt",
      last_login_at::text AS "lastLoginAt", is_suspended AS "isSuspended",
      (deriv_access_token IS NOT NULL) AS "hasDerivConnection", trading_config AS "tradingConfig",
      EXISTS (SELECT 1 FROM admin_staff WHERE user_id = app_users.id) AS "isStaff"
      FROM app_users WHERE id = ${userId}::uuid LIMIT 1` as Record<string, unknown>[];
    if (!userRows[0]) return NextResponse.json({ error: 'User was not found.' }, { status: 404 });
    if ((userRows[0].isStaff === true || isAdminEmail(String(userRows[0].email))) && role !== 'owner') {
      return NextResponse.json({ error: 'Only an Owner can inspect administrator account details.' }, { status: 403 });
    }
    const [activityResult, configResult, sessionResult] = await Promise.all([
      getNeonSql()`SELECT a.id::text AS id, a.event_type AS "eventType", a.details,
        a.created_at::text AS "createdAt", actor.full_name AS "actorName"
        FROM app_user_activity a LEFT JOIN app_users actor ON actor.id = a.actor_user_id
        WHERE a.subject_user_id = ${userId}::uuid ORDER BY a.created_at DESC LIMIT 50`,
      getNeonSql()`SELECT h.previous_config AS "previousConfig", h.new_config AS "newConfig",
        h.created_at::text AS "createdAt", actor.full_name AS "actorName"
        FROM app_trading_config_history h LEFT JOIN app_users actor ON actor.id = h.actor_user_id
        WHERE h.subject_user_id = ${userId}::uuid ORDER BY h.created_at DESC LIMIT 25`,
      getNeonSql()`SELECT session_id::text AS id, created_at::text AS "createdAt",
        last_seen_at::text AS "lastSeenAt", expires_at::text AS "expiresAt"
        FROM app_sessions WHERE user_id = ${userId}::uuid AND expires_at > now()
        ORDER BY last_seen_at DESC LIMIT 25`,
    ]) as [Record<string, unknown>[], Record<string, unknown>[], Record<string, unknown>[]];
    const activities = activityResult;
    const configs = configResult;
    const sessions = sessionResult;
    const currentSession = await getCurrentAppSession();
    const row = userRows[0];
    return NextResponse.json({
      user: {
        id: String(row.id), accountId: String(row.accountId), fullName: String(row.fullName),
        email: String(row.email), joinedAt: String(row.joinedAt),
        lastLoginAt: row.lastLoginAt ? String(row.lastLoginAt) : null,
        isSuspended: row.isSuspended === true, hasDerivConnection: row.hasDerivConnection === true,
        tradingConfig: validateTradingConfig(row.tradingConfig),
      },
      activities: activities.map((activity) => ({
        id: String(activity.id), eventType: String(activity.eventType),
        details: activity.details && typeof activity.details === 'object' ? activity.details : {},
        createdAt: String(activity.createdAt), actorName: activity.actorName ? String(activity.actorName) : 'System',
      })),
      configHistory: configs.map((config) => ({
        previousConfig: validateTradingConfig(config.previousConfig),
        newConfig: validateTradingConfig(config.newConfig),
        createdAt: String(config.createdAt), actorName: config.actorName ? String(config.actorName) : 'System',
      })),
      sessions: sessions.map((session) => ({
        id: String(session.id), createdAt: String(session.createdAt),
        lastSeenAt: String(session.lastSeenAt), expiresAt: String(session.expiresAt),
        isCurrent: currentSession?.sessionId === String(session.id),
      })),
    });
  } catch (error) {
    console.error('Admin user detail lookup failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not load user details.' }, { status: 503 });
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ userId: string }> }
) {
  const { user: admin, role, response } = await requireAdmin('users.read');
  if (response) return response;
  try {
    const { userId } = await context.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
      return NextResponse.json({ error: 'User ID is invalid.' }, { status: 400 });
    }
    const body = await request.json();
    const fullName = body.fullName === undefined ? null : typeof body.fullName === 'string' ? body.fullName.trim() : '';
    const password = body.password;
    const isSuspended = body.isSuspended === undefined ? null : body.isSuspended;
    const hasTradingConfig = body.tradingConfig !== undefined;
    const tradingConfig = hasTradingConfig ? validateTradingConfig(body.tradingConfig) : null;
    if (fullName !== null && (fullName.length < 2 || fullName.length > 100)) {
      return NextResponse.json({ error: 'Name must be between 2 and 100 characters.' }, { status: 400 });
    }
    if (password !== undefined) {
      return NextResponse.json({ error: 'Use a one-time password reset link instead of setting a password.' }, { status: 400 });
    }
    if (isSuspended !== null && typeof isSuspended !== 'boolean') {
      return NextResponse.json({ error: 'Suspension status must be true or false.' }, { status: 400 });
    }
    if (hasTradingConfig && !tradingConfig) {
      return NextResponse.json({ error: 'Bot risk settings contain unsupported or out-of-range values.' }, { status: 400 });
    }
    const fields = [
      fullName !== null ? 'name' : null,
      hasTradingConfig ? 'bot risk settings' : null,
      isSuspended !== null ? (isSuspended ? 'suspended' : 'restored') : null,
    ].filter((field): field is string => field !== null);
    if (fields.length === 0) {
      return NextResponse.json({ error: 'Provide at least one user field to update.' }, { status: 400 });
    }
    if (userId === admin!.id && isSuspended === true) {
      return NextResponse.json({ error: 'You cannot suspend your own admin account.' }, { status: 400 });
    }

    for (const [changed, permission] of [
      [fullName !== null, 'users.edit'],
      [hasTradingConfig, 'users.settings'],
      [isSuspended !== null, 'users.suspend'],
    ] as const) {
      if (!changed) continue;
      const access = await requireAdmin(permission, { recentReauthentication: true });
      if (access.response) return access.response;
    }
    await ensureDatabaseSchema();
    if (!await hasAssignedUserAccess(admin!.id, role!, userId)) {
      return NextResponse.json({ error: 'This account is outside your assigned scope.' }, { status: 403 });
    }
    const previousRows = await getNeonSql()`SELECT full_name AS "fullName", email, is_suspended AS "isSuspended",
      trading_config AS "tradingConfig",
      EXISTS (SELECT 1 FROM admin_staff WHERE user_id = app_users.id) AS "isStaff"
      FROM app_users WHERE id = ${userId}::uuid LIMIT 1` as Record<string, unknown>[];
    if (!previousRows[0]) return NextResponse.json({ error: 'User was not found.' }, { status: 404 });
    if ((previousRows[0].isStaff === true || isAdminEmail(String(previousRows[0].email))) && role !== 'owner') {
      return NextResponse.json({ error: 'Only an Owner can change an administrator account.' }, { status: 403 });
    }
    if (isSuspended === false && previousRows[0].isSuspended === true) {
      if (role !== 'owner') return NextResponse.json({ error: 'Only an Owner can request account restoration.' }, { status: 403 });
      if (fields.length !== 1) return NextResponse.json({ error: 'Request account restoration separately from other changes.' }, { status: 400 });
      const pending = await getNeonSql()`SELECT 1 FROM admin_approvals
        WHERE target_user_id = ${userId}::uuid AND action_type = 'account.restore' AND status = 'pending' LIMIT 1` as Record<string, unknown>[];
      if (pending[0]) return NextResponse.json({ error: 'A restore approval is already pending for this account.' }, { status: 409 });
      const approval = await getNeonSql()`INSERT INTO admin_approvals (requested_by, action_type, target_user_id)
        VALUES (${admin!.id}::uuid, 'account.restore', ${userId}::uuid)
        RETURNING id::text AS id` as Record<string, unknown>[];
      await recordAppUserActivity({
        actorUserId: admin!.id, subjectUserId: userId, eventType: 'admin.approval_requested',
        details: { approvalId: String(approval[0].id), actionType: 'account.restore' },
      });
      return NextResponse.json({ approvalId: String(approval[0].id), status: 'pending' }, { status: 202 });
    }
    const updated = await getNeonSql()`
      UPDATE app_users SET
        full_name = COALESCE(${fullName}, full_name),
        trading_config = CASE WHEN ${hasTradingConfig} THEN ${tradingConfig ? JSON.stringify(tradingConfig) : null}::jsonb ELSE trading_config END,
        is_suspended = COALESCE(${isSuspended}, is_suspended)
      WHERE id = ${userId}::uuid
      RETURNING id::text AS id, account_id AS "accountId", full_name AS "fullName", email,
        joined_at::text AS "joinedAt", is_suspended AS "isSuspended"
    ` as Record<string, unknown>[];
    if (!updated[0]) return NextResponse.json({ error: 'User was not found.' }, { status: 404 });

    if (isSuspended === true) {
      await getNeonSql()`DELETE FROM app_sessions WHERE user_id = ${userId}::uuid`;
    }
    if (isSuspended === true) {
      await getNeonSql()`DELETE FROM deriv_oauth_flows WHERE user_id = ${userId}::uuid`;
    }
    await recordAppUserActivity({
      actorUserId: admin!.id,
      subjectUserId: userId,
      eventType: 'admin.user_updated',
      details: {
        fields: fields.join(', '),
        before: {
          fullName: String(previousRows[0].fullName),
          isSuspended: previousRows[0].isSuspended === true,
          tradingConfig: validateTradingConfig(previousRows[0].tradingConfig),
        },
        after: {
          fullName: String(updated[0].fullName),
          isSuspended: updated[0].isSuspended === true,
          tradingConfig: hasTradingConfig ? tradingConfig : validateTradingConfig(previousRows[0].tradingConfig),
        },
      },
    });
    if (hasTradingConfig && tradingConfig) {
      await getNeonSql()`INSERT INTO app_trading_config_history
        (actor_user_id, subject_user_id, previous_config, new_config)
        VALUES (${admin!.id}::uuid, ${userId}::uuid,
          ${previousRows[0].tradingConfig ? JSON.stringify(previousRows[0].tradingConfig) : null}::jsonb,
          ${JSON.stringify(tradingConfig)}::jsonb)`;
    }
    return NextResponse.json({
      user: {
        id: String(updated[0].id),
        accountId: String(updated[0].accountId),
        fullName: String(updated[0].fullName),
        email: String(updated[0].email),
        joinedAt: String(updated[0].joinedAt),
        isSuspended: updated[0].isSuspended === true,
        tradingConfig: hasTradingConfig ? tradingConfig : undefined,
      },
    });
  } catch (error) {
    console.error('Admin user update failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not update user.' }, { status: 503 });
  }
}
