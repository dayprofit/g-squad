import { NextResponse } from 'next/server';
import { getCurrentAppUser } from '@/lib/server/app-auth';
import { ensureDatabaseSchema, getNeonSql } from '@/lib/server/neon';
import { getSubscriptionSettings } from '@/lib/server/subscription-wallets';

export const runtime = 'nodejs';
const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9]{2,32}$/;
const CURRENCY_PATTERN = /^[A-Z0-9]{2,10}$/;

export async function GET(request: Request) {
  try {
    const user = await getCurrentAppUser();
    if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    const accountId = new URL(request.url).searchParams.get('accountId') ?? '';
    if (!ACCOUNT_ID_PATTERN.test(accountId)) return NextResponse.json({ error: 'Deriv account ID is invalid.' }, { status: 400 });
    await ensureDatabaseSchema();
    const rows = await getNeonSql()`SELECT deriv_account_id AS "accountId", account_type AS "accountType",
      currency, starting_balance::text AS "startingBalance", wins, losses,
      started_at::text AS "startedAt", is_running AS "isRunning"
      FROM app_bot_sessions WHERE user_id = ${user.id}::uuid
        AND deriv_account_id = ${accountId} LIMIT 1` as Record<string, unknown>[];
    const row = rows[0];
    return NextResponse.json({
      session: row ? {
        accountId: String(row.accountId), accountType: String(row.accountType),
        currency: String(row.currency), startingBalance: Number(row.startingBalance),
        wins: Number(row.wins), losses: Number(row.losses),
        startedAt: String(row.startedAt), isRunning: row.isRunning === true,
      } : null,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Bot session lookup failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not load the saved bot session.' }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentAppUser();
    if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    const body = await request.json();
    const action = body.action;
    const accountId = typeof body.accountId === 'string' ? body.accountId : '';
    if (!ACCOUNT_ID_PATTERN.test(accountId) || !['start', 'stop'].includes(action)) {
      return NextResponse.json({ error: 'Provide a valid account and bot-session action.' }, { status: 400 });
    }
    await ensureDatabaseSchema();
    if (action === 'stop') {
      await getNeonSql()`UPDATE app_bot_sessions SET is_running = false, updated_at = now()
        WHERE user_id = ${user.id}::uuid AND deriv_account_id = ${accountId}`;
      return NextResponse.json({ success: true });
    }
    const subscriptionSettings = await getSubscriptionSettings();
    if (subscriptionSettings.enabled) {
      const activeSubscription = await getNeonSql()`SELECT expires_at > now() AS active
        FROM user_subscriptions WHERE user_id = ${user.id}::uuid LIMIT 1` as Record<string, unknown>[];
      if (activeSubscription[0]?.active !== true) {
        const configured = subscriptionSettings.amountUsdt > 0 &&
          Number.isInteger(subscriptionSettings.durationDays) && subscriptionSettings.durationDays > 0;
        return NextResponse.json({
          error: configured
            ? 'An active subscription is required before starting the trading bot.'
            : 'Subscriptions are enabled but have not been configured by the app owner.',
          code: configured ? 'SUBSCRIPTION_REQUIRED' : 'SUBSCRIPTION_SETUP_REQUIRED',
        }, { status: 402 });
      }
    }
    const accountType = body.accountType;
    const currency = typeof body.currency === 'string' ? body.currency.trim().toUpperCase() : '';
    const startingBalance = body.startingBalance;
    if ((accountType !== 'demo' && accountType !== 'real') || !CURRENCY_PATTERN.test(currency)
      || typeof startingBalance !== 'number' || !Number.isFinite(startingBalance)
      || startingBalance < 0 || startingBalance > 1_000_000_000) {
      return NextResponse.json({ error: 'Bot session values are invalid.' }, { status: 400 });
    }
    const activeAccounts = await getNeonSql()`SELECT deriv_account_id AS id FROM app_users
      WHERE id = ${user.id}::uuid LIMIT 1` as Record<string, unknown>[];
    if (!activeAccounts[0] || String(activeAccounts[0].id) !== accountId) {
      return NextResponse.json({ error: 'This Deriv account is no longer selected. Refresh the account connection and try again.' }, { status: 409 });
    }
    const rows = await getNeonSql()`INSERT INTO app_bot_sessions
      (user_id, deriv_account_id, account_type, currency, starting_balance, wins, losses, is_running, started_at, updated_at)
      VALUES (${user.id}::uuid, ${accountId}, ${accountType}, ${currency}, ${startingBalance}, 0, 0, true, now(), now())
      ON CONFLICT (user_id, deriv_account_id) DO UPDATE SET
        account_type = EXCLUDED.account_type, currency = EXCLUDED.currency,
        starting_balance = EXCLUDED.starting_balance, wins = 0, losses = 0,
        is_running = true, started_at = now(), updated_at = now()
      RETURNING deriv_account_id AS "accountId", account_type AS "accountType",
        currency, starting_balance::text AS "startingBalance", wins, losses,
        started_at::text AS "startedAt"` as Record<string, unknown>[];
    const row = rows[0];
    if (!row) throw new Error('Neon did not return the saved bot session.');
    return NextResponse.json({ session: {
      accountId: String(row.accountId), accountType: String(row.accountType),
      currency: String(row.currency), startingBalance: Number(row.startingBalance),
      wins: Number(row.wins), losses: Number(row.losses), startedAt: String(row.startedAt),
    } });
  } catch (error) {
    console.error('Bot session save failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not save the bot session to Neon.' }, { status: 503 });
  }
}
