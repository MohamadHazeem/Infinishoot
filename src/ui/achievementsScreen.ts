import { escapeHtml, localize, localizeHtml } from '../i18n';
import type { Screens } from './screens';
import { ACHIEVEMENTS, ACH_CATS, type AchievementCat, type AchievementDef } from '../data/meta';
import { save } from '../game/save';
import { unlockProgress } from '../data/unlockProgress';
import { achValue } from '../game/systems/meta2';

/**
 * EXTRAS > ACHIEVEMENTS (meta2 lane): every achievement grouped by category,
 * with its medal (bronze, silver, gold), a progress bar for measured goals
 * and the date it was earned. Hidden ones show as ??? until earned.
 */
const CSS = `
#scr-achievements .ac-wrap { width: min(980px, 94vw); }
#scr-achievements .ac-tabs { display: flex; flex-wrap: wrap; gap: calc(2 * var(--p)); justify-content: center; margin: calc(2 * var(--p)) 0; }
#scr-achievements .ac-tabs button { font-size: 15px; padding: var(--p) calc(3 * var(--p)); }
#scr-achievements .ac-tabs button.on { --bg: var(--blue); color: var(--white); }
#scr-achievements .scroll { max-height: 58vh; overflow-y: auto; }
#scr-achievements .ac-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: calc(3 * var(--p)); padding: calc(3 * var(--p)); }
#scr-achievements .ac { --bg: var(--night); --hi: var(--slate); --lo: var(--ink); display: grid; grid-template-columns: calc(10 * var(--p)) 1fr; gap: calc(3 * var(--p)); align-items: start; padding: calc(3 * var(--p)); text-align: left; min-width: 0; }
#scr-achievements .ac.done { --bg: var(--navy); --hi: var(--blue); }
#scr-achievements .ac.focused { --ring: var(--yellow); }
#scr-achievements .ac b { display: block; font: 18px var(--font); color: var(--white); line-height: 1.05; }
#scr-achievements .ac p { margin: var(--p) 0 0; font: 14px var(--font); color: var(--mist); line-height: 1.1; }
#scr-achievements .ac small { display: block; font: 10px var(--label); letter-spacing: 1px; color: var(--mist); margin-top: var(--p); }
#scr-achievements .ac.done small.when { color: var(--lime); }
#scr-achievements .ac .bar { height: calc(2 * var(--p)); background: var(--ink); box-shadow: 0 0 0 calc(0.5 * var(--p)) var(--slate); margin-top: calc(2 * var(--p)); }
#scr-achievements .ac .bar i { display: block; height: 100%; background: var(--sky); }
#scr-achievements .ac.hidden b { color: var(--slate); }
.ac-medal { width: calc(10 * var(--p)); height: calc(10 * var(--p)); position: relative; background: var(--m); box-shadow: inset calc(-1 * var(--p)) calc(-1 * var(--p)) 0 var(--md), inset var(--p) var(--p) 0 var(--ml), 0 0 0 calc(0.5 * var(--p)) var(--ink); display: grid; place-items: center; font: 16px var(--display); color: var(--ink); }
.ac-medal.bronze { --m: #ef7d57; --ml: #ffcd75; --md: #b13e53; }
.ac-medal.silver { --m: #94b0c2; --ml: #f4f4f4; --md: #566c86; }
.ac-medal.gold { --m: #ffcd75; --ml: #f4f4f4; --md: #ef7d57; }
.ac-medal.locked { --m: #333c57; --ml: #566c86; --md: #1a1c2c; color: var(--slate); }
#scr-achievements .ac-sum { font: 15px var(--font); color: var(--mist); }
#scr-achievements .ac-sum em { font-style: normal; color: var(--yellow); }
@media (max-width: 760px) { #scr-achievements .ac-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
`;

const MEDAL_GLYPH: Record<string, string> = { bronze: '★', silver: '★', gold: '★' };

/** [current, goal] for any achievement that can be measured. */
export function achProgress(a: AchievementDef): [number, number] | null {
  if (a.track) return [Math.min(a.track.goal, achValue(a)), a.track.goal];
  const L = save.lifetime;
  const p = unlockProgress({ kills: L.kills, elites: L.elites, bosses: L.bosses, bestStage: L.bestStage }, { stage: 0, dashes: 0, weapons: 0, bosses: 0, mode: '', difficulty: '' }, []).find((x) => x.id === a.id);
  return p ? [p.cur, p.max] : null;
}

