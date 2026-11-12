import { useEffect, useState } from 'react';
import { api, type JobEvent, type JobState, type Run, type SectionDetail } from '../api';
import { useAuth } from '../auth';
import { Icon } from '../components/Icon';
import { Bar, Crumbs, Empty, JobPill, PageLoading, Spinner, toast } from '../components/ui';
import { fmt, useJobStream, useLoad } from '../hooks';
import { linkProps } from '../router';

// ---------------------------------------------------------------- your jobs

export function ActivityPage() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useLoad(() => api.jobs(), []);
  if (loading) return <PageLoading />;
  if (error) return <Empty icon="alert" title="Couldn't load your activity" body={error} />;
  return (
    <div>
      <header className="page-head">
        <h1>Activity</h1>
        <p className="sub">Chapters and articles you've asked for, newest first.</p>
      </header>
      {!data?.length ? (
        <Empty icon="activity" title="Nothing generated yet" body="Open a book and pick a chapter to generate."
          action={<a className="btn" {...linkProps('/books')}>Your books</a>} />
      ) : (
        <ul className="jobs">{data.map((j) => <JobRow key={j.id} job={j} admin={!!user?.is_admin} onChange={reload} />)}</ul>
      )}
    </div>
  );
}

function JobRow({ job, admin, onChange }: { job: JobState; admin: boolean; onChange: () => void }) {
  const live = job.status === 'queued' || job.status === 'running';
  const { state } = useJobStream(live ? job.id : null, onChange);
  const j = state ?? job;
  return (
    <li>
      <a className="job-row" {...linkProps(`/jobs/${j.id}`)}>
        <span className="jr-main">
          <span className="jr-title">{j.chapter.number && <b>{j.chapter.number}</b>}{j.chapter.title}</span>
          <span className="jr-doc">{j.document.title} · {fmt.ago(j.queued_at)}{admin && j.admin && ` · $${j.admin.cost_usd.toFixed(4)}`}</span>
        </span>
        <span className="jr-side">
          <span className="jr-status"><JobPill job={j} />{live && j.detail && <small>{j.detail}</small>}</span>
          {live && <Bar value={j.status === 'queued' ? null : j.progress} label="Progress" />}
        </span>
      </a>
    </li>
  );
}

// ---------------------------------------------------------------- one job

const STEPS: [string, string][] = [
  ['queued', 'Queued'], ['ingest', 'Ingesting'], ['digest', 'Reading closely'], ['plan', 'Planning'],
  ['write', 'Writing'], ['judge', 'Judging'], ['build', 'Building pages'], ['done', 'Ready'],
];
const ORDER = STEPS.map(([s]) => s);
const stepIndex = (stage: string) => {
  if (stage === 'starting') return 1;
  if (stage === 'correct') return ORDER.indexOf('judge');
  return Math.max(0, ORDER.indexOf(stage));
};

