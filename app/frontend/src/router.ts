import { useEffect, useState } from 'react';

// A tiny history router: three routes don't need a library.
//   /                      library
//   /books/:book           one book
//   /books/:book/:chapter  reader
export type Route =
  | { name: 'library' }
  | { name: 'book'; book: string }
  | { name: 'reader'; book: string; chapter: string }
  | { name: 'missing' };

export function parse(path: string): Route {
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts.length === 0) return { name: 'library' };
  if (parts[0] === 'books' && parts.length === 2) return { name: 'book', book: parts[1] };
  if (parts[0] === 'books' && parts.length === 3) return { name: 'reader', book: parts[1], chapter: parts[2] };
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
