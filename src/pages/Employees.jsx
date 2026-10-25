import React, { useEffect, useState } from 'react';
import { ChevronDown, Download, FileUp, Plus, Search } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { api, API, request, token } from '../lib/api.js';
import { money } from '../lib/format.js';
import { Avatar, Card, DataTable, Modal, Notice, Status } from '../components/ui.jsx';

const emptyForm = { name: '', email: '', password: '', department_id: '', designation: '', base_salary: '', employee_code: '' };

export default function Employees({ data, user, submit, busy, reload }) {
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [designationFilter, setDesignationFilter] = useState('');
  const [departments, setDepartments] = useState([]);
  const [departmentError, setDepartmentError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [form, setForm] = useState(emptyForm);
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
    if (result) { setShowForm(false); setForm(emptyForm); }
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

  return (
    <div className="page-stack">
      {csvError && <Notice type="error">{csvError}</Notice>}
      <div className="toolbar" data-reveal>
        <p className="muted">Showing {visible.length} of {(data || []).length} employee record(s)</p>
        <div className="toolbar-actions">
          <label className="search-field"><Search size={15} aria-hidden="true" /><input aria-label="Search employees" placeholder="Search name, email, code…" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
          <select className="select-input" aria-label="Filter by department" value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)}><option value="">All departments</option><option value="none">No department</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select>
          <select className="select-input" aria-label="Filter by designation" value={designationFilter} onChange={(e) => setDesignationFilter(e.target.value)}><option value="">All designations</option>{designations.map((designation) => <option key={designation} value={designation}>{designation}</option>)}</select>
          <button className="button button-secondary" onClick={exportCsv}><Download size={15} aria-hidden="true" />Export CSV</button>
          <button className="button button-primary" onClick={() => setShowForm(true)}><Plus size={15} aria-hidden="true" />Add employee</button>
        </div>
      </div>

      <Card title="Directory">
        <DataTable columns={['Employee', 'Code', 'Department', 'Designation', 'Basic salary', 'Status', 'Action']} rows={visible} keys={['name', 'employee_code', 'department_name', 'designation']} empty="No employees yet. Register your first employee to get started."
          renderRow={(person) => (
            <tr key={person.id}>
              <td><div className="person-cell"><Avatar name={person.name} /><div><strong>{person.name}</strong><small className="table-sub">{person.email}</small></div></div></td>
              <td><code className="chip-code">{person.employee_code || '—'}</code></td>
              <td>{person.department_name || '—'}</td>
              <td>{person.designation || '—'}</td>
              <td className="num">{money(person.base_salary)}</td>
              <td><Status value={person.is_active ? 'active' : 'inactive'} /></td>
              <td><button className="text-button" onClick={() => setEditing({ ...person, department_id: person.department_id || '' })}>Edit</button></td>
            </tr>
          )} />
      </Card>

      <Card title="CSV employee import" subtitle="Bulk-create employee accounts from a spreadsheet." actions={<button className="button button-quiet button-small" aria-expanded={showImport} onClick={() => setShowImport((v) => !v)}><FileUp size={14} aria-hidden="true" />{showImport ? 'Hide' : 'Open'}<ChevronDown size={14} className={showImport ? 'flip' : ''} aria-hidden="true" /></button>}>
        <AnimatePresence initial={false}>
          {(showImport || importCredentials) && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25 }} style={{ overflow: 'hidden' }}>
              <p className="hint">Required columns: name, email, employee_code, department, join_date (YYYY-MM-DD), base_salary. Download/export a CSV as a format reference. Dry-run validates rows without saving data.</p>
              <div className="csv-toolbar">
                <input type="file" accept=".csv,text/csv" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; try { setCsvText(await file.text()); setDryRun(null); } catch { window.alert('Could not read the selected CSV file.'); } }} />
                <button className="button button-secondary" disabled={!csvText || busy} onClick={validateCsv}>Validate CSV</button>
                {dryRun?.validCount > 0 && dryRun.invalidCount === 0 && <button className="button button-primary" disabled={busy} onClick={importCsv}>Import {dryRun.validCount} employees</button>}
              </div>
              {dryRun && <>
                <p className="muted">Validation: {dryRun.validCount} valid · {dryRun.invalidCount} invalid · {dryRun.total} total</p>
                <DataTable columns={['CSV row', 'Employee', 'Email', 'Result', 'Issues']} rows={dryRun.rows} keys={['row', 'valid']} empty="No CSV rows." renderRow={(row) => <tr key={row.row}><td>{row.row}</td><td>{row.data.name || '—'}</td><td>{row.data.email || '—'}</td><td><Status value={row.valid ? 'valid' : 'invalid'} /></td><td>{row.errors.join(', ') || '—'}</td></tr>} />
              </>}
              {importCredentials && <div className="credentials-box"><strong>Import complete: temporary passwords shown once</strong><p>Save these credentials securely and share them directly with each employee.</p>{importCredentials.map((item) => <div key={item.email}><span>{item.name} · {item.email}</span><code>{item.temporary_password}</code></div>)}<button className="text-button" onClick={() => setImportCredentials(null)}>Dismiss credentials</button></div>}
            </motion.div>
          )}
        </AnimatePresence>
      </Card>

      <div className="content-grid">
        <Card title="Departments">
          {departmentError && <Notice type="error">{departmentError}</Notice>}
          <DataTable columns={['Department', 'Employees']} rows={departments} keys={['name', 'employee_count']} empty="No departments yet." />
          <form className="inline-form" onSubmit={async (event) => { event.preventDefault(); const result = await submit((body) => api('/hr/departments', request('POST', body)), { name: departmentName }); if (result) { setDepartmentName(''); try { const next = await api('/hr/departments'); setDepartments(next); setDepartmentError(''); reload(); } catch (error) { setDepartmentError(error.message); } } }}>
            <input placeholder="New department name" aria-label="New department name" value={departmentName} onChange={(e) => setDepartmentName(e.target.value)} required />
            <button className="button button-secondary" disabled={busy}>Add</button>
          </form>
        </Card>
        {user.role === 'admin' && (
          <Card title="Create HR login" subtitle="HR users can manage employees, attendance, leave and payroll drafts.">
            <form className="stack-form" onSubmit={async (event) => { event.preventDefault(); const result = await submit((body) => api('/admin/hr-users', request('POST', body)), hrForm); if (result) setHrForm({ name: '', email: '', password: '' }); }}>
              <input placeholder="HR full name" aria-label="HR full name" required value={hrForm.name} onChange={(e) => setHrForm({ ...hrForm, name: e.target.value })} />
              <input type="email" placeholder="HR email" aria-label="HR email" required value={hrForm.email} onChange={(e) => setHrForm({ ...hrForm, email: e.target.value })} />
              <input type="password" placeholder="Temporary password (8+)" aria-label="Temporary password" minLength={8} required value={hrForm.password} onChange={(e) => setHrForm({ ...hrForm, password: e.target.value })} />
              <button className="button button-secondary" disabled={busy}>Create HR account</button>
            </form>
          </Card>
        )}
      </div>

      <Modal open={showForm} title="Register an employee" subtitle="Creates the employee’s login with a temporary password." onClose={() => setShowForm(false)} wide>
        <form className="form-grid" onSubmit={saveEmployee}>
          <label>Full name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>Email<input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          <label>Temporary password<input type="password" minLength={8} required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
          <label>Department<select value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })}><option value="">No department</option>{departments.map((d) => <option value={d.id} key={d.id}>{d.name}</option>)}</select></label>
          <label>Designation<input value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} /></label>
          <label>Employee code<input value={form.employee_code} onChange={(e) => setForm({ ...form, employee_code: e.target.value })} /></label>
          <label>Monthly basic salary<input type="number" min="1" required value={form.base_salary} onChange={(e) => setForm({ ...form, base_salary: e.target.value })} /></label>
          <div className="form-actions"><button type="button" className="button button-quiet" onClick={() => setShowForm(false)}>Cancel</button><button className="button button-primary" disabled={busy}>Create employee login</button></div>
        </form>
      </Modal>

      <Modal open={Boolean(editing)} title={editing ? `Edit ${editing.name}` : 'Edit employee'} onClose={() => setEditing(null)} wide>
        {editing && (
          <form className="form-grid" onSubmit={saveEdit}>
            <label>Full name<input required value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></label>
            <label>Email<input type="email" required value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })} /></label>
            <label>Employee code<input required value={editing.employee_code} onChange={(e) => setEditing({ ...editing, employee_code: e.target.value })} /></label>
            <label>Department<select value={editing.department_id || ''} onChange={(e) => setEditing({ ...editing, department_id: e.target.value })}><option value="">No department</option>{departments.map((d) => <option value={d.id} key={d.id}>{d.name}</option>)}</select></label>
            <label>Designation<input value={editing.designation || ''} onChange={(e) => setEditing({ ...editing, designation: e.target.value })} /></label>
            <label>Basic salary<input type="number" min="1" value={editing.base_salary} onChange={(e) => setEditing({ ...editing, base_salary: e.target.value })} required /></label>
            <div className="form-actions"><button type="button" className="button button-quiet" onClick={() => setEditing(null)}>Cancel</button><button className="button button-primary" disabled={busy}>Save changes</button></div>
          </form>
        )}
      </Modal>
    </div>
  );
}
