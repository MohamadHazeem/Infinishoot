// Shared by storage normalization and the Worker. Numeric arrays and catalog IDs
// are the only extensible fields. Unknown object properties are rejected at every depth.
import type { Run } from './telemetryClient';

export const uuid = (s: unknown): s is string => typeof s === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(s);
type Check = (value: any) => boolean;
const id = (s: unknown) => typeof s === 'string' && /^[A-Za-z0-9_|:-]{1,64}$/.test(s) && !['constructor', '__proto__', 'prototype'].includes(s);
const num = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1e9;
const int = (n: unknown): n is number => num(n) && Number.isInteger(n);
const positive = (n: unknown) => int(n) && n > 0;
export const fields = (o: unknown, allowed: string): o is Record<string, any> => !!o && typeof o === 'object' && !Array.isArray(o)
  && Object.keys(o).every(k => allowed.split(' ').includes(k));
const list = (x: unknown, check: Check, max = 2048) => Array.isArray(x) && x.length <= max && x.every(check);
const tuple = (x: unknown, ...checks: Check[]) => Array.isArray(x) && x.length === checks.length && checks.every((fn, i) => fn(x[i]));
const map = (x: unknown, fn: Check) => !!x && typeof x === 'object' && !Array.isArray(x) && Object.entries(x).every(([k,v]) => id(k) && fn(v));
const one = (choices: string): Check => v => choices.split(' ').includes(v);
const boss = (x: unknown) => tuple(x, positive, id, one('kill death quit'), num);
const stage = (s: unknown) => fields(s, 'stage seconds level ranks damage') && num(s.seconds) && positive(s.stage) && positive(s.level) && map(s.damage, num)
  && map(s.ranks, a => list(a, n => int(n) || n === -1, 32));
const offer = (a: any, ids?: string[]) => tuple(a, positive, v => list(v, k => ids ? int(k) && k < ids.length : id(k), 16),
  v => Number.isInteger(v) && v >= -1 && v < a[1].length);

export function isRun(r: unknown): r is Run {
  return fields(r, 'id version mode difficulty ascension heat hero loadout party team stage loop clears seconds outcome day stages offerIds offers purchases mods relics bosses hits fatal rewinds stands revives avgMs worstMs quality platform mobile language omitted')
    && uuid(r.id) && typeof r.version === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(r.version)
    && one('standard endless bossrush daily weekly gauntlet raid pvp versus race')(r.mode)
    && one('easy assist normal hard nightmare legend')(r.difficulty) && id(r.hero) && tuple(r.loadout, id, id, id)
    && one('solo coop squad')(r.party) && positive(r.team) && r.team <= 8 && one('death victory quit defeat draw')(r.outcome)
    && typeof r.day === 'string' && /^\d{4}-\d\d-\d\d$/.test(r.day) && positive(r.stage) && positive(r.loop)
    && [r.clears,r.ascension,r.heat,r.rewinds,r.stands,r.revives,r.omitted,r.quality].every(int)
    && [r.seconds,r.avgMs,r.worstMs].every(num) && one('web electron-win electron-mac')(r.platform)
    && typeof r.mobile === 'boolean' && one('en ar es fr de pt-BR tr')(r.language)
    && list(r.stages, stage) && list(r.bosses, boss) && (r.offerIds === undefined || list(r.offerIds, id))
    && list(r.offers, a => offer(a, r.offerIds)) && list(r.purchases, x => tuple(x, positive, id, num))
    && list(r.mods, x => tuple(x, id, positive)) && list(r.relics, id)
    && list(r.hits, x => tuple(x, num, id, num, num)) && (r.fatal === null || tuple(r.fatal, id, num, num));
}
