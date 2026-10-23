'use client';

import { useEffect, useState } from 'react';
import { House, LoaderCircle, LogOut, MessageCircle, SlidersHorizontal, UserRound } from 'lucide-react';
import { DerivWSProvider } from '@/components/custom/deriv-ws-provider';
import { useAppSession } from './app-session';
import { AuthScreen } from './auth-screen';
import { ConfigureScreen } from './configure-screen';
import { HomeDashboard } from './home-dashboard';
import { ProfileScreen } from './profile-screen';

type AppTab = 'home' | 'configure' | 'chat' | 'profile';
const NAV_ITEMS: { id: AppTab; label: string; href: string; icon: typeof House }[] = [
  { id: 'home', label: 'Home', href: '/', icon: House },
  { id: 'configure', label: 'Configure', href: '/?tab=configure', icon: SlidersHorizontal },
  { id: 'chat', label: 'Chat', href: '/?tab=chat', icon: MessageCircle },
  { id: 'profile', label: 'Profile', href: '/?tab=profile', icon: UserRound },
];
const APP_NAME = process.env.NEXT_PUBLIC_DERIV_APP_NAME?.trim() || 'G-squad';

function initialTab(): AppTab {
  if (typeof window === 'undefined') return 'home';
  const tab = new URLSearchParams(window.location.search).get('tab');
  return tab === 'configure' || tab === 'chat' || tab === 'profile' ? tab : 'home';
}

export function AppShell() {
  const { user, loading, logout, registrationComplete, clearRegistrationComplete } = useAppSession();
  const [tab, setTab] = useState<AppTab>(initialTab);
  const [notice, setNotice] = useState('');
  const [splashElapsed, setSplashElapsed] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setSplashElapsed(true), 7000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!user || !registrationComplete) return;
    setNotice('Application account created successfully. Connect your Deriv account to continue.');
    clearRegistrationComplete();
  }, [user, registrationComplete, clearRegistrationComplete]);

  function navigate(next: AppTab) {
    setTab(next);
    const item = NAV_ITEMS.find((candidate) => candidate.id === next)!;
    window.history.pushState({}, '', item.href);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function logoutApplication() {
    try { await logout(); setNotice('Logged out of G-squad.'); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Could not log out.'); }
  }

  if (loading || !splashElapsed) return (
    <main className="gq-loading-screen" role="status" aria-live="polite">
      <div className="gq-splash-brand"><img src="/logo.png" alt={`${APP_NAME} logo`} /><span>{APP_NAME}</span></div>
      <span className="gq-loading-ring"><LoaderCircle className="gq-spin" size={24} /></span>
      <span className="gq-splash-caption">Loading your workspace</span>
    </main>
  );
  if (!user) return <AuthScreen />;

  const initials = user.fullName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('');
  return (
    <div className="gq-app-viewport">
      <header className="gq-header">
        <div className="gq-brand-lockup"><img className="gq-brand-logo" src="/logo.png" alt="" /><span>{APP_NAME}</span></div>
        <div className="gq-header-actions"><button className="gq-avatar" type="button" aria-label="Open profile" onClick={() => navigate('profile')}>{initials}</button><button className="gq-icon-button" type="button" aria-label="Log out of G-squad" title="Log out of G-squad" onClick={() => void logoutApplication()}><LogOut size={18} /></button></div>
      </header>
      <DerivWSProvider>
        <main className="gq-main">
          {tab === 'home' && <HomeDashboard />}
          {tab === 'configure' && <ConfigureScreen onNotice={setNotice} />}
          {tab === 'chat' && <ChatScreen />}
          {tab === 'profile' && <ProfileScreen onNotice={setNotice} />}
        </main>
      </DerivWSProvider>
      {notice && <div className="gq-toast" role="status">{notice}<button aria-label="Dismiss notification" onClick={() => setNotice('')}>×</button></div>}
      <nav className="gq-bottom-nav" aria-label="Primary navigation">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => <button key={id} className={`gq-nav-item ${tab === id ? 'is-active' : ''}`} type="button" aria-current={tab === id ? 'page' : undefined} onClick={() => navigate(id)}><Icon size={20} strokeWidth={tab === id ? 2.3 : 1.8} /><span>{label}</span></button>)}
      </nav>
    </div>
  );
}

function ChatScreen() {
  return <div className="gq-page-content gq-chat-page"><div className="gq-page-heading"><div><p className="gq-eyebrow">COMMUNITY</p><h1>Chat</h1></div></div><section className="gq-chat-empty"><div className="gq-chat-symbol"><MessageCircle size={27} /></div><span className="gq-eyebrow">IN DEVELOPMENT</span><h2>Coming Soon</h2><p>Chat is being developed. It will appear here when ready.</p></section></div>;
}