import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Icon } from '../components/Icon';
import { ThemeToggle } from '../components/ThemeToggle';
import { linkProps } from '../router';

export function AuthPage({ mode }: { mode: 'signin' | 'signup' }) {
  const { setUser } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [show, setShow] = useState(false);
  const [password, setPassword] = useState('');
  const signup = mode === 'signup';

  useEffect(() => { setError(''); setPassword(''); document.title = `${signup ? 'Create account' : 'Sign in'} · readlab`; }, [signup]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError('');
    try {
      const email = String(f.get('email') || '');
      const pw = String(f.get('password') || '');
      setUser(signup ? await api.signUp(String(f.get('name') || ''), email, pw) : await api.signIn(email, pw, f.get('remember') === 'on'));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const strength = pwStrength(password);
  const next = location.search;
  return (
    <div className="auth">
      <section className="auth-form-side">
        <div className="auth-top">
          <a className="brand auth-brand" {...linkProps('/signin')}><span className="brand-mark" aria-hidden>r</span>readlab</a>
          <ThemeToggle />
        </div>
        <div className="auth-card">
          <h1>{signup ? 'Create your account' : 'Welcome back'}</h1>
          <p className="auth-sub">{signup ? 'Turn the technical books on your shelf into pages you can poke at.' : 'Sign in to pick up where you left off.'}</p>

          <form onSubmit={submit} className="form" noValidate={false}>
            {signup && (
              <div className="field">
                <label htmlFor="name">Name</label>
                <input id="name" name="name" type="text" autoComplete="name" required maxLength={120} enterKeyHint="next" />
              </div>
            )}
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" name="email" type="email" autoComplete={signup ? 'email' : 'username'} spellCheck={false} required
                enterKeyHint="next" autoFocus />
            </div>
            <div className="field">
              <div className="field-row">
                <label htmlFor={signup ? 'new-password' : 'current-password'}>Password</label>
                {signup && <span className="hint" id="pw-hint">At least 8 characters</span>}
              </div>
              <div className="pw">
                <input id={signup ? 'new-password' : 'current-password'} name="password" type={show ? 'text' : 'password'}
                  autoComplete={signup ? 'new-password' : 'current-password'} required minLength={signup ? 8 : undefined}
                  aria-describedby={signup ? 'pw-hint' : undefined} value={password} onChange={(e) => setPassword(e.target.value)} enterKeyHint="done" />
                <button type="button" className="pw-toggle" onClick={() => setShow(!show)} aria-pressed={show}
                  aria-label={show ? 'Hide password' : 'Show password'}><Icon name={show ? 'eyeoff' : 'eye'} size={17} /></button>
              </div>
              {signup && password && (
                <div className={`strength s${strength.score}`} aria-live="polite">
                  <span /><span /><span /><span /><em>{strength.label}</em>
                </div>
              )}
            </div>
            {!signup && (
              <label className="check"><input type="checkbox" name="remember" defaultChecked /> Keep me signed in</label>
            )}
            <p className="form-error" role="alert" aria-live="assertive">{error}</p>
            <button className="btn primary block" type="submit" disabled={busy}>
              {busy ? <span className="spinner small" aria-hidden /> : null}{signup ? 'Create account' : 'Sign in'}
            </button>
          </form>

          <p className="auth-switch">
            {signup ? 'Already have an account? ' : 'New here? '}
            <a {...linkProps(`/${signup ? 'signin' : 'signup'}${next}`)}>{signup ? 'Sign in' : 'Create an account'}</a>
          </p>
        </div>
        <p className="auth-foot">Your uploads and pages are private to your account.</p>
      </section>
      <Showcase />
    </div>
  );
}

function pwStrength(p: string): { score: number; label: string } {
  let s = 0;
  if (p.length >= 8) s++;
  if (p.length >= 12) s++;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++;
  if (/\d/.test(p) && /[^\w\s]/.test(p)) s++;
  return { score: s, label: ['Too short', 'Okay', 'Good', 'Strong', 'Very strong'][s] };
}

const LINES = [
  ['$ kubectl get pods', 'NAME          READY   STATUS', 'kiada-7f9c    1/1     Running'],
  ['$ SELECT * FROM accounts', '  -- snapshot isolation', '  -- reads see one commit point'],
  ['$ cargo run', '   Compiling ownership v0.1.0', 'error[E0382]: borrow of moved value'],
];

/** The other half of the page: what a chapter turns into, moving. */
function Showcase() {
  const [shown, setShown] = useState('');
  const [k, setK] = useState(0);
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const text = LINES[k % LINES.length].join('\n');
    if (reduce) { setShown(text); return; }
    let i = 0;
    let t: number;
    const step = () => {
      i++;
      setShown(text.slice(0, i));
      t = window.setTimeout(i < text.length ? step : () => setK((x) => x + 1), i < text.length ? (text[i - 1] === '\n' ? 260 : 32) : 2600);
    };
    setShown('');
    t = window.setTimeout(step, 400);
    return () => clearTimeout(t);
  }, [k]);

  return (
    <aside className="auth-show" aria-label="What readlab makes">
      <div className="show-glow" aria-hidden />
      <div className="show-copy">
        <p className="eyebrow">From PDF to playground</p>
        <h2>Read technical books the way you explore a codebase.</h2>
        <ul className="show-points">
          <li><Icon name="diagram" /> Step-through diagrams of every mechanism</li>
          <li><Icon name="terminal" /> A simulated shell to try the commands</li>
          <li><Icon name="quiz" /> Questions that catch the usual wrong idea</li>
        </ul>
      </div>
      <div className="show-stage" aria-hidden>
        <div className="show-card show-term">
          <div className="show-dots"><i /><i /><i /><span>you@book: ~</span></div>
          <pre>{shown}<span className="caret" /></pre>
        </div>
        <div className="show-card show-diagram">
          <svg viewBox="0 0 300 120">
            <defs><marker id="sh-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10 z" /></marker></defs>
            <rect x="8" y="42" width="70" height="36" rx="8" /><text x="43" y="64">client</text>
            <rect x="116" y="42" width="70" height="36" rx="8" className="hot" /><text x="151" y="64">ingress</text>
            <rect x="224" y="12" width="68" height="32" rx="8" /><text x="258" y="32">svc a</text>
            <rect x="224" y="76" width="68" height="32" rx="8" /><text x="258" y="96">svc b</text>
            <path id="sh-p1" d="M78 60 H116" /><path d="M186 56 C 205 40, 210 30, 224 28" /><path id="sh-p2" d="M186 64 C 205 80, 210 90, 224 92" />
            <circle r="4" className="packet"><animateMotion dur="2.4s" repeatCount="indefinite" path="M78 60 H116 M186 64 C 205 80, 210 90, 224 92" /></circle>
          </svg>
          <p>step 2 of 4 · <b>host rule matches</b></p>
        </div>
        <div className="show-card show-quiz">
          <p>Which isolation level prevents write skew?</p>
          <span className="opt">Read committed</span>
          <span className="opt right"><Icon name="check" size={14} /> Serializable</span>
        </div>
      </div>
    </aside>
  );
}
