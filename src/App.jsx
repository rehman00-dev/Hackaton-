import React, { useEffect, useRef, useState } from 'react';
import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';

const API = '/api';
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

function token() {
  return localStorage.getItem('hcm_token');
}

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token()) headers.Authorization = `Bearer ${token()}`;
  const response = await fetch(`${API}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem('hcm_token');
      window.dispatchEvent(new Event('hcm-auth-expired'));
    }
    throw new Error(data.message || `Request failed (${response.status})`);
  }
  return data;
}

function request(method, body) {
  return { method, body: JSON.stringify(body) };
}

function localDateString(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

async function getCheckInLocation() {
  if (!navigator.geolocation) {
    return {
      coordinates: {},
      warning: 'Location is not available in this browser. If your office requires location, allow it and try again.'
    };
  }
  try {
    const position = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 10000, maximumAge: 0 }));
    return {
      coordinates: { latitude: position.coords.latitude, longitude: position.coords.longitude },
      warning: ''
    };
  } catch (error) {
    const reason = error.code === 1 ? 'permission was denied' : error.code === 3 ? 'the request timed out' : 'could not be read';
    return {
      coordinates: {},
      warning: `Location ${reason}. If your office requires location, allow browser access and try again.`
    };
  }
}

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
  useDepthEffects();

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
  }

  if (checkingSession) return <div className="loading-screen">Loading HCM Lite…</div>;
  if (!user) return setupRequired
    ? <SetupScreen onSetup={async (body) => { await api('/auth/setup', request('POST', body)); setSetupRequired(false); setNotice({ type: 'success', text: 'Setup complete. Sign in with your Admin account.' }); }} notice={notice} />
    : <LoginScreen onLogin={login} notice={notice} />;
  if (user.must_change_password) {
    return <ChangePasswordScreen onChange={async (body) => {
      const result = await api('/auth/change-password', request('POST', body));
      setUser((current) => ({ ...current, must_change_password: 0 }));
      setNotice({ type: 'success', text: result.message });
    }} />;
  }

  return (
    <div className="app-shell">
      <Scene3D />
      <header className="topbar">
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); setNotice(null); setPage('overview'); }}>
          <span className="brand-mark">H</span>
          <span><strong>HCM Lite</strong><small>People operations, made clear</small></span>
        </a>
        <div className="user-tools">
          <span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span>
          <div className="user-info"><strong>{user.name}</strong><small>{user.role}</small></div>
          <button className="button button-quiet" onClick={logout}>Sign out</button>
        </div>
      </header>
      <div className="workspace">
        <nav className="sidebar" aria-label="Workspace navigation">
          <div className="nav-label">Workspace</div>
          {roleMenus[user.role]?.map((item) => (
            <button key={item} className={`nav-link ${page === item ? 'active' : ''}`} aria-current={page === item ? 'page' : undefined} onClick={() => { setNotice(null); setPage(item); }}>
              <span className="nav-icon">{navIcon(item)}</span>{labels[item]}
            </button>
          ))}
          <div className="sidebar-foot"><span className="online-dot" /> Secure workspace <small>HCM LITE · 2026</small></div>
        </nav>
        <main className="main-content" id="main-content" aria-busy={loadingPage}>
          {notice && <div className={`notice ${notice.type}`} role="status">{notice.text}<button onClick={() => setNotice(null)} aria-label="Dismiss">×</button></div>}
          <div className="page-heading">
            <div><p className="eyebrow">{user.role} workspace</p><h1>{labels[page]}</h1></div>
            <div className="today">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
          </div>
          {page !== 'assistant' && loadError && dataPage !== page
            ? <LoadError message={loadError} onRetry={() => setReloadKey((value) => value + 1)} />
            : page !== 'assistant' && dataPage !== page
              ? <PageLoading title={labels[page]} />
              : <>
                {loadError && dataPage === page && <div className="notice error load-warning" role="alert"><span>Could not refresh this page: {loadError}</span><button className="button button-quiet" onClick={() => setReloadKey((value) => value + 1)}>Retry</button></div>}
                {page === 'overview' && <Overview data={data} user={user} go={(nextPage) => { setNotice(null); setPage(nextPage); }} />}
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
              </>}
          {page !== 'assistant' && loadingPage && dataPage === page && <div className="refresh-indicator" role="status">Updating this page…</div>}
        </main>
      </div>
    </div>
  );
}

function navIcon(name) {
  const icons = { overview: '◫', employees: '♙', attendance: '◷', leave: '▤', payroll: '＄', payslips: '▧', settings: '⚙', announcements: '▣', audit: '◉', profile: '♙', notifications: '♢', assistant: '✳' };
  return icons[name] || '•';
}

function LoginScreen({ onLogin, notice }) {
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
    <main className="auth-layout"><Scene3D />
      <section className="auth-aside"><span className="brand-mark large">H</span><p className="eyebrow">HUMAN CAPITAL, SIMPLIFIED</p><h1>Better workdays start with better people operations.</h1><p>Attendance, leave, payroll and insight — designed around the people who make your company.</p><div className="auth-stat"><strong>One workspace.</strong><span>Clear, connected HR workflows.</span></div></section>
      <section className="auth-form-wrap"><form className="auth-card" onSubmit={handleSubmit}><p className="eyebrow">WELCOME BACK</p><h2>Sign in to HCM Lite</h2><p className="muted">Use the account your Admin or HR team created.</p><label>Email address<input type="email" autoComplete="username" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label><label>Password<input type="password" autoComplete="current-password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>{error && <div className="notice error">{error}</div>}{notice && <div className={`notice ${notice.type}`}>{notice.text}</div>}<button className="button button-primary wide" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'} <span>→</span></button><small className="muted">New installation? Create the first Admin account from setup.</small></form></section>
    </main>
  );
}

function SetupScreen({ onSetup, notice }) {
  const [form, setForm] = useState({ companyName: '', name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try { await onSetup(form); } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return <main className="auth-layout"><Scene3D /><section className="auth-aside"><span className="brand-mark large">H</span><p className="eyebrow">FIRST-RUN SETUP</p><h1>Start with your company and its first Admin.</h1><p>This creates your company workspace. HR can then add departments and register employees.</p></section><section className="auth-form-wrap"><form className="auth-card" onSubmit={handleSubmit}><p className="eyebrow">GET STARTED</p><h2>Set up your workspace</h2><p className="muted">No sample employee data is added.</p><label>Company name<input required value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} /></label><label>Admin full name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label><label>Admin email<input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label><label>Admin password (8+ characters)<input type="password" minLength={8} required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>{error && <div className="notice error">{error}</div>}{notice && <div className={`notice ${notice.type}`}>{notice.text}</div>}<button className="button button-primary wide" disabled={busy}>{busy ? 'Creating workspace…' : 'Create workspace'}</button></form></section></main>;
}

function ChangePasswordScreen({ onChange }) {
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
  return <main className="auth-layout"><Scene3D /><section className="auth-aside"><span className="brand-mark large">H</span><p className="eyebrow">ACCOUNT SECURITY</p><h1>One quick step before you get started.</h1><p>This temporary password must be replaced with a password you have not used before.</p></section><section className="auth-form-wrap"><form className="auth-card" onSubmit={handleSubmit}><p className="eyebrow">PASSWORD UPDATE REQUIRED</p><h2>Choose a new password</h2><label>Current temporary password<input type="password" required value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} /></label><label>New password (8+ characters)<input type="password" minLength={8} required value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} /></label><label>Confirm new password<input type="password" minLength={8} required value={form.confirmPassword} onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })} /></label>{error && <div className="notice error">{error}</div>}<button className="button button-primary wide" disabled={busy}>{busy ? 'Updating…' : 'Update password'}</button></form></section></main>;
}

function Overview({ data, user, go }) {
  if (!data) return <EmptyState title="Loading your overview" />;
  if (user.role === 'employee') return <div className="page-stack">
    <div className="welcome-panel"><div><p className="eyebrow">YOUR WORKDAY</p><h2>Good to see you, {user.name.split(' ')[0]}.</h2><p>Keep track of your hours, leave and latest payslip here.</p></div><button className="button button-primary" onClick={() => go('attendance')}>Open attendance →</button></div>
    <div className="stats-grid"><Stat title="Today's status" value={data.attendance?.status || 'Not checked in'} hint={data.attendance?.check_in ? `In at ${formatTime(data.attendance.check_in)}` : 'Attendance'} /><Stat title="Approved leave" value={data.approvedLeaveCount ?? 0} hint="Requests" /><Stat title="Last payslip" value={data.lastPayslip ? money(data.lastPayslip.net_salary) : '—'} hint={data.lastPayslip?.month || 'Not available yet'} /></div>
    <Card title="Company announcements"><AnnouncementList rows={data.announcements} /></Card>
  </div>;
  const totals = Object.fromEntries((data.attendanceToday || []).map((row) => [row.status, row.count]));
  const leaves = Object.fromEntries((data.leaveRequests || []).map((row) => [row.status, row.count]));
  const statItems = user.role === 'admin'
    ? [['Headcount', data.headcount ?? 0, 'Active employees'], ['Present today', totals.present || 0, 'Checked in'], ['Pending leave', leaves.pending || 0, 'Needs review'], ['Payroll cost', money(data.finalizedPayroll || 0), 'Finalized payroll']]
    : [['Headcount', data.headcount ?? 0, 'Active employees'], ['Present today', (totals.present || 0) + (totals.late || 0), 'Checked in'], ['Pending leave', leaves.pending || 0, 'Needs review'], ['Finalized payroll', money(data.finalizedPayroll || 0), 'Net total']];
  return <div className="page-stack"><div className="welcome-panel"><div><p className="eyebrow">{user.role === 'admin' ? 'COMPANY OVERVIEW' : 'PEOPLE OPERATIONS'}</p><h2>Here’s what’s happening today.</h2><p>Your dashboard reflects activity recorded in this workspace.</p></div><button className="button button-secondary" onClick={() => go('assistant')}>✳ Ask assistant</button></div><div className="stats-grid">{statItems.map(([title, value, hint]) => <Stat key={title} title={title} value={value} hint={hint} />)}</div><div className="content-grid"><Card title="Attendance today"><DataTable columns={['Status', 'Count']} rows={data.attendanceToday || []} keys={['status', 'count']} empty="No attendance recorded today." /></Card><Card title="Leave requests"><DataTable columns={['Status', 'Requests']} rows={data.leaveRequests || []} keys={['status', 'count']} empty="No leave requests yet." /></Card></div><Card title="Employees by department"><DataTable columns={['Department', 'Employees']} rows={data.departments || []} keys={['name', user.role === 'admin' ? 'count' : 'employees']} empty="Create departments and register employees to see this breakdown." /></Card></div>;
}

function Employees({ data, user, submit, busy, reload }) {
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [designationFilter, setDesignationFilter] = useState('');
  const [departments, setDepartments] = useState([]);
  const [departmentError, setDepartmentError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', department_id: '', designation: '', base_salary: '', employee_code: '' });
  const [hrForm, setHrForm] = useState({ name: '', email: '', password: '' });
  const [departmentName, setDepartmentName] = useState('');
  const [csvText, setCsvText] = useState('');
  const [csvError, setCsvError] = useState('');
  const [dryRun, setDryRun] = useState(null);
  const [importCredentials, setImportCredentials] = useState(null);
  const [editing, setEditing] = useState(null);
  useEffect(() => {
    let active = true;
    api('/hr/departments')
      .then((result) => { if (active) setDepartments(result); })
      .catch((error) => { if (active) setDepartmentError(error.message); });
    return () => { active = false; };
  }, []);
  const designations = [...new Set((data || []).map((person) => person.designation).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const visible = (data || []).filter((person) => {
    const matchesSearch = `${person.name} ${person.email} ${person.employee_code || ''} ${person.designation || ''} ${person.department_name || ''}`.toLowerCase().includes(search.toLowerCase());
    const matchesDepartment = !departmentFilter
      || (departmentFilter === 'none' ? !person.department_id : String(person.department_id) === departmentFilter);
    const matchesDesignation = !designationFilter || person.designation === designationFilter;
    return matchesSearch && matchesDepartment && matchesDesignation;
  });
  async function validateCsv() {
    const result = await submit((body) => api('/hr/employees/import/dry-run', request('POST', body)), { csv: csvText });
    if (result) setDryRun(result);
  }
  async function importCsv() {
    if (!dryRun?.validCount || dryRun.invalidCount) return;
    if (!window.confirm(`Import ${dryRun.validCount} employee row(s)? This creates employee accounts.`)) return;
    const result = await submit((body) => api('/hr/employees/import', request('POST', body)), { csv: csvText });
    if (result) {
      setImportCredentials(result.credentials);
      setDryRun(null);
      setCsvText('');
    }
  }
  async function exportCsv() {
    setCsvError('');
    try {
      const response = await fetch(`${API}/hr/employees/export.csv`, { headers: { Authorization: `Bearer ${token()}` } });
      if (!response.ok) throw new Error('Could not export employee CSV');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = 'hcm-employees.csv';
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setCsvError(error.message || 'Could not export employee CSV.');
    }
  }
  async function saveEmployee(event) {
    event.preventDefault();
    const result = await submit((body) => api('/hr/employees', request('POST', body)), { ...form, base_salary: Number(form.base_salary), department_id: form.department_id || null });
    if (result) { setShowForm(false); setForm({ name: '', email: '', password: '', department_id: '', designation: '', base_salary: '', employee_code: '' }); }
  }
  async function saveEdit(event) {
    event.preventDefault();
    const result = await submit((body) => api(`/hr/employees/${editing.id}`, request('PATCH', body)), {
      name: editing.name,
      email: editing.email,
      department_id: editing.department_id || null,
      employee_code: editing.employee_code,
      designation: editing.designation,
      base_salary: Number(editing.base_salary)
    });
    if (result) setEditing(null);
  }
  return <div className="page-stack">
    {csvError && <div className="notice error" role="alert">{csvError}</div>}
    <div className="toolbar"><div><p className="muted">Showing {visible.length} of {(data || []).length} employee record(s)</p></div><div className="toolbar-actions"><input className="search-input" aria-label="Search employees" placeholder="Search name, email, code…" value={search} onChange={(e) => setSearch(e.target.value)} /><select className="search-input filter-input" aria-label="Filter by department" value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)}><option value="">All departments</option><option value="none">No department</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select><select className="search-input filter-input" aria-label="Filter by designation" value={designationFilter} onChange={(e) => setDesignationFilter(e.target.value)}><option value="">All designations</option>{designations.map((designation) => <option key={designation} value={designation}>{designation}</option>)}</select><button className="button button-secondary" onClick={exportCsv}>Export CSV</button><button className="button button-primary" onClick={() => setShowForm((value) => !value)}>＋ Add employee</button></div></div>
    <Card title="CSV employee import"><p className="hint">Required columns: name, email, employee_code, department, join_date (YYYY-MM-DD), base_salary. Download/export a CSV as a format reference. Dry-run validates rows without saving data.</p><div className="csv-toolbar"><input type="file" accept=".csv,text/csv" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; try { setCsvText(await file.text()); setDryRun(null); } catch { window.alert('Could not read the selected CSV file.'); } }} /><button className="button button-secondary" disabled={!csvText || busy} onClick={validateCsv}>Validate CSV</button>{dryRun?.validCount > 0 && dryRun.invalidCount === 0 && <button className="button button-primary" disabled={busy} onClick={importCsv}>Import {dryRun.validCount} employees</button>}</div>{dryRun && <><p className="muted">Validation: {dryRun.validCount} valid · {dryRun.invalidCount} invalid · {dryRun.total} total</p><DataTable columns={['CSV row', 'Employee', 'Email', 'Result', 'Issues']} rows={dryRun.rows} keys={['row', 'valid']} empty="No CSV rows." renderRow={(row) => <tr key={row.row}><td>{row.row}</td><td>{row.data.name || '—'}</td><td>{row.data.email || '—'}</td><td><Status value={row.valid ? 'valid' : 'invalid'} /></td><td>{row.errors.join(', ') || '—'}</td></tr>} /></>}{importCredentials && <div className="credentials-box"><strong>Import complete: temporary passwords shown once</strong><p>Save these credentials securely and share them directly with each employee.</p>{importCredentials.map((item) => <div key={item.email}><span>{item.name} · {item.email}</span><code>{item.temporary_password}</code></div>)}<button className="text-button" onClick={() => setImportCredentials(null)}>Dismiss credentials</button></div>}</Card>
    {showForm && <Card title="Register an employee"><form className="form-grid" onSubmit={saveEmployee}><label>Full name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label><label>Email<input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label><label>Temporary password<input type="password" minLength={8} required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label><label>Department<select value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })}><option value="">No department</option>{departments.map((d) => <option value={d.id} key={d.id}>{d.name}</option>)}</select></label><label>Designation<input value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} /></label><label>Employee code<input value={form.employee_code} onChange={(e) => setForm({ ...form, employee_code: e.target.value })} /></label><label>Monthly basic salary<input type="number" min="1" required value={form.base_salary} onChange={(e) => setForm({ ...form, base_salary: e.target.value })} /></label><div className="form-actions"><button className="button button-primary" disabled={busy}>Create employee login</button></div></form></Card>}
    {editing && <Card title={`Edit ${editing.name}`}><form className="form-grid" onSubmit={saveEdit}><label>Full name<input required value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></label><label>Email<input type="email" required value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })} /></label><label>Employee code<input required value={editing.employee_code} onChange={(e) => setEditing({ ...editing, employee_code: e.target.value })} /></label><label>Department<select value={editing.department_id || ''} onChange={(e) => setEditing({ ...editing, department_id: e.target.value })}><option value="">No department</option>{departments.map((d) => <option value={d.id} key={d.id}>{d.name}</option>)}</select></label><label>Designation<input value={editing.designation || ''} onChange={(e) => setEditing({ ...editing, designation: e.target.value })} /></label><label>Basic salary<input type="number" min="1" value={editing.base_salary} onChange={(e) => setEditing({ ...editing, base_salary: e.target.value })} required /></label><div className="form-actions"><button type="button" className="button button-quiet" onClick={() => setEditing(null)}>Cancel</button><button className="button button-primary" disabled={busy}>Save changes</button></div></form></Card>}
    <Card title="Directory"><DataTable columns={['Employee', 'Code', 'Department', 'Designation', 'Basic salary', 'Status', 'Action']} rows={visible} keys={['name', 'employee_code', 'department_name', 'designation']} empty="No employees yet. Register your first employee to get started." renderRow={(person) => <tr key={person.id}><td><strong>{person.name}</strong><small className="table-sub">{person.email}</small></td><td>{person.employee_code || '—'}</td><td>{person.department_name || '—'}</td><td>{person.designation || '—'}</td><td>{money(person.base_salary)}</td><td><Status value={person.is_active ? 'active' : 'inactive'} /></td><td><button className="text-button" onClick={() => setEditing({ ...person, department_id: person.department_id || '' })}>Edit</button></td></tr>} /></Card>
    <div className="content-grid"><Card title="Departments">{departmentError && <div className="notice error" role="alert">{departmentError}</div>}<DataTable columns={['Department', 'Employees']} rows={departments} keys={['name', 'employee_count']} empty="No departments yet." /><form className="inline-form" onSubmit={async (event) => { event.preventDefault(); const result = await submit((body) => api('/hr/departments', request('POST', body)), { name: departmentName }); if (result) { setDepartmentName(''); try { const next = await api('/hr/departments'); setDepartments(next); setDepartmentError(''); reload(); } catch (error) { setDepartmentError(error.message); } } }}><input placeholder="New department name" value={departmentName} onChange={(e) => setDepartmentName(e.target.value)} required /><button className="button button-secondary" disabled={busy}>Add</button></form></Card>
    {user.role === 'admin' && <Card title="Create HR login"><form className="stack-form" onSubmit={async (event) => { event.preventDefault(); const result = await submit((body) => api('/admin/hr-users', request('POST', body)), hrForm); if (result) setHrForm({ name: '', email: '', password: '' }); }}><input placeholder="HR full name" required value={hrForm.name} onChange={(e) => setHrForm({ ...hrForm, name: e.target.value })} /><input type="email" placeholder="HR email" required value={hrForm.email} onChange={(e) => setHrForm({ ...hrForm, email: e.target.value })} /><input type="password" placeholder="Temporary password (8+)" minLength={8} required value={hrForm.password} onChange={(e) => setHrForm({ ...hrForm, password: e.target.value })} /><button className="button button-secondary" disabled={busy}>Create HR account</button></form></Card>}</div>
  </div>;
}

function Attendance({ data, user, submit, busy }) {
  const [date, setDate] = useState(localDateString());
  const [boardRecords, setBoardRecords] = useState([]);
  const [correctionRows, setCorrectionRows] = useState([]);
  const [boardError, setBoardError] = useState('');
  const [correction, setCorrection] = useState({ date: localDateString(), checkIn: '', checkOut: '', reason: '' });
  useEffect(() => {
    if (user.role === 'employee') return;
    let active = true;
    Promise.all([api(`/hr/attendance?date=${date}`), api('/hr/corrections')])
      .then(([records, corrections]) => {
        if (active) {
          setBoardRecords(records);
          setCorrectionRows(corrections);
          setBoardError('');
        }
      })
      .catch((error) => { if (active) setBoardError(error.message); });
    return () => { active = false; };
  }, [date, data, user.role]);
  if (user.role === 'employee') return (
    <div className="page-stack">
      <ClockActions data={data} submit={submit} busy={busy} />
      <CameraAttendance submit={submit} busy={busy} />
      <Card title="My attendance history">
        <DataTable columns={['Date', 'Check in', 'Check out', 'Status', 'Late']} rows={data || []} keys={['date', 'check_in', 'check_out', 'status', 'late_minutes']} empty="Your attendance history will appear here." renderRow={(row) => <tr key={row.id}><td>{row.date}</td><td>{row.check_in ? formatTime(row.check_in) : '—'}</td><td>{row.check_out ? formatTime(row.check_out) : '—'}</td><td><Status value={row.status} /></td><td>{row.late_minutes ? `${row.late_minutes} min` : '—'}</td></tr>} />
      </Card>
      <Card title="Request an attendance correction">
        <form className="form-grid" onSubmit={(event) => {
          event.preventDefault();
          const toIsoString = (value) => value ? new Date(value).toISOString() : '';
          submit((body) => api('/employee/attendance-correction', request('POST', body)), {
            ...correction,
            checkIn: toIsoString(correction.checkIn),
            checkOut: toIsoString(correction.checkOut)
          }, 'Correction request submitted');
        }}>
          <label>Date<input type="date" max={localDateString()} required value={correction.date} onChange={(e) => setCorrection({ ...correction, date: e.target.value })} /></label>
          <label>Requested check-in<input type="datetime-local" required={!correction.checkOut} value={correction.checkIn} onChange={(e) => setCorrection({ ...correction, checkIn: e.target.value })} /></label>
          <label>Requested check-out<input type="datetime-local" required={!correction.checkIn} value={correction.checkOut} onChange={(e) => setCorrection({ ...correction, checkOut: e.target.value })} /></label>
          <label className="span-two">Reason<textarea required minLength={5} value={correction.reason} onChange={(e) => setCorrection({ ...correction, reason: e.target.value })} /></label>
          <div className="form-actions"><button className="button button-primary" disabled={busy}>Send for review</button></div>
        </form>
      </Card>
    </div>
  );
  return <div className="page-stack">{boardError && <div className="notice error">{boardError}</div>}<Card title="Daily attendance board"><div className="toolbar"><p className="muted">Review attendance and corrections submitted by employees.</p><input className="search-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div><DataTable columns={['Employee', 'Code', 'Department', 'Check-in', 'Check-out', 'Status']} rows={boardRecords} keys={['name', 'employee_code', 'department_name']} empty="No attendance entries for this date." renderRow={(row) => <tr key={row.id}><td>{row.name}</td><td>{row.employee_code || '—'}</td><td>{row.department_name || '—'}</td><td>{row.check_in ? formatTime(row.check_in) : '—'}</td><td>{row.check_out ? formatTime(row.check_out) : '—'}</td><td><Status value={row.status} /></td></tr>} /></Card><Card title="Attendance correction inbox"><DataTable columns={['Employee', 'Date', 'Requested in', 'Requested out', 'Reason', 'Status', 'Review']} rows={correctionRows} keys={['name', 'date', 'reason']} empty="No correction requests." renderRow={(row) => <tr key={row.id}><td>{row.name}</td><td>{row.date}</td><td>{row.requested_check_in ? formatTime(row.requested_check_in) : '—'}</td><td>{row.requested_check_out ? formatTime(row.requested_check_out) : '—'}</td><td>{row.reason}</td><td><Status value={row.status} /></td><td>{row.status === 'pending' ? <ReviewButtons onReview={(decision) => submit((body) => api(`/hr/corrections/${row.id}/review`, request('POST', body)), { decision, comment: '' })} /> : '—'}</td></tr>} /></Card></div>;
}

function ClockActions({ data, submit, busy }) {
  const record = data?.find((item) => item.date === localDateString());
  const [locationWarning, setLocationWarning] = useState('');
  const [locating, setLocating] = useState(false);
  async function checkIn() {
    setLocationWarning('');
    setLocating(true);
    const { coordinates, warning } = await getCheckInLocation();
    setLocationWarning(warning);
    setLocating(false);
    await submit((body) => api('/employee/checkin', request('POST', body)), coordinates);
  }
  return <Card title="Today’s check-in" subtitle={record ? `Checked in at ${record.check_in ? formatTime(record.check_in) : '—'}` : 'Your attendance is stamped by the server.'}>{locationWarning && <p className="location-warning" role="status">{locationWarning}</p>}<div className="clock-actions">{record?.check_out ? <><Status value={record.status} /><span className="muted">Checked out at {formatTime(record.check_out)}</span></> : record ? <><Status value={record.status} /><button className="button button-primary" disabled={busy} onClick={() => submit(() => api('/employee/checkout', { method: 'POST' }), null)}>Check out</button></> : <button className="button button-primary" disabled={busy || locating} onClick={checkIn}>{locating ? 'Checking location…' : busy ? 'Checking in…' : 'Check in'}</button>}</div></Card>;
}

function CameraAttendance({ submit, busy }) {
  const videoRef = useRef(null);
  const detectorRef = useRef(null);
  const streamRef = useRef(null);
  const [camera, setCamera] = useState(false);
  const [faceFound, setFaceFound] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [locationWarning, setLocationWarning] = useState('');
  const [starting, setStarting] = useState(false);
  const [locating, setLocating] = useState(false);
  const intervalRef = useRef(null);
  useEffect(() => () => {
    window.clearInterval(intervalRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    detectorRef.current?.close();
  }, []);
  async function startCamera() {
    setStarting(true);
    setCameraError('');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access requires HTTPS or localhost and a supported browser.');
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm');
      detectorRef.current = await FaceDetector.createFromOptions(vision, {
        baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite' },
        runningMode: 'VIDEO'
      });
      setCamera(true);
      const inspect = () => {
        if (!videoRef.current || !detectorRef.current || videoRef.current.readyState < 2) return;
        try {
          setFaceFound(detectorRef.current.detectForVideo(videoRef.current, performance.now()).detections.length > 0);
        } catch (error) {
          console.error('Face detection failed', error);
        }
      };
      videoRef.current.onloadeddata = inspect;
      intervalRef.current = window.setInterval(inspect, 500);
      stream.getTracks()[0].addEventListener('ended', () => window.clearInterval(intervalRef.current), { once: true });
    } catch (error) {
      window.clearInterval(intervalRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      setCameraError(error.message || 'Camera could not be started.');
    } finally {
      setStarting(false);
    }
  }
  async function checkIn() {
    setLocationWarning('');
    setLocating(true);
    const { coordinates, warning } = await getCheckInLocation();
    setLocationWarning(warning);
    setLocating(false);
    const result = await submit((body) => api('/employee/checkin', request('POST', body)), coordinates);
    if (result) {
      window.clearInterval(intervalRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      setCamera(false);
    }
  }
  return <Card title="Camera check-in" subtitle="Optional face-presence check. Your camera image and face data are not uploaded or stored.">
    <div className="camera-layout">
      <div className="camera-frame">
        <video ref={videoRef} className={camera ? 'camera-video' : 'video-hidden'} muted playsInline />
        {!camera && <div className="camera-placeholder"><span>◎</span><small>Camera preview appears here</small></div>}
        <div className={`face-status ${faceFound ? 'detected' : ''}`}>{camera ? faceFound ? 'Face detected' : 'Looking for a face…' : 'Camera is off'}</div>
      </div>
      <div className="camera-info">
        <p>Face detection runs on this device only; it confirms a face is visible but does not identify who you are. Location is checked against your Admin’s office radius when configured.</p>
        {cameraError && <div className="notice error">{cameraError}</div>}
        {locationWarning && <p className="location-warning" role="status">{locationWarning}</p>}
        <div className="camera-actions">
          {!camera
            ? <button className="button button-secondary" onClick={startCamera} disabled={starting}>{starting ? 'Starting camera…' : 'Enable camera'}</button>
            : <button className="button button-primary" disabled={!faceFound || busy || locating} onClick={checkIn}>{locating ? 'Checking location…' : busy ? 'Checking in…' : faceFound ? 'Confirm check-in' : 'Waiting for face'}</button>}
          {camera && <button className="button button-quiet" onClick={() => { window.clearInterval(intervalRef.current); streamRef.current?.getTracks().forEach((track) => track.stop()); setCamera(false); setFaceFound(false); }}>Turn camera off</button>}
        </div>
      </div>
    </div>
  </Card>;
}

function Leave({ data, user, submit, busy }) {
  const [form, setForm] = useState({ leaveType: '', startDate: '', endDate: '', reason: '' });
  const [smartText, setSmartText] = useState('');
  if (user.role !== 'employee') {
    const requests = Array.isArray(data) ? data[0] : [];
    return <Card title="Leave approval inbox" subtitle={`${requests.filter((item) => item.status === 'pending').length} pending request(s)`}><DataTable columns={['Employee', 'Type', 'Dates', 'Reason', 'Status', 'Decision']} rows={requests} keys={['name', 'leave_type']} empty="No leave requests have been submitted." renderRow={(row) => <tr key={row.id}><td><strong>{row.name}</strong><small className="table-sub">{row.employee_code || row.email}</small></td><td>{row.leave_type}</td><td>{row.start_date} – {row.end_date}</td><td>{row.reason || '—'}</td><td><Status value={row.status} /></td><td>{row.status === 'pending' ? <ReviewButtons onReview={(decision, comment) => submit((body) => api(`/hr/leave/${row.id}/review`, request('POST', body)), { decision, comment })} /> : row.reviewer_comment || '—'}</td></tr>} /></Card>;
  }
  const requests = data?.requests || [];
  const balances = data?.balances || [];
  return <div className="page-stack"><div className="stats-grid">{balances.map((item) => <Stat key={item.id} title={`${item.name} balance`} value={item.remaining === null ? 'Unlimited' : `${item.remaining} days`} hint={`${item.used} used of ${item.annual_quota ?? 'unlimited'}`} />)}</div><div className="content-grid"><Card title="Request time off"><form className="smart-form" onSubmit={async (event) => { event.preventDefault(); const result = await submit((body) => api('/ai/smart-leave', request('POST', body)), { prompt: smartText }); if (result?.draft) setForm(result.draft); }}><label>Describe your leave in plain words<input value={smartText} onChange={(e) => setSmartText(e.target.value)} placeholder="Need next Monday and Tuesday off for a wedding" maxLength={500} /></label><button className="button button-secondary" disabled={busy || !smartText.trim()}>✳ Draft with AI</button><small className="hint">AI fills the form only. Review and submit it yourself.</small></form><form className="stack-form" onSubmit={(event) => { event.preventDefault(); submit((body) => api('/employee/leave', request('POST', body)), form, 'Leave request submitted'); }}><label>Leave type<select required value={form.leaveType} onChange={(e) => setForm({ ...form, leaveType: e.target.value })}><option value="">Choose type</option>{balances.map((item) => <option key={item.id} value={item.name}>{item.name}{item.remaining !== null ? ` · ${item.remaining} left` : ''}</option>)}</select></label><label>From<input type="date" required value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></label><label>To<input type="date" min={form.startDate} required value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></label><label>Reason<textarea required value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Share a short reason" /></label><button className="button button-primary" disabled={busy}>Submit request</button></form><p className="hint">Working days exclude configured weekends and holidays. Requests are reviewed by HR.</p></Card><Card title="My leave requests"><DataTable columns={['Type', 'Dates', 'Status', 'Comment']} rows={requests} keys={['leave_type', 'start_date']} empty="No leave requests yet." renderRow={(row) => <tr key={row.id}><td>{row.leave_type}</td><td>{row.start_date} – {row.end_date}</td><td><Status value={row.status} /></td><td>{row.reviewer_comment || '—'}{row.status === 'pending' && <button className="text-button" onClick={() => submit(() => api(`/employee/leave/${row.id}/cancel`, { method: 'POST' }), null, 'Request cancelled')}>Cancel</button>}</td></tr>} /></Card></div></div>;
}

function ReviewButtons({ onReview }) {
  const [comment, setComment] = useState('');
  return <div className="review-actions"><input aria-label="Reviewer comment" placeholder="Optional comment" value={comment} onChange={(e) => setComment(e.target.value)} /><button className="button button-secondary button-small" onClick={() => onReview('approved', comment)}>Approve</button><button className="button button-danger button-small" onClick={() => onReview('rejected', comment)}>Reject</button></div>;
}

function Payroll({ data, user, submit, busy }) {
  const [month, setMonth] = useState(localDateString().slice(0, 7));
  const rows = data || [];
  const isEmployee = user.role === 'employee';
  function downloadPayslip(row) {
    const win = window.open('', '_blank', 'width=760,height=850');
    if (!win) return;
    win.document.write(`<html><head><title>Payslip ${row.month}</title><style>body{font:16px Arial;padding:48px;color:#18332b}h1{margin-bottom:4px}.line{display:flex;justify-content:space-between;border-bottom:1px solid #ddd;padding:12px 0}.total{font-weight:bold;font-size:20px;margin-top:16px}</style></head><body><h1>HCM Lite</h1><p>Employee payslip · ${row.month}</p><div class=\"line\"><span>Employee</span><strong>${escapeHtml(row.name || user.name)}</strong></div><div class=\"line\"><span>Gross salary</span><strong>${money(row.gross_salary)}</strong></div><div class=\"line\"><span>Tax</span><strong>${money(row.tax)}</strong></div><div class=\"line total\"><span>Net pay</span><strong>${money(row.net_salary)}</strong></div><p style=\"margin-top:40px;color:#697971\">Confidential · Generated from HCM Lite payroll records</p><script>window.print()</script></body></html>`);
    win.document.close();
  }
  return <div className="page-stack">{!isEmployee && <Card title="Prepare monthly payroll"><div className="toolbar"><p className="muted">Creates a draft for every active employee. Only Admin can finalize the month.</p><div className="toolbar-actions"><input className="search-input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} /><button className="button button-primary" disabled={busy} onClick={() => submit((body) => api('/hr/payroll/run', request('POST', body)), { month })}>Run payroll draft</button></div></div></Card>}<Card title={isEmployee ? 'My payslips' : 'Payroll records'}><DataTable columns={['Month', 'Employee', 'Gross', 'Tax', 'Net pay', 'Status', 'Action']} rows={rows} keys={['month', 'name']} empty="No payroll records yet." renderRow={(row) => <tr key={row.id}><td>{row.month}</td><td>{row.name || user.name}</td><td>{money(row.gross_salary)}</td><td>{money(row.tax)}</td><td><strong>{money(row.net_salary)}</strong></td><td><Status value={row.status} /></td><td>{isEmployee && row.status === 'finalized' ? <button className="text-button" onClick={() => downloadPayslip(row)}>Print / save PDF</button> : '—'}</td></tr>} /></Card>{user.role === 'admin' && rows.some((row) => row.status === 'draft') && <Card title="Finalize a payroll month"><p className="muted">Finalization locks all draft entries for that month.</p><div className="toolbar-actions">{[...new Set(rows.filter((row) => row.status === 'draft').map((row) => row.month))].map((draftMonth) => <button className="button button-danger" key={draftMonth} disabled={busy} onClick={() => { if (window.confirm(`Finalize and lock ${draftMonth} payroll?`)) submit(() => api(`/admin/payroll/${draftMonth}/finalize`, { method: 'POST' }), null); }}>Finalize {draftMonth}</button>)}</div></Card>}</div>;
}

function Settings({ data, submit, busy }) {
  const company = data?.company || {};
  const [form, setForm] = useState(null);
  const [leaveType, setLeaveType] = useState({ name: '', annualQuota: '', paid: true });
  const [holiday, setHoliday] = useState({ name: '', date: '' });
  useEffect(() => { if (data?.company && !form) setForm({ name: company.name || '', officeHours: company.office_hours || '09:00-17:00', graceMinutes: company.grace_minutes ?? 15, weekend: company.weekend || 'SAT-SUN', officeLocation: company.office_location || '', officeRadiusMeters: company.office_radius_meters || 150, officeLatitude: company.office_latitude ?? '', officeLongitude: company.office_longitude ?? '' }); }, [company, data, form]);
  if (!form) return <EmptyState title="Loading company settings" />;
  return <div className="page-stack"><Card title="Company & attendance rules"><form className="form-grid" onSubmit={(event) => { event.preventDefault(); submit((body) => api('/admin/company', request('PUT', body)), form); }}><label>Company name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label><label>Office hours<input value={form.officeHours} onChange={(e) => setForm({ ...form, officeHours: e.target.value })} placeholder="09:00-17:00" /></label><label>Late grace period (minutes)<input type="number" min="0" max="240" value={form.graceMinutes} onChange={(e) => setForm({ ...form, graceMinutes: e.target.value })} /></label><label>Weekend<select value={form.weekend} onChange={(e) => setForm({ ...form, weekend: e.target.value })}><option>SAT-SUN</option><option>FRI-SAT</option><option>SUN</option></select></label><label>Office address<input value={form.officeLocation} onChange={(e) => setForm({ ...form, officeLocation: e.target.value })} /></label><label>Geofence radius (meters)<input type="number" min="1" value={form.officeRadiusMeters} onChange={(e) => setForm({ ...form, officeRadiusMeters: e.target.value })} /></label><label>Office latitude<input type="number" step="any" value={form.officeLatitude} onChange={(e) => setForm({ ...form, officeLatitude: e.target.value })} /></label><label>Office longitude<input type="number" step="any" value={form.officeLongitude} onChange={(e) => setForm({ ...form, officeLongitude: e.target.value })} /></label><div className="form-actions"><button className="button button-primary" disabled={busy}>Save settings</button></div></form><p className="hint">Set both office coordinates to enforce location-based check-in. Leave them blank to disable geofencing.</p></Card><div className="content-grid"><Card title="Leave types"><DataTable columns={['Type', 'Annual quota', 'Paid']} rows={data.leaveTypes || []} keys={['name', 'annual_quota', 'paid']} empty="No leave types configured." /></Card><Card title="Add leave type"><form className="stack-form" onSubmit={(event) => { event.preventDefault(); submit((body) => api('/admin/leave-types', request('POST', body)), { ...leaveType, annualQuota: leaveType.annualQuota === '' ? null : Number(leaveType.annualQuota) }); }}><label>Name<input required value={leaveType.name} onChange={(e) => setLeaveType({ ...leaveType, name: e.target.value })} /></label><label>Quota per year (blank = unlimited)<input type="number" min="0" value={leaveType.annualQuota} onChange={(e) => setLeaveType({ ...leaveType, annualQuota: e.target.value })} /></label><label className="check-label"><input type="checkbox" checked={leaveType.paid} onChange={(e) => setLeaveType({ ...leaveType, paid: e.target.checked })} /> Paid leave</label><button className="button button-secondary" disabled={busy}>Add leave type</button></form></Card><Card title="Public holidays"><DataTable columns={['Holiday', 'Date', 'Action']} rows={data.holidays || []} keys={['name', 'date']} empty="No holidays added." renderRow={(row) => <tr key={row.id}><td>{row.name}</td><td>{row.date}</td><td><button className="text-button" onClick={() => submit(() => api(`/admin/holidays/${row.id}`, { method: 'DELETE' }), null, 'Holiday removed')}>Remove</button></td></tr>} /></Card><Card title="Add public holiday"><form className="stack-form" onSubmit={(event) => { event.preventDefault(); const result = submit((body) => api('/admin/holidays', request('POST', body)), holiday); result.then((saved) => { if (saved) setHoliday({ name: '', date: '' }); }); }}><label>Holiday name<input required value={holiday.name} onChange={(e) => setHoliday({ ...holiday, name: e.target.value })} /></label><label>Date<input type="date" required value={holiday.date} onChange={(e) => setHoliday({ ...holiday, date: e.target.value })} /></label><button className="button button-secondary" disabled={busy}>Add holiday</button></form></Card></div></div>;
}

function Announcements({ data, user, submit, busy }) {
  const [form, setForm] = useState({ title: '', message: '' });
  const canPost = user.role !== 'employee';
  return <div className="page-stack">{canPost && <Card title="Post an announcement"><form className="form-grid" onSubmit={(event) => { event.preventDefault(); const result = submit((body) => api(user.role === 'admin' ? '/admin/announcements' : '/hr/announcements', request('POST', body)), form); result.then((saved) => { if (saved) setForm({ title: '', message: '' }); }); }}><label>Title<input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label><label className="span-two">Message<textarea required value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></label><div className="form-actions"><button className="button button-primary" disabled={busy}>Publish</button></div></form></Card>}<Card title="Latest announcements"><AnnouncementList rows={data} /></Card></div>;
}

function AnnouncementList({ rows }) {
  if (!rows?.length) return <EmptyState title="No announcements" description="Company announcements will show here when posted." />;
  return <div className="announcement-list">{rows.map((item) => <article className="announcement-item" key={item.id}><div><span className="eyebrow">{item.author || 'Company'} · {new Date(item.created_at).toLocaleDateString()}</span><h3>{item.title}</h3></div><p>{item.message}</p></article>)}</div>;
}

function Audit({ data }) {
  return <Card title="Recent audit activity" subtitle="Important account and HR actions are recorded here."><DataTable columns={['Time', 'Actor', 'Action', 'Entity', 'Details']} rows={data || []} keys={['created_at', 'actor_name', 'action', 'entity']} empty="No audit events recorded yet." renderRow={(row) => <tr key={row.id}><td>{new Date(`${row.created_at}Z`).toLocaleString()}</td><td>{row.actor_name || 'System'}</td><td>{row.action}</td><td>{row.entity || '—'}</td><td><code>{row.details || '—'}</code></td></tr>} /></Card>;
}

function Profile({ data, submit, busy }) {
  const [form, setForm] = useState(null);
  useEffect(() => { if (data && !form) setForm({ phone: data.phone || '', address: data.address || '' }); }, [data, form]);
  if (!data || !form) return <EmptyState title="Loading your profile" />;
  return <Card title="Personal details"><div className="profile-summary"><span className="avatar large-avatar">{data.name?.slice(0, 1).toUpperCase()}</span><div><h2>{data.name}</h2><p>{data.employee_code || 'Employee'} · {data.designation || 'Team member'}</p><p>{data.department_name || 'No department'} · Joined {data.join_date || '—'}</p><p>{data.email}</p></div></div><form className="form-grid" onSubmit={(event) => { event.preventDefault(); submit((body) => api('/employee/profile', request('PATCH', body)), form); }}><label>Phone<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label><label>Address<input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></label><div className="form-actions"><button className="button button-primary" disabled={busy}>Save profile</button></div></form></Card>;
}

function Notifications({ data, submit }) {
  return <Card title="Your notifications"><DataTable columns={['Notification', 'Date', 'Read']} rows={data || []} keys={['title', 'created_at']} empty="You’re all caught up." renderRow={(row) => <tr key={row.id}><td><strong>{row.title}</strong><small className="table-sub">{row.message}</small></td><td>{new Date(`${row.created_at}Z`).toLocaleString()}</td><td>{row.read_at ? 'Read' : <button className="text-button" onClick={() => submit(() => api(`/employee/notifications/${row.id}/read`, { method: 'POST' }), null, 'Marked as read')}>Mark read</button>}</td></tr>} /></Card>;
}

function Assistant() {
  const [messages, setMessages] = useState([{ from: 'assistant', text: 'Ask about your HR data or company policies. I only use information permitted for your role.' }]);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const chatEndRef = useRef(null);
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, busy]);
  async function send(event) {
    event.preventDefault();
    if (busy) return;
    const message = prompt.trim();
    if (!message) return;
    setMessages((items) => [...items, { from: 'user', text: message }]);
    setPrompt('');
    setBusy(true);
    try {
      const response = await api('/ai/chat', request('POST', { message }));
      setMessages((items) => [...items, { from: 'assistant', text: response.response, label: response.generated ? 'AI-generated' : '' }]);
    } catch (error) {
      setMessages((items) => [...items, { from: 'assistant', text: error.message, error: true }]);
    } finally { setBusy(false); }
  }
  return <div className="assistant-card card">
    <div className="assistant-header"><span className="assistant-mark">✳</span><div><h2>HCM assistant</h2><p className="muted">Answers are scoped to your role and grounded in HCM data.</p></div><Status value="Role scoped" /></div>
    <div className="chat-log" role="log" aria-live="polite" aria-relevant="additions">
      {messages.map((item, index) => <div className={`chat-message ${item.from} ${item.error ? 'chat-error' : ''}`} key={`${index}-${item.text}`}><p>{item.text}</p>{item.label && <small>{item.label}</small>}</div>)}
      {busy && <div className="chat-message" role="status"><p>Thinking…</p></div>}
      <div ref={chatEndRef} />
    </div>
    <form className="chat-form" onSubmit={send}><input aria-label="Ask a question" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="e.g. Who is on leave today?" maxLength={2000} /><button className="button button-primary" disabled={busy || !prompt.trim()}>{busy ? 'Thinking…' : 'Send'}</button></form>
    <p className="hint">AI calls Groq from the server. If it is unavailable, check GROQ_API_KEY in the server .env and restart the backend after updating it.</p>
  </div>;
}

