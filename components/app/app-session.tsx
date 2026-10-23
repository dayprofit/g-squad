'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

export interface AppUser {
  id: string;
  accountId: string;
  fullName: string;
  email: string;
  joinedAt: string;
  isAdmin: boolean;
  adminRole: string | null;
}

interface AppSessionValue {
  user: AppUser | null;
  registrationComplete: boolean;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (fullName: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  clearRegistrationComplete: () => void;
}

const AppSessionContext = createContext<AppSessionValue | null>(null);

export function AppSessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [registrationComplete, setRegistrationComplete] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/auth/me', { cache: 'no-store' });
      const result = await response.json();
      setUser(response.ok ? result.user ?? null : null);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'Could not log in.');
    setUser(result.user);
  }, []);

  const register = useCallback(async (fullName: string, email: string, password: string) => {
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fullName, email, password }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'Could not create account.');
    setUser(result.user);
    setRegistrationComplete(true);
  }, []);

  const logout = useCallback(async () => {
    const response = await fetch('/api/auth/logout', { method: 'POST' });
    if (!response.ok) throw new Error('Could not log out. Please try again.');
    setUser(null);
  }, []);

  return (
    <AppSessionContext.Provider value={{ user, registrationComplete, loading, login, register, logout, refresh, clearRegistrationComplete: () => setRegistrationComplete(false) }}>
      {children}
    </AppSessionContext.Provider>
  );
}

export function useAppSession(): AppSessionValue {
  const context = useContext(AppSessionContext);
  if (!context) throw new Error('useAppSession must be used inside AppSessionProvider.');
  return context;
}