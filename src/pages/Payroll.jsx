import React, { useState } from 'react';
import { Printer } from 'lucide-react';
import { api, localDateString, request } from '../lib/api.js';
import { escapeHtml, money } from '../lib/format.js';
import { Card, DataTable, Status } from '../components/ui.jsx';

export default function Payroll({ data, user, submit, busy }) {
  const [month, setMonth] = useState(localDateString().slice(0, 7));
  const rows = data || [];
  const isEmployee = user.role === 'employee';
  function downloadPayslip(row) {
    const win = window.open('', '_blank', 'width=760,height=850');
    if (!win) return;
    win.document.write(`<html><head><title>Payslip ${row.month}</title><style>body{font:16px Arial;padding:48px;color:#18332b}h1{margin-bottom:4px}.line{display:flex;justify-content:space-between;border-bottom:1px solid #ddd;padding:12px 0}.total{font-weight:bold;font-size:20px;margin-top:16px}</style></head><body><h1>HCM Lite</h1><p>Employee payslip · ${row.month}</p><div class=\"line\"><span>Employee</span><strong>${escapeHtml(row.name || user.name)}</strong></div><div class=\"line\"><span>Gross salary</span><strong>${money(row.gross_salary)}</strong></div><div class=\"line\"><span>Tax</span><strong>${money(row.tax)}</strong></div><div class=\"line total\"><span>Net pay</span><strong>${money(row.net_salary)}</strong></div><p style=\"margin-top:40px;color:#697971\">Confidential · Generated from HCM Lite payroll records</p><script>window.print()</script></body></html>`);
    win.document.close();
  }
  return (
    <div className="page-stack">
      {!isEmployee && (
        <Card title="Prepare monthly payroll" subtitle="Creates a draft for every active employee. Only Admin can finalize the month."
          actions={<div className="toolbar-actions"><input className="select-input" aria-label="Payroll month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} /><button className="button button-primary" disabled={busy} onClick={() => submit((body) => api('/hr/payroll/run', request('POST', body)), { month })}>Run payroll draft</button></div>} />
      )}
      <Card title={isEmployee ? 'My payslips' : 'Payroll records'}>
        <DataTable columns={['Month', 'Employee', 'Gross', 'Tax', 'Net pay', 'Status', 'Action']} rows={rows} keys={['month', 'name']} empty="No payroll records yet."
          renderRow={(row) => (
            <tr key={row.id}>
              <td className="nowrap">{row.month}</td><td>{row.name || user.name}</td>
              <td className="num">{money(row.gross_salary)}</td><td className="num">{money(row.tax)}</td>
              <td className="num"><strong>{money(row.net_salary)}</strong></td>
              <td><Status value={row.status} /></td>
              <td>{isEmployee && row.status === 'finalized' ? <button className="text-button" onClick={() => downloadPayslip(row)}><Printer size={13} aria-hidden="true" /> Print / save PDF</button> : '—'}</td>
            </tr>
          )} />
      </Card>
      {user.role === 'admin' && rows.some((row) => row.status === 'draft') && (
        <Card title="Finalize a payroll month" subtitle="Finalization locks all draft entries for that month.">
          <div className="toolbar-actions">{[...new Set(rows.filter((row) => row.status === 'draft').map((row) => row.month))].map((draftMonth) => <button className="button button-danger" key={draftMonth} disabled={busy} onClick={() => { if (window.confirm(`Finalize and lock ${draftMonth} payroll?`)) submit(() => api(`/admin/payroll/${draftMonth}/finalize`, { method: 'POST' }), null); }}>Finalize {draftMonth}</button>)}</div>
        </Card>
      )}
    </div>
  );
}
