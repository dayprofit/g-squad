import { NextResponse } from 'next/server';
import { getCurrentAppUser } from '@/lib/server/app-auth';
import { ensureDatabaseSchema, getNeonSql } from '@/lib/server/neon';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const user = await getCurrentAppUser();
    if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });

    const body = await request.json();
    const contractId = body.contractId;
    const accountId = typeof body.accountId === 'string' ? body.accountId : '';
    const profit = body.profit;

    if (!Number.isSafeInteger(contractId) || contractId <= 0) {
      return NextResponse.json({ error: 'A valid settled contract ID is required.' }, { status: 400 });
    }
    if (!/^[A-Za-z0-9]{2,32}$/.test(accountId)) {
      return NextResponse.json({ error: 'Deriv account ID is invalid.' }, { status: 400 });
    }
    if (typeof profit !== 'number' || !Number.isFinite(profit) || Math.abs(profit) > 1_000_000_000) {
      return NextResponse.json({ error: 'Settled contract profit is invalid.' }, { status: 400 });
    }

    await ensureDatabaseSchema();
    const results = await getNeonSql()`WITH inserted AS (
      INSERT INTO app_bot_trade_results (user_id, contract_id, account_type, currency, profit, deriv_account_id)
      SELECT ${user.id}::uuid, ${contractId}, session.account_type, session.currency, ${profit}, session.deriv_account_id
      FROM app_bot_sessions session
      WHERE session.user_id = ${user.id}::uuid AND session.deriv_account_id = ${accountId}
      ON CONFLICT (user_id, contract_id) DO NOTHING
      RETURNING user_id, deriv_account_id, profit
    ), updated AS (
      UPDATE app_bot_sessions session SET
        wins = session.wins + CASE WHEN inserted.profit > 0 THEN 1 ELSE 0 END,
        losses = session.losses + CASE WHEN inserted.profit < 0 THEN 1 ELSE 0 END,
        updated_at = now()
      FROM inserted
      WHERE session.user_id = inserted.user_id AND session.deriv_account_id = inserted.deriv_account_id
      RETURNING session.user_id
    )
    SELECT (SELECT COUNT(*)::int FROM inserted) AS inserted,
      (SELECT COUNT(*)::int FROM updated) AS updated` as Record<string, unknown>[];
    if (Number(results[0]?.inserted ?? 0) === 0) {
      const session = await getNeonSql()`SELECT 1 FROM app_bot_sessions
        WHERE user_id = ${user.id}::uuid AND deriv_account_id = ${accountId} LIMIT 1` as Record<string, unknown>[];
      if (!session[0]) return NextResponse.json({ error: 'No saved bot session exists for this Deriv account.' }, { status: 409 });
    }
    return NextResponse.json({ success: true, recorded: Number(results[0]?.inserted ?? 0) === 1 });
  } catch (error) {
    console.error('Bot trade result recording failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Could not record the settled bot trade.' }, { status: 503 });
  }
}
