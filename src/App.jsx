import React, { Suspense, lazy, useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  Activity, Bell, CalendarDays, ClipboardCheck, ClipboardList, Clock3, LayoutDashboard,
  LogOut, Menu, MessageCircle, Moon, Settings as SettingsIcon, Sun, UserRound, UsersRound, Wallet, X
} from 'lucide-react';
import { api, request, token } from './lib/api.js';
import { useStaggerReveal, useTheme } from './lib/hooks.js';
import { Avatar, LoadError, Notice, PageLoading } from './components/ui.jsx';
import { ChangePasswordScreen, LoginScreen, SetupScreen } from './pages/Auth.jsx';
const Overview = lazy(() => import('./pages/Overview.jsx'));

// Heavier pages are split into their own chunks and fetched on first visit.
const Employees = lazy(() => import('./pages/Employees.jsx'));
const Attendance = lazy(() => import('./pages/Attendance.jsx'));
const Leave = lazy(() => import('./pages/Leave.jsx'));
const Payroll = lazy(() => import('./pages/Payroll.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));
const Announcements = lazy(() => import('./pages/Announcements.jsx'));
const Audit = lazy(() => import('./pages/Audit.jsx'));
const Profile = lazy(() => import('./pages/Profile.jsx'));
const Notifications = lazy(() => import('./pages/Notifications.jsx'));
const Assistant = lazy(() => import('./pages/Assistant.jsx'));

const roleMenus = {
  admin: ['overview', 'employees', 'attendance', 'leave', 'payroll', 'settings', 'announcements', 'audit', 'assistant'],
  hr: ['overview', 'employees', 'attendance', 'leave', 'payroll', 'announcements', 'assistant'],
  employee: ['overview', 'attendance', 'leave', 'payslips', 'profile', 'notifications', 'assistant']
};
const labels = {
  overview: 'Overview', employees: 'Employees', attendance: 'Attendance', leave: 'Leave',
  payroll: 'Payroll', payslips: 'Payslips', settings: 'Company setup', announcements: 'Announcements',
  audit: 'Audit log', profile: 'My profile', notifications: 'Notifications', assistant: 'AI assistant'
};
const navigationIcons = {
  overview: LayoutDashboard, employees: UsersRound, attendance: Clock3, leave: CalendarDays, payroll: Wallet,
  payslips: ClipboardList, settings: SettingsIcon, announcements: Bell, audit: ClipboardCheck,
  profile: UserRound, notifications: Bell, assistant: MessageCircle
};
const navGroups = [
  { title: 'Workspace', items: ['overview', 'employees', 'attendance', 'leave', 'payroll', 'payslips'] },
  { title: 'Company', items: ['settings', 'announcements', 'audit', 'profile', 'notifications'] },
  { title: 'Intelligence', items: ['assistant'] }
];

function App() {
  const [user, setUser] = useState(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [page, setPage] = useState('overview');
  const [data, setData] = useState(null);
  const [dataPage, setDataPage] = useState(null);
  const [loadingPage, setLoadingPage] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [navOpen, setNavOpen] = useState(false);
  const [theme, toggleTheme] = useTheme();
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const resetSession = () => {
      setUser(null);
      setCheckingSession(false);
    };
    window.addEventListener('hcm-auth-expired', resetSession);
    (async () => {
      try {
        const setup = await api('/auth/setup/status');
        setSetupRequired(setup.setupRequired);
        if (token()) {
          const result = await api('/auth/me');
          setUser(result.user);
          setPage('overview');
        }
      } catch (error) {
        setNotice({ type: 'error', text: error.message });
      } finally {
        setCheckingSession(false);
      }
    })();
    return () => window.removeEventListener('hcm-auth-expired', resetSession);
  }, []);

  useEffect(() => {
    if (!user || user.must_change_password || page === 'assistant') {
      setLoadingPage(false);
      setLoadError('');
      return;
    }
    let active = true;
    setLoadingPage(true);
    setLoadError('');
    const load = async () => {
      try {
        let result;
        if (page === 'overview') {
          result = user.role === 'employee' ? await api('/employee/dashboard') : await api('/dashboard/summary');
        } else if (page === 'employees') {
          result = await api('/hr/employees');
        } else if (page === 'attendance') {
          result = user.role === 'employee'
            ? await api('/employee/attendance')
            : await Promise.all([api('/hr/attendance'), api('/hr/corrections')]);
        } else if (page === 'leave') {
          result = user.role === 'employee'
            ? await api('/employee/leave')
            : await Promise.all([api('/hr/leave'), api('/hr/leave-types')]);
        } else if (page === 'payroll' || page === 'payslips') {
          result = await api(user.role === 'employee' ? '/employee/payroll' : '/hr/payroll');
        } else if (page === 'settings') {
          const [companyResult, types, holidays] = await Promise.all([api('/admin/company'), api('/admin/leave-types'), api('/admin/holidays')]);
          result = { ...companyResult, leaveTypes: types, holidays };
        } else if (page === 'announcements') {
          result = await api(user.role === 'employee' ? '/employee/announcements' : '/hr/announcements');
        } else if (page === 'audit') {
          result = await api('/admin/audit');
        } else if (page === 'profile') {
          result = await api('/employee/profile');
        } else if (page === 'notifications') {
          result = await api('/employee/notifications');
        }
        if (active) {
          setData(result ?? null);
          setDataPage(page);
        }
      } catch (error) {
        if (active) {
          setLoadError(error.message);
        }
      } finally {
        if (active) setLoadingPage(false);
      }
    };
    load();
    return () => { active = false; };
  }, [user, page, reloadKey]);

  // Close the mobile drawer on Escape.
  useEffect(() => {
    if (!navOpen) return undefined;
    const onKey = (event) => { if (event.key === 'Escape') setNavOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [navOpen]);

  async function submit(action, body, successMessage) {
    setBusy(true);
    setNotice(null);
    try {
      const result = await action(body);
      setNotice({ type: 'success', text: result?.message || successMessage || 'Saved successfully' });
      setReloadKey((value) => value + 1);
      return result;
    } catch (error) {
      setNotice({ type: 'error', text: error.message });
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function login(credentials) {
    const result = await api('/auth/login', request('POST', credentials));
    localStorage.setItem('hcm_token', result.token);
    setUser(result.user);
    setPage('overview');
    setNotice({ type: 'success', text: `Welcome, ${result.user.name}` });
  }

  function logout() {
    localStorage.removeItem('hcm_token');
    setUser(null);
    setData(null);
    setNotice(null);
    setNavOpen(false);
  }

  function navigate(next) {
    setNotice(null);
    setPage(next);
    setNavOpen(false);
  }

  if (checkingSession) return <BootScreen />;
  if (!user) return setupRequired
    ? <SetupScreen theme={theme} toggleTheme={toggleTheme} onSetup={async (body) => { await api('/auth/setup', request('POST', body)); setSetupRequired(false); setNotice({ type: 'success', text: 'Setup complete. Sign in with your Admin account.' }); }} notice={notice} />
    : <LoginScreen theme={theme} toggleTheme={toggleTheme} onLogin={login} notice={notice} />;
  if (user.must_change_password) {
    return <ChangePasswordScreen theme={theme} toggleTheme={toggleTheme} onChange={async (body) => {
      const result = await api('/auth/change-password', request('POST', body));
      setUser((current) => ({ ...current, must_change_password: 0 }));
      setNotice({ type: 'success', text: result.message });
    }} />;
  }

  const allowed = roleMenus[user.role] || [];
  const showPage = page === 'assistant' || dataPage === page;

  return (
    <div className="app-shell">
      <div className="ambient" aria-hidden="true"><i className="ambient-a" /><i className="ambient-b" /><i className="ambient-grid" /></div>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="topbar">
        <button className="icon-button nav-toggle" onClick={() => setNavOpen((v) => !v)} aria-label={navOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={navOpen}>{navOpen ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}</button>
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); navigate('overview'); }}>
          <img className="brand-logo" src="/hcm-logo.svg" alt="" aria-hidden="true" />
          <span><strong>HCM Lite</strong><small>People operations, made clear</small></span>
        </a>
        <div className="topbar-title" aria-hidden="true"><span>{user.role} workspace</span><i />{labels[page]}</div>
        <div className="user-tools">
          <button className="icon-button" onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>{theme === 'dark' ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}</button>
          <div className="user-chip">
            <Avatar name={user.name} />
            <div className="user-info"><strong>{user.name}</strong><small>{user.role}</small></div>
          </div>
          <button className="button button-quiet" onClick={logout}><LogOut size={15} aria-hidden="true" /><span className="hide-sm">Sign out</span></button>
        </div>
      </header>
      <div className="workspace">
        <AnimatePresence>{navOpen && <motion.button className="nav-backdrop" aria-label="Close navigation" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setNavOpen(false)} />}</AnimatePresence>
        <nav className={`sidebar ${navOpen ? 'open' : ''}`} aria-label="Workspace navigation">
          {navGroups.map((group) => {
            const items = group.items.filter((item) => allowed.includes(item));
            if (!items.length) return null;
            return (
              <div className="nav-group" key={group.title}>
                <div className="nav-label">{group.title}</div>
                {items.map((item) => {
                  const Icon = navigationIcons[item] || Activity;
                  return (
                    <motion.button key={item} className={`nav-link ${page === item ? 'active' : ''}`} aria-current={page === item ? 'page' : undefined} onClick={() => navigate(item)} whileHover={reduceMotion ? undefined : { x: 2 }} whileTap={reduceMotion ? undefined : { scale: 0.98 }}>
                      {page === item && <motion.span className="nav-active-indicator" layoutId="active-navigation" transition={{ type: 'spring', stiffness: 400, damping: 34 }} />}
                      <span className="nav-icon"><Icon size={17} strokeWidth={1.8} aria-hidden="true" /></span><span className="nav-text">{labels[item]}</span>
                    </motion.button>
                  );
                })}
              </div>
            );
          })}
          <div className="sidebar-foot"><span className="online-dot" /> Secure workspace <small>HCM LITE · 2026</small></div>
        </nav>
        <main className="main-content" id="main-content" tabIndex={-1} aria-busy={loadingPage}>
          <AnimatePresence initial={false}>
            {notice && (
              <motion.div key={`${notice.type}-${notice.text}`} className="toast" initial={reduceMotion ? false : { opacity: 0, y: -10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={reduceMotion ? undefined : { opacity: 0, y: -6 }} transition={{ duration: reduceMotion ? 0 : 0.2 }}>
                <Notice type={notice.type} onDismiss={() => setNotice(null)}>{notice.text}</Notice>
              </motion.div>
            )}
          </AnimatePresence>
          <div className="page-heading">
            <div><p className="eyebrow">{user.role} workspace</p><h1>{labels[page]}</h1></div>
            <div className="today">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
          </div>
          {page !== 'assistant' && loadError && dataPage !== page
            ? <LoadError message={loadError} onRetry={() => setReloadKey((value) => value + 1)} />
            : page !== 'assistant' && dataPage !== page
              ? <PageLoading title={labels[page]} />
              : (
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div key={page} className="page-transition" initial={reduceMotion ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={reduceMotion ? undefined : { opacity: 0, y: -6 }} transition={{ duration: reduceMotion ? 0 : 0.22, ease: 'easeOut' }}>
                    {loadError && dataPage === page && <div className="load-warning"><Notice type="error">Could not refresh this page: {loadError}<button className="button button-quiet button-small" onClick={() => setReloadKey((value) => value + 1)}>Retry</button></Notice></div>}
                    {showPage && (
                      <Suspense fallback={<PageLoading title={labels[page]} />}>
                        <Reveal pageKey={page}>
                          {page === 'overview' && <Overview data={data} user={user} go={navigate} />}
                          {page === 'employees' && <Employees data={data} user={user} submit={submit} busy={busy} reload={() => setReloadKey((n) => n + 1)} />}
                          {page === 'attendance' && <Attendance data={data} user={user} submit={submit} busy={busy} />}
                          {page === 'leave' && <Leave data={data} user={user} submit={submit} busy={busy} />}
                          {(page === 'payroll' || page === 'payslips') && <Payroll data={data} user={user} submit={submit} busy={busy} />}
                          {page === 'settings' && <Settings data={data} submit={submit} busy={busy} />}
                          {page === 'announcements' && <Announcements data={data} user={user} submit={submit} busy={busy} />}
                          {page === 'audit' && <Audit data={data} />}
                          {page === 'profile' && <Profile data={data} submit={submit} busy={busy} />}
                          {page === 'notifications' && <Notifications data={data} submit={submit} />}
                          {page === 'assistant' && <Assistant />}
                        </Reveal>
                      </Suspense>
                    )}
                  </motion.div>
                </AnimatePresence>
              )}
          {page !== 'assistant' && loadingPage && dataPage === page && <div className="refresh-indicator" role="status"><span className="loading-spinner" />Updating…</div>}
        </main>
      </div>
    </div>
  );
}

/** Runs the GSAP stagger once per page visit (not on every background refresh). */
function Reveal({ pageKey, children }) {
  const ref = useStaggerReveal(pageKey);
  return <div ref={ref}>{children}</div>;
}

function BootScreen() {
  return (
    <div className="boot-screen" role="status" aria-live="polite">
      <img src="/hcm-logo.svg" alt="" className="boot-logo" />
      <span className="boot-bar"><i /></span>
      <span className="sr-only">Loading HCM Lite…</span>
    </div>
  );
}

export default App;
