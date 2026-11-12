import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { api, type ChapterView, type Part } from '../api';
import { Icon } from '../components/Icon';
import { openSearch } from '../components/SearchPalette';
import { Empty, Spinner } from '../components/ui';
import { fmt, useLoad, useLocal } from '../hooks';
import { linkProps, useQuery } from '../router';

type Pos = { part: number; offset: number; anchor: string };
type Restore = { part?: number; anchor?: string; offset?: number };
type PageMsg = {
  source: 'readlab-page'; type: 'ready' | 'restored' | 'position' | 'link' | 'key' | 'need-more' | 'appended' | 'append-failed';
  part?: number; offset?: number; anchor?: string; key?: string; after?: number;
};

/**
 * A chapter as one continuous scroll. The page runs in an iframe (it keeps its own scripts, shell and widgets) and
 * opens at one part; the bridge script the server injects appends the following parts as the reader nears the end,
 * reports the position (part, place in it, section), and restores it next time.
 */
export function ReaderPage({ chapterId }: { chapterId: number }) {
  const { data, error, loading } = useLoad(() => api.chapter(chapterId), [chapterId]);
  if (loading) return <div className="reader-loading"><Spinner label="Opening the chapter" /></div>;
  if (error || !data) return <div className="main"><Empty icon="alert" title="Can't open this chapter" body={error} action={<a className="btn" {...linkProps('/')}>Go home</a>} /></div>;
  if (data.chapter.status !== 'ready') {
    return <div className="main"><Empty icon="clock" title="Not ready yet" body="This chapter hasn't been generated."
      action={<a className="btn" {...linkProps(`/d/${data.document.id}`)}>Back to {data.document.title}</a>} /></div>;
  }
  return <Reader view={data} key={chapterId} />;
}

