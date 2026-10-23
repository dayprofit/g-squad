'use client';

import { useState, type FormEvent } from 'react';
import { LockKeyhole } from 'lucide-react';

export function PasswordReset({ token }: { token: string }) {
  const [message, setMessage] = useState('');
  const [complete, setComplete] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    const values = new FormData(event.currentTarget);
    const password = String(values.get('password') ?? '');
    const confirm = String(values.get('confirm') ?? '');
    if (password !== confirm) {
      setMessage('The passwords do not match.');
      return;
    }
    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Could not reset this password.');
      setComplete(true);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Could not reset this password.');
    }
  }

  return (
    <main className="gq-admin-security-gate">
      <section className="gq-admin-security-card">
        <span className="gq-admin-brand-icon"><LockKeyhole size={22} /></span>
        <p className="gq-admin-eyebrow">G-SQUAD · ACCOUNT RECOVERY</p>
        <h1>{complete ? 'Password updated' : 'Choose a new password'}</h1>
        {complete ? <p>Your password was updated and previous sessions were ended. You can now sign in.</p> : (
          <form onSubmit={(event) => void submit(event)}>
            <label><span>New password</span><input name="password" type="password" minLength={10} maxLength={128} autoComplete="new-password" required /></label>
            <label><span>Confirm password</span><input name="confirm" type="password" minLength={10} maxLength={128} autoComplete="new-password" required /></label>
            {message && <div className="gq-admin-notice is-error" role="alert">{message}</div>}
            <button className="gq-admin-primary" type="submit" disabled={!token}>Set password</button>
          </form>
        )}
        {!token && <div className="gq-admin-notice is-error">This reset link is missing or invalid.</div>}
        {complete && <a className="gq-admin-primary" href="/">Go to sign in</a>}
      </section>
    </main>
  );
}
