export interface ChapterStats {
  sections?: number;
  quizzes?: number;
  terminals?: number;
  diagrams?: number;
  labs?: number;
}

export interface Chapter {
  id: string;
  title: string;
  summary?: string;
  made?: string;
  available: boolean;
  stats?: ChapterStats;
  url?: string;
}

export interface Book {
  id: string;
  title: string;
  edition: string;
  authors: string[];
  accent: string;
  blurb: string;
  chapter_count: number;
  ready_count: number;
  chapters: Chapter[];
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(r.status === 404 ? 'Not found' : `Request failed (${r.status})`);
  return r.json() as Promise<T>;
}

export const api = {
  books: () => get<Book[]>('/api/books'),
  book: (id: string) => get<Book>(`/api/books/${encodeURIComponent(id)}`),
};