function Reader({ view }: { view: ChapterView }) {
  const { chapter: ch, document: doc, prev, next, base } = view;
  const parts: Part[] = ch.parts?.length ? ch.parts : [{ n: 1, file: 'index.html', words: 1, sections: [] }];
  const clamp = (n: number) => Math.min(parts.length, Math.max(1, n));
  const q = useQuery();
  const saved = ch.progress;
  const [entry, setEntry] = useState(() => clamp(Number(q.get('part')) || saved?.part || 1));  // the part the iframe opened at
  const [pos, setPos] = useState<Pos>({ part: entry, offset: 0, anchor: '' });
  const part = pos.part;                         // the part being read, which may have been appended below the entry
  const cur = parts[part - 1];
  const [toc, setToc] = useLocal('readlab.reader.toc', window.innerWidth > 1000);
  const [ready, setReady] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const loaded = useRef(new Set<number>([entry]));
  const pending = useRef<Restore | null>(null);  // where to scroll once the page has loaded
  const opened = useRef(false);
  const canSave = useRef(false);                 // not until the saved place is restored, or it would be overwritten
  const saveTimer = useRef<number>();
  const lastSaved = useRef('');

  if (!opened.current) {  // first open: the hash (a search hit or a link), else where the reader left off
    opened.current = true;
    const hash = decodeURIComponent(location.hash.slice(1));
    pending.current = hash ? { part: entry, anchor: hash }
      : saved && saved.part === entry ? { part: entry, offset: saved.offset, anchor: saved.anchor } : null;
  }

  const totals = useMemo(() => {
    const w = parts.map((p) => Math.max(1, p.words));
    return { all: w.reduce((a, b) => a + b, 0), before: w.slice(0, part - 1).reduce((a, b) => a + b, 0), here: w[part - 1] };
  }, [parts, part]);
  const percent = (totals.before + pos.offset * totals.here) / totals.all;

  const post = useCallback((msg: Record<string, unknown>) => {
    frame.current?.contentWindow?.postMessage({ source: 'readlab-app', ...msg }, location.origin);
  }, []);

  const save = useCallback((p: Pos, now = false) => {
    if (!canSave.current) return;
    const body = JSON.stringify({ part: p.part, anchor: p.anchor, offset: Math.round(p.offset * 10000) / 10000 });
    if (body === lastSaved.current) return;
    window.clearTimeout(saveTimer.current);
    const send = () => {
      lastSaved.current = body;
      fetch(`/api/chapters/${ch.id}/progress`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
    };
    if (now) send(); else saveTimer.current = window.setTimeout(send, 1200);
  }, [ch.id]);

  /** A part already on the page is scrolled to; any other reopens the page at that part. */
  const goPart = useCallback((n: number, restore: Restore = {}) => {
    if (n < 1 || n > parts.length) return;
    if (loaded.current.has(n)) {
      post({ type: 'goto', part: n, anchor: restore.anchor, smooth: true });
      return;
    }
    pending.current = restore.anchor ? { part: n, anchor: restore.anchor } : null;
    canSave.current = false;
    window.clearTimeout(saveTimer.current);  // a late save for the old place would land after the new one
    loaded.current = new Set([n]);
    setPos({ part: n, offset: 0, anchor: '' });
    setReady(false);
    setEntry(n);
  }, [parts.length, post]);

  // the address follows the part being read, without reloading anything
  useEffect(() => { history.replaceState(null, '', `/r/${ch.id}?part=${part}`); }, [ch.id, part]);

  // a search hit or link into this same chapter changes the address from outside
  const firstQuery = useRef(true);
  useEffect(() => {
    if (firstQuery.current) { firstQuery.current = false; return; }
    const n = Number(q.get('part'));
    if (n) goPart(clamp(n), { anchor: decodeURIComponent(location.hash.slice(1)) || undefined });
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onMsg = (e: MessageEvent<PageMsg>) => {
      if (e.origin !== location.origin || e.source !== frame.current?.contentWindow || e.data?.source !== 'readlab-page') return;
      const d = e.data;
      const p: Pos = { part: d.part ?? entry, offset: d.offset ?? 0, anchor: d.anchor ?? '' };
      if (d.type === 'ready') {
        setReady(true);
        const r = pending.current;
        pending.current = null;
        if (r && (r.anchor || r.offset)) post({ type: 'restore', ...r });
        else { canSave.current = true; setPos(p); save(p); }
      } else if (d.type === 'restored') {
        canSave.current = true;
        setPos(p);
      } else if (d.type === 'position') {
        setPos(p);
        save(p);
      } else if (d.type === 'need-more') {
        const n = (d.after ?? entry) + 1;
        if (n <= parts.length) {
          loaded.current.add(n);
          post({ type: 'append', part: n, url: `${base}${parts[n - 1].file}` });
        } else post({ type: 'no-more' });
      } else if (d.type === 'append-failed' && d.part) {
        loaded.current.delete(d.part);
      } else if (d.type === 'link' && d.anchor) {
        const target = parts.find((x) => x.sections.some((s) => s.id === d.anchor));
        if (target) goPart(target.n, { anchor: d.anchor });
      } else if (d.type === 'key') {
        if (d.key === 'search') openSearch();
        if (d.key === 'next') goPart(part + 1);
        if (d.key === 'prev') goPart(part - 1);
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [parts, part, entry, base, post, save, goPart]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); goPart(part + 1); }
      if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); goPart(part - 1); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [goPart, part]);

  useEffect(() => { document.title = `${ch.number ? `${ch.number}. ` : ''}${ch.title} · ${doc.title}`; }, [ch, doc]);

  const latest = useRef({ pos, save });
  latest.current = { pos, save };
  useEffect(() => {  // leaving the reader or the tab: write the last place now, not after the debounce
    const flush = () => latest.current.save(latest.current.pos, true);
    window.addEventListener('pagehide', flush);
    return () => { window.removeEventListener('pagehide', flush); flush(); };
  }, []);

  const entryFile = parts[entry - 1].file;
  const currentSection = cur.sections.find((s) => s.id === pos.anchor) ?? cur.sections[0];
  const nextPart = parts[part];
  const prevPart = parts[part - 2];
  const partTitle = (p?: Part) => (p?.sections[0] ? `${p.sections[0].num} ${p.sections[0].title}`.trim() : p ? `Part ${p.n}` : '');

  return (
    <div className={`reader${toc ? ' with-toc' : ''}`} style={{ '--accent': doc.accent } as CSSProperties}>
      <header className="rd-bar">
        <a className="icon-btn" {...linkProps(`/d/${doc.id}`)} aria-label={`Back to ${doc.title}`}><Icon name="left" /></a>
        <button className="icon-btn" onClick={() => setToc(!toc)} aria-label={toc ? 'Hide contents' : 'Show contents'} aria-expanded={toc} aria-controls="rd-toc">
          <Icon name="list" />
        </button>
        <div className="rd-titles">
          <span className="rd-doc">{doc.title}</span>
          <span className="rd-ch">{ch.number && <b>{ch.number}</b>}{ch.title}</span>
        </div>
        <span className="rd-where">
          {parts.length > 1 && <span className="rd-part">Part {part} of {parts.length}</span>}
          <span className="rd-pct" title="Of the whole chapter">{fmt.pct(percent)}</span>
        </span>
        <button className="icon-btn" onClick={openSearch} aria-label="Search (Ctrl K)"><Icon name="search" /></button>
      </header>
      <div className="rd-progress" aria-hidden><span style={{ width: `${percent * 100}%` }} /></div>

      <div className="rd-body">
        <nav id="rd-toc" className="rd-toc" aria-label="Chapter contents" hidden={!toc}>
          <p className="rd-toc-head">{ch.number ? `Chapter ${ch.number}` : 'Contents'} · {fmt.minutes(ch.minutes)}</p>
          <ol>
            {parts.map((p) => (
              <li key={p.n} className={p.n === part ? 'cur' : p.n < part ? 'past' : ''}>
                {parts.length > 1 && <button className="rd-toc-part" onClick={() => goPart(p.n)}>Part {p.n}<span>{fmt.minutes(Math.max(1, Math.round(p.words / 220)))}</span></button>}
                <ol>
                  {p.sections.map((s) => (
                    <li key={s.id} className={`${s.level === 'sub' ? 'sub' : ''}${p.n === part && currentSection?.id === s.id ? ' here' : ''}`}>
                      <button onClick={() => { goPart(p.n, { anchor: s.id }); if (window.innerWidth < 900) setToc(false); }}>
                        <span className="tn">{s.num}</span><span className="tt">{s.title}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ol>
        </nav>
        {toc && <div className="rd-scrim" onClick={() => setToc(false)} aria-hidden />}

        <div className="rd-stage">
          {!ready && <div className="rd-loading"><Spinner label="Loading part" /></div>}
          <iframe ref={frame} key={entryFile} className={`rd-frame${ready ? ' in' : ''}`} src={`${base}${entryFile}`}
            title={`${ch.title}, from part ${entry}`} />
        </div>
      </div>

      <footer className="rd-pager">
        {prevPart ? (
          <button className="pager-btn" onClick={() => goPart(part - 1)}><Icon name="left" size={16} /><span><small>Previous</small>{partTitle(prevPart)}</span></button>
        ) : prev ? (
          <a className="pager-btn" {...linkProps(`/r/${prev.id}`)}><Icon name="left" size={16} /><span><small>Previous chapter</small>{prev.number} {prev.title}</span></a>
        ) : <span />}
        <div className="pager-dots" aria-hidden>
          {parts.length > 1 && parts.map((p) => <span key={p.n} className={p.n === part ? 'on' : p.n < part ? 'past' : ''} />)}
        </div>
        {nextPart ? (
          <button className="pager-btn next" onClick={() => goPart(part + 1)}><span><small>Next</small>{partTitle(nextPart)}</span><Icon name="right" size={16} /></button>
        ) : next ? (
          <a className="pager-btn next" {...linkProps(`/r/${next.id}`)}><span><small>Next chapter</small>{next.number} {next.title}</span><Icon name="right" size={16} /></a>
        ) : (
          <a className="pager-btn next" {...linkProps(`/d/${doc.id}`)}><span><small>Finished</small>Back to {doc.kind === 'book' ? 'the book' : 'the article'}</span><Icon name="check" size={16} /></a>
        )}
      </footer>
    </div>
  );
}
