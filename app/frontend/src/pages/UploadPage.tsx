import { useRef, useState } from 'react';
import { api, type ProbeQuestion, type Upload } from '../api';
import { Loading, useLoad } from '../components/ui';
import { linkProps, navigate } from '../router';

const MODELS = ['deepseek-flash', 'deepseek-v4-pro'];
type Answers = Record<string, string | string[]>;

const NOTE_KEY = 'readlab.reader.note';
const loadNote = () => { try { return localStorage.getItem(NOTE_KEY) ?? ''; } catch { return ''; } };
const saveNote = (v: string) => { try { localStorage.setItem(NOTE_KEY, v); } catch { /* private window: not remembered */ } };

/** "For you": a line about the reader (remembered in this browser) and a few questions about the chosen chapter.
 *  The answers go to the planner, which decides what to explain, refresh or skip and which wrong idea to confront. */
function ReaderProbe({ uploadId, chapter, note, setNote, qs, setQs, answers, setAnswers }: {
  uploadId: string; chapter: string; note: string; setNote: (v: string) => void;
  qs: ProbeQuestion[] | null; setQs: (q: ProbeQuestion[] | null) => void; answers: Answers; setAnswers: (a: Answers) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  async function ask() {
    setLoading(true); setErr('');
    try { setQs((await api.probe(uploadId, chapter)).questions); } catch (e) { setErr((e as Error).message); }
    setLoading(false);
  }
  const pick = (q: ProbeQuestion, o: string) => {
    if (q.kind !== 'multi') return setAnswers({ ...answers, [q.id]: o });
    const cur = Array.isArray(answers[q.id]) ? (answers[q.id] as string[]) : [];
    setAnswers({ ...answers, [q.id]: cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o] });
  };
  return (
    <div className="probe">
      <h2 className="list-title">For you <span className="muted">· optional</span></h2>
      <label className="probe-note">About you
        <input type="text" value={note} placeholder="e.g. backend engineer, knows SQL, new to distributed systems"
          onChange={(e) => { setNote(e.target.value); saveNote(e.target.value); }} />
      </label>
      {!qs && (
        <button className="btn" onClick={ask} disabled={!chapter || loading}>
          {loading ? 'Reading the chapter…' : 'Ask me a few questions about this chapter'}
        </button>
      )}
      {err && <p className="err">{err}</p>}
      {qs && (
        <ol className="probe-qs">
          {qs.map((q) => (
            <li key={q.id}>
              <p>{q.text}{q.kind === 'multi' && <span className="muted"> (pick any)</span>}</p>
              {q.kind === 'text' ? (
                <input type="text" value={(answers[q.id] as string) ?? ''} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} />
              ) : (
                <div className="probe-opts">
                  {q.options.map((o) => {
                    const on = q.kind === 'multi' ? ((answers[q.id] as string[] | undefined) ?? []).includes(o) : answers[q.id] === o;
                    return (
                      <label key={o} className={on ? 'on' : ''}>
                        <input type={q.kind === 'multi' ? 'checkbox' : 'radio'} name={`probe-${q.id}`} checked={on} onChange={() => pick(q, o)} /> {o}
                      </label>
                    );
                  })}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
      <p className="hint">Used to decide what to explain from scratch, what to refresh in a line, and which wrong idea to confront. Skip it and the page is written for a working engineer new to the topic.</p>
    </div>
  );
}

const ago = (t: number) => {
  const s = Math.round(Date.now() / 1000 - t);
  return s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
};

export function UploadPage() {
  const [up, setUp] = useState<Upload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [chapter, setChapter] = useState<string>('');
  const [writeModel, setWriteModel] = useState(MODELS[0]);
  const [planModel, setPlanModel] = useState(MODELS[0]);
  const [thinking, setThinking] = useState(true);
  const [budget, setBudget] = useState('1.00');
  const [dry, setDry] = useState(false);
  const [note, setNote] = useState(loadNote);
  const [qs, setQs] = useState<ProbeQuestion[] | null>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const choose = (sel: string) => { setChapter(sel); setQs(null); setAnswers({}); }; // questions are per chapter
  const input = useRef<HTMLInputElement>(null);
  const recent = useLoad(() => Promise.all([api.jobs(), api.uploads()]), [up?.id]);

  async function send(file: File) {
    setBusy(true); setError(null); setUp(null);
    try {
      const u = await api.sendFile(file);
      setUp(u);
      choose(u.chapters[0]?.selector ?? '');
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }

  async function start() {
    if (!up || !chapter) return;
    setBusy(true); setError(null);
    try {
      const reader = {
        note: note.trim(),
        answers: (qs ?? []).map((q) => ({ question: q.text, purpose: q.purpose, answer: answers[q.id] ?? '' }))
          .filter((a) => (Array.isArray(a.answer) ? a.answer.length : a.answer)),
      };
      const job = await api.startJob(up.id, chapter, { write_model: writeModel, plan_model: planModel, write_thinking: thinking, budget: Number(budget), dry_run: dry, reader });
      navigate(`/jobs/${job.id}`);
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }

  const chosen = up?.chapters.find((c) => c.selector === chapter);
  return (
    <>
      <section className="intro">
        <h1>Upload</h1>
        <p>Turn one chapter of a PDF into a study page. The pipeline digests it, plans it, writes and checks every section, and judges the result.</p>
      </section>

      <div
        className={`drop${drag ? ' over' : ''}${busy ? ' busy' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) send(f); }}
        onClick={() => input.current?.click()}
        role="button" tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') input.current?.click(); }}
      >
        <input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) send(f); }} />
        {busy && !up ? <span>Reading the outline…</span> : up ? (
          <span><b>{up.name}</b> · {up.pages} pages · {up.chapters.length - 1} chapters found <span className="muted">(drop another file to replace)</span></span>
        ) : (
          <span><b>Drop a PDF here</b> or click to choose one</span>
        )}
      </div>
      {error && <p className="err">{error}</p>}
      {!up && (recent.data?.[1] ?? []).length > 0 && (
        <div className="prev-uploads">
          <span className="muted">Or pick a previous upload:</span>
          {(recent.data?.[1] ?? []).slice(0, 8).map((u) => (
            <button key={u.id} className="btn" disabled={busy} onClick={async () => {
              setBusy(true); setError(null);
              try { const full = await api.upload(u.id); setUp(full); choose(full.chapters[0]?.selector ?? ''); }
              catch (e) { setError((e as Error).message); }
              setBusy(false);
            }}>{u.name.replace(/\.pdf$/i, '').replace(/\s*\([^)]*\)/g, '').slice(0, 48)} <span className="muted">· {u.pages} pp</span></button>
          ))}
        </div>
      )}

      {up && (
        <div className="setup">
          <div>
            <h2 className="list-title">Chapter</h2>
            <ul className="pick">
              {up.chapters.map((c) => (
                <li key={c.selector}>
                  <label className={c.selector === chapter ? 'on' : ''}>
                    <input type="radio" name="chapter" checked={c.selector === chapter} onChange={() => choose(c.selector)} />
                    <span className="pick-title">{c.title}</span>
                    <span className="pick-meta">pp. {c.pages[0]}–{c.pages[1]}{c.sections ? ` · ${c.sections} sections` : ''}</span>
                  </label>
                </li>
              ))}
            </ul>
            <ReaderProbe uploadId={up.id} chapter={chapter} note={note} setNote={setNote}
              qs={qs} setQs={setQs} answers={answers} setAnswers={setAnswers} />
          </div>
          <div className="opts">
            <h2 className="list-title">Run</h2>
            <label>Writer model
              <select value={writeModel} onChange={(e) => setWriteModel(e.target.value)} disabled={dry}>{MODELS.map((m) => <option key={m}>{m}</option>)}</select>
            </label>
            <label className="check"><input type="checkbox" checked={thinking} onChange={(e) => setThinking(e.target.checked)} disabled={dry} /> writer thinks first</label>
            <label>Planner model
              <select value={planModel} onChange={(e) => setPlanModel(e.target.value)} disabled={dry}>{MODELS.map((m) => <option key={m}>{m}</option>)}</select>
            </label>
            <label>Budget cap (USD)
              <input type="number" min="0.05" step="0.05" value={budget} onChange={(e) => setBudget(e.target.value)} disabled={dry} />
            </label>
            <label className="check"><input type="checkbox" checked={dry} onChange={(e) => setDry(e.target.checked)} /> dry run (stub replies, no API calls)</label>
            <button className="btn primary" disabled={busy || !chapter} onClick={start}>
              {busy ? 'Starting…' : `Run ${chosen ? `"${chosen.title.slice(0, 32)}${chosen.title.length > 32 ? '…' : ''}"` : ''}`}
            </button>
            <p className="hint">A chapter of 30–50 pages costs roughly a few cents on deepseek-flash. The cap stops new model calls once reached.</p>
          </div>
        </div>
      )}

      <h2 className="list-title" style={{ marginTop: 40 }}>Recent jobs</h2>
      {recent.loading ? <Loading /> : (
        <ul className="joblist">
          {(recent.data?.[0] ?? []).length === 0 && <li className="muted">No jobs yet.</li>}
          {(recent.data?.[0] ?? []).slice(0, 12).map((j) => (
            <li key={j.id}>
              <a {...linkProps(`/jobs/${j.id}`)}>
                <span className={`stage s-${j.stage}`}>{j.stage}</span>
                <span className="jl-title">{j.chapter}</span>
                <span className="muted">{j.file}</span>
                <span className="jl-cost">${j.cost_usd.toFixed(4)}</span>
                <span className="muted">{ago(j.started)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
