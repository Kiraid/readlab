import { useEffect, useRef } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { fmt, useLoad, useScheme, type Scheme } from '../hooks';
import { linkProps, navigate, type Route } from '../router';
import { Icon } from './Icon';
import { openSearch } from './SearchPalette';
import { ThemeToggle } from './ThemeToggle';

type Item = { to: string; label: string; icon: string; match: Route['name'][]; kind?: 'book' | 'article' };

const MAIN: Item[] = [
  { to: '/', label: 'Home', icon: 'home', match: ['home'] },
  { to: '/books', label: 'Books', icon: 'book', match: ['library'], kind: 'book' },
  { to: '/articles', label: 'Articles', icon: 'article', match: ['library'], kind: 'article' },
  { to: '/upload', label: 'Upload', icon: 'upload', match: ['upload'] },
  { to: '/activity', label: 'Activity', icon: 'activity', match: ['activity', 'job'] },
];
const ADMIN: Item[] = [
  { to: '/admin', label: 'Runs & queue', icon: 'shield', match: ['admin'] },
  { to: '/admin/pipeline', label: 'Pipeline', icon: 'flow', match: ['pipeline'] },
];

// React 18 passes unknown lowercase attributes through to the DOM; the types do not know the popover ones yet.
const popover = (v: 'auto' | 'manual') => ({ popover: v }) as Record<string, string>;
const target = (id: string) => ({ popovertarget: id }) as Record<string, string>;

export function Sidebar({ route, collapsed, onCollapse, drawerOpen, onCloseDrawer }: {
  route: Route; collapsed: boolean; onCollapse: () => void; drawerOpen: boolean; onCloseDrawer: () => void;
}) {
  const { user } = useAuth();
  const ref = useRef<HTMLElement>(null);
  const active = (i: Item) => i.match.includes(route.name) && (!i.kind || (route.name === 'library' && route.kind === i.kind));

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseDrawer(); };
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('a, button')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen, onCloseDrawer]);

  const link = (i: Item) => (
    <li key={i.to}>
      <a className={active(i) ? 'active' : ''} aria-current={active(i) ? 'page' : undefined} title={collapsed ? i.label : undefined}
        {...linkProps(i.to)} onClick={(e) => { linkProps(i.to).onClick(e); onCloseDrawer(); }}>
        <Icon name={i.icon} /><span className="sb-label">{i.label}</span>
      </a>
    </li>
  );

  return (
    <aside ref={ref} className={`sidebar${collapsed ? ' collapsed' : ''}${drawerOpen ? ' open' : ''}`}
      aria-label="Main" {...(drawerOpen ? { role: 'dialog', 'aria-modal': true } : {})}>
      <div className="sb-top">
        <a className="brand" {...linkProps('/')} aria-label="readlab home">
          <span className="brand-mark" aria-hidden>r</span><span className="sb-label brand-name">readlab</span>
        </a>
        <span className="sb-top-actions">
        <ThemeToggle />
        <button className="icon-btn sb-collapse" onClick={onCollapse} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}><Icon name="panel" /></button>
        <button className="icon-btn sb-close" onClick={onCloseDrawer} aria-label="Close menu"><Icon name="x" /></button>
        </span>
      </div>

      <button className="sb-search" onClick={() => { onCloseDrawer(); openSearch(); }} title={collapsed ? 'Search (Ctrl K)' : undefined}>
        <Icon name="search" /><span className="sb-label">Search</span><kbd className="sb-label">Ctrl K</kbd>
      </button>

      <nav className="sb-nav">
        <ul>{MAIN.map(link)}</ul>
        {user?.is_admin && (
          <>
            <p className="sb-heading sb-label">Admin</p>
            <ul>{ADMIN.map(link)}</ul>
          </>
        )}
      </nav>

      <div className="sb-bottom">
        {!user?.is_admin && !collapsed && <QuotaMeter />}
        <UserMenu />
      </div>
    </aside>
  );
}

function QuotaMeter() {
  const { data } = useLoad(() => api.quota(), [location.pathname]);
  if (!data || data.limit === null) return null;
  const left = data.remaining ?? 0;
  return (
    <div className="quota" title={`Words of source text you can turn into pages in ${data.days} days`}>
      <div className="quota-row"><span>Allowance</span><b>{fmt.words(left)} words left</b></div>
      <progress className={`bar${left < data.limit * 0.15 ? ' bar-warn' : ''}`} max={data.limit} value={data.used} aria-label="Word allowance used" />
    </div>
  );
}

const SCHEMES: [Scheme, string, string][] = [['system', 'System', 'monitor'], ['light', 'Light', 'sun'], ['dark', 'Dark', 'moon']];

function UserMenu() {
  const { user, signOut } = useAuth();
  const [scheme, setScheme] = useScheme();
  if (!user) return null;
  return (
    <>
      <button className="user-btn" {...target('user-menu')} aria-label={`Account: ${user.email}`}>
        <span className="avatar" aria-hidden>{(user.name || user.email).slice(0, 1).toUpperCase()}</span>
        <span className="sb-label user-meta">
          <b>{user.name}</b>
          <small>{user.is_admin ? 'Admin' : user.email}</small>
        </span>
        <Icon name="dots" className="sb-label" />
      </button>
      <div id="user-menu" className="menu" {...popover('auto')} role="menu" aria-label="Account">
        <p className="menu-head"><b>{user.name}</b><small>{user.email}</small></p>
        <p className="menu-label" id="theme-label">Appearance</p>
        <div className="seg" role="radiogroup" aria-labelledby="theme-label">
          {SCHEMES.map(([s, label, icon]) => (
            <button key={s} role="radio" aria-checked={scheme === s} className={scheme === s ? 'on' : ''} onClick={() => setScheme(s)}>
              <Icon name={icon} size={15} />{label}
            </button>
          ))}
        </div>
        <button className="menu-item" role="menuitem" onClick={async () => { await signOut(); navigate('/signin', { replace: true }); }}>
          <Icon name="logout" size={16} />Sign out
        </button>
      </div>
    </>
  );
}
