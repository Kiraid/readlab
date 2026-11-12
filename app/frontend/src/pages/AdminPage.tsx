import { useEffect, useState } from 'react';
import { api, type JobStatusName } from '../api';
import { Empty, JobPill, PageLoading } from '../components/ui';
import { fmt, useLoad } from '../hooks';
import { linkProps } from '../router';

const FILTERS: (JobStatusName | '')[] = ['', 'queued', 'running', 'done', 'failed', 'cancelled'];

/** Admins: the queue, the workers, spend, and every job from every user. Refreshes itself. */
export function AdminPage() {
  const [status, setStatus] = useState<JobStatusName | ''>('');
  const ov = useLoad(() => api.overview(), []);
  const jobs = useLoad(() => api.adminJobs(status || undefined), [status]);
  useEffect(() => {
    const t = setInterval(() => { ov.reload(); jobs.reload(); }, 5000);
    return () => clearInterval(t);
  }, [ov.reload, jobs.reload]); // eslint-disable-line react-hooks/exhaustive-deps

  if (ov.loading) return <PageLoading />;
  if (ov.error || !ov.data) return <Empty icon="alert" title="Couldn't load the overview" body={ov.error} />;
  const o = ov.data;
  return (
    <div>
      <header className="page-head">
        <h1>Runs & queue</h1>
        <p className="sub">Every job from every user. Readers only ever see a stage name and a progress bar.</p>
      </header>
      <div className="kpis big">
        <div><b>{o.queue.queued}</b><span>queued</span></div>
        <div><b>{o.queue.running}</b><span>running</span></div>
        <div><b>{o.workers.length}</b><span>{o.workers.length === 1 ? 'worker busy' : 'workers busy'}</span></div>
        <div><b>{o.queue.failed}</b><span>failed</span></div>
        <div><b>${o.cost_30d.toFixed(2)}</b><span>spent, 30 days</span></div>
        <div><b>{fmt.words(o.words_30d)}</b><span>words processed, 30 days</span></div>
        <div><b>{o.users}</b><span>users</span></div>
        <div><b>{o.documents}</b><span>documents</span></div>
      </div>
      <p className="muted small">Readers get {fmt.words(o.quota.words)} words per {o.quota.days} days, ${o.quota.user_budget_usd.toFixed(2)} cap per job, default models.</p>

      <div className="section-head">
        <h2 className="section-title">Jobs</h2>
        <div className="seg small" role="radiogroup" aria-label="Status">
          {FILTERS.map((f) => <button key={f || 'all'} role="radio" aria-checked={status === f} className={status === f ? 'on' : ''} onClick={() => setStatus(f)}>{f || 'all'}</button>)}
        </div>
      </div>
      <div className="table-wrap">
        <table className="tbl clickable">
          <thead><tr><th>status</th><th>chapter</th><th>user</th><th>queued</th><th>words</th><th>cost</th><th>worker</th></tr></thead>
          <tbody>
            {(jobs.data ?? []).map((j) => (
              <tr key={j.id}>
                <td><a {...linkProps(`/jobs/${j.id}`)} className="row-link"><JobPill job={j} /></a></td>
                <td><a {...linkProps(`/jobs/${j.id}`)}><b>{j.chapter.number}</b> {j.chapter.title}<br /><span className="faint small">{j.document.title}</span></a></td>
                <td className="small">{j.owner_email}</td>
                <td className="small">{fmt.ago(j.queued_at)}</td>
                <td className="mono">{fmt.words(j.admin?.words ?? 0)}</td>
                <td className="mono">{j.admin ? `$${j.admin.cost_usd.toFixed(4)}` : ''}{j.admin?.dry_run && <span className="tag">dry</span>}</td>
                <td className="mono faint">{j.admin?.worker?.split(':')[0] ?? ''}</td>
              </tr>
            ))}
            {jobs.data?.length === 0 && <tr><td colSpan={7} className="muted">No jobs.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