// ---- Visual-only 3D layer: pointer parallax, card tilt and the animated background scene ----
function useDepthEffects() {
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (reduce || !finePointer) return undefined;
    const root = document.documentElement;
    const targets = [['.stat-card', 9], ['.welcome-panel', 3.5], ['.auth-card', 4], ['.card', 1.3]];
    let frame = 0;
    let lastEvent = null;
    let active = null;
    const release = (element) => {
      if (!element) return;
      element.classList.remove('is-tilting');
      element.style.removeProperty('--rx');
      element.style.removeProperty('--ry');
    };
    const onMove = (event) => {
      lastEvent = event;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const e = lastEvent;
        if (!e) return;
        root.style.setProperty('--px', (e.clientX / window.innerWidth - 0.5).toFixed(3));
        root.style.setProperty('--py', (e.clientY / window.innerHeight - 0.5).toFixed(3));
        const origin = e.target instanceof Element ? e.target : null;
        let element = null;
        let max = 0;
        if (origin) {
          for (const [selector, degrees] of targets) {
            const hit = origin.closest(selector);
            if (hit) { element = hit; max = degrees; break; }
          }
        }
        if (active && active !== element) release(active);
        active = element;
        if (!element) return;
        const focused = document.activeElement;
        if (focused && element.contains(focused) && /^(INPUT|SELECT|TEXTAREA)$/.test(focused.tagName)) { release(element); return; }
        const box = element.getBoundingClientRect();
        const x = (e.clientX - box.left) / box.width;
        const y = (e.clientY - box.top) / box.height;
        element.classList.add('is-tilting');
        element.style.setProperty('--rx', `${((0.5 - y) * max * 2).toFixed(2)}deg`);
        element.style.setProperty('--ry', `${((x - 0.5) * max * 2).toFixed(2)}deg`);
        element.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
        element.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
      });
    };
    const onLeave = () => { release(active); active = null; };
    document.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('mouseleave', onLeave);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('mouseleave', onLeave);
      if (frame) cancelAnimationFrame(frame);
      release(active);
    };
  }, []);
}

