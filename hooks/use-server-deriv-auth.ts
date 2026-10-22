'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuthState, DerivAccount } from '@deriv/core';

interface DerivSessionResponse {
  accounts: DerivAccount[];
  activeAccountId: string | null;
  wsUrl: string | null;
}

export interface ServerDerivAuth {
  authState: AuthState;
  accounts: DerivAccount[];
  activeAccount: DerivAccount | null;
  activeAccountId: string | null;
  wsUrl: string | undefined;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  switchAccount: (accountId: string) => Promise<void>;
  updateAccountBalance: (accountId: string, balance: string, currency?: string) => void;
  error: string | null;
}

async function requestSession(): Promise<DerivSessionResponse> {
  const response = await fetch('/api/deriv/session', { cache: 'no-store' });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Deriv session is unavailable.');
  return result as DerivSessionResponse;
}

export function useServerDerivAuth(): ServerDerivAuth {
  const [authState, setAuthState] = useState<AuthState>('unauthenticated');
  const [accounts, setAccounts] = useState<DerivAccount[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [wsUrl, setWsUrl] = useState<string>();
  const [error, setError] = useState<string | null>(null);
  const initRef = useRef(false);

  const applySession = useCallback((session: DerivSessionResponse) => {
    setAccounts(session.accounts);
    setActiveAccountId(session.activeAccountId);
    setWsUrl(session.wsUrl ?? undefined);
    setAuthState(session.wsUrl ? 'authenticated' : 'unauthenticated');
  }, []);

  const refresh = useCallback(async () => {
    try {
      applySession(await requestSession());
      setError(null);
    } catch (reason) {
      setAccounts([]);
      setActiveAccountId(null);
      setWsUrl(undefined);
      setAuthState('unauthenticated');
      setError(reason instanceof Error ? reason.message : 'Deriv session is unavailable.');
    }
  }, [applySession]);

  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;
    const url = new URL(window.location.href);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const oauthError = url.searchParams.get('error');

    if (oauthError) {
      setAuthState('error');
      setError('Deriv authorization was cancelled or denied.');
      for (const key of ['error', 'error_description', 'state', 'scope']) url.searchParams.delete(key);
      window.history.replaceState(window.history.state, '', url.pathname + url.search);
      return;
    }

    if (code && state) {
      setAuthState('authenticating');
      void fetch('/api/deriv/oauth/callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, state }),
      }).then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? 'Deriv authorization failed.');
        applySession(result as DerivSessionResponse);
        setError(null);
      }).catch((reason) => {
        setAuthState('error');
        setError(reason instanceof Error ? reason.message : 'Deriv authorization failed.');
      }).finally(() => {
        url.searchParams.delete('code');
        url.searchParams.delete('state');
        url.searchParams.delete('scope');
        window.history.replaceState(window.history.state, '', url.pathname + url.search);
      });
      return;
    }
    void refresh();
  }, [applySession, refresh]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && authState === 'authenticated') void refresh();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [authState, refresh]);

  const login = useCallback(async () => {
    const response = await fetch('/api/deriv/oauth/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ landingSearch: window.location.search }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'Could not start Deriv authorization.');
    window.location.assign(result.authorizationUrl);
  }, []);

  const logout = useCallback(async () => {
    const response = await fetch('/api/deriv/session', { method: 'DELETE' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'Could not disconnect Deriv.');
    setAccounts([]);
    setActiveAccountId(null);
    setWsUrl(undefined);
    setAuthState('unauthenticated');
    setError(null);
  }, []);

  const switchAccount = useCallback(async (accountId: string) => {
    const response = await fetch('/api/deriv/account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'Could not switch Deriv accounts.');
    applySession(result as DerivSessionResponse);
  }, [applySession]);

  const updateAccountBalance = useCallback((accountId: string, balance: string, currency?: string) => {
    setAccounts((current) => current.map((account) => account.account_id === accountId
      ? { ...account, balance, currency: currency ?? account.currency }
      : account));
  }, []);

  return {
    authState,
    accounts,
    activeAccount: accounts.find((account) => account.account_id === activeAccountId) ?? null,
    activeAccountId,
    wsUrl,
    login,
    logout,
    switchAccount,
    updateAccountBalance,
    error,
  };
}