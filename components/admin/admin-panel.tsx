'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { ReactNode } from 'react';
import {
  Activity, ArrowLeft, BarChart3, Bell, Check, CircleUserRound, Clock3, Copy,
  Eye, LoaderCircle, LockKeyhole, Menu, Search, ShieldCheck, UserCog, UserPlus, Users, X,
} from 'lucide-react';
import { useAppSession } from '@/components/app/app-session';
import type { TradingConfig } from '@/lib/trading-config';

interface AdminUser {
  id: string;
  accountId: string;
  fullName: string;
  email: string;
  joinedAt: string;
  lastLoginAt: string | null;
  isSuspended: boolean;
  hasDerivConnection: boolean;
  tradingConfig: TradingConfig | null;
  isAdmin: boolean;
  adminRole: string | null;
}

interface ActivityItem {
  id: string;
  eventType: string;
  details: Record<string, unknown>;
  createdAt: string;
  actorName: string;
  actorEmail: string | null;
  subjectName: string;
  subjectEmail: string | null;
}

type AdminView = 'overview' | 'users' | 'activity' | 'staff' | 'alerts';

class AdminRequestError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = 'AdminRequestError';
  }
}

const DEFAULT_TRADING_CONFIG: TradingConfig = {
  stake: 1,
  targetProfit: 5,
  targetLoss: 3,
  symbol: '1HZ100V',
  duration: 5,
  durationUnit: 't',
  maxTrades: 25,
  maxConsecutiveLosses: 3,
  cooldownMinutes: 5,
};

async function readResponse(response: Response) {
  const result = await response.json();
  if (!response.ok) throw new AdminRequestError(result.error ?? 'Admin request failed.', result.code);
  return result;
}

function dateLabel(value: string | null): string {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unavailable' : date.toLocaleString();
}