const SCENE_CUBES = [
  { left: '5%', top: '17%', size: 66, delay: '0s', duration: '28s' },
  { left: '89%', top: '22%', size: 92, delay: '-6s', duration: '34s' },
  { left: '76%', top: '70%', size: 54, delay: '-12s', duration: '24s' },
  { left: '11%', top: '74%', size: 78, delay: '-3s', duration: '31s' },
  { left: '47%', top: '88%', size: 42, delay: '-18s', duration: '22s' }
];

function Scene3D() {
  return (
    <div className="scene3d" aria-hidden="true">
      <div className="scene-stage">
        <div className="scene-floor" />
        <span className="scene-orb scene-orb-a" />
        <span className="scene-orb scene-orb-b" />
        <span className="scene-ring scene-ring-a" />
        <span className="scene-ring scene-ring-b" />
        {SCENE_CUBES.map((cube, index) => (
          <div key={index} className={`scene-cube scene-cube-${index}`} style={{ left: cube.left, top: cube.top, '--size': `${cube.size}px`, '--delay': cube.delay, '--duration': cube.duration }}>
            {['front', 'back', 'right', 'left', 'top', 'bottom'].map((face) => <i key={face} className={`face face-${face}`} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

function Card({ title, subtitle, children }) {
  return <section className="card"><div className="card-heading"><div><h2>{title}</h2>{subtitle && <p className="muted">{subtitle}</p>}</div></div>{children}</section>;
}

function Stat({ title, value, hint }) {
  return <article className="stat-card"><span className="eyebrow">{title}</span><strong>{value}</strong><small>{hint}</small></article>;
}

function DataTable({ columns, rows, keys, empty, renderRow }) {
  if (!rows?.length) return <EmptyState title={empty || 'No records to show.'} />;
  return <div className="table-wrap"><table><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{renderRow ? rows.map(renderRow) : rows.map((row, index) => <tr key={row.id || index}>{keys.map((key) => <td key={key}>{key === 'status' ? <Status value={row[key]} /> : row[key] ?? '—'}</td>)}</tr>)}</tbody></table></div>;
}

function Status({ value }) {
  return <span className={`status status-${String(value || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>{String(value || 'unknown').replaceAll('_', ' ')}</span>;
}

function EmptyState({ title, description }) {
  return <div className="empty-state"><span>◌</span><strong>{title}</strong>{description && <p>{description}</p>}</div>;
}

function PageLoading({ title }) {
  return <div className="page-loading" role="status" aria-live="polite"><span className="loading-spinner" />Loading {title.toLowerCase()}…</div>;
}

function LoadError({ message, onRetry }) {
  return <section className="load-error" role="alert"><span className="load-error-icon">!</span><h2>We couldn’t load this page</h2><p>{message}</p><button className="button button-primary" onClick={onRetry}>Try again</button></section>;
}

function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function money(value) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'PKR', maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

export default App;
