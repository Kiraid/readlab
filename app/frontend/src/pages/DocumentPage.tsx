import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { api, type Chapter, type DocDetail } from '../api';
import { GenerateDialog } from '../components/GenerateDialog';
import { Icon } from '../components/Icon';
import { Bar, Cover, Crumbs, Empty, JobPill, PageLoading, toast } from '../components/ui';
import { fmt, useJobStream, useLoad } from '../hooks';
import { linkProps, navigate } from '../router';

type Filter = 'all' | 'ready' | 'todo';

export function DocumentPage({ id }: { id: string }) {
  const { data: doc, loading, error, reload } = useLoad(() => api.document(id), [id]);
  const [gen, setGen] = useState<Chapter | null>(null);
  const [editing, setEditing] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => { if (doc) document.title = `${doc.title} · readlab`; }, [doc]);
  useEffect(() => {  // a search result for an ungenerated chapter links here as #ch-<id>
    if (doc && location.hash.startsWith('#ch-')) document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'center' });
  }, [doc]);

  const chapters = useMemo(() => (doc?.chapters ?? []).filter((c) =>
    filter === 'all' || (filter === 'ready' ? c.status === 'ready' : c.status !== 'ready')), [doc, filter]);

  if (loading) return <PageLoading />;
  if (error || !doc) return <Empty icon="alert" title="Not found" body={error} action={<a className="btn" {...linkProps('/books')}>Back to books</a>} />;

  const book = doc.kind === 'book';
  const resume = doc.chapters.filter((c) => c.progress && c.status === 'ready')
    .sort((a, b) => (b.progress!.updated_at).localeCompare(a.progress!.updated_at))[0];
  const firstReady = doc.chapters.find((c) => c.status === 'ready');
  const article = !book ? doc.chapters[0] : null;

  return (
    <div className="docpage" style={{ '--accent': doc.accent } as CSSProperties}>
      <Crumbs items={[[book ? 'Books' : 'Articles', book ? '/books' : '/articles'], [doc.title, null]]} />
      <section className="doc-hero">
        <div className="doc-hero-bg" aria-hidden />
        <Cover doc={doc} size="lg" />
        <div className="doc-hero-body">
          <p className="eyebrow">{book ? 'Book' : 'Article'}{doc.edition && ` · ${doc.edition}`}{doc.source === 'handbuilt' && ' · hand-built'}</p>
          <h1>{doc.title}</h1>
          {doc.subtitle && <p className="doc-sub">{doc.subtitle}</p>}
          {doc.authors.length > 0 && <p className="doc-authors">{doc.authors.join(', ')}</p>}
          <ul className="doc-facts">
            {doc.pages > 0 && <li><b>{doc.pages}</b> pages</li>}
            {book && <li><b>{doc.ready_count}</b> of {doc.chapter_count} chapters ready</li>}
            {doc.read_percent > 0 && <li><b>{fmt.pct(doc.read_percent)}</b> read</li>}
          </ul>
          <div className="doc-actions">
            {resume ? (
              <a className="btn primary" {...linkProps(`/r/${resume.id}`)}><Icon name="play" size={15} />Continue {book ? `ch. ${resume.number}` : 'reading'}</a>
            ) : firstReady ? (
              <a className="btn primary" {...linkProps(`/r/${firstReady.id}`)}><Icon name="play" size={15} />Start reading</a>
            ) : article && article.status !== 'ready' && !article.job ? (
              <button className="btn primary" onClick={() => setGen(article)}><Icon name="spark" size={16} />Generate the page</button>
            ) : null}
            {doc.source === 'upload' && <button className="btn" onClick={() => setEditing(true)}><Icon name="edit" size={15} />Edit details</button>}
          </div>
        </div>
      </section>

      {book ? (
        <section className="block">
          <div className="section-head">
            <h2 className="section-title">Chapters</h2>
            <div className="seg small" role="radiogroup" aria-label="Show">
              {([['all', 'All'], ['ready', 'Ready'], ['todo', 'Not generated']] as [Filter, string][]).map(([f, l]) => (
                <button key={f} role="radio" aria-checked={filter === f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{l}</button>
              ))}
            </div>
          </div>
          <ol className="chapters">
            {chapters.map((c) => <ChapterRow key={c.id} c={c} onGenerate={() => setGen(c)} onChange={reload} />)}
            {chapters.length === 0 && <li className="muted pad">No chapters here.</li>}
          </ol>
        </section>
      ) : article && (
        <section className="block">
          <ol className="chapters"><ChapterRow c={article} article onGenerate={() => setGen(article)} onChange={reload} /></ol>
        </section>
      )}

      {gen && <GenerateDialog chapter={gen} kind={doc.kind} onClose={() => setGen(null)} onQueued={reload} />}
      {editing && <EditDialog doc={doc} onClose={() => setEditing(false)} onSaved={reload} />}
    </div>
  );
}

const STAT_ICONS: [keyof Chapter['stats'], string, string][] = [
  ['diagrams', 'diagram', 'diagrams'], ['terminals', 'terminal', 'terminals'], ['labs', 'layers', 'labs'], ['quizzes', 'quiz', 'quizzes'],
];

