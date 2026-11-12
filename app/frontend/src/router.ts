import { useEffect, useState } from 'react';

// A tiny history router.
//   /                      library            /upload          upload a document, pick a chapter, start a job
//   /books/:book           one book           /jobs/:id        a job's live progress
//   /books/:book/:chapter  reader             /pipeline        how the pipeline works
export type Route =
  | { name: 'library' }
  | { name: 'book'; book: string }
  | { name: 'reader'; book: string; chapter: string }
  | { name: 'upload' }
  | { name: 'job'; job: string }
  | { name: 'pipeline' }
  | { name: 'missing' };

export function parse(path: string): Route {
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts.length === 0) return { name: 'library' };
  if (parts[0] === 'books' && parts.length === 2) return { name: 'book', book: parts[1] };
  if (parts[0] === 'books' && parts.length === 3) return { name: 'reader', book: parts[1], chapter: parts[2] };
  if (parts[0] === 'upload' && parts.length === 1) return { name: 'upload' };
  if (parts[0] === 'jobs' && parts.length === 2) return { name: 'job', job: parts[1] };
  if (parts[0] === 'pipeline' && parts.length === 1) return { name: 'pipeline' };
  return { name: 'missing' };
}

export function navigate(to: string) {
  if (to === location.pathname) return;
  history.pushState(null, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo(0, 0);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(location.pathname));
  useEffect(() => {
    const on = () => setRoute(parse(location.pathname));
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);
  return route;
}

/** An <a> that navigates without a reload (and still works with ctrl/cmd-click). */
export function linkProps(to: string) {
  return {
    href: to,
    onClick: (e: React.MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      navigate(to);
    },
  };
}
