import { localizeHtml } from '../i18n';
import { PET_SKILL_INFO, petSkillAt, type PetDef, type PetSkillId } from '../data/pets';

/**
 * Companion HUD: the pet panel (bottom right, left of the minimap: name, level
 * pips, learned skills with shield/revive state, next skill) and, in co-op,
 * the TEAM meter (bottom centre, above the dash/special/ult tanks). Plain
 * DOM in the pixel UI style; styles are injected once so the lane needs no
 * edits to style.css. Only touches the DOM when what it shows changes.
 */
const CSS = `
#petpanel, #teammeter {
  position: absolute;
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
#petpanel {
  right: calc(20px + 50 * var(--p) + 14px);
  bottom: 100px;
  width: calc(50 * var(--p));
  box-sizing: border-box;
  padding: calc(2 * var(--p)) calc(3 * var(--p));
}
#petpanel .h { display: flex; justify-content: space-between; align-items: baseline; }
#petpanel .n { font: 18px var(--font); color: var(--pc); line-height: 1; }
#petpanel .lv { font: 10px var(--label); color: var(--white); letter-spacing: 1px; }
#petpanel .pips { display: flex; gap: var(--p); margin-top: calc(2 * var(--p)); height: calc(2 * var(--p)); }
#petpanel .pips i { flex: 1; background: var(--ink); }
#petpanel .pips i.on { background: var(--pc); }
#petpanel .sk { display: flex; flex-wrap: wrap; gap: 2px 6px; margin-top: calc(2 * var(--p)); font: 9px var(--label); letter-spacing: 1px; }
#petpanel .sk b { font-weight: normal; color: var(--c); }
#petpanel .sk b.off { color: var(--slate); text-decoration: line-through; }
#petpanel .nx { margin-top: 3px; font: 12px var(--font); color: var(--mist); }
#petpanel.pop { animation: petpop 0.6s steps(4); --hi: var(--yellow); }
@keyframes petpop {
  0% { transform: translateY(calc(-3 * var(--p))) scale(1.12); }
  60% { transform: translateY(calc(-1 * var(--p))) scale(1.04); }
  100% { transform: none; }
}
#teammeter {
  left: calc(50% - 132px);
  bottom: calc(22px + 62px + 4 * var(--p) + 10px);
  width: 264px;
  box-sizing: border-box;
  padding: calc(2 * var(--p)) calc(3 * var(--p));
}
#teammeter .h { display: flex; justify-content: space-between; font: 10px var(--label); letter-spacing: 1px; color: var(--cyan); }
#teammeter .h .mv { color: var(--mc); }
#teammeter .bar { display: flex; gap: var(--p); margin-top: calc(2 * var(--p)); height: calc(3 * var(--p)); }
#teammeter .bar i { flex: 1; background: var(--ink); }
#teammeter .bar i.on { background: var(--cyan); }
#teammeter .s { margin-top: 2px; font: 13px var(--font); color: var(--mist); text-align: center; line-height: 1.1; }
#teammeter.charging .bar i.on { background: var(--sky); }
#teammeter.charging .s { color: var(--cyan); }
#teammeter.ready { --bg: var(--teal); --hi: var(--lime); animation: hop 0.6s steps(2) infinite; }
#teammeter.ready .bar i { background: var(--lime); }
#teammeter.ready .s { color: var(--yellow); font-size: 15px; }
#teammeter.fire { --bg: var(--plum); --hi: var(--yellow); }
.reduce-flash #teammeter.ready { animation: none; }
`;

export interface PetHudState {
  def: PetDef;
  level: number;
  maxLevel: number;
  ranks: Record<PetSkillId, number>;
  shieldReady: boolean;
  reviveReady: boolean;
}

export interface TeamHudState {
  charge: number;
  linked: number;
  /** Seconds linked / seconds needed. */
  link01: number;
  next: { name: string; color: string };
  /** Name of the move running now ('' when none). */
  firing: string;
  key: string;
}

const SKILLS: PetSkillId[] = ['fetch', 'zap', 'taunt', 'shield', 'revive'];
const SEGS = 12;

