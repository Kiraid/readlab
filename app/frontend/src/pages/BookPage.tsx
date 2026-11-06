import type { CSSProperties } from 'react';
import { Empty, Loading, useLoad } from '../components/ui';
import { api, type ChapterStats } from '../api';
import { Cover } from '../components/Cover';
import { linkProps } from '../router';

const STAT_LABELS: [keyof ChapterStats, string, string][] = [
  ['sections', 'section', 'sections'],
  ['diagrams', 'diagram', 'diagrams'],
  ['terminals', 'terminal', 'terminals'],
  ['labs', 'lab', 'labs'],
  ['quizzes', 'quiz', 'quizzes'],
];

export function BookPage({ bookId }: { bookId: string }) {
  const { data: book, error, loading } = useLoad(() => api.book(bookId), [bookId]);
  if (loading) return <Loading />;
  if (error || !book) return <Empty title="Book not found" body={error ?? ''} />;

  return (
    <div style={{ '--accent': book.accent } as CSSProperties}>
      <nav className="crumbs">
        <a {...linkProps('/')}>Library</a>
        <span>/</span>
        <span>{book.title}</span>
      </nav>
      <section className="book-head">
        <Cover book={book} size="lg" />
        <div>
          <h1>{book.title}</h1>
          <p className="byline">{[book.edition, book.authors.join(', ')].filter(Boolean).join(' · ')}</p>
          {book.blurb && <p className="blurb">{book.blurb}</p>}
          <p className="pill">{book.ready_count} of {book.chapter_count} chapters ready</p>
        </div>
      </section>

      <h2 className="list-title">Chapters</h2>
      <ol className="chapters">
        {book.chapters.map((c) => {
          const body = (
            <>
              <span className="ch-num">{c.id}</span>
              <span className="ch-main">
                <span className="ch-title">{c.title}</span>
                {c.summary && <span className="ch-summary">{c.summary}</span>}
                {c.available && c.stats && (
                  <span className="ch-stats">
                    {STAT_LABELS.filter(([k]) => (c.stats?.[k] ?? 0) > 0).map(([k, one, many]) => (
                      <span key={k}>{c.stats![k]} {c.stats![k] === 1 ? one : many}</span>
                    ))}
                  </span>
                )}
              </span>
              <span className="ch-side">
                {c.available ? (
                  <>
                    {c.made && <span className="tag">{c.made}</span>}
                    <span className="read">Read →</span>
                  </>
                ) : (
                  <span className="tag muted">not generated</span>
                )}
              </span>
            </>
          );
          return (
            <li key={c.id}>
              {c.available ? <a className="chapter" {...linkProps(`/books/${book.id}/${c.id}`)}>{body}</a> : <div className="chapter off">{body}</div>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
