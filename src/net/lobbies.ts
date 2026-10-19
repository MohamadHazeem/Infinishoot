/**
 * Public lobby list (MP lane). Hosts that mark their lobby PUBLIC register it on
 * the optional online service (server/leaderboard/lobbies.js) and keep it alive
 * with a heartbeat; PLAY ONLINE > BROWSE lists the open ones. Only active when
 * the build has VITE_LEADERBOARD_URL; without it every call returns null and
 * invite codes work as before.
 */
export type LobbyMode = 'coop' | 'pvp' | 'versus' | 'weekly';

export interface PublicLobby {
  code: string;
  name: string;
  players: number;
  max: number;
  mode: LobbyMode;
  difficulty: string;
  region: string;
  version: string;
}

export interface LobbyFilter {
  region?: string;
  difficulty?: string;
  mode?: string;
}

export const lobbyTuning = {
  /** Seconds between heartbeats while a public lobby is open (the worker forgets it after its TTL, 120 s). */
  heartbeat: 45,
  /** Re-register at most this often when the lobby changes (players joining, game type). */
  minResend: 10,
};

/** Regions for the browser's filter; a lobby's region comes from the host's time zone. */
export const REGIONS = ['EU', 'NA', 'SA', 'AS', 'OC', 'AF', 'ME'] as const;
export const REGION_NAMES: Record<string, string> = { EU: 'EUROPE', NA: 'N. AMERICA', SA: 'S. AMERICA', AS: 'ASIA', OC: 'OCEANIA', AF: 'AFRICA', ME: 'MIDDLE EAST' };

const SOUTH_AMERICA = /^America\/(Sao_Paulo|Argentina|Buenos_Aires|Santiago|Lima|Bogota|Caracas|Montevideo|Asuncion|La_Paz|Guayaquil|Cayenne|Paramaribo|Guyana|Belem|Fortaleza|Recife|Manaus|Cuiaba|Campo_Grande|Porto_Velho|Boa_Vista|Rio_Branco|Maceio|Araguaina|Bahia|Santarem|Noronha|Punta_Arenas)/;
const MIDDLE_EAST = /^Asia\/(Dubai|Riyadh|Qatar|Bahrain|Kuwait|Baghdad|Tehran|Muscat|Amman|Beirut|Damascus|Jerusalem|Tel_Aviv|Gaza|Hebron|Aden|Nicosia|Famagusta)/;

/** Region code from an IANA time zone (falls back to the locale's region, then EU). */
export function regionOf(timeZone = safeTz(), locale = typeof navigator !== 'undefined' ? navigator.language : ''): string {
  const tz = timeZone || '';
  if (MIDDLE_EAST.test(tz)) return 'ME';
  if (SOUTH_AMERICA.test(tz)) return 'SA';
  if (/^(America|US|Canada|Mexico)\//.test(tz) || tz === 'America') return 'NA';
  if (/^(Europe|Atlantic\/(Reykjavik|Canary|Faroe|Madeira|Azores))/.test(tz) || tz === 'GB' || tz === 'UTC' || tz === 'Etc/UTC') return 'EU';
  if (/^Africa\//.test(tz)) return 'AF';
  if (/^(Australia|Pacific)\//.test(tz) || tz === 'NZ') return 'OC';
  if (/^(Asia|Indian)\//.test(tz)) return 'AS';
  const cc = (locale.split('-')[1] ?? '').toUpperCase();
  if (['US', 'CA', 'MX'].includes(cc)) return 'NA';
  if (['BR', 'AR', 'CL', 'CO', 'PE', 'VE', 'UY'].includes(cc)) return 'SA';
  if (['AU', 'NZ'].includes(cc)) return 'OC';
  if (['JP', 'KR', 'CN', 'IN', 'SG', 'ID', 'TH', 'VN', 'PH', 'MY', 'TW', 'HK'].includes(cc)) return 'AS';
  return 'EU';
}

function safeTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    return '';
  }
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const ENV_BASE = (import.meta.env?.VITE_LEADERBOARD_URL as string | undefined)?.replace(/\/$/, '') ?? '';

/** Client for the lobby routes; `base` and `fetch` are injectable for tests. */
export class LobbyService {
  constructor(
    readonly base = ENV_BASE,
    private fetchFn: Fetch = (u, i) => fetch(u, i),
  ) {}

  get enabled(): boolean {
    return this.base !== '';
  }

  /** Open public lobbies (null when offline or the service failed). */
  async list(f: LobbyFilter = {}, version = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : ''): Promise<PublicLobby[] | null> {
    if (!this.enabled) return null;
    const q = new URLSearchParams();
    if (f.region) q.set('region', f.region);
    if (f.difficulty) q.set('difficulty', f.difficulty);
    if (f.mode) q.set('mode', f.mode);
    if (version) q.set('version', version);
    try {
      const r = await this.fetchFn(`${this.base}/lobbies?${q}`);
      if (!r.ok) return null;
      return ((await r.json()) as { lobbies: PublicLobby[] }).lobbies ?? [];
    } catch {
      return null;
    }
  }

  /** Register or refresh (heartbeat) a lobby. `token` proves it's the same host. Returns '' or an error. */
  async register(l: PublicLobby, token: string): Promise<string> {
    return this.post({ ...l, token });
  }

  async close(code: string, token: string): Promise<string> {
    return this.post({ code, token, close: true });
  }

  private async post(body: Record<string, unknown>): Promise<string> {
    if (!this.enabled) return 'offline';
    try {
      const r = await this.fetchFn(`${this.base}/lobbies`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (r.ok) return '';
      return ((await r.json().catch(() => ({}))) as { error?: string }).error ?? `http ${r.status}`;
    } catch {
      return 'network';
    }
  }
}

export const lobbyService = new LobbyService();

/** A random host token (kept for the lobby's lifetime). */
export function lobbyToken(): string {
  let s = '';
  for (let i = 0; i < 20; i++) s += 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)];
  return s;
}
