'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, Bot, Link2, Pause, Play, Wallet } from 'lucide-react';
import { useDerivWSContext } from '@/components/custom/deriv-ws-provider';
import { useBaseTrading } from '@/hooks/use-base-trading';

interface ConsoleEntry {
  id: number;
  time: string;
  category: 'INFO' | 'SUCCESS' | 'WARNING' | 'TRADE';
  message: string;
}

function money(value: number, currency?: string): string {
  if (!currency) return 'Unavailable';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

export function HomeDashboard() {
  const { ws, isConnected, isExhausted, auth } = useDerivWSContext();
  const { authState, activeAccount, login, logout } = auth;
  const trading = useBaseTrading({ ws, isConnected, isExhausted, isAuthenticated: !!auth.wsUrl, onAuthWSFailed: () => { void logout(); }, contractTypes: ['CALL', 'PUT'] });
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const [connectError, setConnectError] = useState('');
  const previousConnection = useRef<string | null>(null);
  const previousLatestSettlement = useRef<number | null>(null);

  const addEntry = useCallback((category: ConsoleEntry['category'], message: string) => {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    setEntries((current) => [{ id: Date.now() + Math.random(), time, category, message }, ...current].slice(0, 100));
  }, []);

  useEffect(() => {
    const state = auth.wsUrl ? (isConnected ? 'connected' : 'connecting') : 'disconnected';
    if (previousConnection.current === state) return;
    previousConnection.current = state;
    if (state === 'connected') addEntry('SUCCESS', 'Deriv account connection established.');
    if (state === 'connecting') addEntry('INFO', 'Connecting to Deriv account.');
    if (state === 'disconnected' && authState === 'authenticated') addEntry('WARNING', 'Deriv connection is currently unavailable.');
  }, [auth.wsUrl, authState, isConnected, addEntry]);

  useEffect(() => {
    const latestId = trading.closedPositions[0]?.contract_id ?? null;
    if (previousLatestSettlement.current !== null && latestId !== null && latestId !== previousLatestSettlement.current) {
      addEntry('TRADE', 'Deriv settlement history updated.');
    }
    if (latestId !== null) previousLatestSettlement.current = latestId;
  }, [trading.closedPositions, addEntry]);

  const closed = trading.closedPositions;
  const wins = closed.filter((position) => position.sell_price - position.buy_price > 0).length;
  const losses = closed.filter((position) => position.sell_price - position.buy_price < 0).length;
  const resolved = wins + losses;
  const profitLoss = closed.reduce((total, position) => total + position.sell_price - position.buy_price, 0);
  const accountConnected = !!auth.wsUrl && isConnected && !!activeAccount;

  async function connectDeriv() {
    setConnectError('');
    try { await login(); }
    catch (error) { setConnectError(error instanceof Error ? error.message : 'Could not connect to Deriv.'); }
  }

  return (
    <div className="gq-page-content">
      <div className="gq-page-heading"><div><p className="gq-eyebrow">OVERVIEW</p><h1>Home</h1></div><span className="gq-live-pill"><span /> LIVE DATA</span></div>
      <section className="gq-card gq-account-card">
        <div className="gq-card-heading"><div className="gq-section-icon"><Wallet size={18} /></div><div><h2>Deriv account</h2><p>{accountConnected ? `${activeAccount.account_id} · ${activeAccount.account_type === 'demo' ? 'Demo' : 'Real'}` : 'Not connected'}</p></div><span className={`gq-connection-dot ${accountConnected ? 'is-online' : ''}`} aria-label={accountConnected ? 'Connected' : 'Not connected'} /></div>
        <div className="gq-balance-block"><span>Current balance</span><strong>{accountConnected ? money(Number(activeAccount.balance), activeAccount.currency) : 'Connect Deriv'}</strong></div>
        <div className="gq-stat-grid">
          <Stat label="P/L" value={accountConnected ? money(profitLoss, activeAccount.currency) : '—'} tone={profitLoss > 0 ? 'positive' : profitLoss < 0 ? 'negative' : ''} icon={profitLoss >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />} />
          <Stat label="Wins" value={accountConnected ? String(wins) : '—'} /><Stat label="Losses" value={accountConnected ? String(losses) : '—'} />
          <Stat label="Win rate" value={accountConnected && resolved ? `${Math.round((wins / resolved) * 100)}%` : accountConnected ? '0%' : '—'} />
        </div>
        <p className="gq-footnote">P/L uses the recent settled contracts returned by Deriv. Balance currency: {activeAccount?.currency ?? 'not available'}.</p>
        {!accountConnected && <p className="gq-footnote">Deriv authorization is separate from this app login. The connection requests trade access for account and trading data.</p>}
        {!accountConnected && <button className="gq-secondary-button gq-wide-button" type="button" onClick={connectDeriv} disabled={!process.env.NEXT_PUBLIC_DERIV_APP_ID}><Link2 size={17} />{process.env.NEXT_PUBLIC_DERIV_APP_ID ? 'Connect Deriv account' : 'Deriv app ID not configured'}</button>}
        {(connectError || auth.error) && <p className="gq-inline-error" role="alert">{connectError || auth.error}</p>}
      </section>
      <section className="gq-card gq-bot-card">
        <div className="gq-card-heading"><div className="gq-section-icon gq-section-icon-dark"><Bot size={18} /></div><div><h2>Automatic trading</h2><p>Volatility Breakout · Reversal</p></div><span className="gq-state-tag is-unavailable">UNAVAILABLE</span></div>
        <div className="gq-worker-warning"><AlertTriangle size={16} /><p>No persistent trading worker is deployed. Automation is disabled; no trades will be placed.</p></div>
        <div className="gq-bot-actions"><button className="gq-primary-button" type="button" disabled title="A server trading worker must be deployed first"><Play size={16} fill="currentColor" />Start</button><button className="gq-secondary-button" type="button" disabled title="No bot session is running"><Pause size={16} />Stop</button></div>
        <p className="gq-footnote">{accountConnected ? `Market: ${trading.activeSymbol?.underlying_symbol ?? 'loading'}` : 'Connect a Deriv account to view market details.'}</p>
      </section>
      <section className="gq-card gq-console-card">
        <div className="gq-console-heading"><div><h2>Activity console</h2><p>Newest events first</p></div><span><Activity size={14} />{entries.length} EVENTS</span></div>
        <div className="gq-console" aria-live="polite">{entries.length === 0 ? <p className="gq-console-empty">Waiting for application or account activity.</p> : entries.map((entry) => <div className="gq-console-line" key={entry.id}><time>{entry.time}</time><b className={`log-${entry.category.toLowerCase()}`}>{entry.category}</b><span>{entry.message}</span></div>)}</div>
      </section>
      {trading.error && <p className="gq-inline-error">{trading.error}</p>}
    </div>
  );
}

function Stat({ label, value, tone = '', icon }: { label: string; value: string; tone?: string; icon?: React.ReactNode }) {
  return <div className="gq-stat"><span>{label}</span><strong className={tone}>{icon}{value}</strong></div>;
}