import { useMemo, useState } from 'react';
import { api, type Kind } from '../api';
import { Icon } from '../components/Icon';
import { Bar, Cover, Empty, PageLoading } from '../components/ui';
import { fmt, useLoad, useLocal } from '../hooks';
import { linkProps } from '../router';
import { Shelf } from './HomePage';

type Sort = 'recent' | 'title' | 'progress';

export function LibraryPage({ kind }: { kind: Kind }) {
  const { data, loading, error } = useLoad(() => api.documents(kind), [kind]);
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useLocal<Sort>(`readlab.sort.${kind}`, 'recent');
  const books = kind === 'book';

  const docs = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const list = (data ?? []).filter((d) => !f || `${d.title} ${d.subtitle} ${d.authors.join(' ')}`.toLowerCase().includes(f));
    if (sort === 'title') list.sort((a, b) => a.title.localeCompare(b.title));
    if (sort === 'progress') list.sort((a, b) => (b.last_read_at ?? '').localeCompare(a.last_read_at ?? ''));
    return list;
  }, [data, filter, sort]);

  if (loading) return <PageLoading />;
  if (error) return <Empty icon="alert" title="Couldn't load the library" body={error} />;

  return (
    <div>
      <header className="page-head row">
        <div>
          <h1>{books ? 'Books' : 'Articles'}</h1>
          <p className="sub">{data?.length ?? 0} {books ? (data?.length === 1 ? 'book' : 'books') : (data?.length === 1 ? 'article' : 'articles')} in your library</p>
        </div>
        <a className="btn primary" {...linkProps('/upload')}><Icon name="upload" size={16} />Upload</a>
      </header>

      {!data?.length ? (
        <Empty icon={books ? 'book' : 'article'} title={books ? 'No books yet' : 'No articles yet'}
          body={books ? 'Upload a PDF of a technical book; we find its chapters and you pick which ones to turn into pages.'
            : 'Upload a paper or a long post as a PDF and mark it as an article: it becomes one interactive page.'}
          action={<a className="btn primary" {...linkProps('/upload')}>Upload a PDF</a>} />
      ) : (
        <>
          <div className="toolbar">
            <label className="filter">
              <Icon name="search" size={16} />
              <input type="search" placeholder={`Filter ${books ? 'books' : 'articles'}…`} value={filter} onChange={(e) => setFilter(e.target.value)}
                aria-label={`Filter ${books ? 'books' : 'articles'}`} />
            </label>
            <div className="seg" role="radiogroup" aria-label="Sort">
              {([['recent', 'Recent'], ['title', 'A–Z'], ['progress', 'Last read']] as [Sort, string][]).map(([s, l]) => (
                <button key={s} role="radio" aria-checked={sort === s} className={sort === s ? 'on' : ''} onClick={() => setSort(s)}>{l}</button>
              ))}
            </div>
          </div>
          {docs.length === 0 ? <p className="muted pad">Nothing matches “{filter}”.</p> : books ? <Shelf docs={docs} /> : (
            <ul className="article-list">
              {docs.map((d) => (
                <li key={d.id}>
                  <a className="article-row" {...linkProps(`/d/${d.id}`)} style={{ '--accent': d.accent } as React.CSSProperties}>
                    <Cover doc={d} size="sm" />
                    <span className="ar-main">
                      <span className="ar-title">{d.title}</span>
                      <span className="ar-doc">{[d.authors.join(', '), `${d.pages} pages`, fmt.ago(d.created_at)].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="ar-side">
                      {d.ready_count ? <span className="pill pill-done">Ready</span> : d.generating_count ? <span className="pill pill-running"><span className="pulse" />Generating</span> : <span className="pill">Not generated</span>}
                      {d.read_percent > 0 && <Bar value={d.read_percent} label="Read" />}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
