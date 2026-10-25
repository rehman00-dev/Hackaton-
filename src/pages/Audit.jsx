import React from 'react';
import { Card, DataTable } from '../components/ui.jsx';

export default function Audit({ data }) {
  return (
    <Card title="Recent audit activity" subtitle="Important account and HR actions are recorded here.">
      <DataTable columns={['Time', 'Actor', 'Action', 'Entity', 'Details']} rows={data || []} keys={['created_at', 'actor_name', 'action', 'entity']} empty="No audit events recorded yet."
        renderRow={(row) => <tr key={row.id}><td className="nowrap">{new Date(`${row.created_at}Z`).toLocaleString()}</td><td>{row.actor_name || 'System'}</td><td><code className="chip-code">{row.action}</code></td><td>{row.entity || '—'}</td><td><code className="detail-code">{row.details || '—'}</code></td></tr>} />
    </Card>
  );
}
