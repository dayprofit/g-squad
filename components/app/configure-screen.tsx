'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { LoaderCircle, Save } from 'lucide-react';
import { useDerivWSContext } from '@/components/custom/deriv-ws-provider';

interface TradingConfig {
  stake: number;
  targetProfit: number;
  targetLoss: number;
  strategy: 'breakout' | 'reversal' | 'both';
  symbol: string;
  duration: number;
  durationUnit: 't' | 's' | 'm';
  maxTrades: number;
  maxConsecutiveLosses: number;
  cooldownMinutes: number;
}

const DEFAULT_CONFIG: TradingConfig = { stake: 1, targetProfit: 5, targetLoss: 3, strategy: 'both', symbol: 'R_100', duration: 1, durationUnit: 'm', maxTrades: 25, maxConsecutiveLosses: 3, cooldownMinutes: 5 };
const SYMBOLS = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V'];

export function ConfigureScreen({ onNotice }: { onNotice: (message: string) => void }) {
  const { auth } = useDerivWSContext();
  const currency = auth.activeAccount?.currency;
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/trading/config', { cache: 'no-store' })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? 'Could not load configuration.');
        if (!cancelled && result.config) setConfig({ ...DEFAULT_CONFIG, ...result.config });
      })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Configuration is unavailable.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const update = <K extends keyof TradingConfig>(key: K, value: TradingConfig[K]) => setConfig((current) => ({ ...current, [key]: value }));
  const valid = config.stake > 0 && config.stake <= 10000 && config.targetProfit > 0 && config.targetLoss > 0 && config.duration >= 1 && config.maxTrades >= 1 && config.maxConsecutiveLosses >= 1 && config.cooldownMinutes >= 0;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid) return;
    setSaving(true);
    setError('');
    const startedAt = Date.now();
    try {
      const response = await fetch('/api/trading/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Configuration could not be saved.');
      const remaining = Math.max(0, 5000 - (Date.now() - startedAt));
      if (remaining) await new Promise((resolve) => setTimeout(resolve, remaining));
      setConfig({ ...DEFAULT_CONFIG, ...result.config });
      onNotice('Configuration saved. It will not start trading until a worker is deployed.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Configuration could not be saved.');
    } finally { setSaving(false); }
  }

  return (
    <div className="gq-page-content">
      <div className="gq-page-heading"><div><p className="gq-eyebrow">RISK SETTINGS</p><h1>Configure</h1></div><span className="gq-config-mark">01 / 04</span></div>
      {error && <div className="gq-notice gq-notice-warning" role="status">{error}</div>}
      <form className="gq-config-form" onSubmit={save}>
        <section className="gq-card gq-config-card"><SectionTitle index="01" title="Session limits" subtitle="Values use the connected Deriv account currency." />
          <NumberField label="Stake amount" prefix={currency} value={config.stake} min={0.01} max={10000} step={0.01} onChange={(value) => update('stake', value)} />
          <div className="gq-field-pair"><NumberField label="Target profit" prefix={currency} value={config.targetProfit} min={0.01} max={1000000} step={0.01} onChange={(value) => update('targetProfit', value)} /><NumberField label="Target loss" prefix={currency} value={config.targetLoss} min={0.01} max={1000000} step={0.01} onChange={(value) => update('targetLoss', value)} /></div>
        </section>
        <section className="gq-card gq-config-card"><SectionTitle index="02" title="Strategy" subtitle="Choose which signal models are enabled." />
          <div className="gq-segmented" role="group" aria-label="Strategy">{(['breakout', 'reversal', 'both'] as const).map((strategy) => <button key={strategy} type="button" className={config.strategy === strategy ? 'is-selected' : ''} onClick={() => update('strategy', strategy)}>{strategy === 'breakout' ? 'Breakout' : strategy === 'reversal' ? 'Reversal' : 'Both'}</button>)}</div>
          <label className="gq-field"><span>Market</span><select value={config.symbol} onChange={(event) => update('symbol', event.target.value)}>{SYMBOLS.map((symbol) => <option key={symbol}>{symbol}</option>)}</select></label>
          <div className="gq-field-pair"><NumberField label="Contract duration" value={config.duration} min={1} max={10000} step={1} onChange={(value) => update('duration', value)} /><label className="gq-field"><span>Duration unit</span><select value={config.durationUnit} onChange={(event) => update('durationUnit', event.target.value as TradingConfig['durationUnit'])}><option value="t">Ticks</option><option value="s">Seconds</option><option value="m">Minutes</option></select></label></div>
        </section>
        <section className="gq-card gq-config-card"><SectionTitle index="03" title="Trade safeguards" subtitle="Session caps prevent unlimited entries." />
          <div className="gq-field-pair"><NumberField label="Maximum trades" value={config.maxTrades} min={1} max={500} step={1} onChange={(value) => update('maxTrades', value)} /><NumberField label="Consecutive losses" value={config.maxConsecutiveLosses} min={1} max={50} step={1} onChange={(value) => update('maxConsecutiveLosses', value)} /></div>
          <NumberField label="Loss cooldown (minutes)" value={config.cooldownMinutes} min={0} max={1440} step={1} onChange={(value) => update('cooldownMinutes', value)} />
          <div className="gq-risk-note">{currency ? `Amounts use ${currency}.` : 'Connect Deriv to see your account currency.'} Settings are saved to your application account. Enforcement requires a deployed trading worker.</div>
        </section>
        <button className="gq-primary-button gq-save-button" type="submit" disabled={loading || saving || !valid}><Save size={17} />Save configuration</button>
      </form>
      {saving && <div className="gq-loading-overlay" role="status" aria-live="polite"><span className="gq-loading-ring"><LoaderCircle className="gq-spin" size={27} /></span><strong>Saving configuration</strong><span>Waiting for server confirmation</span></div>}
    </div>
  );
}

function SectionTitle({ index, title, subtitle }: { index: string; title: string; subtitle: string }) {
  return <div className="gq-section-title"><span>{index}</span><div><h2>{title}</h2><p>{subtitle}</p></div></div>;
}

function NumberField({ label, value, min, max, step, prefix, onChange }: { label: string; value: number; min: number; max: number; step: number; prefix?: string; onChange: (value: number) => void }) {
  return <label className="gq-field"><span>{label}</span><span className="gq-number-wrap">{prefix && <b>{prefix}</b>}<input className={prefix ? 'has-prefix' : ''} type="number" inputMode="decimal" min={min} max={max} step={step} required value={value} onChange={(event) => onChange(event.currentTarget.valueAsNumber || 0)} /></span></label>;
}