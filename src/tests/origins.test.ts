import { describe, expect, it } from 'vitest';

// Mirror of the server's origin matcher (kept in sync by hand; the server file starts listening on import).
function matcher(list: string[]) {
  const patterns = list.map((o) => new RegExp('^' + o.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[a-z0-9.-]*') + '$', 'i'));
  return (origin: string | undefined) => {
    if (list.length === 0) return true;
    if (!origin) return false;
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
    return patterns.some((re) => re.test(origin));
  };
}

describe('origin allow-list', () => {
  const ok = matcher(['https://shotdis.vercel.app', 'https://shotdis-*.vercel.app']);
  it('accepts exact and wildcard matches plus localhost', () => {
    expect(ok('https://shotdis.vercel.app')).toBe(true);
    expect(ok('https://shotdis-abc123-team.vercel.app')).toBe(true);
    expect(ok('http://localhost:5180')).toBe(true);
  });
  it('rejects other origins', () => {
    expect(ok('https://evil.com')).toBe(false);
    expect(ok('https://shotdis.vercel.app.evil.com')).toBe(false);
    expect(ok('https://notshotdis.vercel.app')).toBe(false);
    expect(ok(undefined)).toBe(false);
  });
  it('allows everything when the list is empty', () => {
    expect(matcher([])('https://anything.example')).toBe(true);
  });
});
