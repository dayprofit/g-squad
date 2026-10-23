'use client';

import { useEffect, useState } from 'react';
import { Download, Share, X } from 'lucide-react';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function InstallAppButton({ compact = false }: { compact?: boolean }) {
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setInstalled(standalone);
    setIsIos(/iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
      setHelpOpen(false);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  async function install() {
    if (!installPrompt) {
      setHelpOpen(true);
      return;
    }
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === 'accepted') setInstalled(true);
      setInstallPrompt(null);
    } catch {
      setInstallPrompt(null);
      setHelpOpen(true);
    }
  }

  if (installed) return null;

  return <>
    <button
      className={`gq-install-button ${compact ? 'is-compact' : ''}`}
      type="button"
      aria-label="Install G-squad app"
      title="Install app"
      onClick={() => void install()}
    >
      <Download size={16} />
      {!compact && <span>Install app</span>}
    </button>
    {helpOpen && <div className="gq-install-dialog-backdrop" role="presentation" onClick={() => setHelpOpen(false)}>
      <section className="gq-install-dialog" role="dialog" aria-modal="true" aria-labelledby="gq-install-title" onClick={(event) => event.stopPropagation()}>
        <button className="gq-install-close" type="button" aria-label="Close install instructions" onClick={() => setHelpOpen(false)}><X size={18} /></button>
        <div className="gq-install-dialog-icon"><Download size={20} /></div>
        <h2 id="gq-install-title">Install G-squad</h2>
        {isIos ? <p>In Safari, tap <Share size={15} className="gq-install-inline-icon" /> <strong>Share</strong>, scroll down, then choose <strong>Add to Home Screen</strong> and tap <strong>Add</strong>.</p>
          : <p>Open your browser menu and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>. In Chrome, you may also see an install icon in the address bar.</p>}
        <p className="gq-install-note">After installation, open G-squad from your device’s home screen for the full-screen app experience. An internet connection is required.</p>
        <button className="gq-primary-button" type="button" onClick={() => setHelpOpen(false)}>Got it</button>
      </section>
    </div>}
  </>;
}
