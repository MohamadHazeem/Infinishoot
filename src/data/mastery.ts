// Mastery is a collection of display rewards. None of these values enters combat stats.
import { HEROES, HERO_BY_ID } from './heroes';
import { WEAPONS } from './weapons';
import { SKINS, type SkinDef } from './skins';

export const killGoal = 500;
export const clearGoal = 3;
export interface Marks {
  kills: number;
  clears: number;
  flawless: boolean;
  early: boolean;
}
export type Tallies = Record<string, Marks>;
export interface Cabinet {
  tracks: Tallies;
  title: string;
  skin: string;
}
export const emptyMarks = (): Marks => ({ kills: 0, clears: 0, flawless: false, early: false });
export const tracks = () => [
  ...HEROES.map((h) => ({ id: 'h.' + h.id, name: h.name, icon: h.id, color: '#ffcd75' })),
  ...Object.values(WEAPONS).map((w) => ({
    id: 'w.' + w.id,
    name: w.name,
    icon: w.id,
    color: w.color,
  })),
];
export function rank(m?: Marks): number {
  if (!m || (m.kills < killGoal && m.clears < clearGoal)) return 0;
  return m.flawless || m.early ? 2 : 1;
}
export function addMarks(
  into: Tallies,
  id: string,
  kills = 0,
  clears = 0,
  flawless = false,
  early = false,
) {
  const m = (into[id] ??= emptyMarks());
  m.kills = Math.min(killGoal, m.kills + kills);
  m.clears = Math.min(clearGoal, m.clears + clears);
  m.flawless ||= flawless;
  m.early ||= early;
}
const count = (v: unknown, max: number) =>
  Number.isSafeInteger(v) && Number(v) >= 0 ? Math.min(Number(v), max) : 0;
export function normalizeCabinet(raw: unknown): Cabinet {
  const o = raw as Partial<Cabinet> | null;
  const result: Cabinet = { tracks: {}, title: '', skin: '' };
  if (!o?.tracks || typeof o.tracks !== 'object' || Array.isArray(o.tracks)) return result;
  for (const [id, m] of Object.entries(o.tracks)) {
    const registry = id.startsWith('h.') ? HERO_BY_ID : id.startsWith('w.') ? WEAPONS : null;
    if (!registry || !Object.hasOwn(registry, id.slice(2))) continue;
    if (m && typeof m === 'object')
      addMarks(
        result.tracks,
        id,
        count(m.kills, killGoal),
        count(m.clears, clearGoal),
        m.flawless === true,
        m.early === true,
      );
    const tier = rank(result.tracks[id]);
    if (o?.title === id && tier >= 1) result.title = id;
    if (o?.skin === id && tier === 2) result.skin = id;
  }
  return result;
}
export function bankMarks(c: Cabinet, tally: Tallies) {
  for (const [id, m] of Object.entries(normalizeCabinet({ tracks: tally }).tracks)) {
    addMarks(c.tracks, id, m.kills, m.clears, m.flawless, m.early);
  }
}
const enamel = ['#41a6f6', '#ef7d57', '#38b764', '#b13e53', '#3b5dc9', '#257179'];
export function masterySkin(id: string): SkinDef | undefined {
  const track = tracks().find((x) => x.id === id);
  if (!track) return;
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return {
    ...SKINS[0],
    id,
    name: track.name,
    armor: enamel[hash % enamel.length],
    accent: '#ffcd75',
    suit: '#29366f',
    gem: track.color,
    iris: '#73eff7',
  };
}
