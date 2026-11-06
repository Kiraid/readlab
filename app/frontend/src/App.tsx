import { useEffect } from 'react';
import { Empty } from './components/ui';
import { BookPage } from './pages/BookPage';
import { LibraryPage } from './pages/LibraryPage';
import { ReaderPage } from './pages/ReaderPage';
import { linkProps, useRoute } from './router';

export function App() {
  const route = useRoute();

  useEffect(() => {
    document.body.classList.toggle('reading', route.name === 'reader');
  }, [route.name]);

  if (route.name === 'reader') return <ReaderPage bookId={route.book} chapterId={route.chapter} />;

  return (
    <div className="shell">
      <header className="topbar">
        <a className="wordmark" {...linkProps('/')}>
          <span className="mark" aria-hidden>r</span>readlab
        </a>
        <span className="topbar-note">technical reading, made interactive</span>
      </header>
      <main className="page">
        {route.name === 'library' && <LibraryPage />}
        {route.name === 'book' && <BookPage bookId={route.book} />}
        {route.name === 'missing' && <Empty title="Page not found" body="That address doesn't match anything in the library." />}
      </main>
    </div>
  );
}
