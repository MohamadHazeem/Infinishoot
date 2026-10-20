/** One source for every optional online service. Test overrides never persist. */
export function resolveOnlineServer(configured = '', search = ''): string {
  const q = new URLSearchParams(search);
  const raw = q.has('test') && q.has('server') ? q.get('server')! : configured;
  if (!raw.trim()) return '';
  try {
    const url = new URL(raw.trim());
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.search || url.hash) return '';
    return url.href.replace(/\/+$/, '');
  } catch { return ''; }
}

export const onlineServer = resolveOnlineServer(
  import.meta.env?.VITE_LEADERBOARD_URL ?? '',
  typeof location === 'undefined' ? '' : location.search,
);

export type OnlineStatus = 'off' | 'checking' | 'on' | 'unavailable';
export async function checkOnlineServer(base = onlineServer, fetchFn: typeof fetch = fetch): Promise<OnlineStatus> {
  if (!base) return 'off';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetchFn(`${base}/health`, { signal: controller.signal, cache: 'no-store', credentials: 'omit' });
    const body = response.ok ? await response.json() as { ok?: boolean; service?: string } : null;
    return body?.ok === true && body.service === 'infinishoot-online' ? 'on' : 'unavailable';
  } catch { return 'unavailable'; }
  finally { clearTimeout(timeout); }
}
