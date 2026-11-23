// The browser and Worker use this same bounded, canonical grammar. Only the choreography and
// layout travel. Arena-editor wave, loot, difficulty and boss rules never enter the encounter.
import { arenaCode, readArenaCodeSync, crc32 } from '../editor/codec';
import {
  defaultRules,
  normalizeArena,
  pieceColliders,
  SIZE_HALF,
  validateArena,
  type CustomArena,
} from '../editor/arenaData';
import { SAMPLE_IDS, sampleArena } from '../editor/samples';
import { resolveCircleVsBoxes } from '../world/collision';

export const bodies = ['king', 'rex', 'queen'] as const;
export const moves = ['ring', 'charge', 'fan', 'strike', 'summon', 'wall'] as const;
export type Move = (typeof moves)[number];
export interface Cue {
  move: Move;
  tempo: number;
}
export interface Design {
  body: (typeof bodies)[number];
  arena: string; // 0..2 = editor sample, otherwise a portable ISA1 layout
  phases: Cue[][];
}
const alphabet = 'ABCDEFGHIJKLMNOPQR';
const tellBase: Record<Move, number> = {
  ring: 0.95,
  charge: 1.15,
  fan: 1,
  strike: 1.1,
  summon: 1.25,
  wall: 1.35,
};
export const tellTime = (cue: Cue) => tellBase[cue.move] + cue.tempo * 0.35;
export const restTime = (cue: Cue) => 1.15 + cue.tempo * 0.4;
export const wallGap = 2.3; // half-width in metres, measured to the nearest stinger centre
export const maxBossCode = 2300;
export function layoutOnly(a: CustomArena): CustomArena {
  return normalizeArena({
    ...a,
    name: 'CUSTOM ARENA',
    // Persistent floor damage can exhaust a party before its authored fight even starts.
    pieces: a.pieces.filter((p) => p.k !== 'lava' && p.k !== 'thorns'),
    rules: { ...defaultRules(), biome: a.rules.biome, events: false },
  });
}
export function resolveLayout(key: string): CustomArena {
  const sample = /^[012]$/.test(key);
  if (!sample && (key.length > 2100 || !/^ISA1\.[A-Za-z0-9_-]+$/.test(key))) throw Error('arena');
  const source = sample ? sampleArena(SAMPLE_IDS[Number(key)]) : readArenaCodeSync(key);
  const a = layoutOnly(source);
  if (!sample && arenaCode(a) !== key) throw Error('arena');
  if (sample) a.name = source.name;
  const boss = a.pieces.find((p) => p.k === 'boss');
  const bodyRadius = 2.1; // Rex is the largest selectable body. Switching bodies must stay legal.
  if (
    !boss ||
    Math.max(Math.abs(boss.x), Math.abs(boss.z)) + bodyRadius > SIZE_HALF[a.size] - 1 ||
    resolveCircleVsBoxes({ x: boss.x, z: boss.z }, bodyRadius, pieceColliders(a)) ||
    !validateArena(a).ok ||
    a.pieces.some((p) => p.k === 'hero' && Math.hypot(p.x - boss.x, p.z - boss.z) < 8)
  )
    throw Error('arena');
  return a;
}
const checksum = (s: string) => crc32(new TextEncoder().encode(s)).toString(36);
export function encodeBoss(d: Design): string {
  const body = bodies.indexOf(d.body);
  if (body < 0 || !Array.isArray(d.phases) || d.phases.length !== 3) throw Error('phases');
  resolveLayout(d.arena);
  const seq = d.phases.map((phase) => {
    if (!Array.isArray(phase) || phase.length < 1 || phase.length > 4) throw Error('phase');
    return phase
      .map((cue) => {
        const i = moves.indexOf(cue.move);
        if (i < 0 || !Number.isInteger(cue.tempo) || cue.tempo < 0 || cue.tempo > 2)
          throw Error('cue');
        return alphabet[3 * i + cue.tempo];
      })
      .join('');
  });
  const bodyText = [body, ...seq, d.arena].join(':');
  return 'ISB1.' + bodyText + '~' + checksum(bodyText);
}
export function decodeBoss(raw: unknown): Design | null {
  if (typeof raw !== 'string' || raw.length > maxBossCode) return null;
  const match =
    /^ISB1\.([012]):([A-R]{1,4}):([A-R]{1,4}):([A-R]{1,4}):([012]|ISA1\.[A-Za-z0-9_-]+)~([a-z0-9]{1,7})$/.exec(
      raw,
    );
  if (!match || checksum(raw.slice(5, raw.lastIndexOf('~'))) !== match[6]) return null;
  try {
    resolveLayout(match[5]);
  } catch {
    return null;
  }
  return {
    body: bodies[Number(match[1])],
    arena: match[5],
    phases: match.slice(2, 5).map((s) =>
      [...s].map((c) => {
        const i = alphabet.indexOf(c);
        return { move: moves[Math.floor(i / 3)], tempo: i % 3 };
      }),
    ),
  };
}
export function sampleBoss(seed = 0): Design {
  let state = seed >>> 0;
  const roll = (n: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return Math.floor((state / 4294967296) * n);
  };
  return {
    body: bodies[seed % 3],
    arena: String(seed % 3),
    phases: Array.from({ length: 3 }, () =>
      Array.from({ length: 2 }, () => ({ move: moves[roll(6)], tempo: roll(3) })),
    ),
  };
}