export function AdminPanel() {
  const { user, loading: sessionLoading } = useAppSession();
  const [view, setView] = useState<AdminView>('users');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [activityPage, setActivityPage] = useState(1);
  const [activityTotal, setActivityTotal] = useState(0);
  const [activityType, setActivityType] = useState('');
  const [activityFrom, setActivityFrom] = useState('');
  const [activityTo, setActivityTo] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalUsers, setTotalUsers] = useState(0);
  const [loading, setLoading] = useState(true);
  const [accessError, setAccessError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [resetLink, setResetLink] = useState('');
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [detailUserId, setDetailUserId] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mfaStage, setMfaStage] = useState<'setup' | 'verify' | null>(null);
  const [actionLabel, setActionLabel] = useState('');
  const [reauthOpen, setReauthOpen] = useState(false);
  const [reauthError, setReauthError] = useState('');
  const reauthResolver = useRef<(() => void) | null>(null);
  const overlayStack = useRef<{ id: number; label: string }[]>([]);
  const overlayId = useRef(0);

  const withOverlay = useCallback(async <T,>(label: string, action: () => Promise<T>): Promise<T> => {
    const startedAt = Date.now();
    const id = ++overlayId.current;
    overlayStack.current.push({ id, label });
    setActionLabel(label);
    try {
      return await action();
    } finally {
      const remaining = 2000 - (Date.now() - startedAt);
      if (remaining > 0) await new Promise((resolve) => window.setTimeout(resolve, remaining));
      overlayStack.current = overlayStack.current.filter((item) => item.id !== id);
      setActionLabel(overlayStack.current.at(-1)?.label ?? '');
    }
  }, []);

  const adminRequest = useCallback(async (request: () => Promise<Response>): Promise<Record<string, unknown>> => {
    const response = await request();
    const result = await response.json();
    if (result.code === 'ADMIN_REAUTH_REQUIRED') {
      await new Promise<void>((resolve) => {
        reauthResolver.current = resolve;
        setReauthError('');
        setReauthOpen(true);
      });
      return adminRequest(request);
    }
    if (!response.ok) throw new AdminRequestError(result.error ?? 'Admin request failed.', result.code);
    return result;
  }, []);

  const loadData = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError('');
    try {
      const security = await readResponse(await fetch('/api/admin/mfa', { cache: 'no-store', signal }));
      if (!security.mfaEnabled) {
        setMfaStage('setup');
        setAccessError('');
        return;
      }
      if (!security.mfaVerified) {
        setMfaStage('verify');
        setAccessError('');
        return;
      }
      setMfaStage(null);
      const params = new URLSearchParams({ page: String(page) });
      if (search) params.set('search', search);
      const query = params.toString();
      const activityParams = new URLSearchParams({
        page: String(activityPage),
        ...(search ? { search } : {}),
        ...(activityType ? { eventType: activityType } : {}),
        ...(activityFrom ? { from: activityFrom } : {}),
        ...(activityTo ? { to: activityTo } : {}),
      });
      const [usersResponse, activityResponse] = await Promise.all([
        fetch(`/api/admin/users${query ? `?${query}` : ''}`, { cache: 'no-store', signal }),
        fetch(`/api/admin/activity?${activityParams}`, { cache: 'no-store', signal }),
      ]);
      const usersResult = await readResponse(usersResponse);
      const activityResult = await readResponse(activityResponse);
      setUsers(usersResult.users);
      setTotalUsers(usersResult.total);
      setActivities(activityResult.activities);
      setActivityTotal(activityResult.total);
      setAccessError('');
    } catch (reason) {
      if (signal?.aborted) return;
      const message = reason instanceof Error ? reason.message : 'Could not load admin data.';
      if (reason instanceof AdminRequestError && reason.code === 'ADMIN_MFA_SETUP_REQUIRED') {
        setMfaStage('setup');
      } else if (reason instanceof AdminRequestError && reason.code === 'ADMIN_MFA_REQUIRED') {
        setMfaStage('verify');
      } else if (reason instanceof AdminRequestError && reason.code === 'ADMIN_ACCESS_REQUIRED') {
        setAccessError(message);
      } else {
        setError(message);
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [activityFrom, activityPage, activityTo, activityType, page, search]);

  useEffect(() => {
    if (sessionLoading || !user) return;
    const controller = new AbortController();
    void loadData(controller.signal);
    return () => controller.abort();
  }, [loadData, sessionLoading, user]);

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setError('');
    setNotice('');
    await withOverlay('Creating account', async () => {
      try {
        const result = await adminRequest(() => fetch('/api/admin/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fullName: values.get('fullName'),
            email: values.get('email'),
          }),
        }));
        form.reset();
        setResetLink(String(result.resetUrl));
        setNotice('User created. Copy the one-time setup link and share it with the user securely.');
        await loadData();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Could not create user.');
      }
    });
  }

  async function updateUser(userId: string, values: Record<string, unknown>, message: string) {
    setError('');
    setNotice('');
    await withOverlay('Saving account changes', async () => {
      try {
        await adminRequest(() => fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(values),
        }));
        setNotice(message);
        await loadData();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Could not update user.');
      }
    });
  }

  async function issueResetLink(userId: string) {
    await withOverlay('Creating password reset link', async () => {
      try {
        const result = await adminRequest(() => fetch(`/api/admin/users/${encodeURIComponent(userId)}/reset`, { method: 'POST' }));
        setResetLink(String(result.resetUrl));
        setNotice('One-time password setup link created. Share it securely; it expires in one hour.');
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Could not create a reset link.');
      }
    });
  }

  async function bulkChangeSuspension(isSuspended: boolean) {
    if (!selectedUsers.length) return;
    const action = isSuspended ? 'suspend access for' : 'restore access for';
    if (!window.confirm(`Are you sure you want to ${action} ${selectedUsers.length} selected account(s)?`)) return;
    await withOverlay(isSuspended ? 'Suspending selected accounts' : 'Restoring selected accounts', async () => {
      try {
        const result = await adminRequest(() => fetch('/api/admin/users/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userIds: selectedUsers, isSuspended }),
        }));
        setSelectedUsers([]);
        setNotice(`${result.updated} account(s) updated${result.notFound ? `; ${result.notFound} were not found` : ''}.`);
        await loadData();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Could not complete the bulk action.');
      }
    });
  }

  async function signOut() {
    let signedOut = false;
    await withOverlay('Ending session', async () => {
      try {
        const response = await fetch('/api/auth/logout', { method: 'POST' });
        await readResponse(response);
        signedOut = true;
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Could not sign out.');
      }
    });
    if (signedOut) window.location.assign('/');
  }

  async function submitReauthentication(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    await withOverlay('Verifying your identity', async () => {
      try {
        await readResponse(await fetch('/api/admin/reauth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: values.get('password'), code: values.get('code') }),
        }));
        setReauthOpen(false);
        const resume = reauthResolver.current;
        reauthResolver.current = null;
        resume?.();
      } catch (reason) {
        setReauthError(reason instanceof Error ? reason.message : 'Could not verify your identity.');
      }
    });
  }

  if (sessionLoading || user && loading && !accessError && !error && users.length === 0 && activities.length === 0) {
    return <><main className="gq-admin-loading"><LoaderCircle className="gq-spin" size={24} />Loading admin workspace</main>{actionLabel && <ActionOverlay label={actionLabel} />}</>;
  }

  if (!user || accessError) {
    return (
      <main className="gq-admin-denied">
        <section className="gq-admin-denied-card">
          <ShieldCheck size={32} />
          <p className="gq-admin-eyebrow">G-SQUAD ADMIN</p>
          <h1>Admin access required</h1>
          <p>{accessError || 'Sign in with an account listed in the server-only ADMIN_EMAILS setting.'}</p>
          <a className="gq-admin-primary" href="/"><ArrowLeft size={16} />Return to app</a>
        </section>
      </main>
    );
  }

  if (mfaStage) {
    return (
      <>
        <AdminMfaGate
          stage={mfaStage}
          withOverlay={withOverlay}
          onComplete={() => void loadData()}
          onError={setError}
        />
        {actionLabel && <ActionOverlay label={actionLabel} />}
      </>
    );
  }

  const isOwner = user.adminRole === 'owner';
  const canManageUsers = isOwner || user.adminRole === 'account_manager';
  const canSuspendUsers = isOwner || user.adminRole === 'account_manager' || user.adminRole === 'support';
  const viewTitle: Record<AdminView, string> = {
    overview: 'Operations overview',
    users: 'User management',
    activity: 'Account activity',
    staff: 'Staff access',
    alerts: 'Operational alerts',
  };
  const nav = (id: AdminView, label: string, Icon: typeof Users) => (
    <button type="button" className={view === id ? 'is-active' : ''} onClick={() => { setView(id); setMobileMenuOpen(false); }}>
      <Icon size={18} />{label}
    </button>
  );

  return (
    <main className="gq-admin-shell">
      <button
        className="gq-admin-mobile-menu"
        type="button"
        aria-label={mobileMenuOpen ? 'Close admin menu' : 'Open admin menu'}
        onClick={() => setMobileMenuOpen((open) => !open)}
      >
        {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
        <span>Admin menu</span>
      </button>
      {mobileMenuOpen && <button className="gq-admin-backdrop" type="button" aria-label="Close admin menu" onClick={() => setMobileMenuOpen(false)} />}
      <aside className={`gq-admin-sidebar ${mobileMenuOpen ? 'is-open' : ''}`}>
        <div className="gq-admin-brand"><span className="gq-admin-brand-icon"><ShieldCheck size={20} /></span><div><strong>G-squad</strong><span>Admin workspace</span></div></div>
        <p className="gq-admin-nav-label">MANAGEMENT</p>
        <nav className="gq-admin-nav" aria-label="Admin navigation">
          {(isOwner || user.adminRole === 'read_only') && nav('overview', 'Overview', BarChart3)}
          {nav('users', 'Users', Users)}
          {nav('activity', 'Activity log', Activity)}
          {isOwner && nav('staff', 'Staff access', UserCog)}
          {nav('alerts', 'Alerts', Bell)}
        </nav>
        <div className="gq-admin-sidebar-bottom">
          <div className="gq-admin-identity"><span><CircleUserRound size={18} /></span><div><strong>{user.fullName}</strong><small>{user.email}</small></div></div>
          <a href="/"><ArrowLeft size={16} />Back to app</a>
        </div>
      </aside>
      <section className="gq-admin-content">
        <header className="gq-admin-topbar">
          <div><p className="gq-admin-eyebrow">G-SQUAD · ADMINISTRATION</p><h1>{viewTitle[view]}</h1></div>
          <div className="gq-admin-top-actions"><span className="gq-admin-role"><ShieldCheck size={15} />{(user.adminRole ?? 'Staff').replace('_', ' ')}</span><button type="button" onClick={() => void signOut()}><LockKeyhole size={15} />Sign out</button></div>
        </header>
        {(error || notice) && <div className={`gq-admin-notice ${error ? 'is-error' : ''}`} role={error ? 'alert' : 'status'}>{error || notice}</div>}
        {resetLink && <div className="gq-admin-reset-link"><label htmlFor="gq-admin-reset-url">One-time account setup / reset link</label><div><input id="gq-admin-reset-url" value={resetLink} readOnly /><button type="button" onClick={() => void navigator.clipboard.writeText(resetLink).then(() => setNotice('Reset link copied.'))}><Copy size={15} />Copy link</button><button type="button" aria-label="Close reset link" onClick={() => setResetLink('')}><X size={15} /></button></div></div>}
        {view === 'users' ? (
          <>
            <section className="gq-admin-metrics">
              <Metric icon={<Users size={18} />} label="Total users" value={String(totalUsers)} />
              <Metric icon={<Activity size={18} />} label="Active accounts (this page)" value={String(users.filter((item) => !item.isSuspended).length)} />
              <Metric icon={<ShieldCheck size={18} />} label="Deriv connected (this page)" value={String(users.filter((item) => item.hasDerivConnection).length)} />
            </section>
            {canManageUsers && <section className="gq-admin-card gq-admin-create">
              <div className="gq-admin-card-heading"><div><h2><UserPlus size={17} />Add a user</h2><p>Create an account and issue a one-time password setup link. No temporary password is created or shown.</p></div></div>
              <form className="gq-admin-create-form" onSubmit={(event) => void createUser(event)}>
                <label><span>Full name</span><input name="fullName" required minLength={2} maxLength={100} autoComplete="name" /></label>
                <label><span>Email address</span><input name="email" type="email" required maxLength={254} autoComplete="email" /></label>
                <button className="gq-admin-primary" type="submit"><UserPlus size={16} />Create user</button>
              </form>
            </section>}
            <section className="gq-admin-card">
              <div className="gq-admin-card-heading gq-admin-list-heading">
                <div><h2>Application users</h2><p>Search, update access, and edit bot risk settings. Deriv credentials and trades are never exposed.</p></div>
                <label className="gq-admin-search"><Search size={16} /><input aria-label="Search users" placeholder="Search name, email, or ID" value={search} onChange={(event) => { setPage(1); setSearch(event.target.value); }} /></label>
              </div>
              {canSuspendUsers && selectedUsers.length > 0 && <div className="gq-admin-bulk-bar"><span>{selectedUsers.length} selected</span><button type="button" onClick={() => void bulkChangeSuspension(true)}>Suspend selected</button><button type="button" onClick={() => void bulkChangeSuspension(false)}>Restore selected</button><button type="button" onClick={() => setSelectedUsers([])}>Clear</button></div>}
              {loading ? <div className="gq-admin-inline-loading"><LoaderCircle className="gq-spin" size={18} />Refreshing users…</div> : users.length ? (
                <div className="gq-admin-user-list">
                  {users.map((adminUser) => (
                    <AdminUserCard
                      key={adminUser.id}
                      user={adminUser}
                      onUpdate={(values, message) => updateUser(adminUser.id, values, message)}
                      onReset={() => issueResetLink(adminUser.id)}
                      onSelect={(checked) => setSelectedUsers((ids) => checked ? [...new Set([...ids, adminUser.id])] : ids.filter((id) => id !== adminUser.id))}
                      selected={selectedUsers.includes(adminUser.id)}
                      canEdit={canManageUsers}
                      canSuspend={canSuspendUsers && (isOwner || !adminUser.isAdmin)}
                      canBulk={canManageUsers && !adminUser.isAdmin}
                      onView={() => setDetailUserId(adminUser.id)}
                      showDetails={isOwner || !adminUser.isAdmin}
                    />
                  ))}
                </div>
              ) : <p className="gq-admin-empty">No users match this search.</p>}
              {totalUsers > 50 && <div className="gq-admin-pagination"><span>Showing {Math.min((page - 1) * 50 + 1, totalUsers)}–{Math.min(page * 50, totalUsers)} of {totalUsers}</span><div><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</button><button type="button" disabled={page * 50 >= totalUsers || loading} onClick={() => setPage((current) => current + 1)}>Next</button></div></div>}
            </section>
          </>
        ) : view === 'activity' ? (
          <section className="gq-admin-card">
            <div className="gq-admin-card-heading"><div><h2><Activity size={17} />Recent account activity</h2><p>Registration, successful sign-ins, and administrator changes.</p></div></div>
            <div className="gq-admin-filters"><label>Event type<select value={activityType} onChange={(event) => { setActivityPage(1); setActivityType(event.target.value); }}><option value="">All events</option><option value="user.registered">Registration</option><option value="user.login">Successful sign-in</option><option value="auth.login_failed">Failed sign-in</option><option value="admin.user_updated">User changes</option><option value="admin.staff_role_changed">Staff role changes</option></select></label><label>From<input type="date" value={activityFrom} onChange={(event) => { setActivityPage(1); setActivityFrom(event.target.value); }} /></label><label>To<input type="date" value={activityTo} onChange={(event) => { setActivityPage(1); setActivityTo(event.target.value); }} /></label></div>
            {loading ? <div className="gq-admin-inline-loading"><LoaderCircle className="gq-spin" size={18} />Refreshing activity…</div> : activities.length ? (
              <div className="gq-admin-activity-list">
                {activities.map((activity) => (
                  <article className="gq-admin-activity-item" key={activity.id}>
                    <span className="gq-admin-activity-icon"><Clock3 size={16} /></span>
                    <div><strong>{activityLabel(activity.eventType)}</strong><p>{activity.subjectName}{activity.subjectEmail ? ` · ${activity.subjectEmail}` : ''}</p><small>By {activity.actorName}{activity.actorEmail ? ` · ${activity.actorEmail}` : ''}{Object.keys(activity.details).length ? ` · ${JSON.stringify(activity.details)}` : ''}</small></div>
                    <time>{dateLabel(activity.createdAt)}</time>
                  </article>
                ))}
              </div>
            ) : <p className="gq-admin-empty">No account activity recorded yet.</p>}
            <div className="gq-admin-pagination"><span>{activityTotal} matching events</span><div><button type="button" disabled={activityPage <= 1 || loading} onClick={() => setActivityPage((value) => value - 1)}>Previous</button><button type="button" disabled={activityPage * 50 >= activityTotal || loading} onClick={() => setActivityPage((value) => value + 1)}>Next</button></div></div>
          </section>
        ) : view === 'staff' ? (
          <AdminStaffManagement adminRequest={adminRequest} withOverlay={withOverlay} onError={setError} onNotice={setNotice} />
        ) : view === 'alerts' ? (
          <AdminAlerts adminRequest={adminRequest} withOverlay={withOverlay} onError={setError} onNotice={setNotice} canAcknowledge={user.adminRole !== 'read_only'} />
        ) : (
          <AdminOverview adminRequest={adminRequest} />
        )}
      </section>
      {detailUserId && <AdminUserDetails userId={detailUserId} adminRequest={adminRequest} withOverlay={withOverlay} onClose={() => setDetailUserId('')} onError={setError} onNotice={setNotice} canRevokeSessions={canSuspendUsers} />}
      {reauthOpen && <ReauthenticationDialog onSubmit={submitReauthentication} error={reauthError} />}
      {actionLabel && <ActionOverlay label={actionLabel} />}
    </main>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <article className="gq-admin-metric"><span>{icon}</span><div><small>{label}</small><strong>{value}</strong></div></article>;
}

function AdminUserCard({ user, onUpdate, onReset, onSelect, selected, canEdit, canSuspend, canBulk, onView, showDetails }: {
  user: AdminUser;
  onUpdate: (values: Record<string, unknown>, message: string) => Promise<void>;
  onReset: () => Promise<void>;
  onSelect: (selected: boolean) => void;
  selected: boolean;
  canEdit: boolean;
  canSuspend: boolean;
  canBulk: boolean;
  onView: () => void;
  showDetails: boolean;
}) {
  const config = user.tradingConfig ?? DEFAULT_TRADING_CONFIG;
  const [fullName, setFullName] = useState(user.fullName);
  const [stake, setStake] = useState(String(config.stake));
  const [targetProfit, setTargetProfit] = useState(String(config.targetProfit));
  const [targetLoss, setTargetLoss] = useState(String(config.targetLoss));
  const [maxTrades, setMaxTrades] = useState(String(config.maxTrades));
  const [maxConsecutiveLosses, setMaxConsecutiveLosses] = useState(String(config.maxConsecutiveLosses));
  const [cooldownMinutes, setCooldownMinutes] = useState(String(config.cooldownMinutes));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setFullName(user.fullName);
    const current = user.tradingConfig ?? DEFAULT_TRADING_CONFIG;
    setStake(String(current.stake));
    setTargetProfit(String(current.targetProfit));
    setTargetLoss(String(current.targetLoss));
    setMaxTrades(String(current.maxTrades));
    setMaxConsecutiveLosses(String(current.maxConsecutiveLosses));
    setCooldownMinutes(String(current.cooldownMinutes));
  }, [user]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const tradingConfig: TradingConfig = {
      ...DEFAULT_TRADING_CONFIG,
      stake: Number(stake),
      targetProfit: Number(targetProfit),
      targetLoss: Number(targetLoss),
      maxTrades: Number(maxTrades),
      maxConsecutiveLosses: Number(maxConsecutiveLosses),
      cooldownMinutes: Number(cooldownMinutes),
    };
    const increasesRisk = tradingConfig.stake > config.stake ||
      tradingConfig.targetProfit > config.targetProfit ||
      tradingConfig.targetLoss > config.targetLoss ||
      tradingConfig.maxTrades > config.maxTrades ||
      tradingConfig.maxConsecutiveLosses > config.maxConsecutiveLosses ||
      tradingConfig.cooldownMinutes < config.cooldownMinutes;
    if (increasesRisk && !window.confirm('These settings increase potential exposure or reduce cooldowns. Continue and record the change in the audit history?')) return;
    setSaving(true);
    const values: Record<string, unknown> = { fullName, tradingConfig };
    try {
      await onUpdate(values, `Updated ${user.email}.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="gq-admin-user">
      <div className="gq-admin-user-summary">
        {canBulk && <input className="gq-admin-select" type="checkbox" checked={selected} aria-label={`Select ${user.email}`} onChange={(event) => onSelect(event.target.checked)} />}
        <span className="gq-admin-user-avatar">{user.fullName.trim().charAt(0).toUpperCase()}</span>
        <div className="gq-admin-user-main"><strong>{user.fullName}</strong><span>{user.email}</span><small>{user.accountId}</small></div>
        <span className={`gq-admin-status ${user.isSuspended ? 'is-suspended' : ''}`}>{user.isSuspended ? 'Suspended' : 'Active'}</span>
        {user.isAdmin && <span className="gq-admin-role">{user.adminRole}</span>}
        {showDetails && <button className="gq-admin-icon-action" type="button" onClick={onView} aria-label={`View ${user.fullName} details`}><Eye size={16} /></button>}
      </div>
      <div className="gq-admin-user-meta">
        <span>Joined <strong>{dateLabel(user.joinedAt)}</strong></span>
        <span>Last sign-in <strong>{dateLabel(user.lastLoginAt)}</strong></span>
        <span>Deriv <strong>{user.hasDerivConnection ? 'Connected' : 'Not connected'}</strong></span>
      </div>
      {canEdit && <details className="gq-admin-edit">
        <summary>Edit account and bot risk settings</summary>
        <form onSubmit={(event) => void save(event)}>
          <div className="gq-admin-edit-fields">
            <AdminField label="Full name" value={fullName} onChange={setFullName} min={2} max={100} type="text" />
            <AdminField label="Base stake" value={stake} onChange={setStake} min={0.01} max={10000} step={0.01} />
            <AdminField label="Target profit" value={targetProfit} onChange={setTargetProfit} min={0.01} max={1000000} step={0.01} />
            <AdminField label="Target loss" value={targetLoss} onChange={setTargetLoss} min={0.01} max={1000000} step={0.01} />
            <AdminField label="Maximum trades" value={maxTrades} onChange={setMaxTrades} min={1} max={500} step={1} />
            <AdminField label="Consecutive-loss limit" value={maxConsecutiveLosses} onChange={setMaxConsecutiveLosses} min={1} max={50} step={1} />
            <AdminField label="Cooldown minutes" value={cooldownMinutes} onChange={setCooldownMinutes} min={0} max={1440} step={1} />
            <label><span>Trade duration</span><input value="5 ticks (fixed)" readOnly /></label>
          </div>
          <div className="gq-admin-edit-actions"><button className="gq-admin-secondary" type="button" onClick={() => void onReset()}><LockKeyhole size={14} />Issue password link</button><button className="gq-admin-primary" type="submit" disabled={saving}><Check size={15} />Save changes</button></div>
        </form>
      </details>}
      {canSuspend && <div className="gq-admin-user-actions">
        <button
          type="button"
          className={user.isSuspended ? 'gq-admin-restore' : 'gq-admin-suspend'}
          onClick={() => void onUpdate({ isSuspended: !user.isSuspended }, user.isSuspended ? `Restored ${user.email}.` : `Suspended ${user.email}. Existing sessions were revoked.`)}
        >
          {user.isSuspended ? 'Restore access' : 'Suspend access'}
        </button>
      </div>}
    </article>
  );
}

function AdminField({
  label, value, onChange, min, max, step, type = 'number',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min: number;
  max: number;
  step?: number;
  type?: string;
}) {
  return <label><span>{label}</span><input type={type} required={type !== 'password'} min={type === 'number' ? min : undefined} max={type === 'number' ? max : undefined} step={type === 'number' ? step : undefined} minLength={type === 'password' ? 10 : type === 'text' ? min : undefined} maxLength={type === 'password' ? 128 : type === 'text' ? max : undefined} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function ActionOverlay({ label }: { label: string }) {
  return (
    <div className="gq-admin-action-overlay" role="alert" aria-live="assertive" aria-busy="true">
      <div><LoaderCircle className="gq-spin" size={34} /><strong>{label}</strong><span>Please wait while the server completes this action.</span></div>
    </div>
  );
}

function ReauthenticationDialog({ onSubmit, error }: {
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  error: string;
}) {
  return (
    <div className="gq-admin-dialog-backdrop">
      <form className="gq-admin-dialog" onSubmit={onSubmit}>
        <ShieldCheck size={28} />
        <p className="gq-admin-eyebrow">SECURITY CONFIRMATION</p>
        <h2>Verify it’s you</h2>
        <p>Enter your account password and current authenticator code to continue this sensitive action.</p>
        <label><span>Password</span><input name="password" type="password" autoComplete="current-password" required /></label>
        <label><span>Authenticator or recovery code</span><input name="code" inputMode="text" pattern="([0-9]{6}|[A-Fa-f0-9-]{10})" maxLength={10} autoComplete="one-time-code" required /></label>
        {error && <div className="gq-admin-notice is-error" role="alert">{error}</div>}
        <button className="gq-admin-primary" type="submit">Verify and continue</button>
      </form>
    </div>
  );
}

function AdminMfaGate({
  stage, withOverlay, onComplete, onError,
}: {
  stage: 'setup' | 'verify';
  withOverlay: <T,>(label: string, action: () => Promise<T>) => Promise<T>;
  onComplete: () => void;
  onError: (message: string) => void;
}) {
  const [password, setPassword] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    onError('');
    await withOverlay(stage === 'setup' ? 'Securing administrator account' : 'Verifying authenticator code', async () => {
      try {
        if (stage === 'setup' && !secret) {
          const result = await readResponse(await fetch('/api/admin/mfa', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'setup', password }),
          }));
          setSecret(result.secret);
          return;
        }
        const action = stage === 'setup' ? 'verify-setup' : 'verify';
        const result = await readResponse(await fetch('/api/admin/mfa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, code }),
        }));
        if (stage === 'setup') {
          setBackupCodes(result.backupCodes as string[]);
          return;
        }
        onComplete();
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : 'Could not verify administrator security.';
        setError(message);
        onError(message);
      }
    });
  }

  return (
    <main className="gq-admin-security-gate">
      <section className="gq-admin-security-card">
        <span className="gq-admin-brand-icon"><ShieldCheck size={23} /></span>
        <p className="gq-admin-eyebrow">G-SQUAD · ADMINISTRATOR SECURITY</p>
        <h1>{stage === 'setup' ? 'Protect your admin account' : 'Confirm your identity'}</h1>
        <p>{stage === 'setup' ? 'Set up a TOTP authenticator app before accessing administration tools. Compatible with standard authenticator apps.' : 'Enter the six-digit code from your authenticator app. This verification lasts up to 12 hours for this session.'}</p>
        {error && <div className="gq-admin-notice is-error" role="alert">{error}</div>}
        {backupCodes.length > 0 ? (
          <div className="gq-admin-backup-codes">
            <strong>Save these recovery codes now</strong>
            <p>Each code works once if you lose access to your authenticator. They will not be shown again.</p>
            <code>{backupCodes.join('  ·  ')}</code>
            <button className="gq-admin-secondary" type="button" onClick={() => void navigator.clipboard.writeText(backupCodes.join('\n'))}><Copy size={15} />Copy recovery codes</button>
            <button className="gq-admin-primary" type="button" onClick={onComplete}>I saved my codes · Continue</button>
          </div>
        ) : <form onSubmit={(event) => void submit(event)}>
          {stage === 'setup' && !secret ? (
            <label><span>Account password</span><input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required /></label>
          ) : (
            <>
              {secret && <div className="gq-admin-mfa-secret"><strong>Authenticator secret</strong><code>{secret}</code><button type="button" onClick={() => void navigator.clipboard.writeText(secret)}>Copy secret</button><small>Enter this key in your authenticator app as a time-based one-time password.</small></div>}
              <label><span>{stage === 'setup' ? 'Six-digit authenticator code' : 'Authenticator or recovery code'}</span><input value={code} onChange={(event) => setCode(event.target.value.replace(stage === 'setup' ? /\D/g : /[^a-fA-F0-9-]/g, '').slice(0, stage === 'setup' ? 6 : 10))} inputMode={stage === 'setup' ? 'numeric' : 'text'} pattern={stage === 'setup' ? '[0-9]{6}' : '([0-9]{6}|[A-Fa-f0-9-]{10})'} autoComplete="one-time-code" required /></label>
            </>
          )}
          <button className="gq-admin-primary" type="submit">{stage === 'setup' && !secret ? 'Generate setup key' : stage === 'setup' ? 'Enable authenticator' : 'Verify and continue'}</button>
        </form>}
        <a href="/">Return to app</a>
      </section>
    </main>
  );
}

type AdminRequester = (request: () => Promise<Response>) => Promise<Record<string, unknown>>;
type OverlayRunner = <T,>(label: string, action: () => Promise<T>) => Promise<T>;

function AdminStaffManagement({
  adminRequest, withOverlay, onError, onNotice,
}: {
  adminRequest: AdminRequester;
  withOverlay: OverlayRunner;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}) {
  const [staff, setStaff] = useState<{ id: string; fullName: string; email: string; role: string; createdAt: string; isOwner: boolean; isCurrent: boolean; mfaEnabled: boolean }[]>([]);
  const [invitations, setInvitations] = useState<{ id: string; email: string; role: string; expiresAt: string }[]>([]);
  const [inviteUrl, setInviteUrl] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await adminRequest(() => fetch('/api/admin/staff', { cache: 'no-store' }));
      setStaff(result.staff as typeof staff);
      setInvitations(result.invitations as typeof invitations);
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : 'Could not load staff access.');
    } finally {
      setLoading(false);
    }
  }, [adminRequest, onError]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    await withOverlay('Creating staff invitation', async () => {
      try {
        const result = await adminRequest(() => fetch('/api/admin/staff', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: values.get('email'), role: values.get('role') }),
        }));
        setInviteUrl(String(result.invitationUrl));
        onNotice('Invitation link created. It can be used once and expires in seven days.');
        form.reset();
        await refresh();
      } catch (reason) {
        onError(reason instanceof Error ? reason.message : 'Could not create invitation.');
      }
    });
  }

  async function changeRole(userId: string, role: string) {
    await withOverlay('Updating staff permissions', async () => {
      try {
        await adminRequest(() => fetch(`/api/admin/staff/${encodeURIComponent(userId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role }),
        }));
        onNotice('Staff role updated. Their admin verification has been cleared.');
        await refresh();
      } catch (reason) {
        onError(reason instanceof Error ? reason.message : 'Could not update staff role.');
      }
    });
  }

  async function revoke(userId: string, email: string) {
    if (!window.confirm(`Revoke admin staff access for ${email}?`)) return;
    await withOverlay('Revoking staff access', async () => {
      try {
        await adminRequest(() => fetch(`/api/admin/staff/${encodeURIComponent(userId)}`, { method: 'DELETE' }));
        onNotice(`Admin staff access revoked for ${email}.`);
        await refresh();
      } catch (reason) {
        onError(reason instanceof Error ? reason.message : 'Could not revoke staff access.');
      }
    });
  }

  async function resetMfa(userId: string, email: string) {
    if (!window.confirm(`Reset authenticator access for ${email}? They will need to set it up again.`)) return;
    await withOverlay('Resetting staff authenticator', async () => {
      try {
        await adminRequest(() => fetch(`/api/admin/staff/${encodeURIComponent(userId)}/mfa-reset`, { method: 'POST' }));
        onNotice(`Authenticator reset for ${email}.`);
        await refresh();
      } catch (reason) {
        onError(reason instanceof Error ? reason.message : 'Could not reset MFA.');
      }
    });
  }

  async function revokeInvitation(invitationId: string, email: string) {
    if (!window.confirm(`Revoke the pending invitation for ${email}?`)) return;
    await withOverlay('Revoking invitation', async () => {
      try {
        await adminRequest(() => fetch(`/api/admin/staff/invitations/${encodeURIComponent(invitationId)}`, { method: 'DELETE' }));
        onNotice(`Pending invitation for ${email} revoked.`);
        await refresh();
      } catch (reason) {
        onError(reason instanceof Error ? reason.message : 'Could not revoke invitation.');
      }
    });
  }

  return (
    <>
      <section className="gq-admin-card">
        <div className="gq-admin-card-heading"><div><h2><UserPlus size={17} />Invite staff</h2><p>Invite a registered app user by email. They must sign in with the matching account and accept the single-use link.</p></div></div>
        <form className="gq-admin-create-form gq-admin-staff-form" onSubmit={(event) => void invite(event)}>
          <label><span>Account email</span><input name="email" type="email" required maxLength={254} /></label>
          <label><span>Role</span><select name="role" defaultValue="read_only"><option value="support">Support</option><option value="account_manager">Account manager</option><option value="read_only">Read-only</option></select></label>
          <button className="gq-admin-primary" type="submit"><UserPlus size={15} />Create invitation</button>
        </form>
        {inviteUrl && <div className="gq-admin-reset-link"><label htmlFor="gq-admin-invite-url">One-time staff invitation link</label><div><input id="gq-admin-invite-url" value={inviteUrl} readOnly /><button type="button" onClick={() => void navigator.clipboard.writeText(inviteUrl).then(() => onNotice('Invitation link copied.'))}><Copy size={15} />Copy link</button><button type="button" aria-label="Close invitation link" onClick={() => setInviteUrl('')}><X size={15} /></button></div></div>}
      </section>
      <section className="gq-admin-card">
        <div className="gq-admin-card-heading"><div><h2>Active staff</h2><p>Owners are managed only through the server-side ADMIN_EMAILS bootstrap allowlist.</p></div></div>
        {loading ? <div className="gq-admin-inline-loading"><LoaderCircle className="gq-spin" size={18} />Loading staff…</div> : staff.length ? staff.map((member) => (
          <StaffRow key={member.id} member={member} onChange={changeRole} onRevoke={revoke} onResetMfa={resetMfa} />
        )) : <p className="gq-admin-empty">No staff invitations have been accepted yet.</p>}
      </section>
      {invitations.length > 0 && <section className="gq-admin-card"><div className="gq-admin-card-heading"><div><h2>Pending invitations</h2></div></div><div className="gq-admin-user-list">{invitations.map((item) => <article className="gq-admin-user gq-admin-invitation-row" key={item.id}><div><strong>{item.email}</strong><span className="gq-admin-status">{item.role.replace('_', ' ')}</span><p>Expires {dateLabel(item.expiresAt)}</p></div><button className="gq-admin-suspend" type="button" onClick={() => void revokeInvitation(item.id, item.email)}>Revoke invitation</button></article>)}</div></section>}
    </>
  );
}