export function JobPage({ id }: { id: string }) {
  const { user } = useAuth();
  const { data, loading, error, reload } = useLoad(() => api.job(id), [id]);
  const live = !!data && (data.status === 'queued' || data.status === 'running');
  const { state, log } = useJobStream(live ? id : null, () => reload());
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [live]);
  useEffect(() => {  // the admin view's run details come from the job folder; refresh them while it runs
    if (!live || !user?.is_admin) return;
    const t = setInterval(reload, 4000);
    return () => clearInterval(t);
  }, [live, user, reload]);

  if (loading) return <PageLoading />;
  if (error || !data) return <Empty icon="alert" title="Job not found" body={error} />;
  const j = { ...data, ...(state ?? {}) };
  const failed = j.status === 'failed' || j.status === 'cancelled';
  const idx = j.status === 'done' ? ORDER.length - 1 : stepIndex(j.stage);
  const started = j.started_at ? new Date(j.started_at).getTime() : null;
  const ended = j.finished_at ? new Date(j.finished_at).getTime() : now;
  const events = [...(data.events ?? []), ...log.filter((e) => !(data.events ?? []).some((x) => x.id === e.id))];

  async function act(fn: () => Promise<unknown>, msg: string) {
    try { await fn(); toast(msg); reload(); } catch (e) { toast((e as Error).message, 'err'); }
  }

  return (
    <div className="jobpage-wrap">
      <Crumbs items={[['Activity', '/activity'], [j.document.title, `/d/${j.document.id}`], [j.chapter.title, null]]} />
      <section className={`job-card s-${j.status}`}>
        <div className="job-card-head">
          <div>
            <p className="eyebrow">{j.document.title}</p>
            <h1>{j.chapter.number && <span className="num">{j.chapter.number}</span>}{j.chapter.title}</h1>
          </div>
          <JobPill job={j} />
        </div>

        {j.status === 'done' ? (
          <div className="job-done">
            <span className="big-check"><Icon name="check" size={26} /></span>
            <div><b>Ready to read</b><p>Finished {fmt.ago(j.finished_at)}{started ? ` in ${fmt.minutes(Math.max(1, Math.round((ended - started) / 60000)))}` : ''}.</p></div>
            {j.chapter.status === 'ready' && <a className="btn primary" {...linkProps(`/r/${j.chapter.id}`)}><Icon name="play" size={15} />Start reading</a>}
          </div>
        ) : failed ? (
          <div className="job-failed">
            <Icon name="alert" size={22} />
            <div><b>{j.status === 'cancelled' ? 'Cancelled' : "This one didn't make it"}</b><p>{j.error ?? 'It was cancelled before it started.'}</p></div>
            <button className="btn" onClick={() => act(() => api.retryJob(j.id), 'Queued again')}><Icon name="refresh" size={15} />Try again</button>
          </div>
        ) : (
          <>
            <div className="job-now">
              <span className="spinner" aria-hidden />
              <div>
                <b>{j.status === 'queued' ? (j.position ? `Waiting in the queue · #${j.position}` : 'Waiting in the queue') : j.label}</b>
                <p>{j.detail || (j.status === 'queued' ? 'It starts as soon as a writer is free.' : 'This takes a few minutes; you can leave this page.')}</p>
              </div>
              <span className="job-pct">{fmt.pct(j.progress)}</span>
            </div>
            <Bar value={j.status === 'queued' ? null : j.progress} label="Progress" />
            {started && <p className="muted small">Running for {fmt.minutes(Math.max(0, Math.round((ended - started) / 60000)))}</p>}
            {j.status === 'queued' && <button className="btn ghost small" onClick={() => act(() => api.cancelJob(j.id), 'Cancelled')}>Cancel</button>}
          </>
        )}

        <ol className="stepper" aria-label="Stages">
          {STEPS.map(([s, label], i) => (
            <li key={s} className={failed ? (i < idx ? 'done' : '') : i < idx || j.status === 'done' ? 'done' : i === idx ? 'now' : ''}>
              <span className="dot">{(i < idx || j.status === 'done') && !failed ? <Icon name="check" size={12} /> : null}</span>{label}
            </li>
          ))}
        </ol>
      </section>

      {user?.is_admin && <AdminRun job={j} run={data.run ?? null} events={events} />}
    </div>
  );
}

// ---------------------------------------------------------------- admin: the run itself

