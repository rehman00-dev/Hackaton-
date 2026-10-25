import React from 'react';
import { api } from '../lib/api.js';
import { Card, DataTable } from '../components/ui.jsx';

export default function Notifications({ data, submit }) {
  return (
    <Card title="Your notifications">
      <DataTable columns={['Notification', 'Date', 'Read']} rows={data || []} keys={['title', 'created_at']} empty="You’re all caught up."
        renderRow={(row) => <tr key={row.id} className={row.read_at ? '' : 'row-unread'}><td><strong>{row.title}</strong><small className="table-sub">{row.message}</small></td><td className="nowrap">{new Date(`${row.created_at}Z`).toLocaleString()}</td><td>{row.read_at ? 'Read' : <button className="text-button" onClick={() => submit(() => api(`/employee/notifications/${row.id}/read`, { method: 'POST' }), null, 'Marked as read')}>Mark read</button>}</td></tr>} />
    </Card>
  );
}
