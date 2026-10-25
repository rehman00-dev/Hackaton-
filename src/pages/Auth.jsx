import React, { useLayoutEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ArrowRight, Eye, EyeOff, Moon, ShieldCheck, Sun } from 'lucide-react';
import SceneSlot from '../components/SceneSlot.jsx';
import { Notice } from '../components/ui.jsx';
import { usePrefersReducedMotion } from '../lib/hooks';

function AuthLayout({ eyebrow, title, text, highlights, formEyebrow, formTitle, formText, theme, toggleTheme, children }) {
  const root = useRef(null);
  const reduced = usePrefersReducedMotion();
  useLayoutEffect(() => {
    if (reduced) return undefined;
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
      tl.from('.auth-aside [data-in]', { opacity: 0, y: 26, duration: 0.7, stagger: 0.09 })
        .from('.auth-card', { opacity: 0, y: 30, scale: 0.97, duration: 0.7, clearProps: 'all' }, 0.15)
        .from('.auth-card [data-in]', { opacity: 0, y: 12, duration: 0.45, stagger: 0.05, clearProps: 'all' }, 0.4);
    }, root);
    return () => ctx.revert();
  }, [reduced]);
  return (
    <main className="auth-layout" ref={root}>
      <section className="auth-aside">
        <SceneSlot className="auth-scene" />
        <div className="auth-aside-copy">
          <div className="auth-brand" data-in><img className="brand-logo" src="/hcm-logo.svg" alt="" /><strong>HCM Lite</strong></div>
          <p className="eyebrow" data-in>{eyebrow}</p>
          <h1 data-in>{title}</h1>
          <p className="auth-lede" data-in>{text}</p>
          {highlights && <ul className="auth-highlights" data-in>{highlights.map((item) => <li key={item}><ShieldCheck size={15} aria-hidden="true" />{item}</li>)}</ul>}
        </div>
      </section>
      <section className="auth-form-wrap">
        <button type="button" className="icon-button auth-theme" onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>{theme === 'dark' ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}</button>
        <div className="auth-card">
          <p className="eyebrow" data-in>{formEyebrow}</p>
          <h2 data-in>{formTitle}</h2>
          {formText && <p className="muted" data-in>{formText}</p>}
          {children}
        </div>
      </section>
    </main>
  );
}

function PasswordField({ label, value, onChange, autoComplete, minLength }) {
  const [shown, setShown] = useState(false);
  return (
    <label data-in>{label}
      <span className="input-affix">
        <input type={shown ? 'text' : 'password'} autoComplete={autoComplete} minLength={minLength} required value={value} onChange={onChange} />
        <button type="button" className="affix-button" onClick={() => setShown((v) => !v)} aria-label={shown ? 'Hide password' : 'Show password'}>{shown ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}</button>
      </span>
    </label>
  );
}

export function LoginScreen({ onLogin, notice, theme, toggleTheme }) {
  const [form, setForm] = useState({ email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try { await onLogin(form); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return (
    <AuthLayout theme={theme} toggleTheme={toggleTheme}
      eyebrow="HUMAN CAPITAL, SIMPLIFIED" title="Better workdays start with better people operations."
      text="Attendance, leave, payroll and insight — designed around the people who make your company."
      highlights={['One workspace for every HR workflow', 'Role-based access for Admin, HR and employees', 'Your data stays inside your own backend']}
      formEyebrow="WELCOME BACK" formTitle="Sign in to HCM Lite" formText="Use the account your Admin or HR team created.">
      <form className="auth-form" onSubmit={handleSubmit}>
        <label data-in>Email address<input type="email" autoComplete="username" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
        <PasswordField label="Password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        {error && <Notice type="error">{error}</Notice>}
        {notice && <Notice type={notice.type}>{notice.text}</Notice>}
        <button className="button button-primary wide" disabled={busy} data-in>{busy ? 'Signing in…' : 'Sign in'} {!busy && <ArrowRight size={16} aria-hidden="true" />}</button>
        <small className="muted" data-in>New installation? Create the first Admin account from setup.</small>
      </form>
    </AuthLayout>
  );
}

export function SetupScreen({ onSetup, notice, theme, toggleTheme }) {
  const [form, setForm] = useState({ companyName: '', name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try { await onSetup(form); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return (
    <AuthLayout theme={theme} toggleTheme={toggleTheme}
      eyebrow="FIRST-RUN SETUP" title="Start with your company and its first Admin."
      text="This creates your company workspace. HR can then add departments and register employees."
      formEyebrow="GET STARTED" formTitle="Set up your workspace" formText="No sample employee data is added.">
      <form className="auth-form" onSubmit={handleSubmit}>
        <label data-in>Company name<input required value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} /></label>
        <label data-in>Admin full name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label data-in>Admin email<input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
        <PasswordField label="Admin password (8+ characters)" minLength={8} autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        {error && <Notice type="error">{error}</Notice>}
        {notice && <Notice type={notice.type}>{notice.text}</Notice>}
        <button className="button button-primary wide" disabled={busy} data-in>{busy ? 'Creating workspace…' : 'Create workspace'}</button>
      </form>
    </AuthLayout>
  );
}

export function ChangePasswordScreen({ onChange, theme, toggleTheme }) {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    if (form.newPassword !== form.confirmPassword) return setError('The new passwords do not match.');
    setBusy(true);
    try { await onChange(form); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return (
    <AuthLayout theme={theme} toggleTheme={toggleTheme}
      eyebrow="ACCOUNT SECURITY" title="One quick step before you get started."
      text="This temporary password must be replaced with a password you have not used before."
      formEyebrow="PASSWORD UPDATE REQUIRED" formTitle="Choose a new password">
      <form className="auth-form" onSubmit={handleSubmit}>
        <PasswordField label="Current temporary password" autoComplete="current-password" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} />
        <PasswordField label="New password (8+ characters)" minLength={8} autoComplete="new-password" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} />
        <PasswordField label="Confirm new password" minLength={8} autoComplete="new-password" value={form.confirmPassword} onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })} />
        {error && <Notice type="error">{error}</Notice>}
        <button className="button button-primary wide" disabled={busy} data-in>{busy ? 'Updating…' : 'Update password'}</button>
      </form>
    </AuthLayout>
  );
}