export class CompanionHud {
  private pet: HTMLElement | null = null;
  private team: HTMLElement | null = null;
  private lastPet = '';
  private lastTeam = '';
  private lastLevel = 0;

  private mount(): boolean {
    if (this.pet) return true;
    const root = document.getElementById('ingame');
    if (!root) return false;
    if (!document.getElementById('companion-css')) {
      const st = document.createElement('style');
      st.id = 'companion-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    this.pet = document.createElement('div');
    this.pet.id = 'petpanel';
    this.pet.hidden = true;
    this.team = document.createElement('div');
    this.team.id = 'teammeter';
    this.team.hidden = true;
    root.append(this.pet, this.team);
    return true;
  }

  /** Pet panel for the local hero (null hides it). */
  setPet(s: PetHudState | null): void {
    if (!this.mount()) return;
    const el = this.pet!;
    if (!s) {
      el.hidden = true;
      this.lastPet = '';
      return;
    }
    const key = `${s.def.id}|${s.level}|${s.shieldReady}|${s.reviveReady}`;
    if (key !== this.lastPet) {
      // Level-up pop (not on the first show of a run).
      if (this.lastPet && s.level > this.lastLevel) {
        el.classList.remove('pop');
        void el.offsetWidth;
        el.classList.add('pop');
      }
      this.lastPet = key;
      this.lastLevel = s.level;
      let pips = '';
      for (let i = 0; i < s.maxLevel; i++) pips += `<i class="${i < s.level ? 'on' : ''}"></i>`;
      const chips = SKILLS.filter((k) => s.ranks[k] > 0)
        .map((k) => {
          const info = PET_SKILL_INFO[k];
          const off = (k === 'shield' && !s.shieldReady) || (k === 'revive' && !s.reviveReady);
          return `<b class="${off ? 'off' : ''}" style="--c:${info.color}">${info.name}${s.ranks[k] > 1 ? ' ' + 'I'.repeat(s.ranks[k]) : ''}</b>`;
        })
        .join('');
      const nextSkill = s.level < s.maxLevel ? petSkillAt(s.def, s.level + 1) : null;
      const nx = nextSkill ? `NEXT LV: ${PET_SKILL_INFO[nextSkill].name}${s.ranks[nextSkill] > 0 ? '+' : ''}` : 'MAX LEVEL!';
      el.style.setProperty('--pc', s.def.color);
      el.innerHTML = localizeHtml(`<div class="h"><span class="n">${s.def.name.toUpperCase()}</span><span class="lv">LV ${s.level}</span></div><div class="pips">${pips}</div><div class="sk">${chips}</div><div class="nx">${nx}</div>`);
    }
    el.hidden = false;
  }

  /** TEAM meter (co-op only; null hides it). */
  setTeam(s: TeamHudState | null): void {
    if (!this.mount()) return;
    const el = this.team!;
    if (!s) {
      el.hidden = true;
      this.lastTeam = '';
      return;
    }
    const on = Math.floor(Math.min(1, s.charge) * SEGS + 1e-6);
    const ready = s.charge >= 1;
    const charging = !ready && s.linked >= 2 && s.link01 >= 1;
    const status = s.firing
      ? `${s.firing}!`
      : ready
        ? `TEAM MOVE READY! PRESS ${s.key}`
        : charging
          ? `CHARGING x${s.linked}`
          : s.linked >= 2
            ? 'LINKING...'
            : 'STAND TOGETHER TO CHARGE';
    const cls = s.firing ? 'fire' : ready ? 'ready' : charging ? 'charging' : '';
    const key = `${on}|${status}|${cls}|${s.next.name}`;
    if (key !== this.lastTeam) {
      this.lastTeam = key;
      let bar = '';
      for (let i = 0; i < SEGS; i++) bar += `<i class="${i < on ? 'on' : ''}"></i>`;
      el.className = cls;
      el.style.setProperty('--mc', s.next.color);
      el.innerHTML = localizeHtml(`<div class="h"><span>TEAM</span><span class="mv">${s.next.name}</span></div><div class="bar">${bar}</div><div class="s">${status}</div>`);
    }
    el.hidden = false;
  }
}
