import { FIXED_TRADING_DURATION, FIXED_TRADING_SYMBOL } from './trading-constants';

export interface TradingConfig {
  stake: number;
  targetProfit: number;
  targetLoss: number;
  symbol: string;
  duration: number;
  durationUnit: 't';
  maxTrades: number;
  maxConsecutiveLosses: number;
  cooldownMinutes: number;
}

export function validateTradingConfig(value: unknown): TradingConfig | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const { stake, targetProfit, targetLoss, maxTrades, maxConsecutiveLosses, cooldownMinutes } = raw;
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
