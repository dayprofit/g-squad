'use client';

import { useState } from 'react';
import { AlertTriangle, CalendarDays, CircleUserRound, Link2, LogOut, ShieldCheck, Unlink } from 'lucide-react';
import { useAppSession } from './app-session';
import { useDerivWSContext } from '@/components/custom/deriv-ws-provider';

function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join(''); }

export function ProfileScreen({ onNotice }: { onNotice: (message: string) => void }) {
  const { user, logout } = useAppSession();
  const { auth } = useDerivWSContext();
  const [pending, setPending] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const connected = !!auth.wsUrl && !!auth.activeAccount;

  async function connectDeriv() {
    setConnectionError('');
    try { await auth.login(); }
    catch (error) { setConnectionError(error instanceof Error ? error.message : 'Could not start Deriv connection.'); }
  }

  async function disconnectDeriv() {
    if (!window.confirm('Disconnect Deriv from this browser? Any open contracts will remain open at Deriv and will not be closed automatically.')) return;
    try {
      await auth.logout();
      onNotice('Deriv account disconnected. Your G-squad account remains active.');
    } catch (error) {
      onNotice(error instanceof Error ? error.message : 'Could not disconnect Deriv.');
    }
  }

  async function logoutApp() {
    setPending(true);
    try { await logout(); onNotice('You are logged out of G-squad.'); }
    catch (error) { onNotice(error instanceof Error ? error.message : 'Application logout failed.'); }
    finally { setPending(false); }
  }

  async function switchDerivAccount(accountId: string) {
    setSwitching(true);
    setSwitchError('');
    try {
      await auth.switchAccount(accountId);
      onNotice('Deriv account switched.');
    } catch (error) {
      setSwitchError(error instanceof Error ? error.message : 'Could not switch Deriv accounts.');
    } finally {
      setSwitching(false);
    }
  }

  if (!user) return null;
  const joined = new Date(user.joinedAt);
  return (
    <div className="gq-page-content">
      <div className="gq-page-heading"><div><p className="gq-eyebrow">YOUR ACCOUNT</p><h1>Profile</h1></div><CircleUserRound size={23} className="gq-heading-icon" /></div>
      <section className="gq-profile-hero"><div className="gq-avatar gq-avatar-large">{initials(user.fullName)}</div><div><h2>{user.fullName}</h2><p>{user.email}</p></div></section>
      <section className="gq-card gq-profile-card"><div className="gq-profile-row"><span><ShieldCheck size={17} />Application ID</span><strong>{user.accountId}</strong></div><div className="gq-profile-row"><span><CalendarDays size={17} />Date joined</span><strong>{Number.isNaN(joined.getTime()) ? 'Unavailable' : joined.toLocaleDateString()}</strong></div></section>
      <section className="gq-card gq-profile-card">
        <div className="gq-card-heading"><div className="gq-section-icon"><Link2 size={18} /></div><div><h2>Deriv connection</h2><p>{connected ? 'Connected in this browser' : 'Not connected'}</p></div><span className={`gq-connection-dot ${connected ? 'is-online' : ''}`} /></div>
        {connected && auth.activeAccount && <div className="gq-deriv-details"><div><span>Account</span><strong>{auth.activeAccount.account_id}</strong></div><div><span>Type</span><strong>{auth.activeAccount.account_type === 'demo' ? 'Demo' : 'Real'}</strong></div><div><span>Currency</span><strong>{auth.activeAccount.currency}</strong></div></div>}
        {connected && auth.accounts.length > 1 && <label className="gq-field"><span>Switch account</span><select disabled={switching} value={auth.activeAccountId ?? ''} onChange={(event) => void switchDerivAccount(event.target.value)}>{auth.accounts.map((account) => <option key={account.account_id} value={account.account_id}>{account.account_id} · {account.account_type === 'demo' ? 'Demo' : 'Real'}</option>)}</select></label>}
        {switchError && <p className="gq-inline-error" role="alert">{switchError}</p>}
        {(connectionError || auth.error) && <p className="gq-inline-error" role="alert">{connectionError || auth.error}</p>}
        {!connected && process.env.NEXT_PUBLIC_DERIV_APP_ID && <button className="gq-secondary-button gq-wide-button" type="button" onClick={() => void connectDeriv()}><Link2 size={16} />Connect Deriv account</button>}
        <p className="gq-footnote">Application login and Deriv authorization are separate. Trading access is requested for account and market operations. Credentials are not displayed here.</p>
      </section>
      <section className="gq-profile-actions"><button className="gq-danger-button" type="button" disabled={!connected} onClick={() => void disconnectDeriv()}><Unlink size={17} />Disconnect Deriv account</button><button className="gq-secondary-button gq-wide-button" type="button" disabled={pending} onClick={() => void logoutApp()}><LogOut size={17} />Log out of G-squad</button>{connected && <p className="gq-open-contract-note"><AlertTriangle size={15} />Disconnecting does not close open Deriv contracts.</p>}</section>
    </div>
  );
}