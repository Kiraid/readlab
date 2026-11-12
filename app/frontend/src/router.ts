import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';

// A tiny history router.
//   /                 home: continue reading, active jobs      /signin, /signup     accounts
//   /books, /articles the library                              /d/:id               one book or article
//   /r/:chapter       the reader (?part=N#anchor)              /upload              add a PDF
//   /activity         your jobs        /jobs/:id  one job      /admin, /admin/pipeline   admins only
export type Route =
  | { name: 'home' }
  | { name: 'signin' }
  | { name: 'signup' }
  | { name: 'library'; kind: 'book' | 'article' }
  | { name: 'document'; id: string }
  | { name: 'reader'; chapter: number }
  | { name: 'upload' }
  | { name: 'activity' }
  | { name: 'job'; id: string }
  | { name: 'admin' }
  | { name: 'pipeline' }
  | { name: 'missing' };

export function parse(path: string): Route {
  const p = path.split('/').filter(Boolean).map(decodeURIComponent);
  const [a, b] = p;
  if (p.length === 0) return { name: 'home' };
  if (p.length === 1) {
    if (a === 'signin' || a === 'signup' || a === 'upload' || a === 'activity' || a === 'admin') return { name: a };
    if (a === 'books') return { name: 'library', kind: 'book' };
    if (a === 'articles') return { name: 'library', kind: 'article' };
  }
  if (p.length === 2) {
    if (a === 'd') return { name: 'document', id: b };
    if (a === 'r' && /^\d+$/.test(b)) return { name: 'reader', chapter: Number(b) };
    if (a === 'jobs') return { name: 'job', id: b };
    if (a === 'admin' && b === 'pipeline') return { name: 'pipeline' };
  }
  return { name: 'missing' };
}

const NAV = 'readlab:navigate';
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Change the URL and re-render, cross-fading with a view transition where the browser has them. */
export function navigate(to: string, opts: { replace?: boolean; transition?: boolean } = {}) {
  if (to === location.pathname + location.search + location.hash) return;
  const samePage = to.split('?')[0] === location.pathname;
  const apply = () => {
    history[opts.replace ? 'replaceState' : 'pushState'](null, '', to);
    flushSync(() => window.dispatchEvent(new Event(NAV)));
    if (!samePage) window.scrollTo(0, 0);
  };
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };
  // a hidden tab renders no frames, so a transition there would hold the navigation until it is shown again
  if (opts.transition !== false && !samePage && doc.startViewTransition && !reduced() && document.visibilityState === 'visible') {
    doc.startViewTransition(apply).finished.then(focusMain, focusMain);
  } else {
    apply();
    if (!samePage) focusMain();
  }
}

/** After a page change, put focus on the new page's heading, so keyboard and screen reader users keep their place. */
function focusMain() {
  const h = document.querySelector<HTMLElement>('main h1, main [data-focus]');
  if (h) {
    if (!h.hasAttribute('tabindex')) h.setAttribute('tabindex', '-1');
    h.focus({ preventScroll: true });
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(location.pathname));
  useEffect(() => {
    const on = () => setRoute(parse(location.pathname));
    window.addEventListener('popstate', on);
    window.addEventListener(NAV, on);
    return () => { window.removeEventListener('popstate', on); window.removeEventListener(NAV, on); };
  }, []);
  return route;
}

export function useQuery(): URLSearchParams {
  const [q, setQ] = useState(() => new URLSearchParams(location.search));
  useEffect(() => {
    const on = () => setQ(new URLSearchParams(location.search));
    window.addEventListener('popstate', on);
    window.addEventListener(NAV, on);
    return () => { window.removeEventListener('popstate', on); window.removeEventListener(NAV, on); };
  }, []);
  return q;
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