function ChapterRow({ c, article, onGenerate, onChange }: { c: Chapter; article?: boolean; onGenerate: () => void; onChange: () => void }) {
  const ready = c.status === 'ready';
  const active = c.job && (c.job.status === 'queued' || c.job.status === 'running');
  const pct = c.progress?.furthest ?? 0;
  const body = (
    <>
      <span className="ch-num" aria-hidden>{article ? <Icon name="article" size={22} /> : c.number || '·'}</span>
      <span className="ch-main">
        <span className="ch-title">{!article && c.number && <span className="sr-only">Chapter {c.number}: </span>}{c.title}</span>
        {ready && c.summary && <span className="ch-summary">{c.summary}</span>}
        <span className="ch-meta">
          {ready ? (
            <>
              <span><Icon name="clock" size={14} />{fmt.minutes(c.minutes)}</span>
              {c.part_count > 1 && <span>{c.part_count} parts</span>}
              {STAT_ICONS.map(([k, icon, label]) => (c.stats[k] ?? 0) > 0 && (
                <span key={k} title={`${c.stats[k]} ${label}`}><Icon name={icon} size={14} />{c.stats[k]}</span>
              ))}
            </>
          ) : (
            <>
              {c.pages[1] > c.pages[0] && <span>pp. {c.pages[0]}–{c.pages[1]}</span>}
              {c.sections > 0 && <span>{c.sections} sections</span>}
              <span>~{fmt.minutes(Math.max(1, Math.round(c.source_words / 220)))} in print</span>
            </>
          )}
        </span>
        {active && <LiveJob jobId={c.job!.id} initial={c.job!} onEnd={onChange} />}
        {c.status === 'failed' && !active && <span className="ch-failed"><Icon name="alert" size={14} />The last attempt failed.</span>}
      </span>
      <span className="ch-side">
        {ready ? (
          <>
            {pct > 0 ? <span className="ring" style={{ '--p': pct } as CSSProperties} title={`${fmt.pct(pct)} read`}><span>{Math.round(pct * 100)}</span></span>
              : <span className="pill">New</span>}
            <span className="read-link">{c.progress ? 'Resume' : 'Read'}<Icon name="right" size={15} /></span>
          </>
        ) : active ? null : (
          <button className="btn small" onClick={(e) => { e.preventDefault(); onGenerate(); }}>
            <Icon name={c.status === 'failed' ? 'refresh' : 'spark'} size={15} />{c.status === 'failed' ? 'Try again' : 'Generate'}
          </button>
        )}
      </span>
    </>
  );
  return (
    <li id={`ch-${c.id}`}>
      {ready ? <a className="chapter" {...linkProps(`/r/${c.id}`)}>{body}</a> : <div className={`chapter off${active ? ' live' : ''}`}>{body}</div>}
    </li>
  );
}

function LiveJob({ jobId, initial, onEnd }: { jobId: string; initial: NonNullable<Chapter['job']>; onEnd: () => void }) {
  const { state } = useJobStream(jobId, (s) => {
    if (s.status === 'done') toast(`“${s.chapter.title}” is ready to read.`);
    onEnd();
  });
  const j = state ?? { ...initial, detail: '' };
  return (
    <a className="ch-live" {...linkProps(`/jobs/${jobId}`)}>
      <span className="ch-live-row"><JobPill job={j} /><small>{j.detail}</small></span>
      <Bar value={j.status === 'queued' ? null : j.progress} label="Generation progress" />
    </a>
  );
}

function EditDialog({ doc, onClose, onSaved }: { doc: DocDetail; onClose: () => void; onSaved: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const confirmRef = useRef<HTMLDialogElement>(null);
  const [err, setErr] = useState('');
  useEffect(() => { ref.current?.showModal(); }, []);

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await api.editDocument(doc.id, {
        title: String(f.get('title')), subtitle: String(f.get('subtitle')),
        authors: String(f.get('authors')).split(',').map((a) => a.trim()).filter(Boolean),
      });
      ref.current?.close();
      onSaved();
      toast('Saved');
    } catch (x) { setErr((x as Error).message); }
  }
  async function remove() {
    try {
      await api.deleteDocument(doc.id);
      toast(`Deleted “${doc.title}”`);
      navigate(doc.kind === 'book' ? '/books' : '/articles');
    } catch (x) { setErr((x as Error).message); confirmRef.current?.close(); }
  }

  return (
    <>
      <dialog ref={ref} className="modal small" aria-labelledby="edit-title" onClose={onClose}>
        <form onSubmit={save}>
          <header className="modal-head"><h2 id="edit-title">Edit details</h2></header>
          <div className="modal-body form">
            <div className="field"><label htmlFor="e-title">Title</label><input id="e-title" name="title" defaultValue={doc.title} required autoFocus /></div>
            <div className="field"><label htmlFor="e-sub">Subtitle</label><input id="e-sub" name="subtitle" defaultValue={doc.subtitle} /></div>
            <div className="field"><label htmlFor="e-auth">Authors <span className="hint">comma-separated</span></label><input id="e-auth" name="authors" defaultValue={doc.authors.join(', ')} /></div>
            <p className="form-error" role="alert">{err}</p>
          </div>
          <footer className="modal-foot">
            <button type="button" className="btn danger-ghost" onClick={() => confirmRef.current?.showModal()}><Icon name="trash" size={15} />Delete</button>
            <span className="grow" />
            <button type="button" className="btn ghost" onClick={() => ref.current?.close()}>Cancel</button>
            <button className="btn primary">Save</button>
          </footer>
        </form>
      </dialog>
      <dialog ref={confirmRef} className="modal small" aria-labelledby="del-title">
        <header className="modal-head"><h2 id="del-title">Delete “{doc.title}”?</h2></header>
        <div className="modal-body"><p>This removes the PDF, every generated chapter and your reading progress. It can't be undone.</p></div>
        <footer className="modal-foot">
          <form method="dialog"><button className="btn ghost" autoFocus>Keep it</button></form>
          <button className="btn danger" onClick={remove}>Delete</button>
        </footer>
      </dialog>
    </>
  );
}
