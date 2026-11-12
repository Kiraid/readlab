import { useEffect, useRef, useState } from 'react';
import { api, type Chapter, type ProbeQuestion, type Quota } from '../api';
import { useAuth } from '../auth';
import { fmt, useLocal } from '../hooks';
import { Icon } from './Icon';
import { toast } from './ui';

type Answers = Record<string, string | string[]>;
const MODELS = ['deepseek-flash', 'deepseek-v4-pro'];

/** Ask the reader a few questions about the chapter, then queue it. Admins also get the run's settings. */
export function GenerateDialog({ chapter, kind, onClose, onQueued }: {
  chapter: Chapter; kind: 'book' | 'article'; onClose: () => void; onQueued: () => void;
}) {
  const { user } = useAuth();
  const ref = useRef<HTMLDialogElement>(null);
  const [qs, setQs] = useState<ProbeQuestion[] | null>(null);
  const [qErr, setQErr] = useState('');
  const [answers, setAnswers] = useState<Answers>({});
  const [note, setNote] = useLocal('readlab.reader.note', '');
  const [quota, setQuota] = useState<Quota | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [opts, setOpts] = useState({ write_model: MODELS[0], plan_model: MODELS[0], write_thinking: true, budget: '2.00', dry_run: false });

  useEffect(() => {
    let live = true;
    if (!ref.current?.open) ref.current?.showModal();
    api.questions(chapter.id).then((r) => live && setQs(r.questions), (e) => { if (live) { setQs([]); setQErr((e as Error).message); } });
    api.quota().then((q) => live && setQuota(q), () => {});
    return () => { live = false; };
  }, [chapter.id]);

  const pick = (q: ProbeQuestion, o: string) => {
    if (q.kind !== 'multi') return setAnswers({ ...answers, [q.id]: o });
    const cur = Array.isArray(answers[q.id]) ? (answers[q.id] as string[]) : [];
    setAnswers({ ...answers, [q.id]: cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o] });
  };
  const over = quota?.remaining != null && chapter.source_words > quota.remaining;

  async function start() {
    setBusy(true);
    setErr('');
    try {
      const reader = {
        note: note.trim(),
        answers: (qs ?? []).map((q) => ({ question: q.text, purpose: q.purpose, answer: answers[q.id] ?? '' }))
          .filter((a) => (Array.isArray(a.answer) ? a.answer.length : a.answer)),
      };
      await api.generate(chapter.id, reader, user?.is_admin ? { ...opts, budget: Number(opts.budget) } : undefined);
      toast(`${kind === 'book' ? 'Chapter' : 'Article'} queued. We'll write it in the background.`);
      ref.current?.close();
      onQueued();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <dialog ref={ref} className="modal gen" aria-labelledby="gen-title" onClose={onClose}>
      <header className="modal-head">
        <div>
          <p className="eyebrow">{kind === 'book' ? `Chapter ${chapter.number}` : 'Article'} · about {fmt.words(chapter.source_words)} words</p>
          <h2 id="gen-title">{chapter.title}</h2>
        </div>
        <form method="dialog"><button className="icon-btn" aria-label="Close"><Icon name="x" /></button></form>
      </header>

      <div className="modal-body">
        <p className="lead">A few questions decide what gets explained from scratch, what gets a one-line refresher, and which wrong idea the page confronts. All optional.</p>

        <div className="field">
          <label htmlFor="gen-note">About you</label>
          <input id="gen-note" type="text" value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. backend engineer, comfortable with SQL, new to distributed systems" />
        </div>

        {qs === null ? (
          <div className="q-loading"><span className="spinner small" aria-hidden /> Reading the chapter to ask you something useful…</div>
        ) : qs.length === 0 ? (
          <p className="muted small">{qErr ? "Questions aren't available right now; the page will be written for a working engineer new to the topic." : ''}</p>
        ) : (
          <ol className="questions">
            {qs.map((q) => (
              <li key={q.id}>
                <p>{q.text}{q.kind === 'multi' && <span className="muted"> (pick any)</span>}</p>
                {q.kind === 'text' ? (
                  <input type="text" aria-label={q.text} value={(answers[q.id] as string) ?? ''} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} />
                ) : (
                  <div className="chips">
                    {q.options.map((o) => {
                      const on = q.kind === 'multi' ? ((answers[q.id] as string[] | undefined) ?? []).includes(o) : answers[q.id] === o;
                      return (
                        <label key={o} className={`chip${on ? ' on' : ''}`}>
                          <input type={q.kind === 'multi' ? 'checkbox' : 'radio'} name={`q-${q.id}`} checked={on} onChange={() => pick(q, o)} />{o}
                        </label>
                      );
                    })}
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}

        {user?.is_admin && (
          <details className="advanced">
            <summary>Run settings <span className="muted">· admin</span></summary>
            <div className="adv-grid">
              <label>Writer model<select value={opts.write_model} onChange={(e) => setOpts({ ...opts, write_model: e.target.value })}>{MODELS.map((m) => <option key={m}>{m}</option>)}</select></label>
              <label>Planner model<select value={opts.plan_model} onChange={(e) => setOpts({ ...opts, plan_model: e.target.value })}>{MODELS.map((m) => <option key={m}>{m}</option>)}</select></label>
              <label>Budget cap (USD)<input type="number" min="0.05" step="0.05" value={opts.budget} onChange={(e) => setOpts({ ...opts, budget: e.target.value })} /></label>
              <label className="check"><input type="checkbox" checked={opts.write_thinking} onChange={(e) => setOpts({ ...opts, write_thinking: e.target.checked })} /> writer thinks first</label>
              <label className="check"><input type="checkbox" checked={opts.dry_run} onChange={(e) => setOpts({ ...opts, dry_run: e.target.checked })} /> dry run (stub replies, no API calls)</label>
            </div>
          </details>
        )}
      </div>

      <footer className="modal-foot">
        <span className="muted small">
          {quota?.limit != null
            ? over ? `Not enough allowance: ${fmt.words(quota.remaining ?? 0)} of ${fmt.words(quota.limit)} words left for ${quota.days} days.`
              : `Uses ${fmt.words(chapter.source_words)} of your ${fmt.words(quota.remaining ?? 0)} remaining words.`
            : 'Takes a few minutes. You can keep reading meanwhile.'}
        </span>
        <p className="form-error" role="alert">{err}</p>
        <form method="dialog"><button className="btn ghost">Cancel</button></form>
        <button className="btn primary" onClick={start} disabled={busy || over} autoFocus>
          {busy ? <span className="spinner small" aria-hidden /> : <Icon name="spark" size={16} />}Generate
        </button>
      </footer>
    </dialog>
  );
}