const NODE_ORDER = ['probe', 'digest', 'plan', 'write', 'fix', 'judge', 'correct'];
const usd = (n: number) => `$${n.toFixed(n < 0.1 ? 4 : 3)}`;
const k = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(1)}k` : String(n));

function AdminRun({ job, run, events }: { job: JobState; run: Run | null; events: JobEvent[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const a = job.admin;
  if (!run) return <section className="admin-run"><h2 className="section-title">Run details</h2><p className="muted">No run files yet.</p></section>;
  const { chunks, nodes, totals } = run;
  const passed = chunks.filter((c) => c.pass).length;
  const hit = totals.input ? Math.round((100 * totals.cache_hit) / totals.input) : 0;
  const scores = chunks.map((c) => c.judge?.overall).filter((x): x is number => typeof x === 'number');

  return (
    <section className={`admin-run${open ? ' with-panel' : ''}`}>
      <div className="admin-main">
        <h2 className="section-title">Run details <span className="tag">admin</span></h2>
        <div className="kpis">
          <div><b>{usd(totals.cost_usd)}</b><span>of {usd(run.job.budget)} cap</span></div>
          <div><b>{totals.calls}</b><span>model calls</span></div>
          <div><b>{passed}/{chunks.length || '–'}</b><span>sections pass checks</span></div>
          <div><b>{scores.length ? (scores.reduce((x, y) => x + y, 0) / scores.length).toFixed(1) : '–'}</b><span>judge avg (1–5)</span></div>
          <div><b>{hit}%</b><span>input from cache</span></div>
          <div><b>{a?.worker?.split(':')[0] ?? '–'}</b><span>worker · attempt {a?.attempts ?? 0}</span></div>
        </div>
        {a?.dry_run && <p className="tag warn">dry run: stub replies, no API calls</p>}
        {run.page?.errors?.length ? <p className="form-error">Build: {run.page.errors.length} error(s): {run.page.errors[0]}</p> : null}

        <h3 className="sub-title">Model calls by node</h3>
        <div className="table-wrap">
          <table className="tbl">
            <thead><tr><th>node</th><th>model</th><th>calls</th><th>input</th><th>cache hit</th><th>output</th><th>reasoning</th><th>cost</th><th>time</th></tr></thead>
            <tbody>
              {NODE_ORDER.filter((x) => nodes[x] || run.job.nodes[x]).map((x) => {
                const u = nodes[x];
                const cfg = run.job.nodes[x];
                return (
                  <tr key={x}>
                    <td>{x}</td>
                    <td className="mono">{cfg ? `${cfg.model}${cfg.thinking ? ' · thinking' : ''}` : ''}</td>
                    <td>{u?.calls ?? 0}</td>
                    <td>{u ? k(u.input) : ''}</td>
                    <td>{u && u.input ? `${Math.round((100 * u.cache_hit) / u.input)}%` : ''}</td>
                    <td>{u ? k(u.output) : ''}</td>
                    <td>{u && u.output ? `${Math.round((100 * u.reasoning) / u.output)}%` : ''}</td>
                    <td>{u ? usd(u.cost_usd) : ''}</td>
                    <td>{u ? `${Math.round(u.latency_s)}s` : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <h3 className="sub-title">Sections</h3>
        {chunks.length === 0 ? <p className="muted">Waiting for ingestion…</p> : (
          <div className="table-wrap">
            <table className="tbl clickable">
              <thead><tr><th>chunk</th><th>covers</th><th>words</th><th>state</th><th>fixes</th><th>checks</th><th>judge</th><th>cost</th></tr></thead>
              <tbody>
                {chunks.map((c) => (
                  <tr key={c.id} className={open === c.id ? 'sel' : ''} onClick={() => setOpen(open === c.id ? null : c.id)}>
                    <td className="mono">{c.id}</td>
                    <td><span className="mono faint">{c.sections.join(', ')}</span> {c.title}</td>
                    <td>{c.words}</td>
                    <td><span className={`badge b-${c.state}`}>{c.state}</span></td>
                    <td>{c.versions > 1 ? c.versions - 1 : c.versions === 1 ? 0 : ''}</td>
                    <td>{c.score ?? ''}</td>
                    <td>{c.judge?.overall ?? (c.judge?.error ? '!' : '')}
                      {c.judge?.corrected ? <span className="badge b-pass"> {c.judge.corrected} fixed</span> : null}
                      {c.judge?.errors_left ? <span className="badge b-fail"> {c.judge.errors_left} flagged</span> : null}</td>
                    <td>{c.cost_usd ? usd(c.cost_usd) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h3 className="sub-title">Events</h3>
        <ol className="events">
          {events.slice(-60).reverse().map((e, i) => (
            <li key={e.id ?? i} className={e.level === 'error' ? 'bad' : ''}>
              <span className="ev-t">{new Date(e.ts * 1000).toLocaleTimeString()}</span>
              <span className="ev-s">{e.stage}</span>
              {e.chunk && <span className="mono">{e.chunk}</span>}
              <span>{e.msg}</span>
            </li>
          ))}
        </ol>
      </div>
      {open && <SectionPanel jobId={job.id} chunk={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

function SectionPanel({ jobId, chunk, onClose }: { jobId: string; chunk: string; onClose: () => void }) {
  const [d, setD] = useState<SectionDetail | null>(null);
  const [tab, setTab] = useState<'section' | 'checks' | 'judge' | 'brief'>('section');
  useEffect(() => { setD(null); api.section(jobId, chunk).then(setD, () => setD(null)); }, [jobId, chunk]);
  return (
    <aside className="side">
      <header>
        <b className="mono">{chunk}</b>
        <div className="seg small">{(['section', 'checks', 'judge', 'brief'] as const).map((t) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t}</button>)}</div>
        <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button>
      </header>
      {!d ? <div className="pad"><Spinner /></div> : (
        <div className="side-body">
          {tab === 'section' && (d.markdown ? <pre className="md">{d.markdown}</pre> : <p className="muted">{d.error ? 'This section failed.' : 'Not written yet.'}</p>)}
          {tab === 'section' && d.error && <pre className="md err">{d.error}</pre>}
          {tab === 'checks' && (d.score ? (
            <>
              <p><b>{d.score.pass ? 'pass' : 'fail'}</b> · score {d.score.score} · drafts: {d.versions.join(', ')}</p>
              <ul className="w-checks">{Object.entries(d.score.must).map(([key, v]) => <li key={key} className={v ? 'pass' : 'fail'}><span className="mark">{v ? '✓' : '✗'}</span>{key}</li>)}</ul>
              <ul className="issues">{d.score.issues.map((i, n) => <li key={n} className={i.startsWith('error') || i.startsWith('build') ? 'bad' : ''}>{i}</li>)}</ul>
            </>
          ) : <p className="muted">No checks yet.</p>)}
          {tab === 'judge' && (d.judge ? (
            <>
              <table className="tbl"><tbody>{(['faithful', 'clear', 'visual', 'interactive', 'polish', 'overall'] as const).map((key) => (
                <tr key={key}><td>{key}</td><td><b>{d.judge?.[key] ?? '–'}</b></td><td className="muted">{d.judge?.reasons?.[key] ?? ''}</td></tr>
              ))}</tbody></table>
              {d.judge.top_fix && <p><b>Top fix:</b> {d.judge.top_fix}</p>}
              {!!d.judge.errors?.length && <><h3>Errors still flagged</h3><ul className="issues">{d.judge.errors.map((e, n) => <li key={n} className="bad"><b>{e.where}</b>: {e.problem}</li>)}</ul></>}
              {d.judge.correction && (
                <>
                  <h3>Correction</h3>
                  <p className="muted">
                    {d.judge.correction.applied && !d.judge.correction.reverted
                      ? `The first judge found ${d.judge.correction.errors} error(s); they were corrected and the section judged again (overall was ${d.judge.correction.before?.overall ?? '–'}).`
                      : `The first judge found ${d.judge.correction.errors} error(s); not corrected: ${d.judge.correction.note ?? ''}`}
                  </p>
                </>
              )}
              {d.judge.error && <p className="form-error">{d.judge.error}</p>}
            </>
          ) : <p className="muted">Not judged yet.</p>)}
          {tab === 'brief' && (
            <>
              <h3>Planner brief</h3>
              <pre className="md">{d.plan ? JSON.stringify(d.plan, null, 2) : 'No plan yet.'}</pre>
              <h3>Digest</h3>
              <pre className="md">{d.digest ? JSON.stringify(d.digest, null, 2) : 'No digest yet.'}</pre>
            </>
          )}
        </div>
      )}
    </aside>
  );
}
