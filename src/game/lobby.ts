/**
 * Lobby lane: the pure rules behind getting friends together (no DOM, no
 * network). Chat filtering and rate limits, ready-up, party votes, invite
 * links, profile levels and the local friends list. Used by
 * src/game/systems/party.ts and the lobby/party/friends screens.
 */

export const lobbyTuning = {
  /** Seconds between everyone being ready and the run starting (any un-ready cancels). */
  countdown: 3,
  /** Host pings each client this often (s) while in the lobby or party screen. */
  pingEvery: 2,
  /** Seconds a kicked player can't rejoin the same host. */
  kickBan: 120,
};

export const chatTuning = {
  maxLen: 60,
  /** Minimum seconds between two messages from one player. */
  minGap: 0.8,
  /** At most `burst` messages per `window` seconds from one player. */
  burst: 4,
  window: 8,
  /** Lines kept in the chat log. */
  keep: 30,
};

/** Quick chat: pad-friendly phrases (sent as an index, so they can't be abused). */
export const QUICK_CHAT = ['READY!', 'ONE SEC!', "LET'S GO!", 'GG!', 'NICE ONE!', 'BRB'] as const;

// ---------------------------------------------------------------- chat filter

/** A short, basic list: whole words (and simple leetspeak) become asterisks. */
const BAD = ['fuck', 'fucking', 'fucker', 'shit', 'bitch', 'cunt', 'dick', 'cock', 'pussy', 'asshole', 'bastard', 'slut', 'whore', 'fag', 'faggot', 'nigger', 'nigga', 'retard', 'retarded', 'motherfucker', 'wanker', 'twat'];
const BAD_SET = new Set(BAD);
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's', '!': 'i' };

function plain(word: string): string {
  let s = '';
  for (const ch of word.toLowerCase()) s += LEET[ch] ?? ch;
  // "fuuuck" -> "fuck"
  return s.replace(/(.)\1+/g, '$1');
}

function isBad(word: string): boolean {
  const p = plain(word);
  if (!p) return false;
  if (BAD_SET.has(p) || BAD_SET.has(plain(word).replace(/s$/, ''))) return true;
  // Repeated letters are collapsed above, so check the collapsed forms of the list too.
  for (const b of BAD) if (b.replace(/(.)\1+/g, '$1') === p || b.replace(/(.)\1+/g, '$1') + 's' === p) return true;
  return false;
}

/** Clean a chat line: no control characters, collapsed spaces, length cap, bad words starred. '' if nothing is left. */
export function filterChat(text: unknown): string {
  if (typeof text !== 'string') return '';
  const s = text
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, chatTuning.maxLen);
  // Words are runs of letters, digits and the leetspeak symbols.
  return s.replace(/[\p{L}\p{N}@$!]+/gu, (w) => (isBad(w) ? '*'.repeat(w.length) : w));
}

/** Per-sender chat rate limit (minimum gap plus a burst cap over a window). */
export class ChatLimiter {
  private sent = new Map<string, number[]>();

  constructor(private tune = chatTuning) {}

  /** Whether `who` may send now (`now` in seconds); records the message when allowed. */
  allow(who: string, now: number): boolean {
    const list = (this.sent.get(who) ?? []).filter((t) => now - t < this.tune.window);
    const last = list[list.length - 1];
    if ((last !== undefined && now - last < this.tune.minGap) || list.length >= this.tune.burst) {
      this.sent.set(who, list);
      return false;
    }
    list.push(now);
    this.sent.set(who, list);
    return true;
  }

  forget(who: string): void {
    this.sent.delete(who);
  }
}

// ---------------------------------------------------------------- ready-up and votes

/** Auto start: two or more players and every one of them ready. */
export function allReady(ready: readonly boolean[]): boolean {
  return ready.length >= 2 && ready.every(Boolean);
}

export type PartyVote = 'restart' | 'lobby' | '';

/** Party after game over: what everyone agreed on, or null while votes differ or are missing. */
export function tallyVotes(votes: readonly PartyVote[]): 'restart' | 'lobby' | null {
  if (!votes.length) return null;
  if (votes.every((v) => v === 'restart')) return 'restart';
  if (votes.every((v) => v === 'lobby')) return 'lobby';
  return null;
}

/** Counts for the vote buttons. */
export function voteCounts(votes: readonly PartyVote[]): { restart: number; lobby: number; total: number } {
  return { restart: votes.filter((v) => v === 'restart').length, lobby: votes.filter((v) => v === 'lobby').length, total: votes.length };
}

// ---------------------------------------------------------------- invite links

/** The web build, for invite links made in the desktop app (file:// pages can't be opened by friends). */
export const WEB_URL: string = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_WEB_URL || 'https://mohamadhazeem.github.io/Infinishoot/';

const CODE_RE = /^[A-HJ-NP-Z2-9]{5}$/;

/** Where an invite link should point: this page on the web, else the public web build. */
export function inviteBase(loc: { protocol: string; origin: string; pathname: string } | undefined, web = WEB_URL): string {
  if (!loc || (loc.protocol !== 'http:' && loc.protocol !== 'https:')) return web;
  return loc.origin + loc.pathname;
}

export function inviteLink(base: string, code: string): string {
  return `${base}${base.includes('?') ? '&' : '?'}join=${encodeURIComponent(code)}`;
}

/**
 * A join code from whatever was typed or pasted: a bare code ("abcde", " AB-CDE "),
 * or a whole invite link ("https://.../?join=ABCDE"). Null if it holds no valid code.
 */
