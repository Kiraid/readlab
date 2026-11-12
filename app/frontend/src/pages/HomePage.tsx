import { api, type Doc, type Home } from '../api';
import { useAuth } from '../auth';
import { Icon } from '../components/Icon';
import { Bar, Cover, Empty, JobPill, PageLoading } from '../components/ui';
import { fmt, useJobStream, useLoad } from '../hooks';
import { linkProps } from '../router';

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export function HomePage() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useLoad(() => api.home(), []);
  if (loading) return <PageLoading />;
  if (error || !data) return <Empty icon="alert" title="Couldn't load your library" body={error} />;
  const empty = !data.recent.length;

  return (
    <div className="home">
      <header className="page-head">
        <p className="eyebrow">{greeting()}, {user?.name}</p>
        <h1>{data.continue.length ? 'Pick up where you left off' : empty ? 'Your library is empty' : 'Your library'}</h1>
      </header>

      {empty && (
        <a className="hero-cta" {...linkProps('/upload')}>
          <span className="hero-cta-icon"><Icon name="upload" size={26} /></span>
          <span>
            <b>Upload your first PDF</b>
            <small>A technical book or an article. We find its chapters and the cover, and you choose what to turn into an interactive page.</small>
          </span>
          <Icon name="right" />
        </a>
      )}

      {data.continue.length > 0 && (
        <section className="block">
          <ul className="continue">
            {data.continue.map(({ chapter: c, document: d }) => (
              <li key={c.id}>
                <a className="continue-card" {...linkProps(`/r/${c.id}`)} style={{ '--accent': d.accent } as React.CSSProperties}>
                  <Cover doc={d} size="sm" />
                  <span className="cc-body">
                    <span className="cc-doc">{d.title}</span>
                    <span className="cc-title">{c.number && <b>{c.number}</b>}{c.title}</span>
                    <Bar value={c.progress?.percent ?? 0} label="Read" />
                    <span className="cc-meta">{fmt.pct(c.progress?.percent ?? 0)} read · part {c.progress?.part} of {c.part_count} · {fmt.ago(c.progress?.updated_at)}</span>
                  </span>
                  <span className="cc-go" aria-hidden><Icon name="play" size={16} /></span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data.active.length > 0 && (
        <section className="block">
          <h2 className="section-title">Being written</h2>
          <ul className="active-list">
            {data.active.map((a) => <ActiveJob key={a.job.id} item={a} onDone={reload} />)}
          </ul>
        </section>
      )}

      {!empty && (
        <section className="block">
          <div className="section-head">
            <h2 className="section-title">Recently added</h2>
            <a className="link" {...linkProps('/books')}>All books <Icon name="right" size={15} /></a>
          </div>
          <Shelf docs={data.recent} />
        </section>
      )}
    </div>
  );
}

function ActiveJob({ item, onDone }: { item: Home['active'][number]; onDone: () => void }) {
  const { state } = useJobStream(item.job.id, onDone);
  const j = state ?? { ...item.job, detail: '' };
  return (
    <li>
      <a className="active-row" {...linkProps(`/jobs/${item.job.id}`)}>
        <span className="ar-main">
          <span className="ar-title">{item.chapter.number && <b>{item.chapter.number}</b>}{item.chapter.title}</span>
          <span className="ar-doc">{item.document.title}</span>
        </span>
        <span className="ar-progress">
          <span className="ar-status"><JobPill job={j} />{j.detail && <small>{j.detail}</small>}</span>
          <Bar value={j.status === 'queued' ? null : j.progress} label="Progress" />
        </span>
      </a>
    </li>
  );
}

export function Shelf({ docs }: { docs: Doc[] }) {
  return (
    <ul className="shelf">
      {docs.map((d) => (
        <li key={d.id}>
          <a className="book" {...linkProps(`/d/${d.id}`)} style={{ '--accent': d.accent } as React.CSSProperties}>
            <Cover doc={d} />
            <span className="book-title">{d.title}</span>
            <span className="book-meta">
              {d.kind === 'article' ? 'Article' : `${d.ready_count}/${d.chapter_count} chapters`}
              {d.generating_count > 0 && <span className="dot-live" title="Generating" />}
            </span>
            {d.read_percent > 0 && <Bar value={d.read_percent} label="Read" />}
          </a>
        </li>
      ))}
    </ul>
  );
}
