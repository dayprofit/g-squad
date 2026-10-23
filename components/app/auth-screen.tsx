'use client';

import { useState, type FormEvent } from 'react';
import { Eye, EyeOff, LoaderCircle, ShieldCheck } from 'lucide-react';
import { useAppSession } from './app-session';

const APP_NAME = process.env.NEXT_PUBLIC_DERIV_APP_NAME?.trim() || 'G-squad';

export function AuthScreen() {
  const { login, register } = useAppSession();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (mode === 'register' && password !== confirmation) {
      setError('Passwords do not match.');
      return;
    }
    setPending(true);
    try {
      if (mode === 'register') await register(fullName, email, password);
      else await login(email, password);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Authentication failed.');
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="gq-auth-screen">
      <section className="gq-auth-panel">
        <div className="gq-brand-lockup"><img className="gq-brand-logo" src="/logo.png" alt={`${APP_NAME} logo`} /><span>{APP_NAME}</span></div>
        <p className="gq-eyebrow">PRIVATE TRADING WORKSPACE</p>
        <h1>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h1>
        <p className="gq-auth-copy">{mode === 'login' ? 'Sign in to manage your trading workspace.' : 'Your application account is separate from your Deriv account.'}</p>
        <form className="gq-form" onSubmit={submit}>
          {mode === 'register' && <label className="gq-field"><span>Full name</span><input autoComplete="name" required minLength={2} maxLength={100} value={fullName} onChange={(event) => setFullName(event.target.value)} /></label>}
          <label className="gq-field"><span>Email address</span><input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label className="gq-field"><span>Password</span><span className="gq-password-wrap"><input type={showPassword ? 'text' : 'password'} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required minLength={mode === 'register' ? 10 : 1} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} /><button className="gq-icon-button gq-password-toggle" type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></span></label>
          {mode === 'register' && <label className="gq-field"><span>Confirm password</span><input type={showPassword ? 'text' : 'password'} autoComplete="new-password" required minLength={10} maxLength={128} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>}
          {error && <p className="gq-inline-error" role="alert">{error}</p>}
          <button className="gq-primary-button gq-auth-submit" type="submit" disabled={pending}>{pending ? <LoaderCircle className="gq-spin" size={18} /> : null}{pending ? 'Please wait' : mode === 'login' ? 'Log in' : 'Create account'}</button>
        </form>
        <p className="gq-auth-switch">{mode === 'login' ? 'New to G-squad?' : 'Already have an account?'} <button type="button" onClick={() => { setError(''); setMode(mode === 'login' ? 'register' : 'login'); }}>{mode === 'login' ? 'Create account' : 'Log in'}</button></p>
        <div className="gq-security-note"><ShieldCheck size={16} /> Secured application account</div>
      </section>
    </main>
  );
}