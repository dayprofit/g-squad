'use client';

import { useState, type FormEvent } from 'react';
import { LoaderCircle, ShieldCheck } from 'lucide-react';
import { useAppSession } from '@/components/app/app-session';

export function AcceptAdminInvite({ token }: { token: string }) {
  const { user, loading } = useAppSession();
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage('');
    try {
      const response = await fetch('/api/admin/staff/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Could not accept this invitation.');
      window.location.assign('/admin');
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Could not accept this invitation.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="gq-admin-security-gate">
      <section className="gq-admin-security-card">
        <span className="gq-admin-brand-icon"><ShieldCheck size={23} /></span>
        <p className="gq-admin-eyebrow">G-SQUAD · STAFF INVITATION</p>
        <h1>Accept admin staff access</h1>
        {loading ? <LoaderCircle className="gq-spin" size={22} /> : user ? (
          <>
            <p>You are signed in as <strong>{user.email}</strong>. Accept this invitation only if that is the email address it was sent to.</p>
            {message && <div className="gq-admin-notice is-error" role="alert">{message}</div>}
            <form onSubmit={(event) => void accept(event)}><button className="gq-admin-primary" type="submit" disabled={submitting}>{submitting ? 'Accepting…' : 'Accept staff invitation'}</button></form>
          </>
        ) : (
          <p>Sign in to the G-squad account that matches the invited email address, then reopen this invitation link. <a href="/">Go to sign in</a></p>
        )}
      </section>
    </main>
  );
}
