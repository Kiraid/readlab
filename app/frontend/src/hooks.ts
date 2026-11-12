import { useCallback, useEffect, useRef, useState } from 'react';
import type { JobEvent, JobState } from './api';

/** Fetch with loading and error state; `reload()` refetches without clearing what is shown. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const [tick, setTick] = useState(0);
  const first = useRef(true);
  useEffect(() => { first.current = true; }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let live = true;
    if (first.current) setState({ loading: true });
    first.current = false;
    load().then(
      (data) => live && setState({ data, loading: false }),
      (e: Error) => live && setState((s) => ({ ...s, error: e.message, loading: false })),
    );
    return () => { live = false; };
  }, [...deps, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload, setData: (data: T) => setState({ data, loading: false }) };
}

/** A job's live state over server-sent events. Admins also get the harness's own log lines. */
export function useJobStream(id: string | null | undefined, onEnd?: (s: JobState) => void) {
  const [state, setState] = useState<JobState | null>(null);
  const [log, setLog] = useState<JobEvent[]>([]);
  const end = useRef(onEnd);
  end.current = onEnd;
  useEffect(() => {
    if (!id) return;
    setState(null);
    setLog([]);
    const es = new EventSource(`/api/jobs/${encodeURIComponent(id)}/stream`);
    let last: JobState | null = null;
    es.addEventListener('state', (e) => { last = JSON.parse((e as MessageEvent).data); setState(last); });
    es.addEventListener('log', (e) => {
      const ev = JSON.parse((e as MessageEvent).data) as JobEvent;
      setLog((l) => (l.some((x) => x.id === ev.id) ? l : [...l.slice(-399), ev]));
    });
    es.addEventListener('end', () => { es.close(); if (last) end.current?.(last); });
    return () => es.close();
  }, [id]);
  return { state, log };
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useLocal<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const s = localStorage.getItem(key);
      return s === null ? initial : (JSON.parse(s) as T);
    } catch { return initial; }
  });
  const set = useCallback((next: T) => {
    setV(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* private window: not remembered */ }
  }, [key]);
  return [v, set];
}

// Colour scheme: "system" (no stored value), "light" or "dark", applied through <meta name="color-scheme">.
export type Scheme = 'system' | 'light' | 'dark';
const SCHEME_KEY = 'color-scheme';
const SCHEME_EVENT = 'readlab:scheme';

export function useScheme(): [Scheme, (s: Scheme) => void] {
  const read = (): Scheme => {
    try {
      const s = localStorage.getItem(SCHEME_KEY);
      return s === 'light' || s === 'dark' ? s : 'system';
    } catch { return 'system'; }
  };
  const [scheme, setScheme] = useState<Scheme>(read);
  useEffect(() => {
    const on = (e: StorageEvent) => { if (e.key === SCHEME_KEY) { setScheme(read()); apply(read()); } };
    const here = (e: Event) => setScheme((e as CustomEvent<Scheme>).detail);  // another control on this page
    window.addEventListener('storage', on);
    window.addEventListener(SCHEME_EVENT, here);
    return () => { window.removeEventListener('storage', on); window.removeEventListener(SCHEME_EVENT, here); };
  }, []);
  const set = (s: Scheme) => {
    try {
      if (s === 'system') localStorage.removeItem(SCHEME_KEY); else localStorage.setItem(SCHEME_KEY, s);
    } catch { /* still applied for this page */ }
    apply(s);
    window.dispatchEvent(new CustomEvent(SCHEME_EVENT, { detail: s }));
  };
  return [scheme, set];
}

function apply(s: Scheme) {
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) meta.setAttribute('content', s === 'system' ? 'light dark' : s);
}

export const fmt = {
  ago(iso: string | null | undefined): string {
    if (!iso) return '';
    const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    if (s < 86400 * 7) return `${Math.round(s / 86400)} d ago`;
    return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  },
  words(n: number): string { return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n); },
  minutes(m: number): string { return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; },
  pct(x: number): string { return `${Math.round(x * 100)}%`; },
};
