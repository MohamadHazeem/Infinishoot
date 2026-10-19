import type { Game } from '../game/game';
import { settings } from '../game/settings';
import { cleanLook } from '../data/customise';
import { fogForce } from '../render/volumeFog';
import { reflectTuning } from '../render/reflections';
import { cineTuning } from '../game/cineCam';
import { gfxState, gfxStats } from '../game/systems/graphics';
import { smashCover } from '../game/coverBreak';

/**
 * Test-link options for the graphics lane (called from applyTestLink):
 * - `anime`: ANIME LOOK on (`noanime` off)
 * - `look=<code>`: CUSTOMISE code, e.g. `look=b3c31` (armour, body, accent, accessory, weapon skin; src/data/customise.ts)
 * - `customise`: open EXTRAS > CUSTOMISE (on the title screen: use with `?test&title`)
 * - `shatter=<s>`: after <s> seconds break the props around the hero: crates, barrels, the nearest pillar and cover
 * - `impact=<s>`: an impact frame every <s> seconds (with `anime`)
 * - `fog=<0..1>`: force the volumetric ground fog
 * - `puddles=<n>`: force n puddles on this stage
 * - `cine=<0..1>`: pin the camera framing tilt (`nocine` disables it)
 * - `speedpin=x,z`: hold the dash speed lines on; `boomwater=<s>`: explosions on the nearest pond; `gfxstats=<s>`: log the lane's numbers
 */
export function graphicsLinks(game: Game, q: URLSearchParams): void {
  if (q.has('anime')) settings.animeLook = true;
  if (q.has('noanime')) settings.animeLook = false;
  if (q.has('look')) settings.look = cleanLook(q.get('look'));
  if (q.has('fog')) fogForce.amount = Number(q.get('fog')) || 0;
  if (q.has('puddles')) {
    reflectTuning.puddles = reflectTuning.rainPuddles = Number(q.get('puddles')) || 0;
    const n = reflectTuning.puddles;
    // Force them on any biome: pretend it's raining for the puddle check.
    setInterval(() => {
      if (n > 0 && game.ambience.rain < 0.06) game.ambience.rain = 0.06;
    }, 100);
  }
  if (q.has('nocine')) cineTuning.pitchDrop = 0;
  const cine = q.get('cine');
  if (cine !== null) {
    const v = Math.max(0, Math.min(1, Number(cine) || 0));
    setInterval(() => {
      game.cam.cine = v;
      game.cam.cineShown = v;
    }, 16);
  }
  if (q.has('customise')) {
    game.leaveToTitle();
    setTimeout(() => {
      gfxState(game);
      (document.querySelector('#scr-extras [data-act=cu-open]') as HTMLElement | null)?.click();
    }, 600);
  }
  // &gfxstats=<s>: log the lane's numbers (pieces, piles, puddles, fog, cine tilt, lights) as console errors so `npm run shot` prints them.
  const gs = Number(q.get('gfxstats'));
  if (gs > 0) setTimeout(() => console.error('gfxstats ' + JSON.stringify(gfxStats(game))), gs * 1000);
  // &boomwater=<s>: an explosion on the nearest pond every <s> seconds (reflection checks).
  const bw = Number(q.get('boomwater'));
  if (bw > 0) {
    setInterval(() => {
      if (game.paused) return;
      const p = game.hero.player;
      let best = null as { x: number; z: number; r: number } | null;
      for (const w of game.ambience.surfaces.patches) if (w.kind === 'water' && (!best || (w.x - p.x) ** 2 + (w.z - p.z) ** 2 < (best.x - p.x) ** 2 + (best.z - p.z) ** 2)) best = w;
      if (!best) return;
      const a = Math.random() * Math.PI * 2;
      const x = best.x + Math.cos(a) * best.r * 0.4;
      const z = best.z + Math.sin(a) * best.r * 0.4;
      game.vfx.ring(x, z, 1, 8, '#ff7a2f', 0.6);
      game.vfx.star(x, 1.4, z, 3, '#ffb627', 0.3);
    }, bw * 1000);
  }
  // &speedpin=x,z: hold the dash speed lines on (screenshots), along world direction (x, z).
  const pin = q.get('speedpin');
  if (pin !== null) {
    const [x, z] = pin.split(',').map(Number);
    setInterval(() => {
      const st = gfxState(game) as unknown as { speedK: number; speedX: number; speedZ: number };
      st.speedK = 1;
      st.speedX = x || 1;
      st.speedZ = z || 0;
    }, 16);
  }
  const imp = Number(q.get('impact'));
  if (imp > 0) {
    setInterval(() => {
      const st = gfxState(game) as unknown as { impactLeft: number; impactCd: number };
      st.impactCd = 0;
      st.impactLeft = 2;
    }, imp * 1000);
  }
  const sh = Number(q.get('shatter'));
  if (sh > 0) {
    setTimeout(() => {
      const p = game.hero.player;
      const near = (x: number, z: number, r: number) => (x - p.x) ** 2 + (z - p.z) ** 2 < r * r;
      for (const b of game.barrels.list) if (b.alive && near(b.x, b.z, 16)) b.fuse = 0.05;
      let pillar = null as (typeof game.toys.props)[number] | null;
      for (const t of game.toys.props) {
        if (!t.alive) continue;
        if (t.def.kind === 'pillar') {
          if (near(t.def.x, t.def.z, 22) && (!pillar || (t.def.x - p.x) ** 2 + (t.def.z - p.z) ** 2 < (pillar.def.x - p.x) ** 2 + (pillar.def.z - p.z) ** 2)) pillar = t;
        } else if (near(t.def.x, t.def.z, 16)) game.damageProp(t, 1e6, 0, t.def.x - p.x, t.def.z - p.z);
      }
      if (pillar) game.damageProp(pillar, 1e6, 0, 0, 1);
      // Cover within reach: smash it like Rex does.
      for (let k = 0; k < 6; k++) smashCover(game, p.x + Math.cos(k) * 6, p.z + Math.sin(k) * 6, 4);
    }, sh * 1000);
  }
}
