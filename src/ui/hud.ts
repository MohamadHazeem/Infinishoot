/**
 * In-game arcade HUD: XP bar and level, life, stage timer, score and combo,
 * kills and gold, boss bar, weapon/item loadout, dash and bomb meters,
 * banners, toasts, hurt vignette, screen flash and fade. Plain DOM.
 */
import { iconHtml } from './pixelIcons';

export interface HudState {
  hp: number;
  maxHp: number;
  dash01: number;
  bomb01: number;
  score: number;
  combo: number;
  multiplier: number;
  combo01: number;
  stage: number;
  level: number;
  xp01: number;
  timeLeft: number; // seconds; -1 = boss fight, -2 = stage cleared
  kills: number;
  gold: number;
  boss: { name: string; hp01: number } | null;
  lowHp: boolean;
}

export interface LoadoutItem {
  /** Item id (picks its pixel icon). */
  id: string;
  icon: string;
  color: string;
  level: number;
  max: boolean;
  /** Evolved weapon. */
  evo?: boolean;
  name: string;
  kind: 'weapon' | 'passive';
}

export const fmtScore = (n: number) => Math.floor(n).toLocaleString('en-US');
const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export class Hud {
  private root: HTMLElement;
  private q: <T extends HTMLElement>(s: string) => T;
  private els: Record<string, HTMLElement> = {};
  private lastHp = -1;
  private lastLevel = -1;
  private shownScore = 0;
  private lastCombo = 0;
  private lastMult = 1;
  private bannerT = 0;
  private toastT = 0;
  private hurtV = 0;
  private flashV = 0;
  private lastText: Record<string, string> = {};

  constructor(root: HTMLElement) {
    root.insertAdjacentHTML(
      'beforeend',
      `<div id="ingame">
         <div id="xpbar"><div class="fill"></div><div class="lv"></div></div>
         <div id="hp"><div class="bar"><div class="fill"></div></div><div class="num"></div></div>
         <div id="runinfo"><span class="kills"></span><span class="gold"></span></div>
         <div id="timer"><div class="clock"></div><div class="stage"></div></div>
         <button id="pausebtn" title="Pause (Esc)" aria-label="Pause">II</button>
         <div id="bossbar" hidden><div class="name"></div><div class="bar"><div class="fill"></div></div></div>
         <div id="toast"></div>
         <div id="score">0</div>
         <div id="combo"><div class="mult">x1</div><div class="num"></div><div class="cbar"><div></div></div></div>
         <div id="loadout"><div class="row weapons"></div><div class="row passives"></div></div>
         <div id="mods"></div>
         <div id="team"></div>
         <div id="tags"></div>
         <div id="meters">
           <div id="dashpip" class="pip"><span>DASH</span></div>
           <div id="bombpip" class="pip"><span>BOMB</span></div>
         </div>
         <div id="banner"><div class="t"></div><div class="s"></div></div>
         <div id="chestptr" hidden><i class="arrow"></i>${iconHtml('world_chest', '#ffcd75', '')}<span class="m"></span></div>
       </div>
       <div id="vignette"></div>
       <div id="flash"></div>
       <div id="fade"></div>`,
    );
    this.q = <T extends HTMLElement>(s: string) => root.querySelector<T>(s)!;
    this.root = this.q('#ingame');
    const pause = this.q('#pausebtn');
    pause.addEventListener('mousedown', (e) => e.stopPropagation());
    pause.addEventListener('click', () => this.onPause?.());
  }

  /** Edge-of-screen pointer to the nearest closed chest (null hides it). */
  setChestPointer(p: { x: number; y: number; angle: number; dist: number } | null): void {
    const el = this.el('#chestptr');
    el.hidden = !p;
    if (!p) return;
    el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -50%)`;
    // Snap the arrow to 8 directions so it stays a clean pixel sprite.
    const snapped = Math.round(p.angle / 45) * 45;
    (el.querySelector('.arrow') as HTMLElement).style.transform = `rotate(${snapped}deg) translateX(30px)`;
    this.text('#chestptr .m', `${Math.round(p.dist)}m`);
  }

  /** Called when the on-screen pause button is clicked. */
  onPause: (() => void) | null = null;
  private lastGold = -1;

  private el(sel: string): HTMLElement {
    return (this.els[sel] ??= this.q(sel));
  }

  /** Set text only when it changed (avoids layout churn every frame). */
  private text(sel: string, v: string): void {
    if (this.lastText[sel] === v) return;
    this.lastText[sel] = v;
    this.el(sel).textContent = v;
  }

  setVisible(v: boolean): void {
    this.root.hidden = !v;
  }

  showBanner(title: string, sub = '', seconds = 1.6): void {
    const b = this.el('#banner');
    b.querySelector('.t')!.textContent = title;
    b.querySelector('.s')!.innerHTML = sub;
    b.classList.remove('show');
    void b.offsetWidth; // restart CSS animation
    b.classList.add('show');
    this.bannerT = seconds;
  }

  /** Small message under the timer (elite incoming, achievements, ...). */
  toast(msg: string, seconds = 2.2): void {
    const t = this.el('#toast');
    t.textContent = msg;
    t.classList.remove('show');
    void t.offsetWidth;
    t.classList.add('show');
    this.toastT = seconds;
  }

  hurt(): void {
    this.hurtV = 1;
  }

  flash(amount = 1): void {
    this.flashV = Math.max(this.flashV, amount);
  }

  setFade(v: number): void {
    this.el('#fade').style.opacity = String(v);
  }

  resetScore(): void {
    this.shownScore = 0;
    this.lastHp = -1;
    this.lastLevel = -1;
  }

  setLoadout(items: LoadoutItem[]): void {
    const html = (kind: LoadoutItem['kind']) =>
      items
        .filter((i) => i.kind === kind)
        .map(
          (i) =>
            `<div class="slot ${i.evo ? 'max evo' : i.max ? 'max' : ''}" style="--c:${i.color}" title="${i.name}">${iconHtml(i.id, i.color, i.icon)}<i>${i.evo ? 'EVO' : i.max ? 'MAX' : i.level}</i></div>`,
        )
        .join('');
    this.el('#loadout .weapons').innerHTML = html('weapon');
    this.el('#loadout .passives').innerHTML = html('passive');
  }

  private lastMods = '';
  private lastTeam = '';
  private tagEls: HTMLElement[] = [];

  /** Co-op: teammate life bars (top-left) and floating name tags. */
  setTeam(
    team: { name: string; color: string; hp01: number; down: boolean; left: boolean }[],
    tags: { x: number; y: number; name: string; color: string; down: boolean; revive01: number; onScreen: boolean }[],
  ): void {
    const html = team
      .map(
        (t) =>
          `<div class="mate ${t.down ? 'down' : ''} ${t.left ? 'left' : ''}" style="--c:${t.color}"><span class="nm">${t.name}${t.left ? ' (left)' : t.down ? ' DOWN' : ''}</span><div class="bar"><div style="width:${Math.round(t.hp01 * 100)}%"></div></div></div>`,
      )
      .join('');
    if (html !== this.lastTeam) {
      this.lastTeam = html;
      this.el('#team').innerHTML = html;
    }
    const root = this.el('#tags');
    while (this.tagEls.length < tags.length) {
      const d = document.createElement('div');
      d.className = 'tag';
      root.appendChild(d);
      this.tagEls.push(d);
    }
    this.tagEls.forEach((d, i) => {
      const t = tags[i];
      if (!t || !t.onScreen) {
        d.style.display = 'none';
        return;
      }
      d.style.display = '';
      d.style.setProperty('--c', t.color);
      d.style.transform = `translate(${t.x}px, ${t.y}px) translate(-50%, -100%)`;
      const label = t.down ? `${t.name} - REVIVE!` : t.name;
      if (d.dataset.label !== label) {
        d.dataset.label = label;
        d.textContent = label;
      }
      d.classList.toggle('down', t.down);
      d.style.setProperty('--rv', String(t.revive01));
    });
  }

  /** Owned Mods, bottom-right, with live readouts (only rebuilt when the markup changes). */
  setMods(mods: { id: string; icon: string; color: string; name: string; readout: string; cursed: boolean }[]): void {
    const html = mods
      .map(
        (m) =>
          `<div class="mod ${m.cursed ? 'cursed' : ''}" style="--c:${m.color}" title="${m.name}">${iconHtml(m.id, m.color, m.icon)}${m.readout ? `<i>${m.readout}</i>` : ''}</div>`,
      )
      .join('');
    if (html === this.lastMods) return;
    this.lastMods = html;
    this.el('#mods').innerHTML = html;
  }

  update(s: HudState, dt: number): void {
    // XP
    this.el('#xpbar .fill').style.transform = `scaleX(${Math.min(1, s.xp01)})`;
    if (s.level !== this.lastLevel) {
      this.text('#xpbar .lv', `LV ${s.level}`);
      if (this.lastLevel > 0) {
        const bar = this.el('#xpbar');
        bar.classList.remove('up');
        void bar.offsetWidth;
        bar.classList.add('up');
      }
      this.lastLevel = s.level;
    }

    // Life
    if (s.hp !== this.lastHp) {
      const k = Math.max(0, s.hp / s.maxHp);
      const fill = this.el('#hp .fill');
      fill.style.width = `${k * 100}%`;
      fill.classList.toggle('low', k <= 0.3);
      this.text('#hp .num', `${Math.max(0, Math.ceil(s.hp))}/${Math.round(s.maxHp)}`);
      if (s.hp < this.lastHp - 0.5) {
        const bar = fill.parentElement!;
        bar.classList.remove('hurt');
        void bar.offsetWidth;
        bar.classList.add('hurt');
      }
      this.lastHp = s.hp;
    }
    this.text('#runinfo .kills', `☠ ${s.kills}`);
    this.text('#runinfo .gold', `● ${s.gold}`);
    if (s.gold !== this.lastGold) {
      if (s.gold > this.lastGold && this.lastGold >= 0) {
        const g = this.el('#runinfo .gold');
        g.classList.remove('bump');
        void g.offsetWidth;
        g.classList.add('bump');
      }
      this.lastGold = s.gold;
    }

    // Timer / boss
    this.text('#timer .clock', s.timeLeft >= 0 ? fmtClock(s.timeLeft) : s.timeLeft === -1 ? 'BOSS!' : 'CLEAR!');
    this.el('#timer').classList.toggle('urgent', s.timeLeft >= 0 && s.timeLeft < 10);
    this.text('#timer .stage', `STAGE ${s.stage}`);
    const bb = this.el('#bossbar');
    bb.hidden = !s.boss;
    if (s.boss) {
      this.text('#bossbar .name', s.boss.name.toUpperCase());
      this.el('#bossbar .fill').style.transform = `scaleX(${s.boss.hp01})`;
    }

    // Score counts up quickly toward the real value.
    this.shownScore += (s.score - this.shownScore) * Math.min(1, dt * 12);
    if (Math.abs(s.score - this.shownScore) < 1) this.shownScore = s.score;
    this.text('#score', fmtScore(this.shownScore));

    // Combo
    const combo = this.el('#combo');
    combo.classList.toggle('on', s.combo > 1);
    if (s.combo !== this.lastCombo) {
      this.text('#combo .num', `${s.combo} COMBO`);
      if (s.combo > this.lastCombo && s.combo % 5 === 0) {
        combo.classList.remove('bump');
        void combo.offsetWidth;
        combo.classList.add('bump');
      }
      this.lastCombo = s.combo;
    }
    if (s.multiplier !== this.lastMult) {
      this.text('#combo .mult', `x${s.multiplier}`);
      this.el('#combo .mult').dataset.tier = String(Math.min(s.multiplier, 8));
      this.lastMult = s.multiplier;
    }
    this.el('#combo .cbar div').style.transform = `scaleX(${s.combo01})`;

    // Meters
    const dash = this.el('#dashpip');
    dash.style.setProperty('--k', String(s.dash01));
    dash.classList.toggle('ready', s.dash01 >= 1);
    const bomb = this.el('#bombpip');
    bomb.style.setProperty('--k', String(s.bomb01));
    bomb.classList.toggle('ready', s.bomb01 >= 1);

    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) this.el('#banner').classList.remove('show');
    }
    if (this.toastT > 0) {
      this.toastT -= dt;
      if (this.toastT <= 0) this.el('#toast').classList.remove('show');
    }

    // Vignette: hurt pulse plus a heartbeat when low on life.
    this.hurtV = Math.max(0, this.hurtV - dt * 2.5);
    const beat = s.lowHp ? 0.25 + 0.2 * Math.max(0, Math.sin(performance.now() / 180)) : 0;
    this.el('#vignette').style.opacity = String(Math.max(this.hurtV, beat));
    this.flashV = Math.max(0, this.flashV - dt * 4);
    this.el('#flash').style.opacity = String(this.flashV);
  }
}