function StaffRow({
  member, onChange, onRevoke, onResetMfa,
}: {
  member: { id: string; fullName: string; email: string; role: string; createdAt: string; isOwner: boolean; isCurrent: boolean; mfaEnabled: boolean };
  onChange: (userId: string, role: string) => Promise<void>;
  onRevoke: (userId: string, email: string) => Promise<void>;
  onResetMfa: (userId: string, email: string) => Promise<void>;
}) {
  const [role, setRole] = useState(member.role);
  return (
    <article className="gq-admin-staff-row">
      <div><strong>{member.fullName}{member.isCurrent ? ' · You' : ''}</strong><span>{member.email}</span><small>{member.isOwner ? 'Owner · ADMIN_EMAILS' : `Added ${dateLabel(member.createdAt)}`} · MFA {member.mfaEnabled ? 'enabled' : 'not enrolled'}</small></div>
      {member.isOwner ? <span className="gq-admin-role">Owner</span> : <>
        <select aria-label={`Role for ${member.email}`} value={role} onChange={(event) => setRole(event.target.value)}><option value="support">Support</option><option value="account_manager">Account manager</option><option value="read_only">Read-only</option></select>
        <button className="gq-admin-secondary" type="button" disabled={role === member.role} onClick={() => void onChange(member.id, role)}>Save role</button>
      </>}
      {!member.isCurrent && <button className="gq-admin-secondary" type="button" onClick={() => void onResetMfa(member.id, member.email)}>Reset MFA</button>}
      {!member.isOwner && <button className="gq-admin-suspend" type="button" onClick={() => void onRevoke(member.id, member.email)}>Revoke access</button>}
    </article>
  );
}

