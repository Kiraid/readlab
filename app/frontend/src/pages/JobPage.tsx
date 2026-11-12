import { useEffect, useState } from 'react';
import { api, type JobStatus, type SectionDetail } from '../api';
import { Empty, Loading } from '../components/ui';

const STAGES = ['ingest', 'digest', 'plan', 'write', 'build', 'done'] as const;  // each section is judged in its own branch, right after it is written
const NODE_ORDER = ['digest', 'plan', 'write', 'fix', 'judge', 'correct'];
const usd = (n: number) => `$${n.toFixed(n < 0.1 ? 4 : 3)}`;
const k = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(1)}k` : String(n));

function useJob(id: string) {
  const [data, setData] = useState<JobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let timer: number | undefined;
    const tick = async () => {
      try {
        const s = await api.job(id);
        if (!live) return;
        setData(s);
        const done = ['done', 'error'].includes(s.status.stage ?? '') && !s.running;
        if (!done) timer = window.setTimeout(tick, 1500);
      } catch (e) { if (live) setError((e as Error).message); }
    };
    tick();
    return () => { live = false; window.clearTimeout(timer); };
  }, [id]);
  return { data, error };
}

export function JobPage({ jobId }: { jobId: string }) {
  const { data, error } = useJob(jobId);
  const [open, setOpen] = useState<string | null>(null);
  if (error) return <Empty title="Job not found" body={error} />;
  if (!data) return <Loading />;

  const { job, status, chunks, nodes, totals, events } = data;
  const stage = status.stage ?? 'queued';
  const n = chunks.length;
  const counts: Record<string, string> = {
    digest: `${chunks.filter((c) => c.digested).length}/${n}`,
    write: `${chunks.filter((c) => ['pass', 'fail', 'error'].includes(c.state)).length}/${n} · judged ${chunks.filter((c) => c.judge).length}`,
  };
  const passed = chunks.filter((c) => c.pass).length;
  const hit = totals.input ? Math.round((100 * totals.cache_hit) / totals.input) : 0;
  const elapsed = ((status.finished ?? Date.now() / 1000) - job.started);
  const scores = chunks.map((c) => c.judge?.overall).filter((x): x is number => typeof x === 'number');

  return (
    <div className={`jobpage${open ? ' with-panel' : ''}`}>
      <div className="job-main">
        <header className="job-head">
          <div>
            <p className="eyebrow">{job.file}</p>
            <h1>{job.chapter_title}</h1>
            {data.page?.url && (
              <p className="job-read">
                <a className="btn primary" href={data.page.url} target="_blank" rel="noreferrer">Read chapter →</a>
                <span className="muted">
                  {data.page.sections} sections on one page{data.page.errors.length ? ` · ${data.page.errors.length} build error(s): ${data.page.errors[0]}` : ''}
                </span>
              </p>
            )}
          </div>
          <div className="kpis">
            <div><b>{usd(totals.cost_usd)}</b><span>of {usd(job.budget)} cap</span></div>
            <div><b>{totals.calls}</b><span>model calls</span></div>
            <div><b>{passed}/{n || '–'}</b><span>sections pass checks</span></div>
            <div><b>{scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : '–'}</b><span>judge avg (1–5)</span></div>
            <div><b>{hit}%</b><span>input from cache</span></div>
            <div><b>{Math.round(elapsed)}s</b><span>{data.running ? 'running' : 'total'}</span></div>
          </div>
        </header>
        {status.error && <p className="err">Job failed: {status.error}</p>}

        <ol className="stages">
          {STAGES.map((s) => {
            const i = STAGES.indexOf(s), cur = STAGES.indexOf(stage as typeof STAGES[number]);
            const state = stage === 'error' ? (i <= Math.max(0, cur) ? 'done' : '') : i < cur || stage === 'done' ? 'done' : i === cur ? 'now' : '';
            return <li key={s} className={state}><span>{s === 'write' ? 'write · judge' : s}</span>{counts[s] && <em>{counts[s]}</em>}</li>;
          })}
        </ol>

        <section className="panel">
          <h2 className="list-title">Model calls by node</h2>
          <table className="tbl">
            <thead><tr><th>node</th><th>model</th><th>calls</th><th>input</th><th>cache hit</th><th>output</th><th>of which reasoning</th><th>cost</th><th>time</th></tr></thead>
            <tbody>
              {NODE_ORDER.filter((x) => nodes[x] || job.nodes[x]).map((x) => {
                const u = nodes[x];
                const cfg = job.nodes[x];
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
        </section>

        <section className="panel">
          <h2 className="list-title">Sections</h2>
          {n === 0 ? <p className="muted">Waiting for ingestion…</p> : (
            <table className="tbl clickable">
              <thead><tr><th>chunk</th><th>covers</th><th>words</th><th>state</th><th>fix rounds</th><th>checks</th><th>judge</th><th>cost</th></tr></thead>
              <tbody>
                {chunks.map((c) => (
                  <tr key={c.id} className={open === c.id ? 'sel' : ''} onClick={() => setOpen(open === c.id ? null : c.id)}>
                    <td className="mono">{c.id}</td>
                    <td><span className="cover-ids">{c.sections.join(', ')}</span> {c.title}</td>
                    <td>{c.words}</td>
                    <td><span className={`badge b-${c.state}`}>{c.state}</span></td>
                    <td>{c.versions > 1 ? c.versions - 1 : c.versions === 1 ? 0 : ''}</td>
                    <td>{c.score ?? ''}</td>
                    <td>{c.judge?.overall ?? (c.judge?.error ? '!' : '')}
                      {c.judge?.corrected ? <span className="badge b-pass" title="errors the judge found were corrected"> {c.judge.corrected} fixed</span> : null}
                      {c.judge?.errors_left ? <span className="badge b-fail" title="errors the judge still flags"> {c.judge.errors_left} flagged</span> : null}</td>
                    <td>{c.cost_usd ? usd(c.cost_usd) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="panel">
          <h2 className="list-title">Events</h2>
          <ol className="events">
            {events.slice(-40).reverse().map((e, i) => (
              <li key={i} className={e.level === 'error' ? 'bad' : ''}>
                <span className="ev-t">{new Date(e.ts * 1000).toLocaleTimeString()}</span>
                <span className="ev-s">{e.stage}</span>
                {e.chunk && <span className="mono">{e.chunk}</span>}
                <span>{e.msg}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
      {open && <SectionPanel jobId={job.id} chunk={open} onClose={() => setOpen(null)} />}
    </div>
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
        <div className="w-seg">{(['section', 'checks', 'judge', 'brief'] as const).map((t) => <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>)}</div>
        <button className="btn ghost" onClick={onClose}>close</button>
      </header>
      {!d ? <Loading /> : (
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
              {!!d.judge.errors?.length && (
                <><h3>Errors still flagged</h3><ul className="issues">{d.judge.errors.map((e, n) => <li key={n} className="bad"><b>{e.where}</b>: {e.problem}</li>)}</ul></>
              )}
              {d.judge.correction && (
                <>
                  <h3>Correction</h3>
                  <p className="muted">
                    {d.judge.correction.applied && !d.judge.correction.reverted
                      ? `The first judge found ${d.judge.correction.errors} error(s); they were corrected and the section judged again (overall was ${d.judge.correction.before?.overall ?? '–'}).`
                      : `The first judge found ${d.judge.correction.errors} error(s); not corrected: ${d.judge.correction.note ?? ''}`}
                  </p>
                  {d.judge.correction.fixed && <ul className="issues">{d.judge.correction.fixed.map((e, n) => <li key={n}><b>{e.where}</b>: {e.problem}</li>)}</ul>}
                </>
              )}
              {d.judge.error && <p className="err">{d.judge.error}</p>}
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
