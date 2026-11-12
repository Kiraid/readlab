import { api } from '../api';
import { useLoad } from '../components/ui';

type Box = { x: number; y: number; w: number; h: number; title: string; sub?: string; kind: 'code' | 'model' | 'io'; stack?: boolean; note?: string };

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

export function PipelinePage() {
  const { data: cfg } = useLoad(() => api.pipeline(), []);
  const m = (node: string) => {
    const n = cfg?.nodes[node];
    return n ? `${n.model.replace('deepseek-', '')}${n.thinking ? ' · thinks' : ''}` : '';
  };

  const B: Record<string, Box> = {
    upload: { x: 6, y: 196, w: 112, h: 64, title: 'PDF upload', sub: '1 chapter', kind: 'io' },
    ingest: { x: 146, y: 182, w: 140, h: 92, title: 'ingest', sub: 'outline → sections\n→ chunks + features\nno model', kind: 'code' },
    digest: { x: 322, y: 186, w: 128, h: 84, title: 'digest', sub: `${m('digest')}\nJSON per chunk`, kind: 'model', stack: true, note: '× N chunks, in parallel' },
    plan: { x: 486, y: 186, w: 150, h: 84, title: 'plan', sub: `${m('plan')}\n1 call · digests only`, kind: 'model' },
    write: { x: 676, y: 150, w: 112, h: 66, title: 'write', sub: m('write'), kind: 'model' },
    validate: { x: 820, y: 150, w: 112, h: 66, title: 'validate', sub: 'build + checks\nno model', kind: 'code' },
    fix: { x: 748, y: 262, w: 112, h: 66, title: 'fix', sub: `${m('fix')}\nJSON edits`, kind: 'model' },
    judge: { x: 1000, y: 186, w: 112, h: 84, title: 'judge', sub: `${m('judge')}\nrubric scores`, kind: 'model' },
    out: { x: 992, y: 356, w: 128, h: 76, title: 'files', sub: 'chapter/*.md\nreport · ledger', kind: 'io' },
  };

  return (
    <>
      <section className="intro">
        <h1>How the pipeline runs</h1>
        <p>One chapter in, one file per section out. Boxes in blue call a model; grey boxes are plain code. The graph is built with LangGraph; this page reads the models from <code>pipeline/config.yaml</code>.</p>
      </section>

      <figure className="pipe">
        <svg viewBox="0 0 1150 450" role="img" aria-label="The pipeline: ingest, digest per chunk in parallel, one plan call, then per chunk in parallel write-validate-fix and judge, then files">
          <defs>
            <marker id="pa-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" className="pa-head" /></marker>
          </defs>
          {/* the per-chunk section loop */}
          <rect x="666" y="118" width="462" height="236" rx="18" className="pn-group-shadow" transform="translate(10,-10)" />
          <rect x="666" y="118" width="462" height="236" rx="18" className="pn-group" />
          <text x="676" y="138" className="pn-glabel">section branch · × N in parallel · judged as soon as written</text>
          <text x="956" y="344" className="pn-note" textAnchor="end">max {cfg?.run.max_fix_rounds ?? 2} fix rounds</text>

          {arrow('M118 228 H146')}
          {arrow('M286 228 H322')}
          {arrow('M450 228 H486')}
          {arrow('M636 228 C 656 228, 656 183, 676 183')}
          {arrow('M788 183 H820')}
          {arrow('M876 216 C 876 260, 870 295, 860 295', 'fail')}
          <text x="898" y="258" className="pn-edge bad">fails a check</text>
          {arrow('M748 295 C 700 295, 690 240, 790 216', 'loop')}
          <text x="690" y="262" className="pn-edge">patched draft</text>
          {arrow('M932 183 C 970 183, 975 228, 1000 228')}
          <text x="972" y="172" className="pn-edge ok">passes</text>
          {arrow('M1056 270 V356')}

          {Object.values(B).map((b) => <Node key={b.title} b={b} />)}

          {/* barriers */}
          <text x="468" y="172" className="pn-bar">wait for all</text>
          <text x="984" y="388" className="pn-bar" textAnchor="end">wait for all</text>
        </svg>
        <figcaption>
          <span><i className="lg lg-model" /> model call (one request, fixed JSON or Markdown out)</span>
          <span><i className="lg lg-code" /> code, no model</span>
          <span><i className="lg lg-stack" /> stacked = one branch per chunk, run in parallel (up to {cfg?.run.max_concurrency ?? 6} at a time)</span>
        </figcaption>
      </figure>

      <div className="faq">
        <section>
          <h3>Are these agents calling other agents?</h3>
          <p>No. Every blue box is a single request with a fixed input and a fixed output shape (JSON for digest, plan, fix and judge; a section file for write). None of them has tools or decides what runs next. <b>The graph decides</b>: after ingest it sends one digest branch per chunk (LangGraph <code>Send</code>), waits for all of them, makes one plan call, then sends one section branch per chunk. Each branch writes, checks and fixes its section and has it judged straight away, so a fast section never waits for the slowest one. The files are written once every branch is done.</p>
        </section>
        <section>
          <h3>Then what's the loop?</h3>
          <p>Inside each section branch: <b>write</b> produces the section, <b>validate</b> (code) builds the page and runs the checks against the source, and if a must-check fails, <b>fix</b> gets only the problems (e.g. "this sentence of yours copies the source") and returns find/replace edits. Validate runs again. At most {cfg?.run.max_fix_rounds ?? 2} rounds; the checker's verdict, not the model, decides when to stop.</p>
        </section>
        <section>
          <h3>Where does caching happen?</h3>
          <p><b>At the provider, automatically.</b> DeepSeek caches prompt prefixes it has seen. Every write and fix call starts with the same ~9.5k-token system prompt (format guide, skills, widget catalog), and every digest call with the same digest instructions, so after the first call those tokens are billed as cache hits, at about 2% of the normal input price. The job page shows the hit rate per node.</p>
          <p><b>In the harness, on disk.</b> Every response is stored under a hash of its exact prompt (<code>.cache/llm/</code>). Re-running a job after changing one prompt only pays for the calls whose prompt changed.</p>
        </section>
        <section>
          <h3>What does each call see?</h3>
          <ul>
            <li><b>digest</b>: one chunk's text and its counted features. Never other chunks.</li>
            <li><b>plan</b>: the outline and every digest. <b>Never the source text</b>; it is the one call that sees the whole chapter, so it reads summaries.</li>
            <li><b>write</b>: the toolkit (cached), its chunk's text, the listings, and its brief from the plan.</li>
            <li><b>fix</b>: the same, plus its draft and the checker's problems.</li>
            <li><b>judge</b>: the chunk's text, the brief, the section and the checker's findings, scored with the rubric.</li>
          </ul>
        </section>
        <section>
          <h3>What a 200-page book means</h3>
          <p>You run one chapter at a time. A chapter becomes 5–20 chunks; each chunk gets one digest, one write (plus fixes if needed) and one judge, all in parallel, and the chapter gets one plan. No call ever holds more than one chunk of source text.</p>
        </section>
        {cfg && (
          <section>
            <h3>Models and prices right now</h3>
            <table className="tbl">
              <thead><tr><th>node</th><th>model</th><th>thinking</th><th>max output</th></tr></thead>
              <tbody>{['digest', 'plan', 'write', 'fix', 'judge'].map((n) => cfg.nodes[n] && (
                <tr key={n}><td>{n}</td><td className="mono">{cfg.nodes[n].model}</td><td>{cfg.nodes[n].thinking ? 'yes' : 'no'}</td><td>{cfg.nodes[n].max_tokens}</td></tr>
              ))}</tbody>
            </table>
            <p className="hint">Per 1M tokens at peak (off-peak is half): {Object.entries(cfg.prices).map(([k2, p]) => `${k2} in $${p.cache_miss} (cached $${p.cache_hit}) · out $${p.output}`).join(' | ')}</p>
          </section>
        )}
      </div>
    </>
  );
}
