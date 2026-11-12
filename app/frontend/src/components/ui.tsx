import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type { Doc, JobBrief, JobState } from '../api';
import { linkProps } from '../router';
import { Icon } from './Icon';

export function Empty({ icon = 'book', title, body, action }: { icon?: string; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon"><Icon name={icon} size={26} /></span>
      <h2>{title}</h2>
      {body && <p>{body}</p>}
      {action}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <span className="spinner" role="status" aria-label={label} />;
}

export function PageLoading() {
  return (
    <div className="page-loading" aria-busy="true" aria-label="Loading">
      <div className="sk sk-title" />
      <div className="sk sk-line" />
      <div className="sk-grid">{Array.from({ length: 6 }, (_, i) => <div key={i} className="sk sk-card" />)}</div>
    </div>
  );
}

export function Bar({ value, label, tone }: { value: number | null; label: string; tone?: 'ok' | 'warn' }) {
  return <progress className={`bar${tone ? ` bar-${tone}` : ''}`} max={1} value={value ?? undefined} aria-label={label} />;
}

/** A book's cover: the PDF's first page when there is one, else a typeset stand-in in the book's colour. */
export function Cover({ doc, size = 'md' }: { doc: Pick<Doc, 'title' | 'authors' | 'accent' | 'cover' | 'kind'>; size?: 'sm' | 'md' | 'lg' }) {
  const [failed, setFailed] = useState(false);
  const style = { '--accent': doc.accent } as CSSProperties;
  if (doc.cover && !failed) {
    return (
      <div className={`cover cover-${size} has-img`} style={style}>
        <img src={doc.cover} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
      </div>
    );
  }
  return (
    <div className={`cover cover-${size}`} style={style} aria-hidden>
      <div className="cover-lines"><i /><i /><i /></div>
      <div className="cover-title">{doc.title}</div>
      {doc.authors.length > 0 && <div className="cover-foot">{doc.authors.slice(0, 2).join(' · ')}</div>}
    </div>
  );
}

const STATUS_TEXT: Record<string, string> = { queued: 'Queued', running: 'Generating', done: 'Ready', failed: 'Failed', cancelled: 'Cancelled' };

export function JobPill({ job }: { job: Pick<JobBrief | JobState, 'status' | 'label' | 'position'> }) {
  const text = job.status === 'running' ? job.label : job.status === 'queued' && job.position ? `Queued · #${job.position}` : STATUS_TEXT[job.status];
  return <span className={`pill pill-${job.status}`}>{job.status === 'running' && <span className="pulse" />}{text}</span>;
}

export function Crumbs({ items }: { items: [string, string | null][] }) {
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      <ol>
        {items.map(([label, to], i) => (
          <li key={i}>{to ? <a {...linkProps(to)}>{label}</a> : <span aria-current="page">{label}</span>}</li>
        ))}
      </ol>
    </nav>
  );
}

// Toasts: toast('Queued') from anywhere; <Toasts /> renders them.
const TOAST = 'readlab:toast';
export function toast(msg: string, tone: 'ok' | 'err' = 'ok') {
  window.dispatchEvent(new CustomEvent(TOAST, { detail: { msg, tone } }));
}
export function Toasts() {
  const [items, setItems] = useState<{ id: number; msg: string; tone: string }[]>([]);
  useEffect(() => {
    const on = (e: Event) => {
      const { msg, tone } = (e as CustomEvent).detail;
      const id = Date.now() + Math.random();
      setItems((x) => [...x, { id, msg, tone }]);
      setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 4200);
    };
    window.addEventListener(TOAST, on);
    return () => window.removeEventListener(TOAST, on);
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => <div key={t.id} className={`toast toast-${t.tone}`}><Icon name={t.tone === 'err' ? 'alert' : 'check'} size={16} />{t.msg}</div>)}
    </div>
  );
}
