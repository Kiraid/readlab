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

export interface ChapterOption { selector: string; title: string; pages: [number, number]; sections: number }
export interface Upload { id: string; name: string; pages: number; bytes?: number; chapters: ChapterOption[]; uploaded: number }
export interface ProbeQuestion { id: string; kind: 'single' | 'multi' | 'text'; text: string; options: string[]; purpose: string }
export interface JobSummary { id: string; file: string; chapter: string; stage: string; started: number; cost_usd: number }

export interface NodeUsage { calls: number; input: number; cache_hit: number; output: number; reasoning: number; cost_usd: number; latency_s: number }
export interface JobEvent { ts: number; stage: string; msg: string; chunk?: string; level?: string }
export interface Judge { faithful?: number; clear?: number; visual?: number; interactive?: number; polish?: number; overall?: number; error?: string;
  corrected?: number; errors_left?: number }
export interface JudgeError { where: string; problem: string; fix?: string }
export interface JobChunk {
  id: string; sections: string[]; title: string; tokens: number; words: number;
  state: 'waiting' | 'digested' | 'writing' | 'pass' | 'fail' | 'error';
  versions: number; score: number | null; pass: boolean | null; judge: Judge | null; cost_usd: number; digested: boolean;
}
export interface JobStatus {
  job: { id: string; file: string; chapter_title: string; budget: number; max_fix: number; started: number;
         nodes: Record<string, { provider: string; model: string; thinking?: boolean }> };
  status: { stage?: string; error?: string; finished?: number; chapter?: { id: string; title: string } };
  events: JobEvent[];
  nodes: Record<string, NodeUsage>;
  totals: { calls: number; input: number; cache_hit: number; output: number; reasoning: number; cost_usd: number };
  chunks: JobChunk[];
  page: { ok: boolean; url: string | null; sections: number; errors: string[]; warnings: string[] } | null;
  running: boolean;
}
export interface SectionDetail {
  chunk: string; markdown: string | null; versions: string[]; error: string | null;
  score: { pass: boolean; score: number; must: Record<string, boolean>; issues: string[]; metrics: Record<string, unknown> } | null;
  judge: (Judge & { reasons?: Record<string, string>; top_fix?: string; errors?: JudgeError[];
    correction?: { errors: number; applied: boolean; reverted?: boolean; note?: string; fixed?: JudgeError[]; before?: Judge; errors_left?: number } }) | null;
  digest: Record<string, unknown> | null;
  plan: { brief?: string; skills?: string[]; visuals?: string[]; expect?: Record<string, unknown> } | null;
}
export interface PipelineConfig {
  nodes: Record<string, { provider: string; model: string; thinking?: boolean; max_tokens?: number }>;
  run: Record<string, number>;
  prices: Record<string, { cache_hit: number; cache_miss: number; output: number }>;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, init);
  if (!r.ok) {
    let msg = `Request failed (${r.status})`;
    try { msg = (await r.json()).detail ?? msg; } catch { /* not json */ }
    throw new Error(r.status === 404 && msg.startsWith('Request') ? 'Not found' : msg);
  }
  return r.json() as Promise<T>;
}

export const api = {
  books: () => req<Book[]>('/api/books'),
  book: (id: string) => req<Book>(`/api/books/${encodeURIComponent(id)}`),
  uploads: () => req<Upload[]>('/api/uploads'),
  upload: (id: string) => req<Upload>(`/api/uploads/${encodeURIComponent(id)}`),
  sendFile: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return req<Upload>('/api/uploads', { method: 'POST', body: fd });
  },
  probe: (upload_id: string, chapter: string) =>
    req<{ chapter: string; questions: ProbeQuestion[] }>(`/api/uploads/${encodeURIComponent(upload_id)}/probe`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chapter }) }),
  startJob: (upload_id: string, chapter: string, options: Record<string, unknown>) =>
    req<{ id: string }>('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ upload_id, chapter, options }) }),
  jobs: () => req<JobSummary[]>('/api/jobs'),
  job: (id: string) => req<JobStatus>(`/api/jobs/${encodeURIComponent(id)}`),
  section: (id: string, chunk: string) => req<SectionDetail>(`/api/jobs/${encodeURIComponent(id)}/sections/${encodeURIComponent(chunk)}`),
  pipeline: () => req<PipelineConfig>('/api/pipeline'),
};
