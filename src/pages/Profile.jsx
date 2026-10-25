import React, { useEffect, useState } from 'react';
import { Briefcase, Building2, CalendarDays, Mail } from 'lucide-react';
import { api, request } from '../lib/api.js';
import { Avatar, Card, EmptyState } from '../components/ui.jsx';

export default function Profile({ data, submit, busy }) {
  const [form, setForm] = useState(null);
  useEffect(() => { if (data && !form) setForm({ phone: data.phone || '', address: data.address || '' }); }, [data, form]);
  if (!data || !form) return <EmptyState title="Loading your profile" />;
  return (
    <Card title="Personal details">
      <div className="profile-summary">
        <Avatar name={data.name} size="xl" />
        <div>
          <h2>{data.name}</h2>
          <p className="profile-meta"><Briefcase size={14} aria-hidden="true" />{data.employee_code || 'Employee'} · {data.designation || 'Team member'}</p>
          <p className="profile-meta"><Building2 size={14} aria-hidden="true" />{data.department_name || 'No department'}</p>
          <p className="profile-meta"><CalendarDays size={14} aria-hidden="true" />Joined {data.join_date || '—'}</p>
          <p className="profile-meta"><Mail size={14} aria-hidden="true" />{data.email}</p>
        </div>
      </div>
      <form className="form-grid" onSubmit={(event) => { event.preventDefault(); submit((body) => api('/employee/profile', request('PATCH', body)), form); }}>
        <label>Phone<input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
        <label>Address<input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></label>
        <div className="form-actions"><button className="button button-primary" disabled={busy}>Save profile</button></div>
      </form>
    </Card>
  );
}
