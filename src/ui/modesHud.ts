import { localizeHtml, localize } from '../i18n';
import type { Game } from '../game/game';
import { clock } from '../game/game';
import { rhythmTuning } from '../game/modes/rhythm';
import { PACIFIST_RULES, pacifistLeft } from '../game/modes/pacifist';
import { MINI_GAMES, miniLeft, miniTuning } from '../game/modes/minigames';
import { ghostDelta, signed } from '../game/modes/ghost';

/**
 * Modes lane HUD: a panel in the goals stack (rhythm stage beat pips and on-beat kills, the
 * Pacifist road's timer and rules, the ghost race delta), the crosshair's beat frame (it closes
 * in on every beat and lights in the on-beat window), the mini-game's big countdown and haul,
 * and the ghost's name tag. Pixel UI, CSS injected once; the DOM only changes when text does.
 */
const CSS = `
#modes {
  position: relative;
  min-width: 190px;
  margin-top: calc(2 * var(--p));
  padding: calc(2 * var(--p)) calc(3 * var(--p));
  --bg: var(--night);
  --hi: var(--slate);
  --lo: var(--ink);
  background-color: var(--bg);
  box-shadow:
    inset var(--p) var(--p) 0 0 var(--hi),
    inset calc(-1 * var(--p)) calc(-1 * var(--p)) 0 0 var(--lo),
    0 calc(-1 * var(--p)) 0 0 var(--ink),
    0 var(--p) 0 0 var(--ink),
    calc(-1 * var(--p)) 0 0 0 var(--ink),
    var(--p) 0 0 0 var(--ink),
    0 calc(2 * var(--p)) 0 0 var(--ink);
  pointer-events: none;
  text-shadow: var(--outline);
}
#modes .h { font: 10px var(--label); letter-spacing: 1px; color: var(--mc, var(--cyan)); display: flex; justify-content: space-between; gap: 10px; }
#modes .t { font: 20px var(--font); color: var(--white); line-height: 1.1; margin-top: 2px; }
#modes .s { font: 13px var(--font); color: var(--mist); }
#modes .row { display: flex; justify-content: space-between; gap: 8px; font: 13px var(--font); color: var(--white); margin-top: var(--p); }
#modes .sec + .sec { margin-top: calc(3 * var(--p)); }
#modes .pips { display: flex; gap: var(--p); margin-top: calc(2 * var(--p)); height: calc(3 * var(--p)); }
#modes .pips i { flex: 1; background: var(--ink); }
#modes .pips i.on { background: var(--cyan); }
#modes .pips i.down.on { background: var(--yellow); }
#modes .chip { font: 11px var(--label); letter-spacing: 1px; text-shadow: none; padding: 0 calc(2 * var(--p)); color: var(--slate); background: var(--ink); }
#modes .chip.on { color: var(--ink); background: var(--yellow); }
#modes .ok { color: var(--lime); }
#modes .bad { color: var(--red); }
#modes .ahead { color: var(--lime); }
#modes .behind { color: var(--red); }
#modes .rule { font: 11px var(--label); letter-spacing: 1px; color: var(--mist); }
#mdbeat {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 30px;
  height: 30px;
  margin: -15px 0 0 -15px;
  pointer-events: none;
  box-shadow:
    -3px -3px 0 0 var(--cyan), 3px -3px 0 0 var(--cyan),
    -3px 3px 0 0 var(--cyan), 3px 3px 0 0 var(--cyan);
  opacity: 0.85;
}
#mdbeat.on { box-shadow: -3px -3px 0 0 var(--yellow), 3px -3px 0 0 var(--yellow), -3px 3px 0 0 var(--yellow), 3px 3px 0 0 var(--yellow), 0 0 0 3px var(--yellow); }
#mgbig {
  position: absolute;
  left: 50%;
  top: 18%;
  transform: translateX(-50%);
  text-align: center;
  pointer-events: none;
  text-shadow: var(--outline);
}
#mgbig .n { font: 13px var(--label); letter-spacing: 2px; color: var(--mgc, var(--yellow)); }
#mgbig .c { font: 64px var(--display); color: var(--white); line-height: 1; }
#mgbig .g { font: 24px var(--display); color: var(--yellow); }
#mgbig .o { font: 13px var(--font); color: var(--mist); }
#mdghost { position: absolute; left: 0; top: 0; pointer-events: none; font: 11px var(--label); letter-spacing: 1px; color: var(--cyan); text-shadow: var(--outline); transform: translate(-50%, -100%); white-space: nowrap; }
`;

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

export class ModesHud {
  private el: HTMLElement | null = null;
  private beatEl: HTMLElement | null = null;
  private big: HTMLElement | null = null;
  private tag: HTMLElement | null = null;
  private last = '';
  private lastBig = '';
  private lastTag = '';
  private tmp = { x: 0, y: 0 };

  constructor(private reticle: HTMLElement) {}

