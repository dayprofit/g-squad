import { NextResponse } from 'next/server';
import { getCurrentAppUser } from '@/lib/server/app-auth';
import { ensureDatabaseSchema, getNeonSql } from '@/lib/server/neon';
import { FIXED_TRADING_DURATION, FIXED_TRADING_SYMBOL } from '@/lib/trading-constants';

export const runtime = 'nodejs';

interface TradingConfig {
  stake: number;
  targetProfit: number;
  targetLoss: number;
  symbol: string;
  duration: number;
  durationUnit: 't' | 's' | 'm';
  maxTrades: number;
  maxConsecutiveLosses: number;
  cooldownMinutes: number;
}

function validateConfig(value: unknown): TradingConfig | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const stake = raw.stake;
  const targetProfit = raw.targetProfit;
  const targetLoss = raw.targetLoss;
  const maxTrades = raw.maxTrades;
  const maxConsecutiveLosses = raw.maxConsecutiveLosses;
  const cooldownMinutes = raw.cooldownMinutes;
  if (
    typeof stake !== 'number' || !Number.isFinite(stake) ||
    typeof targetProfit !== 'number' || !Number.isFinite(targetProfit) ||
    typeof targetLoss !== 'number' || !Number.isFinite(targetLoss) ||
    typeof maxTrades !== 'number' || !Number.isFinite(maxTrades) ||
    typeof maxConsecutiveLosses !== 'number' || !Number.isFinite(maxConsecutiveLosses) ||
    typeof cooldownMinutes !== 'number' || !Number.isFinite(cooldownMinutes)
  ) return null;
  if (!(stake > 0 && stake <= 10000)) return null;
  if (!(targetProfit > 0 && targetProfit <= 1_000_000)) return null;
  if (!(targetLoss > 0 && targetLoss <= 1_000_000)) return null;
  if (!Number.isInteger(maxTrades) || !(maxTrades >= 1 && maxTrades <= 500)) return null;
  if (!Number.isInteger(maxConsecutiveLosses) || !(maxConsecutiveLosses >= 1 && maxConsecutiveLosses <= 50)) return null;
  if (!Number.isInteger(cooldownMinutes) || !(cooldownMinutes >= 0 && cooldownMinutes <= 1440)) return null;
  return {
    stake,
    targetProfit,
    targetLoss,
    symbol: FIXED_TRADING_SYMBOL,
    duration: FIXED_TRADING_DURATION,
    durationUnit: 't',
    maxTrades,
    maxConsecutiveLosses,
    cooldownMinutes,
  };
}

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
    const config = validateConfig(await request.json());
    if (!config) return NextResponse.json({ error: 'Configuration contains unsupported or out-of-range values.' }, { status: 400 });

    await ensureDatabaseSchema();
    await getNeonSql()`
      UPDATE app_users
      SET trading_config = ${JSON.stringify(config)}::jsonb, config_updated_at = now()
      WHERE id = ${user.id}::uuid
    `;
    return NextResponse.json({ config });
  } catch (error) {
    console.error('Trading configuration save failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Configuration could not be saved.' }, { status: 503 });
  }
}