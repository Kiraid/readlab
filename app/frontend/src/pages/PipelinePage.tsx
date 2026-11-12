import { api } from '../api';
import { Empty, PageLoading } from '../components/ui';
import { useLoad } from '../hooks';

type Box = { x: number; y: number; w: number; h: number; title: string; sub?: string; kind: 'code' | 'model' | 'io' | 'store'; stack?: boolean; note?: string };

function Node({ b }: { b: Box }) {
  return (
    <g className={`pn pn-${b.kind}`}>
      {b.stack && <>
        <rect x={b.x + 10} y={b.y - 10} width={b.w} height={b.h} rx={12} className="pn-shadow" />
        <rect x={b.x + 5} y={b.y - 5} width={b.w} height={b.h} rx={12} className="pn-shadow" />
      </>}
      <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={12} />
      <text x={b.x + b.w / 2} y={b.y + (b.sub ? 26 : b.h / 2 + 5)} className="pn-title">{b.title}</text>
      {b.sub && b.sub.split('\n').map((l, i) => <text key={i} x={b.x + b.w / 2} y={b.y + 44 + i * 14} className="pn-sub">{l}</text>)}
      {b.note && <text x={b.x + b.w / 2} y={b.y + b.h + 18} className="pn-note">{b.note}</text>}
    </g>
  );
}

const arrow = (d: string, cls = '') => <path d={d} className={`pa ${cls}`} markerEnd="url(#pa-head)" />;

