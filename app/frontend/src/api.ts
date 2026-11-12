export interface User { id: string; email: string; name: string; role: 'user' | 'admin'; is_admin: boolean; created_at: string }

export type Kind = 'book' | 'article';
export type ChapterStatus = 'none' | 'queued' | 'running' | 'ready' | 'failed';
export type JobStatusName = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface Progress { part: number; anchor: string; offset: number; percent: number; furthest: number; updated_at: string }
export interface JobBrief { id: string; status: JobStatusName; stage: string; label: string; progress: number; position: number | null;
  queued_at: string; error: string | null }

export interface Doc {
  id: string; kind: Kind; title: string; subtitle: string; authors: string[]; edition: string; blurb: string; accent: string;
  pages: number; words: number; cover: string | null; source: 'upload' | 'handbuilt'; filename: string; created_at: string; updated_at: string;
  chapter_count: number; ready_count: number; generating_count: number; read_percent: number; last_read_at: string | null;
  existing?: boolean;
}
export interface PartSection { id: string; num: string; title: string; level?: 'major' | 'sub' }
export interface Part { n: number; file: string; words: number; sections: PartSection[] }
export interface ChapterStats { sections?: number; quizzes?: number; terminals?: number; diagrams?: number; labs?: number; words?: number }
export interface Chapter {
  id: number; document_id: string; position: number; number: string; title: string; pages: [number, number]; sections: number;
  source_words: number; minutes: number; status: ChapterStatus; summary: string; stats: ChapterStats; part_count: number;
  ready_at: string | null; progress: Progress | null; job: JobBrief | null; parts?: Part[];
}
export interface DocDetail extends Doc { chapters: Chapter[] }
export interface ChapterNav { id: number; number: string; title: string }
export interface ChapterView { chapter: Chapter; document: Doc; prev: ChapterNav | null; next: ChapterNav | null; base: string }
export interface Quota { used: number; limit: number | null; days: number; remaining: number | null }
export interface Home {
  continue: { chapter: Chapter; document: Doc }[];
  active: { job: JobBrief; chapter: ChapterNav; document: { id: string; title: string; kind: Kind } }[];
  recent: Doc[];
  quota: Quota;
}
export interface ProbeQuestion { id: string; kind: 'single' | 'multi' | 'text'; text: string; options: string[]; purpose: string }

export interface JobState {
  id: string; status: JobStatusName; stage: string; label: string; detail: string; progress: number; position: number | null;
  queued_at: string; started_at: string | null; finished_at: string | null; error: string | null;
  document: { id: string; title: string; kind: Kind; cover: boolean };
  chapter: { id: number; number: string; title: string; status: ChapterStatus; ready: boolean };
  owner_email?: string;
  admin?: { cost_usd: number; worker: string | null; attempts: number; words: number; owner: string; models: Record<string, string>;
            budget: number; dry_run: boolean };
}
export interface JobEvent { id?: number; ts: number; stage: string; msg: string; chunk?: string | null; level?: string }

// Admin: the harness's own view of a run (pipeline/harness/jobs.py job_status)
export interface NodeUsage { calls: number; input: number; cache_hit: number; output: number; reasoning: number; cost_usd: number; latency_s: number }
export interface Judge { faithful?: number; clear?: number; visual?: number; interactive?: number; polish?: number; overall?: number; error?: string;
  corrected?: number; errors_left?: number }
