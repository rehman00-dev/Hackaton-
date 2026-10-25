import React from 'react';
import { Megaphone } from 'lucide-react';
import { EmptyState } from './ui.jsx';

export function AnnouncementList({ rows }) {
  if (!rows?.length) return <EmptyState title="No announcements" description="Company announcements will show here when posted." />;
  return (
    <div className="announcement-list">
      {rows.map((item) => (
        <article className="announcement-item" key={item.id}>
          <span className="announcement-icon"><Megaphone size={16} aria-hidden="true" /></span>
          <div>
            <span className="eyebrow">{item.author || 'Company'} · {new Date(item.created_at).toLocaleDateString()}</span>
            <h3>{item.title}</h3>
            <p>{item.message}</p>
          </div>
        </article>
      ))}
    </div>
  );
}
