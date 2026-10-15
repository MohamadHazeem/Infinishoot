/**
 * Curses: optional deals offered in the shop between stages. Taking one makes
 * the rest of the run harder for the whole team, and pays the taker gold
 * right away plus a permanent team score bonus. They stack.
 */
export interface CurseDef {
  id: string;
  name: string;
  desc: string;
  icon: string;
  color: string;
  /** Gold paid to whoever takes it. */
  gold: number;
  /** Team score bonus for the rest of the run (+0.2 = +20%). */
  score: number;
  enemyHp?: number;
  enemySpeed?: number;
  enemyCount?: number;
  enemyDmg?: number;
  dmgTaken?: number;
  dashCd?: number;
  noHearts?: boolean;
}

export const CURSES: CurseDef[] = [
  { id: 'c_swift', name: 'Swift Foes', desc: 'Enemies move 15% faster.', icon: '»', color: '#ef7d57', gold: 8, score: 0.2, enemySpeed: 0.15 },
  { id: 'c_thick', name: 'Thick Skin', desc: 'Enemies have 25% more life.', icon: '▣', color: '#b13e53', gold: 10, score: 0.25, enemyHp: 0.25 },
  { id: 'c_glass', name: 'Glass Bones', desc: 'You take 25% more damage.', icon: '✚', color: '#ff5e7a', gold: 10, score: 0.25, dmgTaken: 0.25 },
  { id: 'c_famine', name: 'Famine', desc: 'No more hearts drop.', icon: '♥', color: '#5d275d', gold: 6, score: 0.15, noHearts: true },
  { id: 'c_crowd', name: 'Crowded', desc: '20% more enemies at once.', icon: '☠', color: '#566c86', gold: 8, score: 0.2, enemyCount: 0.2 },
  { id: 'c_fuse', name: 'Short Fuse', desc: 'Your dash recharges 30% slower.', icon: '◔', color: '#29366f', gold: 6, score: 0.15, dashCd: 0.3 },
  { id: 'c_brutal', name: 'Brutality', desc: 'Enemies hit 20% harder.', icon: '✷', color: '#ff2d4a', gold: 9, score: 0.2, enemyDmg: 0.2 },
];

export const CURSE_BY_ID = Object.fromEntries(CURSES.map((c) => [c.id, c])) as Record<string, CurseDef>;
