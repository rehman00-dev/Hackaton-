import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { Activity, AlertTriangle, Check, Inbox, X } from 'lucide-react';
import { useTilt } from '../lib/hooks';

export function Card({ title, subtitle, actions, children, className = '', reveal = true }) {
  return (
    <section className={`card ${className}`} data-reveal={reveal ? '' : undefined}>
      {(title || actions) && (
        <div className="card-heading">
          <div>{title && <h2>{title}</h2>}{subtitle && <p className="muted">{subtitle}</p>}</div>
          {actions && <div className="card-actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** KPI tile: animated count-up for real numeric values, subtle 3D tilt + spotlight on hover. */
export function Stat({ title, value, hint, icon: Icon, tone = 'violet', progress }) {
  const reduceMotion = useReducedMotion();
  const tilt = useTilt(5);
  const numericValue = typeof value === 'number' || /^\d+$/.test(String(value)) ? Number(value) : null;
  const count = useMotionValue(numericValue ?? 0);
  const countLabel = useTransform(count, (current) => Math.round(current).toLocaleString());
  useEffect(() => {
    if (numericValue === null) return undefined;
    if (reduceMotion) {
      count.set(numericValue);
      return undefined;
    }
    count.set(0);
    const controls = animate(count, numericValue, { duration: 0.9, delay: 0.15, ease: [0.16, 1, 0.3, 1] });
    return () => controls.stop();
  }, [count, numericValue, reduceMotion]);
  return (
    <article ref={tilt} className={`stat-card tone-${tone}`} data-reveal>
      <div className="stat-top">
        <span className="eyebrow">{title}</span>
        {Icon && <span className="stat-icon"><Icon size={16} strokeWidth={1.9} aria-hidden="true" /></span>}
      </div>
      {numericValue === null || reduceMotion ? <strong className="stat-value">{numericValue === null ? value : numericValue.toLocaleString()}</strong> : <motion.strong className="stat-value">{countLabel}</motion.strong>}
      <small>{hint}</small>
      {typeof progress === 'number' && (
        <div className="stat-progress" role="presentation"><motion.i initial={reduceMotion ? false : { scaleX: 0 }} animate={{ scaleX: Math.max(0, Math.min(1, progress)) }} transition={{ duration: reduceMotion ? 0 : 1, delay: 0.25, ease: [0.16, 1, 0.3, 1] }} /></div>
      )}
      <span className="stat-glow" aria-hidden="true" />
    </article>
  );
}

export function DataTable({ columns, rows, keys, empty, renderRow }) {
  if (!rows?.length) return <EmptyState title={empty || 'No records to show.'} />;
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>{columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr></thead>
        <tbody>{renderRow ? rows.map(renderRow) : rows.map((row, index) => <tr key={row.id || index}>{keys.map((key) => <td key={key}>{key === 'status' ? <Status value={row[key]} /> : row[key] ?? '—'}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export function Status({ value }) {
  return <span className={`status status-${String(value || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>{String(value || 'unknown').replaceAll('_', ' ')}</span>;
}

export function EmptyState({ title, description }) {
  return (
    <div className="empty-state">
      <span><Inbox size={20} aria-hidden="true" /></span>
      <strong>{title}</strong>
      {description && <p>{description}</p>}
    </div>
  );
}

export function PageLoading({ title }) {
  return (
    <div className="page-loading" role="status" aria-live="polite">
      <span className="sr-only">Loading {title.toLowerCase()}…</span>
      <div className="skeleton-row" aria-hidden="true"><i className="skeleton" /><i className="skeleton" /><i className="skeleton" /><i className="skeleton" /></div>
      <div className="skeleton-block" aria-hidden="true"><i className="skeleton" style={{ width: '34%', height: 16 }} /><i className="skeleton" style={{ height: 180 }} /></div>
      <div className="skeleton-block" aria-hidden="true"><i className="skeleton" style={{ width: '22%', height: 16 }} /><i className="skeleton" style={{ height: 120 }} /></div>
    </div>
  );
}

export function LoadError({ message, onRetry }) {
  return (
    <section className="load-error" role="alert">
      <span className="load-error-icon"><AlertTriangle size={22} aria-hidden="true" /></span>
      <h2>We couldn’t load this page</h2>
      <p>{message}</p>
      <button className="button button-primary" onClick={onRetry}>Try again</button>
    </section>
  );
}

export function Notice({ type = 'info', children, onDismiss, className = '' }) {
  return (
    <div className={`notice ${type} ${className}`} role={type === 'error' ? 'alert' : 'status'}>
      <span className="notice-icon">{type === 'success' ? <Check size={15} aria-hidden="true" /> : <Activity size={15} aria-hidden="true" />}</span>
      <span className="notice-text">{children}</span>
      {onDismiss && <button type="button" onClick={onDismiss} aria-label="Dismiss"><X size={14} aria-hidden="true" /></button>}
    </div>
  );
}

/** Accessible dialog: Escape closes, focus moves in and is restored, body scroll is locked. */
export function Modal({ open, title, subtitle, onClose, children, wide = false }) {
  const reduceMotion = useReducedMotion();
  const panel = useRef(null);
  const previous = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    previous.current = document.activeElement;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = window.setTimeout(() => {
      const target = panel.current?.querySelector('input, select, textarea, button:not(.modal-close)');
      (target || panel.current)?.focus();
    }, 60);
    const onKey = (event) => {
      if (event.key === 'Escape') { event.stopPropagation(); closeRef.current(); }
      if (event.key === 'Tab' && panel.current) {
        const focusable = [...panel.current.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = original;
      previous.current?.focus?.();
    };
  }, [open]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="modal-backdrop" initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={reduceMotion ? undefined : { opacity: 0 }} transition={{ duration: 0.18 }} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
          <motion.div ref={panel} className={`modal-panel ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}
            initial={reduceMotion ? false : { opacity: 0, y: 24, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={reduceMotion ? undefined : { opacity: 0, y: 12, scale: 0.98 }} transition={{ type: 'spring', stiffness: 380, damping: 32 }}>
            <div className="modal-head">
              <div><h2>{title}</h2>{subtitle && <p className="muted">{subtitle}</p>}</div>
              <button type="button" className="modal-close icon-button" onClick={onClose} aria-label="Close dialog"><X size={16} aria-hidden="true" /></button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function ReviewButtons({ onReview }) {
  const [comment, setComment] = useState('');
  return (
    <div className="review-actions">
      <input aria-label="Reviewer comment" placeholder="Optional comment" value={comment} onChange={(e) => setComment(e.target.value)} />
      <button className="button button-secondary button-small" onClick={() => onReview('approved', comment)}>Approve</button>
      <button className="button button-danger button-small" onClick={() => onReview('rejected', comment)}>Reject</button>
    </div>
  );
}

export function Avatar({ name, size = 'md' }) {
  const text = (name || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('');
  return <span className={`avatar avatar-${size}`} aria-hidden="true">{text}</span>;
}
