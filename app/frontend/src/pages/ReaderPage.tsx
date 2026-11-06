import { useEffect, useRef } from 'react';
import { Empty, Loading, useLoad } from '../components/ui';
import { api } from '../api';
import { linkProps, navigate } from '../router';

/**
 * The chapter page runs in an iframe under a slim bar, so the page keeps its own layout, shell and storage,
 * and the app keeps its navigation. (When pages come from user uploads they will move to their own origin.)
 */
export function ReaderPage({ bookId, chapterId }: { bookId: string; chapterId: string }) {
  const { data: book, error, loading } = useLoad(() => api.book(bookId), [bookId]);
  const frame = useRef<HTMLIFrameElement>(null);

  const ready = book?.chapters.filter((c) => c.available) ?? [];
  const i = ready.findIndex((c) => c.id === chapterId);
  const chapter = ready[i];
  const prev = i > 0 ? ready[i - 1] : null;
  const next = i >= 0 && i < ready.length - 1 ? ready[i + 1] : null;

  useEffect(() => {
    if (chapter) document.title = `${book?.title} · ${chapter.id} ${chapter.title} · readlab`;
    return () => { document.title = 'readlab'; };
  }, [book, chapter]);

  if (loading) return <Loading />;
  if (error || !book) return <div className="page"><Empty title="Book not found" body={error ?? ''} /></div>;
  if (!chapter) return <div className="page"><Empty title="Chapter not available" body="It hasn't been generated yet." /></div>;

  return (
    <div className="reader">
      <header className="reader-bar">
        <a className="back" {...linkProps(`/books/${book.id}`)} title="Back to the book">←</a>
        <div className="reader-title">
          <span className="reader-book">{book.title}</span>
          <span className="reader-ch"><b>{chapter.id}</b> {chapter.title}</span>
        </div>
        <div className="reader-actions">
          <button className="btn ghost" disabled={!prev} onClick={() => prev && navigate(`/books/${book.id}/${prev.id}`)} title={prev ? `Chapter ${prev.id}` : ''}>← prev</button>
          <button className="btn ghost" disabled={!next} onClick={() => next && navigate(`/books/${book.id}/${next.id}`)} title={next ? `Chapter ${next.id}` : ''}>next →</button>
          <a className="btn ghost" href={chapter.url} target="_blank" rel="noreferrer" title="Open the chapter on its own">full page ↗</a>
        </div>
      </header>
      <iframe ref={frame} key={chapter.id} className="reader-frame" src={chapter.url} title={`${chapter.id} ${chapter.title}`} />
    </div>
  );
}
