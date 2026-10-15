/** Procedural music: generated songs are valid and seeded. */
import { ok } from './check';
(globalThis as any).window = { addEventListener() {} };
const { makeSong, TRACKS } = await import('../src/audio/music');
let bad = 0;
for (const t of TRACKS) for (let seed = 0; seed < 200; seed++) {
  const s = makeSong(t.style, seed);
  if (s.chords.length !== 4 || s.melody.length !== 64 || s.bass.length !== 16 || s.kick.length !== 16) bad++;
  for (const n of s.melody) if (n && (!Number.isFinite(n.deg) || n.deg < 0 || n.deg > 14)) bad++;
  if (s.melody.filter(Boolean).length < 4) bad++;
}
const a = JSON.stringify(makeSong(TRACKS[1].style, 42)), b = JSON.stringify(makeSong(TRACKS[1].style, 42)), c = JSON.stringify(makeSong(TRACKS[1].style, 43));
ok(bad === 0, 'songs are well formed for every track and 200 seeds');
ok(a === b, 'same seed, same song');
ok(a !== c, 'different seed, different song');
