import React, { useEffect, useState } from 'react';
import { api, request } from '../lib/api.js';
import { Card, DataTable, EmptyState } from '../components/ui.jsx';

export default function Settings({ data, submit, busy }) {
  const company = data?.company || {};
  const [form, setForm] = useState(null);
  const [leaveType, setLeaveType] = useState({ name: '', annualQuota: '', paid: true });
  const [holiday, setHoliday] = useState({ name: '', date: '' });
  useEffect(() => { if (data?.company && !form) setForm({ name: company.name || '', officeHours: company.office_hours || '09:00-17:00', graceMinutes: company.grace_minutes ?? 15, weekend: company.weekend || 'SAT-SUN', officeLocation: company.office_location || '', officeRadiusMeters: company.office_radius_meters || 150, officeLatitude: company.office_latitude ?? '', officeLongitude: company.office_longitude ?? '' }); }, [company, data, form]);
  if (!form) return <EmptyState title="Loading company settings" />;
  return (
    <div className="page-stack">
      <Card title="Company & attendance rules">
        <form className="form-grid" onSubmit={(event) => { event.preventDefault(); submit((body) => api('/admin/company', request('PUT', body)), form); }}>
          <label>Company name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>Office hours<input value={form.officeHours} onChange={(e) => setForm({ ...form, officeHours: e.target.value })} placeholder="09:00-17:00" /></label>
          <label>Late grace period (minutes)<input type="number" min="0" max="240" value={form.graceMinutes} onChange={(e) => setForm({ ...form, graceMinutes: e.target.value })} /></label>
          <label>Weekend<select value={form.weekend} onChange={(e) => setForm({ ...form, weekend: e.target.value })}><option>SAT-SUN</option><option>FRI-SAT</option><option>SUN</option></select></label>
          <label>Office address<input value={form.officeLocation} onChange={(e) => setForm({ ...form, officeLocation: e.target.value })} /></label>
          <label>Geofence radius (meters)<input type="number" min="1" value={form.officeRadiusMeters} onChange={(e) => setForm({ ...form, officeRadiusMeters: e.target.value })} /></label>
          <label>Office latitude<input type="number" step="any" value={form.officeLatitude} onChange={(e) => setForm({ ...form, officeLatitude: e.target.value })} /></label>
          <label>Office longitude<input type="number" step="any" value={form.officeLongitude} onChange={(e) => setForm({ ...form, officeLongitude: e.target.value })} /></label>
          <div className="form-actions"><button className="button button-primary" disabled={busy}>Save settings</button></div>
        </form>
        <p className="hint">Set both office coordinates to enforce location-based check-in. Leave them blank to disable geofencing.</p>
      </Card>
      <div className="content-grid">
        <Card title="Leave types"><DataTable columns={['Type', 'Annual quota', 'Paid']} rows={data.leaveTypes || []} keys={['name', 'annual_quota', 'paid']} empty="No leave types configured." /></Card>
        <Card title="Add leave type">
          <form className="stack-form" onSubmit={(event) => { event.preventDefault(); submit((body) => api('/admin/leave-types', request('POST', body)), { ...leaveType, annualQuota: leaveType.annualQuota === '' ? null : Number(leaveType.annualQuota) }); }}>
            <label>Name<input required value={leaveType.name} onChange={(e) => setLeaveType({ ...leaveType, name: e.target.value })} /></label>
            <label>Quota per year (blank = unlimited)<input type="number" min="0" value={leaveType.annualQuota} onChange={(e) => setLeaveType({ ...leaveType, annualQuota: e.target.value })} /></label>
            <label className="check-label"><input type="checkbox" checked={leaveType.paid} onChange={(e) => setLeaveType({ ...leaveType, paid: e.target.checked })} /> Paid leave</label>
            <button className="button button-secondary" disabled={busy}>Add leave type</button>
          </form>
        </Card>
        <Card title="Public holidays">
          <DataTable columns={['Holiday', 'Date', 'Action']} rows={data.holidays || []} keys={['name', 'date']} empty="No holidays added."
            renderRow={(row) => <tr key={row.id}><td>{row.name}</td><td className="nowrap">{row.date}</td><td><button className="text-button" onClick={() => submit(() => api(`/admin/holidays/${row.id}`, { method: 'DELETE' }), null, 'Holiday removed')}>Remove</button></td></tr>} />
        </Card>
        <Card title="Add public holiday">
          <form className="stack-form" onSubmit={(event) => { event.preventDefault(); const result = submit((body) => api('/admin/holidays', request('POST', body)), holiday); result.then((saved) => { if (saved) setHoliday({ name: '', date: '' }); }); }}>
            <label>Holiday name<input required value={holiday.name} onChange={(e) => setHoliday({ ...holiday, name: e.target.value })} /></label>
            <label>Date<input type="date" required value={holiday.date} onChange={(e) => setHoliday({ ...holiday, date: e.target.value })} /></label>
            <button className="button button-secondary" disabled={busy}>Add holiday</button>
          </form>
        </Card>
      </div>
    </div>
  );
}