export class AchievementsScreen {
  readonly el: HTMLElement;
  private cat: AchievementCat | 'all' = 'all';

  constructor(private screens: Screens) {
    if (!document.getElementById('ac-css')) {
      const st = document.createElement('style');
      st.id = 'ac-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    this.el = document.createElement('div');
    this.el.id = 'scr-achievements';
    this.el.className = 'screen dim';
    screens.addScreen('achievements', this.el, { columns: 3, onBack: () => screens.show('extras') });
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-ac]');
      if (!b) return;
      if (b.dataset.ac === 'back') screens.show('extras');
      else if (b.dataset.ac === 'cat') {
        this.cat = (b.dataset.cat as AchievementCat | 'all') ?? 'all';
        this.open(Array.from(this.el.querySelectorAll('[data-nav]')).indexOf(b));
      }
    });
  }

  open(focus = 0): void {
    this.render();
    this.screens.show('achievements', focus);
  }

  private card(a: AchievementDef): string {
    const done = save.achievements.includes(a.id);
    const hide = a.hidden && !done;
    const tier = a.tier ?? 'bronze';
    const prog = done || hide ? null : achProgress(a);
    const when = done ? (save.achDates[a.id] ? `EARNED ${save.achDates[a.id]}` : 'EARNED') : hide ? 'HIDDEN' : `${tier.toUpperCase()}`;
    const bar = prog ? `<div class="bar"><i style="width:${Math.round((prog[0] / prog[1]) * 100)}%"></i></div><small>${Math.floor(prog[0]).toLocaleString('en-US')} / ${prog[1].toLocaleString('en-US')}</small>` : '';
    return `<article class="ac px ${done ? 'done' : ''} ${hide ? 'hidden' : ''}" data-nav tabindex="0"><i class="ac-medal ${done ? tier : 'locked'}" aria-label="${tier}">${MEDAL_GLYPH[tier]}</i><div><b>${hide ? '???' : escapeHtml(a.name)}</b><p>${hide ? 'A hidden achievement. Keep playing!' : escapeHtml(a.desc)}</p>${bar}<small class="when">${when}</small></div></article>`;
  }

  private render(): void {
    const list = ACHIEVEMENTS.filter((a) => this.cat === 'all' || a.cat === this.cat);
    const done = ACHIEVEMENTS.filter((a) => save.achievements.includes(a.id));
    const by = (t: string) => done.filter((a) => a.tier === t).length;
    const total = (t: string) => ACHIEVEMENTS.filter((a) => a.tier === t).length;
    // Earned first (newest date first), then closest to done.
    const sorted = list
      .map((a, i) => ({ a, i, done: save.achievements.includes(a.id), p: achProgress(a) }))
      .sort((x, y) => Number(y.done) - Number(x.done) || (x.done ? (save.achDates[y.a.id] ?? '').localeCompare(save.achDates[x.a.id] ?? '') : (y.p ? y.p[0] / y.p[1] : -1) - (x.p ? x.p[0] / x.p[1] : -1)) || x.i - y.i)
      .map((x) => x.a);
    const tabs = [{ id: 'all', name: 'ALL' }, ...ACH_CATS]
      .map((c) => `<button data-nav data-ac="cat" data-cat="${c.id}" class="${this.cat === c.id ? 'on' : ''}">${c.name}</button>`)
      .join('');
    this.el.innerHTML = localizeHtml(`<h1>ACHIEVEMENTS</h1>
      <p class="ac-sum"><em>★ ${done.length} / ${ACHIEVEMENTS.length}</em> · <span>GOLD</span> ${by('gold')}/${total('gold')} · <span>SILVER</span> ${by('silver')}/${total('silver')} · <span>BRONZE</span> ${by('bronze')}/${total('bronze')} · <span>${localize('Cosmetic only: every run starts equal.')}</span></p>
      <div class="ac-tabs">${tabs}</div>
      <div class="scroll ac-wrap"><div class="ac-grid">${sorted.map((a) => this.card(a)).join('')}</div></div>
      <div class="menu row"><button data-nav data-ac="back">BACK</button></div>`);
  }
}
