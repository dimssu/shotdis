import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { Unsupported } from './ui/common/Unsupported';
import './styles/global.css';
import { useStore } from './app/store';

if (import.meta.env.DEV) (window as unknown as { __store?: typeof useStore }).__store = useStore;

function isMobile(): boolean {
  const ua = navigator.userAgent;
  const touchOnly = window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(pointer: fine)').matches;
  const small = Math.min(window.innerWidth, window.innerHeight) < 600;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (touchOnly && small);
}

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

const root = createRoot(document.getElementById('root')!);
if (isMobile()) root.render(<Unsupported reason="mobile" />);
else if (!hasWebGL()) root.render(<Unsupported reason="webgl" />);
// No StrictMode: the game view owns a WebGL context and a live connection, which must mount exactly once.
else root.render(<App />);

// Never show raw stack traces to players; log for developers.
window.addEventListener('error', (e) => {
  console.error(e.error ?? e.message);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error(e.reason);
});
