import { isRun, uuid } from './telemetrySchema';
import { loadJson, saveJson } from '../core/storage';
import { resolveOnlineServer } from './onlineServer';

// A test-link server override must never redirect a real installation's queued data or deletion key.
export const telemetryServer = resolveOnlineServer(import.meta.env?.VITE_LEADERBOARD_URL ?? '');
export const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '2.0.1';
export const QUEUE_LIMIT = 24;
export const RUN_BYTES = 8000;
export const REPORT_BYTES = 1536 * 1024;
export const categories = ['bug', 'too-hard', 'too-easy', 'confusing', 'performance', 'other'] as const;
export type Category = typeof categories[number];
export type Choice = 'yes' | 'no' | null;
export type Outcome = 'death' | 'victory' | 'quit' | 'defeat' | 'draw';
export type Hit = [time: number, source: string, damage: number, remaining: number];
export interface Stage {
  stage: number; seconds: number; level: number; ranks: Record<string, number[]>; damage: Record<string, number>;
}
export interface Run {
  id: string; version: string; mode: string; difficulty: string; ascension: number; heat: number;
  hero: string; loadout: string[]; party: 'solo' | 'coop' | 'squad'; team: number;
  stage: number; loop: number; clears: number; seconds: number; outcome: Outcome; day: string;
  stages: Stage[]; offerIds?: string[]; offers: [stage: number, alternatives: (string | number)[], pick: number][];
  purchases: [number, string, number][]; mods: [string, number][]; relics: string[];
  bosses: [stage: number, id: string, result: 'kill' | 'death' | 'quit', seconds: number][];
  hits: Hit[]; fatal: [source: string, damage: number, prior: number] | null;
  rewinds: number; stands: number; revives: number; avgMs: number; worstMs: number;
  quality: number; platform: string; mobile: boolean; language: string; omitted: number;
}

export const byteSize = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
const key = (suffix: string) => 'playtest.v1.' + suffix;
export function consent(): Choice {
  const v = loadJson<unknown>(key('choice'), null);
  return v === 'yes' || v === 'no' ? v : null;
}

export function choose(v: Exclude<Choice, null>): void {
  saveJson(key('choice'), v);
  if (v === 'no') saveJson(key('runs'), []);
}

export function installId(): string {
  const old = loadJson<unknown>(key('id'), null);
  if (uuid(old)) return old;
  // Fail closed when storage is blocked: the player must be able to delete later.
  const value = globalThis.crypto?.randomUUID?.();
  if (value) saveJson(key('id'), value);
  return value && loadJson<string>(key('id'), '') === value ? value : '';
}

export function queue(): Run[] {
  const value = loadJson<unknown>(key('runs'), []);
  return Array.isArray(value) ? value.slice(-QUEUE_LIMIT).filter(isRun) : [];
}

/** The most recent stages and the killing hit survive even very long endless runs. */
export function fitRun(r: Run): Run {
  if (!r.offerIds && byteSize(r) > RUN_BYTES) {
    const ids = new Map<string, number>();
    for (const [, choices] of r.offers) {
      for (let i = 0; i < choices.length; i++) {
        const choice = choices[i];
        if (typeof choice !== 'string') continue;
        if (!ids.has(choice)) ids.set(choice, ids.size);
        choices[i] = ids.get(choice)!;
      }
    }
    r.offerIds = [...ids.keys()];
  }
  for (const history of [r.offers, r.purchases, r.stages, r.bosses, r.hits]) {
    while (history.length && byteSize(r) > RUN_BYTES) {
      const count = Math.max(1, Math.floor(history.length / 8));
      history.splice(0, count); r.omitted += count;
    }
  }
  if (!r.offers.length) delete r.offerIds;
  return r;
}

export async function post(path: string, body: unknown, base = telemetryServer, send: typeof fetch = fetch): Promise<number> {
  if (!base || (path === 'run' && consent() !== 'yes')) return 0;
  try {
    const result = await send(base + '/telemetry/' + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    return result.status;
  } catch { return 0; }
}

let pending: Promise<void> | undefined;
export function flush(base = telemetryServer, send: typeof fetch = fetch): Promise<void> {
  if (!base || consent() !== 'yes') return Promise.resolve();
  if (pending) return pending;
  pending = (async () => {
    const install = installId();
    if (!install) return;
    // Re-read after every await: a run can finish or consent can change mid-flush.
    let previous = '';
    while (consent() === 'yes' && loadJson(key('id'), '') === install) {
      const run = queue()[0];
      if (!run || run.id === previous) break; // blocked storage must never cause a retry loop
      previous = run.id;
      const status = await post('run', { install, run }, base, send);
      if (status !== 200 && status !== 400 && status !== 413 && status !== 410) break;
      saveJson(key('runs'), queue().filter(r => r.id !== run.id));
    }
  })().catch(() => {}).finally(() => { pending = undefined; });
  return pending;
}

export function enqueue(run: Run, base = telemetryServer): void {
  if (consent() !== 'yes') return;
  const batch = queue().filter(r => r.id !== run.id);
  fitRun(run);
  if (!isRun(run) || byteSize(run) > RUN_BYTES) return;
  batch.push(run);
  saveJson(key('runs'), batch.slice(-QUEUE_LIMIT));
  void flush(base);
}

export async function deleteData(base = telemetryServer, send: typeof fetch = fetch): Promise<boolean> {
  choose('no');
  const install = loadJson(key('id'), '');
  if (!uuid(install)) return true;
  await pending;
  if (await post('delete', { install }, base, send) !== 200) return false;
  saveJson(key('id'), null);
  return true;
}
