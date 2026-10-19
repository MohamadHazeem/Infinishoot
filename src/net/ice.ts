/**
 * ICE servers for WebRTC (fixes lane). PeerJS's defaults are a public STUN
 * server plus PeerJS's own free TURN, which is often down or overloaded, so
 * players behind strict NATs or firewalls can't connect. A relay (TURN) can
 * come from three places, all optional (docs/TURN.md):
 *   1. Build time: VITE_TURN_URLS (comma-separated turn:/turns: URLs),
 *      VITE_TURN_USERNAME, VITE_TURN_CREDENTIAL.
 *   2. Build time: VITE_TURN_CREDENTIAL_URL, fetched before hosting/joining.
 *      It returns time-limited credentials as a list of ICE servers or
 *      `{ iceServers }` (metered.ca's credentials API, or a tiny Worker in front
 *      of Cloudflare Calls TURN).
 *   3. The player: PLAY ONLINE > CUSTOM RELAY, e.g.
 *      `turn:relay.example.com:3478 myuser mypass` (saved locally).
 * Everything is added to PeerJS's defaults, so plain STUN still comes first.
 */
import { loadJson, saveJson } from '../core/storage';

export type IceServer = { urls: string | string[]; username?: string; credential?: string };

const env = ((import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {}) as Record<string, string | undefined>;

/** PeerJS 1.5's defaults (kept so STUN and its free relay still come first). */
export const DEFAULT_ICE: IceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
];

export const iceTuning = {
  /** Most we wait for VITE_TURN_CREDENTIAL_URL before hosting/joining (ms). */
  fetchTimeout: 3000,
  /** Fetched credentials are reused this long (ms). */
  cacheFor: 10 * 60 * 1000,
};

const isIceUrl = (u: string) => /^(stun|turn|turns):[^\s]+$/i.test(u);

/** Validate one ICE server object (from JSON). */
function cleanServer(o: unknown): IceServer | null {
  if (!o || typeof o !== 'object') return null;
  const s = o as Record<string, unknown>;
  const raw = Array.isArray(s.urls) ? s.urls : typeof s.urls === 'string' ? [s.urls] : typeof s.url === 'string' ? [s.url] : [];
  const urls = raw.filter((u): u is string => typeof u === 'string' && isIceUrl(u.trim())).map((u) => u.trim());
  if (!urls.length) return null;
  const out: IceServer = { urls: urls.length === 1 ? urls[0] : urls };
  if (typeof s.username === 'string') out.username = s.username;
  if (typeof s.credential === 'string') out.credential = s.credential;
  return out;
}

/** ICE servers from a credentials API response: a list, `{ iceServers: [...] }` or `{ iceServers: {...} }`. */
export function serversFromJson(data: unknown): IceServer[] {
  const list = Array.isArray(data) ? data : data && typeof data === 'object' ? (data as { iceServers?: unknown }).iceServers : null;
  const arr = Array.isArray(list) ? list : list ? [list] : [];
  return arr.map(cleanServer).filter((s): s is IceServer => !!s);
}

/**
 * Parse the CUSTOM RELAY text: `turn:host:3478[,turns:host:5349] [username] [credential]`,
 * or JSON (one server or a list). Returns [] for empty text, null if it can't be read.
 */
export function parseRelay(text: string): IceServer[] | null {
  const t = text.trim();
  if (!t) return [];
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      const s = serversFromJson(t.startsWith('[') ? JSON.parse(t) : { iceServers: JSON.parse(t) });
      return s.length ? s : null;
    } catch {
      return null;
    }
  }
  const [urlPart, username, credential, ...rest] = t.split(/\s+/);
  if (rest.length) return null;
  const urls = urlPart.split(',').map((u) => u.trim()).filter(Boolean);
  if (!urls.length || !urls.every(isIceUrl)) return null;
  const needsAuth = urls.some((u) => /^turns?:/i.test(u));
  if (needsAuth && (!username || !credential)) return null;
  const s: IceServer = { urls: urls.length === 1 ? urls[0] : urls };
  if (username) s.username = username;
  if (credential) s.credential = credential;
  return [s];
}

/** Servers from the build-time VITE_TURN_* variables. */
export function buildTimeServers(e: Record<string, string | undefined> = env): IceServer[] {
  const urls = (e.VITE_TURN_URLS ?? '')
    .split(',')
    .map((u) => u.trim())
    .filter(isIceUrl);
  if (!urls.length) return [];
  return [{ urls, username: e.VITE_TURN_USERNAME || undefined, credential: e.VITE_TURN_CREDENTIAL || undefined }];
}

// ---------------------------------------------------------------- state

const KEY = 'relay.v1';
const stored = loadJson<{ text: string }>(KEY, { text: '' });
let custom: IceServer[] = parseRelay(stored.text) ?? [];
let fetched: IceServer[] = [];
let fetchedAt = -Infinity;
let pending: Promise<void> | null = null;

export function customRelayText(): string {
  return stored.text;
}

/** Save the CUSTOM RELAY text. Returns false (and keeps the old one) if it can't be read. */
export function setCustomRelay(text: string): boolean {
  const s = parseRelay(text);
  if (!s) return false;
  stored.text = text.trim();
  custom = s;
  saveJson(KEY, stored);
  return true;
}

/** True if any relay beyond PeerJS's defaults is configured (build time, fetched or custom). */
export function hasRelay(): boolean {
  return custom.length > 0 || fetched.length > 0 || buildTimeServers().length > 0;
}

/** Refresh time-limited credentials (VITE_TURN_CREDENTIAL_URL) if needed; never throws, gives up after fetchTimeout. */
export function prefetchIce(): Promise<void> {
  const url = env.VITE_TURN_CREDENTIAL_URL;
  if (!url || typeof fetch !== 'function') return Promise.resolve();
  if (performance.now() - fetchedAt < iceTuning.cacheFor) return Promise.resolve();
  if (pending) return pending;
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => ctl?.abort(), iceTuning.fetchTimeout);
  pending = fetch(url, { signal: ctl?.signal, cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      const s = serversFromJson(data);
      if (s.length) {
        fetched = s;
        fetchedAt = performance.now();
      }
    })
    .catch(() => {})
    .finally(() => {
      clearTimeout(timer);
      pending = null;
    });
  return pending;
}

/** The RTCConfiguration for PeerJS (sync: uses whatever credentials were fetched). */
export function iceConfig(): { iceServers: IceServer[]; sdpSemantics: 'unified-plan' } {
  return { iceServers: [...DEFAULT_ICE, ...buildTimeServers(), ...fetched, ...custom], sdpSemantics: 'unified-plan' };
}
