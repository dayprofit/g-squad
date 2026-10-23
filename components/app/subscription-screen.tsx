'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Clock3, Copy, ExternalLink, RefreshCw, ShieldCheck, Wallet } from 'lucide-react';

interface SubscriptionSnapshot {
  settings: {
    enabled: boolean;
    configured: boolean;
    amountUsdt: number;
    durationDays: number;
    network: string;
    tokenContractConfigured: boolean;
  };
  subscription: { active: boolean; expiresAt: string | null };
  depositAddress: string | null;
  payments: {
    depositTxid: string;
    amountUsdt: string;
    status: string;
    sweepStatus: string;
    sweepTxid: string | null;
    receivedAt: string;
  }[];
}

function dateLabel(value: string | null): string {
  if (!value) return 'Not active';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unavailable' : date.toLocaleString();
}

export function SubscriptionScreen() {
  const [snapshot, setSnapshot] = useState<SubscriptionSnapshot | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    setError('');
    try {
      const response = await fetch('/api/subscription', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Could not load subscription status.');
      setSnapshot(result as SubscriptionSnapshot);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load subscription status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 20_000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  async function copyAddress() {
    if (!snapshot?.depositAddress) return;
    try {
      await navigator.clipboard.writeText(snapshot.depositAddress);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError('Could not copy the address. Select and copy it manually.');
    }
  }

  const paymentEnabled = snapshot?.settings.enabled === true;
  return <div className="gq-page-content gq-subscription-page">
    <div className="gq-page-heading">
      <div><p className="gq-eyebrow">ACCOUNT ACCESS</p><h1>Subscription</h1></div>
      <button className="gq-icon-button" type="button" aria-label="Refresh subscription status" onClick={() => void refresh()} disabled={loading}>
        <RefreshCw size={17} className={loading ? 'gq-spin' : ''} />
      </button>
    </div>

    {error && <div className="gq-subscription-error" role="alert">{error}<button type="button" onClick={() => void refresh()}>Try again</button></div>}
    {loading && !snapshot ? <section className="gq-card gq-subscription-state"><RefreshCw className="gq-spin" size={20} /><p>Loading subscription status…</p></section> : null}
    {snapshot && <>
      <section className="gq-card gq-subscription-status">
        <div className="gq-subscription-status-icon"><ShieldCheck size={20} /></div>
        <div><span className="gq-eyebrow">TRADING ACCESS</span><h2>{snapshot.subscription.active ? 'Subscription active' : 'Subscription required'}</h2>
          <p>{snapshot.subscription.active ? `Access expires ${dateLabel(snapshot.subscription.expiresAt)}.` : paymentEnabled ? 'Confirm the exact payment below to enable bot access.' : 'Subscriptions are currently disabled by the app owner.'}</p>
        </div>
        <span className={`gq-state-tag ${snapshot.subscription.active ? 'is-online' : 'is-unavailable'}`}>{snapshot.subscription.active ? 'ACTIVE' : 'INACTIVE'}</span>
      </section>

      {paymentEnabled && snapshot.settings.configured && <section className="gq-card gq-subscription-payment">
        <div className="gq-card-heading"><div className="gq-section-icon"><Wallet size={18} /></div><div><h2>USDT payment</h2><p>{snapshot.settings.network}</p></div></div>
        <div className="gq-subscription-price"><span>Subscription price</span><strong>{snapshot.settings.amountUsdt.toFixed(2)} USDT</strong><small>Access for {snapshot.settings.durationDays} days after confirmation</small></div>
        <div className="gq-subscription-address">
          <span>Your personal deposit address</span>
          {snapshot.depositAddress ? <><code>{snapshot.depositAddress}</code><button className="gq-secondary-button" type="button" onClick={() => void copyAddress()}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? 'Copied' : 'Copy address'}</button></> : <p className="gq-footnote">A deposit address is not available yet. Refresh or contact support.</p>}
        </div>
        <div className="gq-subscription-warning"><Clock3 size={16} /><p>Send only the exact USDT amount on TRON Nile testnet to this address. Other networks and tokens are not supported. One confirmed transfer is required; partial transfers are not combined. Never send mainnet funds to a testnet address.</p></div>
      </section>}

      {paymentEnabled && !snapshot.settings.configured && <section className="gq-card gq-subscription-state"><h2>Subscription setup is incomplete</h2><p>The app owner must configure the USDT price and duration before payments can be made.</p></section>}

      <section className="gq-card gq-subscription-history">
        <div className="gq-card-heading"><div><h2>Payment history</h2><p>Deposit confirmation and treasury sweep status</p></div></div>
        {snapshot.payments.length ? <div className="gq-subscription-payments">{snapshot.payments.map((payment) => <article key={payment.depositTxid}>
          <div className="gq-subscription-payment-row"><strong>{payment.amountUsdt} USDT</strong><span className={`gq-state-tag ${payment.status === 'successful' ? 'is-online' : 'is-unavailable'}`}>{payment.status.replace('_', ' ')}</span></div>
          <small>{dateLabel(payment.receivedAt)} · sweep {payment.sweepStatus.replace('_', ' ')}</small>
          <a href={`https://nile.tronscan.org/#/transaction/${encodeURIComponent(payment.depositTxid)}`} target="_blank" rel="noreferrer">View deposit <ExternalLink size={13} /></a>
          {payment.sweepTxid && <a href={`https://nile.tronscan.org/#/transaction/${encodeURIComponent(payment.sweepTxid)}`} target="_blank" rel="noreferrer">View treasury transfer <ExternalLink size={13} /></a>}
        </article>)}</div> : <p className="gq-admin-empty">No payments recorded yet.</p>}
      </section>
    </>}
  </div>;
}
