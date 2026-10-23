import { NextResponse } from 'next/server';
import { getCurrentAppUser, recordAppUserActivity } from '@/lib/server/app-auth';
import { ensureDatabaseSchema, getNeonSql } from '@/lib/server/neon';
import { FIXED_TRADING_DURATION, FIXED_TRADING_SYMBOL } from '@/lib/trading-constants';
import { validateTradingConfig } from '@/lib/trading-config';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const user = await getCurrentAppUser();
    if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    await ensureDatabaseSchema();
    const result = await getNeonSql()`
      SELECT trading_config AS config FROM app_users WHERE id = ${user.id}::uuid LIMIT 1
    ` as Record<string, unknown>[];
    const config = result[0]?.config;
    const savedConfig = config && typeof config === 'object'
      ? Object.fromEntries(Object.entries(config as Record<string, unknown>).filter(([key]) => key !== 'strategy'))
      : {};
    return NextResponse.json({
      config: config && typeof config === 'object'
        ? { ...savedConfig, symbol: FIXED_TRADING_SYMBOL, duration: FIXED_TRADING_DURATION, durationUnit: 't' }
        : null,
    });
  } catch (error) {
    console.error('Trading configuration lookup failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Configuration service is unavailable.' }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  try {
    const user = await getCurrentAppUser();
    if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    const config = validateTradingConfig(await request.json());
    if (!config) return NextResponse.json({ error: 'Configuration contains unsupported or out-of-range values.' }, { status: 400 });

    await ensureDatabaseSchema();
    const previous = await getNeonSql()`SELECT trading_config AS config FROM app_users WHERE id = ${user.id}::uuid LIMIT 1` as Record<string, unknown>[];
    await getNeonSql()`
      UPDATE app_users
      SET trading_config = ${JSON.stringify(config)}::jsonb, config_updated_at = now()
      WHERE id = ${user.id}::uuid
    `;
    await getNeonSql()`INSERT INTO app_trading_config_history
      (actor_user_id, subject_user_id, previous_config, new_config)
      VALUES (${user.id}::uuid, ${user.id}::uuid,
        ${previous[0]?.config ? JSON.stringify(previous[0].config) : null}::jsonb,
        ${JSON.stringify(config)}::jsonb)`;
    await recordAppUserActivity({
      actorUserId: user.id, subjectUserId: user.id, eventType: 'user.trading_config_updated',
    });
    return NextResponse.json({ config });
  } catch (error) {
    console.error('Trading configuration save failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Configuration could not be saved.' }, { status: 503 });
  }
}