  private mount(): boolean {
    if (this.el) return true;
    const root = document.getElementById('ingame');
    if (!root) return false;
    if (!document.getElementById('modes-css')) {
      const st = document.createElement('style');
      st.id = 'modes-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    this.el = document.createElement('div');
    this.el.id = 'modes';
    this.el.hidden = true;
    const goals = document.getElementById('goals');
    if (goals) goals.insertBefore(this.el, document.getElementById('spice'));
    else root.append(this.el);
    this.beatEl = document.createElement('div');
    this.beatEl.id = 'mdbeat';
    this.beatEl.hidden = true;
    this.reticle.append(this.beatEl);
    this.big = document.createElement('div');
    this.big.id = 'mgbig';
    this.big.hidden = true;
    root.append(this.big);
    this.tag = document.createElement('div');
    this.tag.id = 'mdghost';
    this.tag.hidden = true;
    root.append(this.tag);
    return true;
  }

  update(g: Game, ghost: { x: number; z: number } | null, inWindow: boolean, phase: number): void {
    if (!this.mount()) return;
    const M = g.modes;
    const combat = g.isCombatMode && g.mode !== 'title';
    const me = g.hero.index;
    const parts: string[] = [];
    if (M.rhythm && combat) {
      const b = Math.floor(M.beat);
      const pips = [0, 1, 2, 3].map((k) => `<i class="${k === 0 ? 'down ' : ''}${((b % 4) + 4) % 4 === k && phase < 0.5 ? 'on' : ''}"></i>`).join('');
      parts.push(`<div class="sec" style="--mc: var(--cyan)"><div class="h"><span>RHYTHM STAGE</span><span>${Math.round(M.clock.bpm)} BPM</span></div>
        <div class="pips">${pips}</div>
        <div class="row"><span>ON-BEAT KILLS ${M.onBeat[me] ?? 0}</span><span class="chip${inWindow ? ' on' : ''}">ON BEAT x${rhythmTuning.killScore}</span></div></div>`);
    }
    if (M.pacifist && combat && g.mode === 'fight') {
      const left = g.role === 'client' ? M.pacLeft : pacifistLeft(g.director.time, g.director.duration);
      const killed = (M.pacKills[me] ?? 0) > 0;
      parts.push(`<div class="sec" style="--mc: var(--lime)"><div class="h"><span>PACIFIST ROAD</span><span class="${killed ? 'bad' : 'ok'}">${killed ? 'REWARD LOST' : 'NO KILLS'}</span></div>
        <div class="t">${clock(left)}</div>
        ${PACIFIST_RULES.map((r) => `<div class="rule">${r}</div>`).join('')}</div>`);
    }
    if (M.rival && ghost !== undefined && combat && (g.runMode === 'weekly' || M.rec)) {
      const d = ghostDelta(M.rival, g.runTime, Math.floor(g.score * g.meta.multiplier));
      const cls = d.score >= 0 ? 'ahead' : 'behind';
      const sec = d.seconds === null ? '' : `<span class="${d.seconds >= 0 ? 'ahead' : 'behind'}">${signed(d.seconds)} S</span>`;
      parts.push(`<div class="sec" style="--mc: var(--sky)"><div class="h"><span>GHOST RACE</span><span>${esc((M.rivalOwn ? 'YOUR BEST' : M.rival.name).toUpperCase())}</span></div>
        <div class="row"><span class="${cls}">${d.score >= 0 ? '+' : '-'}${Math.abs(d.score).toLocaleString('en-US')} PTS</span>${sec}</div></div>`);
    }
    const html = parts.join('');
    if (html !== this.last) {
      this.last = html;
      this.el!.innerHTML = localizeHtml(html);
      this.el!.hidden = !html;
    }
    // Crosshair beat frame: closes in toward the beat, flashes in the on-beat window.
    const bOn = M.rhythm && combat;
    this.beatEl!.hidden = !bOn;
    if (bOn) {
      const s = 1 + (1 - phase) * 0.9;
      this.beatEl!.style.transform = `scale(${(Math.round(s * 8) / 8).toFixed(3)})`;
      this.beatEl!.classList.toggle('on', inWindow);
    }
    // Mini-game: countdown, clock and haul.
    let big = '';
    const mg = M.mg;
    if (mg) {
      const def = MINI_GAMES[mg.kind];
      const mine = mg.gold[me] ?? 0;
      const others = g.heroes.filter((h) => h !== g.hero && !h.left).map((h) => `${esc(h.name.toUpperCase())} +${mg.gold[h.index] ?? 0}`).join(' · ');
      const c = mg.phase === 0 ? String(Math.max(1, Math.ceil(miniTuning.intro - mg.t))) : mg.phase === 1 ? String(Math.ceil(miniLeft(mg))) : "TIME'S UP";
      big = `<div class="n" style="--mgc: ${def.color}">${def.name}</div><div class="c">${c}</div><div class="g">+${mine} GOLD</div>${others ? `<div class="o">${others}</div>` : ''}${mg.phase === 0 ? `<div class="o">${def.how}</div>` : ''}`;
    }
    if (big !== this.lastBig) {
      this.lastBig = big;
      this.big!.innerHTML = localizeHtml(big);
      this.big!.hidden = !big;
    }
    // Ghost name tag.
    let tag = '';
    if (ghost && M.rival) {
      const v = g.tmp.set(ghost.x, 2.5, ghost.z).project(g.cam.camera);
      if (v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05) {
        this.tmp.x = ((v.x + 1) / 2) * innerWidth;
        this.tmp.y = ((1 - v.y) / 2) * innerHeight;
        tag = M.rivalOwn ? 'YOUR GHOST' : `${M.rival.name.toUpperCase()} (GHOST)`;
      }
    }
    if (tag !== this.lastTag) {
      this.lastTag = tag;
      this.tag!.textContent = localize(tag);
      this.tag!.hidden = !tag;
    }
    if (tag) this.tag!.style.transform = `translate(${Math.round(this.tmp.x)}px, ${Math.round(this.tmp.y)}px) translate(-50%, -100%)`;
  }
}
