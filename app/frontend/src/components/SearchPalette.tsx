import { useEffect, useRef, useState } from 'react';
import { api, type SearchResults } from '../api';
import { useDebounced } from '../hooks';
import { navigate } from '../router';
import { Icon } from './Icon';

const OPEN = 'readlab:search';
export const openSearch = () => window.dispatchEvent(new Event(OPEN));

type Hit = { key: string; to: string; kind: 'document' | 'chapter' | 'passage'; title: string; meta: string; snippet?: string; cover?: string | null };

function hits(r: SearchResults | null): Hit[] {
  if (!r) return [];
  return [
    ...r.documents.map((d) => ({ key: `d${d.id}`, to: `/d/${d.id}`, kind: 'document' as const, title: d.title,
      meta: [d.kind === 'article' ? 'Article' : 'Book', d.authors.slice(0, 2).join(', ')].filter(Boolean).join(' · '), cover: d.cover })),
    ...r.chapters.map((c) => ({ key: `c${c.id}`, to: c.status === 'ready' ? `/r/${c.id}` : `/d/${c.document_id}#ch-${c.id}`, kind: 'chapter' as const,
      title: `${c.number ? `${c.number}. ` : ''}${c.title}`, meta: `${c.document_title}${c.status === 'ready' ? '' : ' · not generated yet'}` })),
    ...r.passages.map((p) => ({ key: `p${p.chapter_id}-${p.anchor}`, to: `/r/${p.chapter_id}?part=${p.part}#${encodeURIComponent(p.anchor)}`,
      kind: 'passage' as const, title: `${p.number ? `${p.number} ` : ''}${p.title}`, snippet: p.snippet,
      meta: `${p.document_title} · ${p.chapter_number ? `ch. ${p.chapter_number} ` : ''}${p.chapter_title}` })),
  ];
}

const GROUPS: [Hit['kind'], string][] = [['document', 'Books & articles'], ['chapter', 'Chapters'], ['passage', 'In the text']];

/** Ctrl/Cmd+K anywhere (also from inside a chapter page): search titles, chapters and the text you can read. */
export function SearchPalette() {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [res, setRes] = useState<SearchResults | null>(null);
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState(0);
  const dq = useDebounced(q.trim(), 140);
  const list = hits(res);

  useEffect(() => {
    const open = () => { if (!dialog.current?.open) { dialog.current?.showModal(); input.current?.select(); } };
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); open(); }
      else if (e.key === '/' && !(e.target as HTMLElement).closest('input, textarea, [contenteditable]')) { e.preventDefault(); open(); }
    };
    window.addEventListener(OPEN, open);
    document.addEventListener('keydown', onKey);
    return () => { window.removeEventListener(OPEN, open); document.removeEventListener('keydown', onKey); };
  }, []);

  useEffect(() => {
    if (dq.length < 2) { setRes(null); return; }
    const ctl = new AbortController();
    setBusy(true);
    api.search(dq, ctl.signal).then((r) => { setRes(r); setSel(0); }, () => {}).finally(() => setBusy(false));
    return () => ctl.abort();
  }, [dq]);

  const go = (h: Hit) => { dialog.current?.close(); navigate(h.to); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(list.length - 1, s + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === 'Enter' && list[sel]) { e.preventDefault(); go(list[sel]); }
  };
  useEffect(() => { document.getElementById(`hit-${sel}`)?.scrollIntoView({ block: 'nearest' }); }, [sel]);

  let i = -1;
  return (
    <dialog ref={dialog} className="palette" aria-label="Search" {...({ closedby: 'any' } as Record<string, string>)}>
      <div className="palette-input">
        <Icon name="search" />
        <input ref={input} type="search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} autoFocus
          placeholder="Search books, chapters and what's in them…" aria-label="Search" enterKeyHint="search"
          role="combobox" aria-expanded={list.length > 0} aria-controls="palette-list" aria-activedescendant={list.length ? `hit-${sel}` : undefined} />
        {busy && <span className="spinner small" aria-hidden />}
        <form method="dialog"><button className="kbd-btn" aria-label="Close search">Esc</button></form>
      </div>
      <div className="palette-body" id="palette-list" role="listbox" aria-label="Results">
        {dq.length < 2 ? (
          <p className="palette-hint">Type at least two letters. Results come from your own library, including the text of every chapter you've generated.</p>
        ) : !busy && res && list.length === 0 ? (
          <p className="palette-hint">Nothing matches “{dq}”.</p>
        ) : GROUPS.map(([kind, label]) => {
          const group = list.filter((h) => h.kind === kind);
          if (!group.length) return null;
          return (
            <section key={kind} className="palette-group">
              <h3>{label}</h3>
              {group.map((h) => {
                i = list.indexOf(h);
                const n = i;
                return (
                  <button key={h.key} id={`hit-${n}`} role="option" aria-selected={sel === n} className={`hit${sel === n ? ' sel' : ''}`}
                    onMouseMove={() => setSel(n)} onClick={() => go(h)}>
                    {h.kind === 'document' ? (h.cover ? <img className="hit-cover" src={h.cover} alt="" /> : <span className="hit-icon"><Icon name="book" /></span>)
                      : <span className="hit-icon"><Icon name={h.kind === 'chapter' ? 'list' : 'article'} /></span>}
                    <span className="hit-body">
                      <span className="hit-title">{h.title}</span>
                      {h.snippet && <span className="hit-snippet" dangerouslySetInnerHTML={{ __html: h.snippet }} />}
                      <span className="hit-meta">{h.meta}</span>
                    </span>
                    <Icon name="right" size={16} className="hit-go" />
                  </button>
                );
              })}
            </section>
          );
        })}
      </div>
      <footer className="palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span></footer>
    </dialog>
  );
}
