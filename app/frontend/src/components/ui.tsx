import { useEffect, useState } from 'react';
import { linkProps } from '../router';

/** Fetch helper with loading and error state. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  useEffect(() => {
    let live = true;
    setState({ loading: true });
    load().then(
      (data) => live && setState({ data, loading: false }),
      (e: Error) => live && setState({ error: e.message, loading: false }),
    );
    return () => { live = false; };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      <p>{body}</p>
      <a className="btn ghost" {...linkProps('/')}>Back to the library</a>
    </div>
  );
}

export function Loading() {
  return <div className="loading" aria-busy="true"><span /><span /><span /></div>;
}
