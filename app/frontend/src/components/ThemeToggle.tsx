import { useEffect, useState } from 'react';
import { useScheme } from '../hooks';
import { Icon } from './Icon';

const dark = () => window.matchMedia('(prefers-color-scheme: dark)');

/** One click flips what you see. Flipping back to what the system wants clears the override, so the site follows
 *  the system again (the account menu has all three choices). */
export function ThemeToggle({ className = 'icon-btn' }: { className?: string }) {
  const [scheme, setScheme] = useScheme();
  const [systemDark, setSystemDark] = useState(() => dark().matches);
  useEffect(() => {
    const mq = dark();
    const on = () => setSystemDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const shown = scheme === 'system' ? (systemDark ? 'dark' : 'light') : scheme;
  const target = shown === 'dark' ? 'light' : 'dark';
  return (
    <button className={className} onClick={() => setScheme(target === (systemDark ? 'dark' : 'light') ? 'system' : target)}
      aria-label={`Switch to ${target} mode`} title={`Switch to ${target} mode`}>
      <Icon name={shown === 'dark' ? 'sun' : 'moon'} />
    </button>
  );
}
