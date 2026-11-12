import { useEffect } from 'react';
import { Empty } from './components/ui';
import { BookPage } from './pages/BookPage';
import { JobPage } from './pages/JobPage';
import { LibraryPage } from './pages/LibraryPage';
import { PipelinePage } from './pages/PipelinePage';
import { ReaderPage } from './pages/ReaderPage';
import { UploadPage } from './pages/UploadPage';
import { linkProps, useRoute, type Route } from './router';

const NAV: [string, string, Route['name'][]][] = [
  ['/', 'Library', ['library', 'book']],
  ['/upload', 'Upload', ['upload', 'job']],
  ['/pipeline', 'Pipeline', ['pipeline']],
];

export function App() {
  const route = useRoute();

  useEffect(() => {
    document.body.classList.toggle('reading', route.name === 'reader');
  }, [route.name]);

  if (route.name === 'reader') return <ReaderPage bookId={route.book} chapterId={route.chapter} />;

  const wide = route.name === 'job' || route.name === 'pipeline';
  return (
    <div className="shell">
      <header className="topbar">
        <a className="wordmark" {...linkProps('/')}>
          <span className="mark" aria-hidden>r</span>readlab
        </a>
        <nav className="nav">
          {NAV.map(([to, label, names]) => (
            <a key={to} className={names.includes(route.name) ? 'active' : ''} {...linkProps(to)}>{label}</a>
          ))}
        </nav>
      </header>
      <main className={`page${wide ? ' wide' : ''}`}>
        {route.name === 'library' && <LibraryPage />}
        {route.name === 'book' && <BookPage bookId={route.book} />}
        {route.name === 'upload' && <UploadPage />}
        {route.name === 'job' && <JobPage jobId={route.job} />}
        {route.name === 'pipeline' && <PipelinePage />}
        {route.name === 'missing' && <Empty title="Page not found" body="That address doesn't match anything." />}
      </main>
    </div>
  );
}
