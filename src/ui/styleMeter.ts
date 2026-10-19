import { binds, keyLabel } from '../core/keybinds';
import { STYLE_RANKS, styleTuning, type StyleNote } from '../game/style';
import { reduceMotion, restartClass } from './hud';

/**
 * Skill HUD: the style meter (a big bold rank letter with a progress bar,
 * the score multiplier and a feed of what earned style) on the right under
 * the combo, plus the ultimate's charge tank next to the DASH and special
 * meters. Plain DOM inside #ingame, so it hides with the HUD and in menus.
 * Styles are injected here to keep the skill layer self-contained.
 */
const CSS = `
#stylemeter {
  position: absolute;
  top: calc(57 * var(--p));
  right: 20px;
  display: grid;
  grid-template-columns: auto auto;
  align-items: center;
  column-gap: 10px;
  justify-items: end;
}
#stylemeter .side { text-align: right; }
#stylemeter .lbl { font: 10px var(--label); letter-spacing: 2px; color: var(--mist); }
#stylemeter .mul { font: 12px var(--label); color: var(--white); margin-top: 2px; }
#stylemeter .bar {
  --bg: var(--ink); --hi: var(--ink); --lo: var(--ink); --ring: transparent;
  width: 66px; height: calc(3 * var(--p)); margin: 6px 0 0 auto;
  background: var(--night);
  box-shadow: 0 calc(-1 * var(--p)) 0 0 var(--ink), 0 var(--p) 0 0 var(--ink), calc(-1 * var(--p)) 0 0 0 var(--ink), var(--p) 0 0 0 var(--ink);
}
#stylemeter .bar i { display: block; height: 100%; background: var(--rc); transform-origin: left; }
#stylemeter .rank {
  font-family: var(--display);
  font-size: 104px;
  line-height: 0.78;
  min-width: 1em;
  text-align: center;
  color: var(--rc);
  transform: rotate(-6deg);
  text-shadow: var(--outline), calc(2 * var(--o)) calc(3 * var(--o)) 0 var(--ink);
}
#stylemeter { --rc: var(--slate); }
#stylemeter.r1 { --rc: var(--sky); }
#stylemeter.r2 { --rc: var(--lime); }
#stylemeter.r3 { --rc: var(--yellow); }
#stylemeter.r4 { --rc: var(--orange); }
#stylemeter.r5 { --rc: var(--red); }
#stylemeter .rank { color: var(--rc); }
#stylemeter.r0 .rank { opacity: 0.55; }
#stylemeter.r5 .rank { animation: tiercycle 0.4s steps(1) infinite; font-size: 88px; letter-spacing: -6px; }
#stylemeter.up .rank { animation: stylePop 0.36s steps(3); }
#stylemeter.r5.up .rank { animation: stylePop 0.36s steps(3), tiercycle 0.4s steps(1) infinite; }
#stylemeter.down .rank { animation: styleDrop 0.3s steps(4); }
@keyframes stylePop {
  0% { transform: scale(2) rotate(-14deg); }
  50% { transform: scale(1.3) rotate(2deg); }
  100% { transform: rotate(-6deg); }
}
@keyframes styleDrop {
  0% { transform: rotate(-6deg) translateX(calc(-3 * var(--p))); }
  25% { transform: rotate(4deg) translateX(calc(3 * var(--p))); }
  50% { transform: rotate(-10deg) translateX(calc(-2 * var(--p))); }
  100% { transform: rotate(-6deg); }
}
#stylemeter .feed {
  grid-column: 1 / span 2;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  margin-top: 8px;
  min-height: 48px;
}
#stylemeter .feed div {
  font: 10px var(--label);
  letter-spacing: 1px;
  color: var(--white);
  animation: styleNote 1.8s steps(6) forwards;
}
#stylemeter .feed div b { color: var(--rc); font-weight: normal; margin-left: 6px; }
@keyframes styleNote {
  0% { transform: translateX(calc(6 * var(--p))); opacity: 0; }
  15% { transform: none; opacity: 1; }
  80% { opacity: 1; }
  100% { opacity: 0; }
}
#ultpip { --c: var(--yellow); }
#ultpip.ready { --ring: var(--yellow); animation: hop 0.5s steps(2) infinite; }
#ultpip.active { --c: var(--white); --ring: var(--orange); }
.reduce-flash #stylemeter .rank, .reduce-flash #ultpip { animation: none !important; }
`;

export interface SkillHudState {
  points: number;
  rank: number;
  notes: readonly StyleNote[];
  seq: number;
  ult01: number;
  ultActive: number;
  ultName: string;
  visible: boolean;
}