/** Admins: how an upload becomes a chapter page, with the models read from pipeline/config.yaml. */
export function PipelinePage() {
  const { data: cfg, loading, error } = useLoad(() => api.pipeline(), []);
  if (loading) return <PageLoading />;
  if (error || !cfg) return <Empty icon="alert" title="Couldn't load the pipeline" body={error} />;
  const m = (node: string) => {
    const n = cfg.nodes[node];
    return n ? `${n.model.replace('deepseek-', '')}${n.thinking ? ' · thinks' : ''}` : '';
  };

  const B: Record<string, Box> = {
    upload: { x: 6, y: 24, w: 128, h: 64, title: 'upload', sub: 'outline · cover\nwords per page', kind: 'io' },
    generate: { x: 168, y: 24, w: 150, h: 64, title: 'generate', sub: 'reader answers\nquota check', kind: 'io' },
    queue: { x: 352, y: 24, w: 160, h: 64, title: 'jobs queue', sub: 'Postgres · SKIP LOCKED\nheartbeat · requeue', kind: 'store' },
    worker: { x: 546, y: 24, w: 150, h: 64, title: 'worker', sub: `${cfg.run.max_concurrency ?? 12} branches / job`, kind: 'code' },
    sse: { x: 870, y: 24, w: 270, h: 64, title: 'live progress', sub: 'job_events + NOTIFY → SSE\nreaders see stages; admins see this', kind: 'store' },
    ingest: { x: 6, y: 196, w: 130, h: 92, title: 'ingest', sub: 'outline → sections\n→ chunks + features\nno model', kind: 'code' },
    digest: { x: 168, y: 200, w: 128, h: 84, title: 'digest', sub: `${m('digest')}\nJSON per chunk`, kind: 'model', stack: true, note: '× N chunks, in parallel' },
    plan: { x: 330, y: 200, w: 140, h: 84, title: 'plan', sub: `${m('plan')}\n1 call · digests only`, kind: 'model' },
    write: { x: 520, y: 166, w: 112, h: 66, title: 'write', sub: m('write'), kind: 'model' },
    validate: { x: 664, y: 166, w: 112, h: 66, title: 'validate', sub: 'build + checks\nno model', kind: 'code' },
    fix: { x: 592, y: 278, w: 112, h: 66, title: 'fix', sub: `${m('fix')}\nJSON edits`, kind: 'model' },
    judge: { x: 836, y: 166, w: 112, h: 66, title: 'judge', sub: `${m('judge')}\nrubric + errors`, kind: 'model' },
    correct: { x: 1000, y: 166, w: 128, h: 66, title: 'correct', sub: `${m('correct')}\nonly if flagged`, kind: 'model' },
    build: { x: 520, y: 446, w: 170, h: 72, title: 'build', sub: 'parts + cached assets\nmanifest · search text', kind: 'code' },
    publish: { x: 736, y: 446, w: 180, h: 72, title: 'publish', sub: 'chapter ready\nfull-text index', kind: 'store' },
    reader: { x: 962, y: 446, w: 166, h: 72, title: 'reader', sub: 'one part at a time\nprogress saved', kind: 'io' },
  };

  return (
    <div>
      <header className="page-head">
        <h1>How a chapter gets made</h1>
        <p className="sub">Blue boxes call a model; grey boxes are plain code; purple is the database. Models come from <code>pipeline/config.yaml</code>.</p>
      </header>

      <figure className="pipe">
        <svg viewBox="0 0 1150 545" role="img" aria-label="Upload, generate, Postgres queue, worker; then ingest, digest per chunk, plan, per-chunk write-validate-fix and judge-correct, then build parts, publish, reader">
          <defs>
            <marker id="pa-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" className="pa-head" /></marker>
          </defs>
          <rect x="508" y="132" width="632" height="248" rx="18" className="pn-group" />
          <text x="520" y="152" className="pn-glabel">section branch · × N in parallel · judged as soon as written</text>
          <text x="790" y="366" className="pn-note">max {cfg.run.max_fix_rounds ?? 2} fix rounds · a correction that breaks a check is reverted</text>

          {arrow('M134 56 H168')}
          {arrow('M318 56 H352')}
          {arrow('M512 56 H546')}
          {arrow('M696 56 H870', 'live')}
          <text x="783" y="48" className="pn-edge">events</text>
          {arrow('M621 88 C 621 140, 71 130, 71 196')}
          <text x="330" y="128" className="pn-edge">claims the oldest queued job</text>
          {arrow('M136 242 H168')}
          {arrow('M296 242 H330')}
          {arrow('M470 242 C 492 242, 498 199, 520 199')}
          {arrow('M632 199 H664')}
          {arrow('M720 232 C 720 276, 714 311, 704 311', 'fail')}
          <text x="752" y="276" className="pn-edge bad">fails a check</text>
          {arrow('M592 311 C 548 311, 540 256, 600 232', 'loop')}
          {arrow('M776 199 H836')}
          <text x="806" y="190" className="pn-edge ok">passes</text>
          {arrow('M948 199 H1000')}
          <text x="974" y="190" className="pn-edge bad">errors</text>
          {arrow('M1064 232 C 1064 290, 892 290, 892 232', 'loop')}
          <text x="980" y="300" className="pn-edge">judged again</text>
          {arrow('M892 380 C 892 420, 605 410, 605 446')}
          <text x="750" y="410" className="pn-bar">wait for all sections</text>
          {arrow('M690 482 H736')}
          {arrow('M916 482 H962')}

          {Object.values(B).map((b) => <Node key={b.title} b={b} />)}
          <text x="400" y="186" className="pn-bar">wait for all</text>
        </svg>
        <figcaption>
          <span><i className="lg lg-model" /> model call (one request, fixed JSON or Markdown out)</span>
          <span><i className="lg lg-code" /> code, no model</span>
          <span><i className="lg lg-store" /> database</span>
          <span><i className="lg lg-stack" /> stacked = one branch per chunk, in parallel</span>
        </figcaption>
      </figure>

      <div className="faq">
        <section>
          <h3>From upload to the queue</h3>
          <p>An upload is read once, with no model: the outline gives the chapters and their pages, the first page becomes the cover, and every page's words are counted (that count is what a reader's allowance is charged). Generating a chapter asks a few <b>probe</b> questions ({m('probe')}), then puts a row in the <code>jobs</code> table.</p>
        </section>
        <section>
          <h3>The queue and the workers</h3>
          <p>A worker claims the oldest queued row with <code>FOR UPDATE SKIP LOCKED</code>, so any number of workers can drain the same queue. It sends a heartbeat every 20 s; a job whose worker goes quiet for three minutes goes back in the queue (twice at most). Stopping a worker hands its jobs back straight away. <code>python -m app.backend.worker --drain</code> works through the queue and exits.</p>
        </section>
        <section>
          <h3>Are these agents calling other agents?</h3>
          <p>No. Every blue box is a single request with a fixed input and output shape. <b>The graph decides</b> what runs next: one digest branch per chunk, one plan call, then one section branch per chunk that writes, checks, fixes, judges and corrects its own section.</p>
        </section>
        <section>
          <h3>Progress people see</h3>
          <p>Each harness event is written to <code>job_events</code> with a <code>NOTIFY</code>; the API streams it over server-sent events. Readers see <i>Ingesting → Reading closely → Planning → Writing → Judging → Building pages</i> and a bar; models, prices and these events are admin-only.</p>
        </section>
        <section>
          <h3>Pages that load fast</h3>
          <p>The build splits a chapter into parts of about 2,000 words at section boundaries. Engine code and styles go into one hashed bundle the browser caches once, so each part is a few dozen KB. Every section's plain text goes into a full-text index for search, and the reader saves the part and scroll position as you go.</p>
        </section>
        <section>
          <h3>Models and prices right now</h3>
          <table className="tbl">
            <thead><tr><th>node</th><th>model</th><th>thinking</th><th>max output</th></tr></thead>
            <tbody>{['probe', 'digest', 'plan', 'write', 'fix', 'judge', 'correct'].map((n) => cfg.nodes[n] && (
              <tr key={n}><td>{n}</td><td className="mono">{cfg.nodes[n].model}</td><td>{cfg.nodes[n].thinking ? 'yes' : 'no'}</td><td>{cfg.nodes[n].max_tokens}</td></tr>
            ))}</tbody>
          </table>
          <p className="muted small">Per 1M tokens at peak (off-peak is half): {Object.entries(cfg.prices).map(([k2, p]) => `${k2} in $${p.cache_miss} (cached $${p.cache_hit}) · out $${p.output}`).join(' | ')}</p>
        </section>
      </div>
    </div>
  );
}