function AdminOverview({ adminRequest }: { adminRequest: AdminRequester }) {
  const [metrics, setMetrics] = useState<Record<string, number>>({});
  const [months, setMonths] = useState<{ month: string; count: number }[]>([]);
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void Promise.all([
      adminRequest(() => fetch('/api/admin/analytics', { cache: 'no-store' })),
      adminRequest(() => fetch('/api/admin/health', { cache: 'no-store' })),
    ]).then(([analytics, status]) => {
      if (!active) return;
      setMetrics(analytics.metrics as Record<string, number>);
      setMonths(analytics.registrationsByMonth as typeof months);
      setHealth(status);
    }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'Could not load overview.'); });
    return () => { active = false; };
  }, [adminRequest]);
  return (
    <>
      <section className="gq-admin-metrics">
        <Metric icon={<Users size={18} />} label="Total accounts" value={String(metrics.totalUsers ?? '—')} />
        <Metric icon={<Activity size={18} />} label="Active in last 30 days" value={String(metrics.activeUsers30d ?? '—')} />
        <Metric icon={<ShieldCheck size={18} />} label="Suspended accounts" value={String(metrics.suspendedUsers ?? '—')} />
        <Metric icon={<UserPlus size={18} />} label="New accounts · 30 days" value={String(metrics.newUsers30d ?? '—')} />
        <Metric icon={<Check size={18} />} label="Successful sign-ins · 30 days" value={String(metrics.successfulLogins30d ?? '—')} />
        <Metric icon={<Activity size={18} />} label="Failed sign-ins · 24 hours" value={String(metrics.failedLogins24h ?? '—')} />
      </section>
      {error && <div className="gq-admin-notice is-error" role="alert">{error}</div>}
      <section className="gq-admin-card">
        <div className="gq-admin-card-heading"><div><h2>Service health</h2><p>Live checks show service state only, never connection credentials.</p></div><span className={`gq-admin-status ${health?.status === 'operational' ? '' : 'is-suspended'}`}>{String(health?.status ?? 'Checking')}</span></div>
        {health && <div className="gq-admin-health-grid">{Object.entries((health.services ?? {}) as Record<string, string>).map(([name, status]) => <div key={name}><strong>{name}</strong><span>{status}</span></div>)}</div>}
      </section>
      <section className="gq-admin-card">
        <div className="gq-admin-card-heading"><div><h2>Account registrations</h2><p>Monthly totals; account activity is not a measure of trading performance.</p></div></div>
        <div className="gq-admin-month-list">{months.map((month) => <div key={month.month}><span>{month.month}</span><strong>{month.count}</strong></div>)}</div>
      </section>
    </>
  );
}

