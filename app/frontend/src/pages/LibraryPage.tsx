import { Empty, Loading, useLoad } from '../components/ui';
import { api } from '../api';
import { Cover } from '../components/Cover';
import { linkProps } from '../router';

export function LibraryPage() {
  const { data: books, error, loading } = useLoad(() => api.books(), []);
  if (loading) return <Loading />;
  if (error || !books) return <Empty title="The library didn't load" body={error ?? 'No response from the server.'} />;

  const ready = books.reduce((n, b) => n + b.ready_count, 0);
  return (
    <>
      <section className="intro">
        <h1>Library</h1>
        <p>
          {books.length} {books.length === 1 ? 'book' : 'books'} · {ready} {ready === 1 ? 'chapter' : 'chapters'} ready to read
        </p>
      </section>
      {books.length === 0 ? (
        <Empty title="No books yet" body="Add one to app/library.yaml." />
      ) : (
        <ul className="shelf">
          {books.map((b) => (
            <li key={b.id}>
              <a className="book-card" {...linkProps(`/books/${b.id}`)}>
                <Cover book={b} />
                <div className="book-card-body">
                  <h2>{b.title}</h2>
                  {b.blurb && <p>{b.blurb}</p>}
                  <div className="meta">
                    <span className="pill">{b.ready_count}/{b.chapter_count} chapters ready</span>
                    <span className="chapter-ids">{b.chapters.filter((c) => c.available).map((c) => `ch ${c.id}`).join(' · ')}</span>
                  </div>
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
