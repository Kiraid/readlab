import { useRef, useState } from 'react';
import { api, type Kind } from '../api';
import { Icon } from '../components/Icon';
import { toast } from '../components/ui';
import { fmt, useLoad } from '../hooks';
import { navigate } from '../router';

const STEPS = ['Uploading', 'Reading the outline', 'Finding chapters', 'Taking the cover'];

export function UploadPage() {
  const [kind, setKind] = useState<'auto' | Kind>('auto');
  const [busy, setBusy] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const { data: quota } = useLoad(() => api.quota(), []);

  async function send(file: File) {
    if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') { setError('Only PDF files for now.'); return; }
    setError('');
    setBusy(file.name);
    setStep(0);
    const tick = window.setInterval(() => setStep((s) => Math.min(STEPS.length - 1, s + 1)), 1800);
    try {
      const d = await api.upload(file, kind);
      toast(d.existing ? `You already have “${d.title}”` : `Added “${d.title}”`);
      navigate(`/d/${d.id}`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    } finally {
      window.clearInterval(tick);
    }
  }

  return (
    <div className="upload">
      <header className="page-head">
        <h1>Upload</h1>
        <p className="sub">Add a PDF to your library. Nothing is generated until you pick a chapter and say go.</p>
      </header>

      <div className="seg big" role="radiogroup" aria-label="What is it?">
        {([['auto', 'Detect', 'Book if it has chapters'], ['book', 'Book', 'Pick chapters one by one'], ['article', 'Article', 'One page for the whole thing']] as const).map(([k, l, d]) => (
          <button key={k} role="radio" aria-checked={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)} disabled={!!busy}>
            <b>{l}</b><small>{d}</small>
          </button>
        ))}
      </div>

      <div className={`drop${drag ? ' over' : ''}${busy ? ' busy' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f && !busy) send(f); }}>
        <input ref={input} id="file" type="file" accept="application/pdf,.pdf" className="sr-only" disabled={!!busy}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) send(f); e.target.value = ''; }} />
        {busy ? (
          <div className="drop-busy" role="status" aria-live="polite">
            <span className="spinner" aria-hidden />
            <b>{busy}</b>
            <ol className="steps">
              {STEPS.map((s, i) => <li key={s} className={i < step ? 'done' : i === step ? 'now' : ''}>{i < step && <Icon name="check" size={13} />}{s}</li>)}
            </ol>
          </div>
        ) : (
          <label htmlFor="file" className="drop-label">
            <span className="drop-icon"><Icon name="upload" size={28} /></span>
            <b>Drop a PDF here, or choose one</b>
            <small>Up to 120 MB · technical books, papers, long posts saved as PDF</small>
          </label>
        )}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}

      <ol className="how">
        <li><span>1</span><div><b>We read the outline</b><p>Chapters, page ranges and the cover come from the PDF itself. No model is involved yet.</p></div></li>
        <li><span>2</span><div><b>You pick what to read</b><p>Answer a few optional questions so the page starts from what you already know.</p></div></li>
        <li><span>3</span><div><b>It's written in the background</b><p>Each section is written, checked against the book, and judged. You get a ping when it's ready.</p></div></li>
      </ol>

      {quota && quota.limit !== null && (
        <p className="quota-note"><Icon name="clock" size={15} />
          You can turn {fmt.words(quota.remaining ?? 0)} more words of source text into pages in the next {quota.days} days (about {Math.max(0, Math.round((quota.remaining ?? 0) / 10000))} chapters).
        </p>
      )}
    </div>
  );
}