function AdminAlerts({
  adminRequest, withOverlay, onError, onNotice, canAcknowledge,
}: {
  adminRequest: AdminRequester;
  withOverlay: OverlayRunner;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  canAcknowledge: boolean;
}) {
  const [alerts, setAlerts] = useState<{ id: string; alertType: string; severity: string; message: string; createdAt: string; acknowledgedAt: string | null }[]>([]);
  const refresh = useCallback(async () => {
    try {
      const result = await adminRequest(() => fetch('/api/admin/alerts', { cache: 'no-store' }));
      setAlerts(result.alerts as typeof alerts);
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : 'Could not load alerts.');
    }
  }, [adminRequest, onError]);
  useEffect(() => { void refresh(); }, [refresh]);
  async function acknowledge(alertId: string) {
    await withOverlay('Acknowledging alert', async () => {
      try {
        await adminRequest(() => fetch('/api/admin/alerts', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ alertId }),
        }));
        onNotice('Alert acknowledged.');
        await refresh();
      } catch (reason) { onError(reason instanceof Error ? reason.message : 'Could not acknowledge alert.'); }
    });
  }
  return (
    <section className="gq-admin-card">
      <div className="gq-admin-card-heading"><div><h2><Bell size={17} />Operational alerts</h2><p>Alerts flag repeated failed sign-in attempts and relevant account events.</p></div><button className="gq-admin-secondary" type="button" onClick={() => void refresh()}>Refresh</button></div>
      {alerts.length ? <div className="gq-admin-alert-list">{alerts.map((alert) => <article className={`gq-admin-alert is-${alert.severity}`} key={alert.id}><div><strong>{alert.message}</strong><small>{alert.alertType.replace(/_/g, ' ')} · {dateLabel(alert.createdAt)}</small></div>{alert.acknowledgedAt ? <span className="gq-admin-status">Acknowledged</span> : canAcknowledge && <button className="gq-admin-secondary" type="button" onClick={() => void acknowledge(alert.id)}>Acknowledge</button>}</article>)}</div> : <p className="gq-admin-empty">No operational alerts.</p>}
    </section>
  );
}

