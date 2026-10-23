import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server/admin-auth';
import { ensureDatabaseSchema, getNeonSql } from '@/lib/server/neon';

export const runtime = 'nodejs';

export async function GET() {
  const { response } = await requireAdmin('analytics.read');
  if (response) return response;
  try {
    await ensureDatabaseSchema();
    const result = await getNeonSql()`
      SELECT
        (SELECT COUNT(*)::int FROM app_users) AS "totalUsers",
        (SELECT COUNT(*)::int FROM app_users WHERE joined_at >= now() - interval '30 days') AS "newUsers30d",
        (SELECT COUNT(*)::int FROM app_users WHERE last_login_at >= now() - interval '30 days') AS "activeUsers30d",
        (SELECT COUNT(*)::int FROM app_users WHERE is_suspended = true) AS "suspendedUsers",
        (SELECT COUNT(*)::int FROM app_users WHERE deriv_access_token IS NOT NULL) AS "connectedAccounts",
        (SELECT COUNT(*)::int FROM app_user_activity WHERE event_type = 'user.login' AND created_at >= now() - interval '30 days') AS "successfulLogins30d",
        (SELECT COUNT(*)::int FROM app_user_activity WHERE event_type = 'auth.login_failed' AND created_at >= now() - interval '24 hours') AS "failedLogins24h"
    ` as Record<string, unknown>[];
    const monthly = await getNeonSql()`
      SELECT to_char(date_trunc('month', joined_at), 'YYYY-MM') AS month, COUNT(*)::int AS count
      FROM app_users WHERE joined_at >= date_trunc('month', now()) - interval '11 months'
      GROUP BY date_trunc('month', joined_at) ORDER BY date_trunc('month', joined_at)
    ` as Record<string, unknown>[];
    const tradeResults = await getNeonSql()`
      SELECT account_type AS "accountType", currency,
        SUM(CASE WHEN profit > 0 THEN profit ELSE 0 END)::text AS won,
        SUM(CASE WHEN profit < 0 THEN -profit ELSE 0 END)::text AS lost,
        COUNT(*)::int AS trades
      FROM app_bot_trade_results
      GROUP BY account_type, currency
      ORDER BY account_type, currency
    ` as Record<string, unknown>[];
    return NextResponse.json({
      metrics: Object.fromEntries(Object.entries(result[0] ?? {}).map(([key, value]) => [key, Number(value ?? 0)])),
      registrationsByMonth: monthly.map((row) => ({ month: String(row.month), count: Number(row.count) })),
      tradingPerformance: tradeResults.map((row) => ({
        accountType: String(row.accountType),
        currency: String(row.currency),
        won: String(row.won),
        lost: String(row.lost),
        trades: Number(row.trades),
      })),
      refreshedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Admin analytics lookup failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not load account analytics.' }, { status: 503 });
  }
}
