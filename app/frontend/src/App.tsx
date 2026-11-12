import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './auth';
import { Icon } from './components/Icon';
import { SearchPalette, openSearch } from './components/SearchPalette';
import { Sidebar } from './components/Sidebar';
import { ThemeToggle } from './components/ThemeToggle';
import { Empty, Toasts } from './components/ui';
import { useLocal } from './hooks';
import { AdminPage } from './pages/AdminPage';
import { AuthPage } from './pages/AuthPage';
import { ActivityPage, JobPage } from './pages/JobPages';
import { DocumentPage } from './pages/DocumentPage';
import { HomePage } from './pages/HomePage';
import { LibraryPage } from './pages/LibraryPage';
import { PipelinePage } from './pages/PipelinePage';
import { ReaderPage } from './pages/ReaderPage';
import { UploadPage } from './pages/UploadPage';
import { linkProps, navigate, useRoute, type Route } from './router';

const TITLES: Partial<Record<Route['name'], string>> = {
  home: 'Home', upload: 'Upload', activity: 'Activity', admin: 'Runs & queue', pipeline: 'Pipeline', signin: 'Sign in', signup: 'Create account',
};

export function App() {
  const { user, ready } = useAuth();
  const route = useRoute();
  const auth = route.name === 'signin' || route.name === 'signup';

  useEffect(() => {
    if (!ready) return;
    if (!user && !auth) {
      const next = location.pathname + location.search + location.hash;
      navigate(`/signin${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`, { replace: true, transition: false });
    } else if (user && auth) {
      const next = new URLSearchParams(location.search).get('next');
      navigate(next && next.startsWith('/') && !next.startsWith('//') ? next : '/', { replace: true });
    }
  }, [user, ready, auth]);

  useEffect(() => {
    const t = route.name === 'library' ? (route.kind === 'book' ? 'Books' : 'Articles') : TITLES[route.name];
    if (t) document.title = `${t} · readlab`;
  }, [route]);

  if (!ready) return <div className="splash" aria-busy="true"><span className="brand-mark big">r</span></div>;
  if (!user || auth) return <>{auth && <AuthPage mode={route.name === 'signup' ? 'signup' : 'signin'} />}<Toasts /></>;

  return (
    <>
      {route.name === 'reader' ? <ReaderPage chapterId={route.chapter} /> : <Shell route={route} />}
      <SearchPalette />
      <Toasts />
    </>
  );
}

function Shell({ route }: { route: Route }) {
  const { user } = useAuth();
  const [collapsed, setCollapsed] = useLocal('readlab.sidebar.collapsed', false);
  const [drawer, setDrawer] = useState(false);
  const closeDrawer = useCallback(() => setDrawer(false), []);
  const wide = route.name === 'job' || route.name === 'admin' || route.name === 'pipeline';

  return (
    <div className={`shell${collapsed ? ' rail' : ''}`}>
      <header className="mobilebar">
        <button className="icon-btn" onClick={() => setDrawer(true)} aria-label="Open menu" aria-expanded={drawer}><Icon name="menu" /></button>
        <a className="brand" {...linkProps('/')}><span className="brand-mark" aria-hidden>r</span>readlab</a>
        <span className="mobilebar-actions">
          <ThemeToggle />
          <button className="icon-btn" onClick={openSearch} aria-label="Search"><Icon name="search" /></button>
        </span>
      </header>
      <Sidebar route={route} collapsed={collapsed} onCollapse={() => setCollapsed(!collapsed)} drawerOpen={drawer} onCloseDrawer={closeDrawer} />
      {drawer && <div className="scrim" onClick={closeDrawer} aria-hidden />}
      <main className={`main${wide ? ' wide' : ''}`} {...(drawer ? ({ inert: '' } as Record<string, string>) : {})}>
        {route.name === 'home' && <HomePage />}
        {route.name === 'library' && <LibraryPage kind={route.kind} key={route.kind} />}
        {route.name === 'document' && <DocumentPage id={route.id} key={route.id} />}
        {route.name === 'upload' && <UploadPage />}
        {route.name === 'activity' && <ActivityPage />}
        {route.name === 'job' && <JobPage id={route.id} key={route.id} />}
        {route.name === 'admin' && (user?.is_admin ? <AdminPage /> : <Forbidden />)}
        {route.name === 'pipeline' && (user?.is_admin ? <PipelinePage /> : <Forbidden />)}
        {route.name === 'missing' && <Empty icon="alert" title="Page not found" body="That address doesn't match anything here."
          action={<a className="btn" {...linkProps('/')}>Go home</a>} />}
      </main>
    </div>
  );
}

const Forbidden = () => <Empty icon="shield" title="Admins only" body="This page is for administrators." action={<a className="btn" {...linkProps('/')}>Go home</a>} />;