function AdminUserDetails({
  userId, adminRequest, withOverlay, onClose, onError, onNotice, canRevokeSessions,
}: {
  userId: string;
  adminRequest: AdminRequester;
  withOverlay: OverlayRunner;
  onClose: () => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  canRevokeSessions: boolean;
}) {
  const [details, setDetails] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setDetails(await adminRequest(() => fetch(`/api/admin/users/${encodeURIComponent(userId)}`, { cache: 'no-store' })));
    } catch (reason) { onError(reason instanceof Error ? reason.message : 'Could not load account details.'); }
    finally { setLoading(false); }
  }, [adminRequest, onError, userId]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function revokeSessions() {
    if (!window.confirm('End this user’s other active application sessions?')) return;
    await withOverlay('Revoking active sessions', async () => {
      try {
        const result = await adminRequest(() => fetch(`/api/admin/users/${encodeURIComponent(userId)}/sessions`, { method: 'DELETE' }));
        onNotice(`${Number(result.revoked)} other session(s) ended.`);
        await refresh();
      } catch (reason) { onError(reason instanceof Error ? reason.message : 'Could not revoke sessions.'); }
    });
  }

  const user = details?.user as Record<string, unknown> | undefined;
  const configHistory = (details?.configHistory ?? []) as Record<string, unknown>[];
  const sessions = (details?.sessions ?? []) as Record<string, unknown>[];
  const activities = (details?.activities ?? []) as Record<string, unknown>[];
  return (
    <div className="gq-admin-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="gq-admin-detail-panel" role="dialog" aria-modal="true" aria-label="User account details">
        <header><div><p className="gq-admin-eyebrow">ACCOUNT PROFILE</p><h2>{String(user?.fullName ?? 'User details')}</h2></div><button type="button" aria-label="Close details" onClick={onClose}><X size={19} /></button></header>
        {loading ? <div className="gq-admin-inline-loading"><LoaderCircle className="gq-spin" size={18} />Loading account details…</div> : user ? (
          <>
            <div className="gq-admin-detail-identity"><strong>{String(user.email)}</strong><span>{String(user.accountId)} · {user.isSuspended ? 'Suspended' : 'Active'}</span><small>Deriv {user.hasDerivConnection ? 'connected' : 'not connected'} · Never displays credentials or trade history</small></div>
            {canRevokeSessions && <div className="gq-admin-detail-actions"><button className="gq-admin-secondary" type="button" onClick={() => void revokeSessions()}>Revoke other sessions</button></div>}
            <h3>Configuration change history</h3>
            {configHistory.length ? configHistory.map((change, index) => <article className="gq-admin-history-item" key={index}><strong>{dateLabel(String(change.createdAt))}</strong><small>Changed by {String(change.actorName)}</small><pre>{JSON.stringify({ from: change.previousConfig, to: change.newConfig }, null, 2)}</pre></article>) : <p className="gq-admin-empty">No configuration changes recorded.</p>}
            <h3>Recent sessions</h3>
            {sessions.map((session) => <div className="gq-admin-session-row" key={String(session.id)}><span>{session.isCurrent ? 'Current session' : 'Active session'} · last seen {dateLabel(String(session.lastSeenAt))}</span><small>Expires {dateLabel(String(session.expiresAt))}</small></div>)}
            <h3>Recent account activity</h3>
            {activities.map((item) => <div className="gq-admin-session-row" key={String(item.id)}><span>{activityLabel(String(item.eventType))} · {String(item.actorName)}</span><small>{dateLabel(String(item.createdAt))}</small></div>)}
          </>
        ) : <p className="gq-admin-empty">No account details are available.</p>}
      </section>
    </div>
  );
}

function activityLabel(eventType: string): string {
  const labels: Record<string, string> = {
    'user.registered': 'Account registered',
    'user.login': 'Successful sign-in',
    'user.password_reset': 'Password reset completed',
    'auth.login_failed': 'Failed sign-in attempt',
    'admin.user_created': 'User created by admin',
    'admin.user_updated': 'User account updated by admin',
    'admin.password_reset_link_created': 'Password recovery link created',
    'admin.staff_invited': 'Staff invitation created',
    'admin.staff_invitation_accepted': 'Staff invitation accepted',
    'admin.staff_invitation_revoked': 'Staff invitation revoked',
    'admin.staff_role_changed': 'Staff role changed',
    'admin.staff_access_revoked': 'Staff access revoked',
    'admin.staff_mfa_reset': 'Staff authenticator reset',
    'admin.user_sessions_revoked': 'Application sessions revoked',
    'admin.mfa_enabled': 'Administrator MFA enabled',
    'admin.mfa_verified': 'Administrator MFA verified',
    'admin.reauthenticated': 'Administrator reauthenticated',
    'admin.alert_acknowledged': 'Alert acknowledged',
  };
  return labels[eventType] ?? eventType.replace(/\./g, ' ');
}
