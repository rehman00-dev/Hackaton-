import React, { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { api, request } from '../lib/api.js';
import { Avatar, Card, DataTable, ReviewButtons, Stat, Status } from '../components/ui.jsx';
import { CalendarDays } from 'lucide-react';

export default function Leave({ data, user, submit, busy }) {
  const [form, setForm] = useState({ leaveType: '', startDate: '', endDate: '', reason: '' });
  const [smartText, setSmartText] = useState('');
  if (user.role !== 'employee') {
    const requests = Array.isArray(data) ? data[0] : [];
    return (
      <Card title="Leave approval inbox" subtitle={`${requests.filter((item) => item.status === 'pending').length} pending request(s)`}>
        <DataTable columns={['Employee', 'Type', 'Dates', 'Reason', 'Status', 'Decision']} rows={requests} keys={['name', 'leave_type']} empty="No leave requests have been submitted."
          renderRow={(row) => (
            <tr key={row.id}>
              <td><div className="person-cell"><Avatar name={row.name} /><div><strong>{row.name}</strong><small className="table-sub">{row.employee_code || row.email}</small></div></div></td>
              <td>{row.leave_type}</td>
              <td className="nowrap">{row.start_date} – {row.end_date}</td>
              <td>{row.reason || '—'}</td>
              <td><Status value={row.status} /></td>
              <td>{row.status === 'pending' ? <ReviewButtons onReview={(decision, comment) => submit((body) => api(`/hr/leave/${row.id}/review`, request('POST', body)), { decision, comment })} /> : row.reviewer_comment || '—'}</td>
            </tr>
          )} />
      </Card>
    );
  }
  const requests = data?.requests || [];
  const balances = data?.balances || [];
  return (
    <div className="page-stack">
      <div className="stats-grid">
        {balances.map((item, index) => <Stat key={item.id} icon={CalendarDays} tone={['violet', 'cyan', 'emerald', 'amber'][index % 4]} title={`${item.name} balance`} value={item.remaining === null ? 'Unlimited' : `${item.remaining} days`} hint={`${item.used} used of ${item.annual_quota ?? 'unlimited'}`} progress={item.annual_quota ? Math.min(1, (item.remaining ?? 0) / item.annual_quota) : undefined} />)}
      </div>
      <div className="content-grid">
        <Card title="Request time off">
          <form className="smart-form" onSubmit={async (event) => { event.preventDefault(); const result = await submit((body) => api('/ai/smart-leave', request('POST', body)), { prompt: smartText }); if (result?.draft) setForm(result.draft); }}>
            <label>Describe your leave in plain words<input value={smartText} onChange={(e) => setSmartText(e.target.value)} placeholder="Need next Monday and Tuesday off for a wedding" maxLength={500} /></label>
            <button className="button button-secondary" disabled={busy || !smartText.trim()}><Sparkles size={15} aria-hidden="true" />Draft with AI</button>
            <small className="hint">AI fills the form only. Review and submit it yourself.</small>
          </form>
          <form className="stack-form" onSubmit={(event) => { event.preventDefault(); submit((body) => api('/employee/leave', request('POST', body)), form, 'Leave request submitted'); }}>
            <label>Leave type<select required value={form.leaveType} onChange={(e) => setForm({ ...form, leaveType: e.target.value })}><option value="">Choose type</option>{balances.map((item) => <option key={item.id} value={item.name}>{item.name}{item.remaining !== null ? ` · ${item.remaining} left` : ''}</option>)}</select></label>
            <div className="split-fields">
              <label>From<input type="date" required value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} /></label>
              <label>To<input type="date" min={form.startDate} required value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} /></label>
            </div>
            <label>Reason<textarea required value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Share a short reason" /></label>
            <button className="button button-primary" disabled={busy}>Submit request</button>
          </form>
          <p className="hint">Working days exclude configured weekends and holidays. Requests are reviewed by HR.</p>
        </Card>
        <Card title="My leave requests">
          <DataTable columns={['Type', 'Dates', 'Status', 'Comment']} rows={requests} keys={['leave_type', 'start_date']} empty="No leave requests yet."
            renderRow={(row) => <tr key={row.id}><td>{row.leave_type}</td><td className="nowrap">{row.start_date} – {row.end_date}</td><td><Status value={row.status} /></td><td>{row.reviewer_comment || '—'}{row.status === 'pending' && <button className="text-button" onClick={() => submit(() => api(`/employee/leave/${row.id}/cancel`, { method: 'POST' }), null, 'Request cancelled')}>Cancel</button>}</td></tr>} />
        </Card>
      </div>
    </div>
  );
}
