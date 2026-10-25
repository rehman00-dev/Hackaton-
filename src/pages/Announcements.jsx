import React, { useState } from 'react';
import { api, request } from '../lib/api.js';
import { Card } from '../components/ui.jsx';
import { AnnouncementList } from '../components/AnnouncementList.jsx';

export default function Announcements({ data, user, submit, busy }) {
  const [form, setForm] = useState({ title: '', message: '' });
  const canPost = user.role !== 'employee';
  return (
    <div className="page-stack">
      {canPost && (
        <Card title="Post an announcement">
          <form className="form-grid" onSubmit={(event) => { event.preventDefault(); const result = submit((body) => api(user.role === 'admin' ? '/admin/announcements' : '/hr/announcements', request('POST', body)), form); result.then((saved) => { if (saved) setForm({ title: '', message: '' }); }); }}>
            <label>Title<input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
            <label className="span-two">Message<textarea required value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></label>
            <div className="form-actions"><button className="button button-primary" disabled={busy}>Publish</button></div>
          </form>
        </Card>
      )}
      <Card title="Latest announcements"><AnnouncementList rows={data} /></Card>
    </div>
  );
}