export function parseInviteCode(text: unknown): string | null {
  if (typeof text !== 'string') return null;
  const m = /[?&#]join=([A-Za-z0-9-]+)/.exec(text);
  const raw = (m ? m[1] : text).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return CODE_RE.test(raw) ? raw : null;
}

// ---------------------------------------------------------------- profile card

export interface ProfileCard {
  /** Profile level (from lifetime stats and achievements). */
  lv: number;
  best: number;
  runs: number;
  ach: number;
  /** Friend code (src/game/save.ts friends.code), so teammates can save it. */
  fc: string;
}

/** A gentle square-root curve: about LV 5 after a few evenings, LV 20 for veterans. */
export function profileLevel(l: { kills: number; bosses: number; runs: number }, achievements: number): number {
  const pts = l.kills / 250 + l.bosses * 3 + l.runs + achievements * 4;
  return Math.max(1, Math.min(99, 1 + Math.floor(Math.sqrt(Math.max(0, pts)))));
}

/** A profile card received from the network, made safe. */
export function cleanProfile(raw: unknown): ProfileCard | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const n = (v: unknown, max: number) => Math.max(0, Math.min(max, Math.floor(Number(v) || 0)));
  const fc = typeof r.fc === 'string' && CODE_RE.test(r.fc) ? r.fc : '';
  return { lv: Math.max(1, n(r.lv, 99)), best: n(r.best, 999), runs: n(r.runs, 1e6), ach: n(r.ach, 999), fc };
}

// ---------------------------------------------------------------- friends (local)

export interface RecentPlayer {
  name: string;
  /** Their friend code ('' if unknown). */
  code: string;
  /** YYYY-MM-DD */
  last: string;
  runs: number;
}

export interface SavedFriend {
  name: string;
  code: string;
}

export interface FriendsData {
  /** This player's own friend code: hosting uses it as the room code when `useCode` is on. */
  code: string;
  useCode: boolean;
  recent: RecentPlayer[];
  saved: SavedFriend[];
}

export const friendsTuning = { maxRecent: 20, maxSaved: 30 };

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeFriendCode(rand: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 5; i++) s += ALPHABET[Math.floor(rand() * ALPHABET.length) % ALPHABET.length];
  return s;
}

export function cleanName(v: unknown): string {
  return typeof v === 'string' ? v.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12) : '';
}

/** Fill missing or broken fields (save migration). */
export function cleanFriends(raw: unknown): FriendsData {
  const d: FriendsData = { code: '', useCode: true, recent: [], saved: [] };
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<FriendsData>;
  if (typeof r.code === 'string' && CODE_RE.test(r.code)) d.code = r.code;
  if (typeof r.useCode === 'boolean') d.useCode = r.useCode;
  if (Array.isArray(r.recent))
    d.recent = r.recent
      .filter((x) => x && typeof x === 'object' && cleanName(x.name))
      .map((x) => ({ name: cleanName(x.name), code: typeof x.code === 'string' && CODE_RE.test(x.code) ? x.code : '', last: typeof x.last === 'string' && /^\d{4}-\d\d-\d\d$/.test(x.last) ? x.last : '', runs: Math.max(1, Math.floor(Number(x.runs) || 1)) }))
      .slice(0, friendsTuning.maxRecent);
  if (Array.isArray(r.saved))
    d.saved = r.saved
      .filter((x) => x && typeof x === 'object' && cleanName(x.name) && typeof x.code === 'string' && CODE_RE.test(x.code))
      .map((x) => ({ name: cleanName(x.name), code: x.code }))
      .slice(0, friendsTuning.maxSaved);
  return d;
}

/** Note teammates from a run that just started (newest first; same code, or same name without a code, is one entry). */
export function noteRecent(list: RecentPlayer[], mates: { name: string; code: string }[], date: string, ownCode = ''): RecentPlayer[] {
  const out = [...list];
  for (const m of mates) {
    const name = cleanName(m.name);
    if (!name || (m.code && m.code === ownCode)) continue;
    const i = out.findIndex((r) => (m.code && r.code ? r.code === m.code : r.name === name));
    const old = i >= 0 ? out.splice(i, 1)[0] : null;
    out.unshift({ name, code: m.code || old?.code || '', last: date, runs: (old?.runs ?? 0) + 1 });
  }
  return out.slice(0, friendsTuning.maxRecent);
}

/** Save (or rename) a friend code. Returns the new list, or null if the code isn't valid. */
export function addSaved(list: SavedFriend[], name: string, code: string): SavedFriend[] | null {
  const c = parseInviteCode(code);
  if (!c) return null;
  const n = cleanName(name) || c;
  const out = list.filter((f) => f.code !== c);
  out.unshift({ name: n, code: c });
  return out.slice(0, friendsTuning.maxSaved);
}

export function removeSaved(list: SavedFriend[], code: string): SavedFriend[] {
  return list.filter((f) => f.code !== code);
}

/** "today", "yesterday", "3 days ago", or the date. */
export function lastPlayed(date: string, today: string): string {
  if (!date) return '';
  const d = (Date.parse(today) - Date.parse(date)) / 86400000;
  if (!Number.isFinite(d)) return date;
  if (d < 1) return 'TODAY';
  if (d < 2) return 'YESTERDAY';
  if (d < 30) return `${Math.round(d)} DAYS AGO`;
  return date;
}

/** Ping colour band: good, ok or bad. */
export function pingBand(ms: number): 'good' | 'ok' | 'bad' {
  return ms < 90 ? 'good' : ms < 180 ? 'ok' : 'bad';
}