export interface JudgeError { where: string; problem: string; fix?: string }
export interface RunChunk {
  id: string; sections: string[]; title: string; tokens: number; words: number;
  state: 'waiting' | 'digested' | 'writing' | 'pass' | 'fail' | 'error';
  versions: number; score: number | null; pass: boolean | null; judge: Judge | null; cost_usd: number; digested: boolean;
}
export interface Run {
  job: { id: string; file: string; chapter_title: string; budget: number; max_fix: number; started: number;
         nodes: Record<string, { provider: string; model: string; thinking?: boolean }> };
  status: { stage?: string; error?: string; finished?: number };
  nodes: Record<string, NodeUsage>;
  totals: { calls: number; input: number; cache_hit: number; output: number; reasoning: number; cost_usd: number };
  chunks: RunChunk[];
  page: { ok: boolean; sections: number; errors: string[]; warnings: string[] } | null;
}
export interface JobDetail extends JobState { run?: Run | null; events?: JobEvent[] }
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
export interface Overview {
  queue: Record<JobStatusName, number>; workers: string[]; users: number; documents: number; cost_30d: number; words_30d: number;
  quota: { words: number; days: number; user_budget_usd: number };
}
export interface SearchResults {
  q: string;
  documents: { id: string; kind: Kind; title: string; subtitle: string; authors: string[]; cover: string | null }[];
  chapters: { id: number; number: string; title: string; status: ChapterStatus; document_id: string; document_title: string; kind: Kind }[];
  passages: { chapter_id: number; part: number; anchor: string; number: string; title: string; chapter_number: string; chapter_title: string;
    document_id: string; document_title: string; kind: Kind; snippet: string }[];
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Fired on any 401, so the app can drop back to the sign-in page. */
export const UNAUTHORIZED = 'readlab:unauthorized';

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { credentials: 'same-origin', ...init });
  if (!r.ok) {
    let msg = r.status === 404 ? 'Not found' : `Request failed (${r.status})`;
    try {
      const body = await r.json();
      if (typeof body.detail === 'string') msg = body.detail;
    } catch { /* not json */ }
    if (r.status === 401 && !path.startsWith('/api/auth/')) window.dispatchEvent(new Event(UNAUTHORIZED));
    throw new ApiError(r.status, msg.charAt(0).toUpperCase() + msg.slice(1));
  }
  return r.json() as Promise<T>;
}

const json = (method: string, body?: unknown): RequestInit => ({
  method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
});
const e = encodeURIComponent;

export const api = {
  me: () => req<User>('/api/auth/me'),
  signIn: (email: string, password: string, remember: boolean) => req<User>('/api/auth/signin', json('POST', { email, password, remember })),
  signUp: (name: string, email: string, password: string) => req<User>('/api/auth/signup', json('POST', { name, email, password })),
  signOut: () => req<{ ok: boolean }>('/api/auth/signout', json('POST')),

  home: () => req<Home>('/api/home'),
  quota: () => req<Quota>('/api/me/quota'),
  documents: (kind?: Kind) => req<Doc[]>(`/api/documents${kind ? `?kind=${kind}` : ''}`),
  document: (id: string) => req<DocDetail>(`/api/documents/${e(id)}`),
  editDocument: (id: string, patch: Partial<Pick<Doc, 'title' | 'subtitle' | 'authors'>>) => req<Doc>(`/api/documents/${e(id)}`, json('PATCH', patch)),
  deleteDocument: (id: string) => req<{ ok: boolean }>(`/api/documents/${e(id)}`, json('DELETE')),
  upload: (file: File, kind: 'auto' | Kind) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('kind', kind);
    return req<Doc>('/api/documents', { method: 'POST', body: fd });
  },

  chapter: (id: number) => req<ChapterView>(`/api/chapters/${id}`),
  questions: (id: number) => req<{ chapter: string; questions: ProbeQuestion[] }>(`/api/chapters/${id}/questions`, json('POST')),
  generate: (id: number, reader: unknown, options?: Record<string, unknown>) =>
    req<JobBrief>(`/api/chapters/${id}/generate`, json('POST', { reader, options })),
  saveProgress: (id: number, p: { part: number; anchor: string; offset: number }) => req<Progress>(`/api/chapters/${id}/progress`, json('PUT', p)),
  resetProgress: (id: number) => req<{ ok: boolean }>(`/api/chapters/${id}/progress`, json('DELETE')),

  search: (q: string, signal?: AbortSignal) => req<SearchResults>(`/api/search?q=${e(q)}`, { signal }),

  jobs: () => req<JobState[]>('/api/jobs'),
  job: (id: string) => req<JobDetail>(`/api/jobs/${e(id)}`),
  cancelJob: (id: string) => req<JobState>(`/api/jobs/${e(id)}/cancel`, json('POST')),
  retryJob: (id: string) => req<JobState>(`/api/jobs/${e(id)}/retry`, json('POST')),

  adminJobs: (status?: string) => req<JobState[]>(`/api/admin/jobs${status ? `?status=${status}` : ''}`),
  overview: () => req<Overview>('/api/admin/overview'),
  section: (job: string, chunk: string) => req<SectionDetail>(`/api/admin/jobs/${e(job)}/sections/${e(chunk)}`),
  pipeline: () => req<PipelineConfig>('/api/admin/pipeline'),
};
