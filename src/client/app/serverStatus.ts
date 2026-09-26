export const SERVER_URL: string = (import.meta.env.VITE_SERVER_URL as string | undefined)?.trim() ?? '';

export function healthUrl(): string | null {
  if (!SERVER_URL) return null;
  try {
    const u = new URL(SERVER_URL);
    u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:';
    u.pathname = '/health';
    u.search = '';
    return u.toString();
  } catch {
    return null;
  }
}

export interface ServerInfo {
  ok: boolean;
  players: number;
  rooms: number;
}

export async function fetchServerInfo(timeoutMs = 4000): Promise<ServerInfo> {
  const url = healthUrl();
  if (!url) return { ok: false, players: 0, rooms: 0 };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) return { ok: false, players: 0, rooms: 0 };
    const j = (await res.json()) as Partial<ServerInfo>;
    return { ok: j.ok === true, players: Number(j.players ?? 0), rooms: Number(j.rooms ?? 0) };
  } catch {
    return { ok: false, players: 0, rooms: 0 };
  } finally {
    clearTimeout(t);
  }
}