export class SkillHud {
  private el: HTMLElement;
  private rankEl: HTMLElement;
  private mulEl: HTMLElement;
  private barEl: HTMLElement;
  private feedEl: HTMLElement;
  private ult: HTMLElement;
  private ultLbl: HTMLElement;
  private shownRank = -1;
  private shownSeq = 0;
  private lastLabel = '';
  private lastBar = -1;
  private lastUlt = -1;
  private animT = 0;

  constructor(hudRoot: HTMLElement) {
    if (!document.getElementById('skill-css')) {
      const st = document.createElement('style');
      st.id = 'skill-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    const ingame = hudRoot.querySelector<HTMLElement>('#ingame') ?? hudRoot;
    this.el = document.createElement('div');
    this.el.id = 'stylemeter';
    this.el.className = 'r0';
    this.el.innerHTML = `<div class="side"><div class="lbl">STYLE</div><div class="mul">x1</div><div class="bar"><i></i></div></div><div class="rank">D</div><div class="feed"></div>`;
    ingame.appendChild(this.el);
    this.rankEl = this.el.querySelector('.rank')!;
    this.mulEl = this.el.querySelector('.mul')!;
    this.barEl = this.el.querySelector('.bar i')!;
    this.feedEl = this.el.querySelector('.feed')!;
    const meters = ingame.querySelector<HTMLElement>('#meters') ?? ingame;
    this.ult = document.createElement('div');
    this.ult.id = 'ultpip';
    this.ult.className = 'pip';
    this.ult.innerHTML = '<span>ULT</span>';
    meters.appendChild(this.ult);
    this.ultLbl = this.ult.querySelector('span')!;
  }

  /** Called every render frame. */
  update(s: SkillHudState, dt: number): void {
    this.el.hidden = !s.visible;
    if (!s.visible) return;
    const r = s.rank;
    if (r !== this.shownRank) {
      const up = r > this.shownRank && this.shownRank >= 0;
      const down = r < this.shownRank;
      this.el.className = `r${r}`;
      this.rankEl.textContent = STYLE_RANKS[r];
      this.mulEl.textContent = `SCORE x${styleTuning.scoreMul[r]}`;
      if (!reduceMotion() && (up || down)) {
        restartClass(this.el, up ? 'up' : 'down'); // restart the pop/drop animation (no forced layout)
        this.animT = 0.4;
      }
      this.shownRank = r;
    }
    if (this.animT > 0 && (this.animT -= dt) <= 0) this.el.classList.remove('up', 'down');
    const t = styleTuning.thresholds;
    const next = r + 1 < t.length ? t[r + 1] : styleTuning.cap;
    const k = Math.max(0, Math.min(1, (s.points - t[r]) / Math.max(1, next - t[r])));
    const kq = Math.round(k * 20) / 20; // chunky steps
    if (kq !== this.lastBar) {
      this.lastBar = kq;
      this.barEl.style.transform = `scaleX(${kq})`;
    }
    // New feed notes (newest on top, at most 3 on screen).
    if (s.seq !== this.shownSeq) {
      const fresh = Math.min(s.notes.length, Math.max(0, s.seq - this.shownSeq));
      for (let i = s.notes.length - fresh; i < s.notes.length; i++) {
        const n = s.notes[i];
        const d = document.createElement('div');
        d.innerHTML = `${n.text}<b>+${n.pts}</b>`;
        d.addEventListener('animationend', () => d.remove(), { once: true });
        this.feedEl.prepend(d);
      }
      while (this.feedEl.children.length > 3) this.feedEl.lastElementChild!.remove();
      this.shownSeq = s.seq;
    }
    // Ultimate tank.
    const ready = s.ult01 >= 1 && s.ultActive <= 0;
    const fill = s.ultActive > 0 ? s.ultActive : s.ult01;
    const fq = Math.round(fill * 20) / 20;
    if (fq !== this.lastUlt) {
      this.lastUlt = fq;
      this.ult.style.setProperty('--k', String(fq));
    }
    this.ult.classList.toggle('ready', ready);
    this.ult.classList.toggle('active', s.ultActive > 0);
    const key = keyLabel(binds.ult[0] || binds.ult[1]);
    const label = s.ultActive > 0 ? 'GO!' : ready ? `ULT ${key}` : 'ULT';
    if (label !== this.lastLabel) {
      this.lastLabel = label;
      this.ultLbl.textContent = label;
    }
  }

  /** Forget shown state (new run). */
  reset(): void {
    this.shownSeq = 0;
    this.shownRank = -1;
    this.feedEl.textContent = '';
  }
}
