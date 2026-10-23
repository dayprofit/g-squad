'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Save } from 'lucide-react';
import { useDerivWSContext } from '@/components/custom/deriv-ws-provider';
import { FIXED_TRADING_SYMBOL, FIXED_TRADING_SYMBOL_NAME } from '@/lib/trading-constants';

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

const DEFAULT_CONFIG: TradingConfig = { stake: 1, targetProfit: 5, targetLoss: 3, symbol: FIXED_TRADING_SYMBOL, duration: 1, durationUnit: 'm', maxTrades: 25, maxConsecutiveLosses: 3, cooldownMinutes: 5 };

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

  const update = <K extends keyof TradingConfig>(key: K, value: TradingConfig[K]) => {
    setConfig((current) => ({ ...current, [key]: value }));
    setError('');
  };
  const valid = Number.isFinite(config.stake) && config.stake > 0 && config.stake <= 10000
    && Number.isFinite(config.targetProfit) && config.targetProfit > 0 && config.targetProfit <= 1000000
    && Number.isFinite(config.targetLoss) && config.targetLoss > 0 && config.targetLoss <= 1000000
    && Number.isInteger(config.duration) && config.duration >= 1 && config.duration <= 10000
    && Number.isInteger(config.maxTrades) && config.maxTrades >= 1 && config.maxTrades <= 500
    && Number.isInteger(config.maxConsecutiveLosses) && config.maxConsecutiveLosses >= 1 && config.maxConsecutiveLosses <= 50
    && Number.isInteger(config.cooldownMinutes) && config.cooldownMinutes >= 0 && config.cooldownMinutes <= 1440;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch('/api/trading/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...config, symbol: FIXED_TRADING_SYMBOL }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Configuration could not be saved.');
      setConfig({ ...DEFAULT_CONFIG, ...result.config });
      onNotice('Settings saved. Start automated trading from Home; it runs only while that page stays open.');
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
        <section className="gq-card gq-config-card"><SectionTitle index="02" title="Trade setup" subtitle="Fixed market and contract duration." />
          <div className="gq-field"><span>Market</span><strong>{FIXED_TRADING_SYMBOL_NAME}</strong></div>
          <div className="gq-field-pair"><NumberField label="Contract duration" value={config.duration} min={1} max={10000} step={1} onChange={(value) => update('duration', value)} /><label className="gq-field"><span>Duration unit</span><select value={config.durationUnit} onChange={(event) => update('durationUnit', event.target.value as TradingConfig['durationUnit'])}><option value="t">Ticks</option><option value="s">Seconds</option><option value="m">Minutes</option></select></label></div>
        </section>
        <section className="gq-card gq-config-card"><SectionTitle index="03" title="Trade safeguards" subtitle="Session caps prevent unlimited entries." />
          <div className="gq-field-pair"><NumberField label="Maximum trades" value={config.maxTrades} min={1} max={500} step={1} onChange={(value) => update('maxTrades', value)} /><NumberField label="Consecutive losses" value={config.maxConsecutiveLosses} min={1} max={50} step={1} onChange={(value) => update('maxConsecutiveLosses', value)} /></div>
          <NumberField label="Loss cooldown (minutes)" value={config.cooldownMinutes} min={0} max={1440} step={1} onChange={(value) => update('cooldownMinutes', value)} />
          <div className="gq-risk-note">Amounts use the selected Deriv account currency. Real accounts place live trades using real funds. Trading stops if this dashboard page closes.</div>
        </section>
        <button className="gq-primary-button gq-save-button" type="submit" disabled={loading || saving || !valid}><Save size={17} />Save configuration</button>
      </form>
    </div>
  );
}

function SectionTitle({ index, title, subtitle }: { index: string; title: string; subtitle: string }) {
  return <div className="gq-section-title"><span>{index}</span><div><h2>{title}</h2><p>{subtitle}</p></div></div>;
}

function NumberField({ label, value, min, max, step, prefix, onChange }: { label: string; value: number; min: number; max: number; step: number; prefix?: string; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(Number.isFinite(value) ? String(value) : '');
  useEffect(() => {
    if (Number.isFinite(value) && Number(value) !== Number(draft)) setDraft(String(value));
  }, [value, draft]);
  return <label className="gq-field"><span>{label}</span><span className="gq-number-wrap">{prefix && <b>{prefix}</b>}<input className={prefix ? 'has-prefix' : ''} type="number" inputMode="decimal" min={min} max={max} step={step} required value={draft} onChange={(event) => {
    const next = event.currentTarget.value;
    setDraft(next);
    if (next === '') onChange(Number.NaN);
    else if (!next.endsWith('.')) onChange(event.currentTarget.valueAsNumber);
  }} /></span></label>;
}