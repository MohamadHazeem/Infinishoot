import type { Game } from '../game/game';
import { TRIALS, TRIAL_TIER_POINTS, trialPoints, trialUnlocked, type TrialDef, type TrialCategory } from '../data/trials';
import { WEAPONS } from '../data/weapons';
import { HEROES } from '../data/heroes';
import { t, localize, localizeHtml, onLanguageChange } from '../i18n';
import { prompt } from './prompts';
import { settings } from '../game/settings';
import { startTrial, trialsState, canStartTrial, type TrialRun } from '../game/systems/trials';
const MEDALS = ['none', 'bronze', 'silver', 'gold'] as const;
const CATEGORIES: ('all' | TrialCategory)[] = ['all', 'basics', 'skill', 'heroes', 'world', 'bosses', 'pairs'];
const esc = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const name = (d: TrialDef): string => t(`trials.${d.id}.name`);
const desc = (d: TrialDef): string => t(`trials.${d.id}.desc`);
export class TrialsScreen {
  private el = document.createElement('div');
  private card = document.createElement('div');
  private result = document.createElement('div');
  private hud: HTMLElement | null = null;
  private category: typeof CATEGORIES[number] = 'all';
  private selected: TrialDef = TRIALS[0];
  private lastHud = '';
  constructor(private g: Game) {
    injectCss();
    for (const [id, el] of [['trials', this.el], ['trialintro', this.card], ['trialresult', this.result]] as const) {
      el.id = `scr-${id}`; el.className = 'screen dim tl-screen';
      g.screens.addScreen(id, el, { columns: id === 'trials' ? 3 : 1, onBack: () => id === 'trials' ? this.back() : this.open() });
    }
    // Append outside the mode grid: renderModes regenerates that grid on each visit.
    for (const selector of ['#scr-modes > .menu:last-child', '#scr-online [data-act=mp-leave]', '#scr-pause .menu']) {
      const anchor = document.querySelector(selector);
      const parent = selector.includes('mp-leave') ? anchor?.parentElement : anchor; if (!parent) continue;
      const button = document.createElement('button'); button.dataset.nav = ''; button.className = 'tl-entry';
      button.textContent = t('trials.title'); button.addEventListener('click', () => this.open()); parent.append(button);
    }
    this.el.addEventListener('click', e => {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>('button'); if (!button || button.disabled) return;
      if (button.dataset.category) { this.category = button.dataset.category as typeof this.category; this.draw(); this.g.screens.refreshNav(); }
      if (button.dataset.trial) this.intro(TRIALS.find(d => d.id === button.dataset.trial)!);
      if (button.dataset.back !== undefined) this.back();
    });
    this.card.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (b?.dataset.start !== undefined) startTrial(g, this.selected.id);
      if (b?.dataset.back !== undefined) this.open();
    });
    this.result.addEventListener('click', e => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (b?.dataset.retry !== undefined && g.role !== 'client') startTrial(g, trialsState(g).run!.def.id, trialsState(g).run!.practice);
      if (b?.dataset.back !== undefined) this.open();
      if (b?.dataset.exit !== undefined) g.leaveToTitle();
    });
    onLanguageChange(() => {
      document.querySelectorAll('.tl-entry').forEach(b => { b.textContent = t('trials.title'); });
      if (g.screens.current === 'trials') this.draw();
      if (g.screens.current === 'trialintro') this.intro(this.selected);
      const r = trialsState(g).run; if (r?.result && g.screens.current === 'trialresult') this.showResult(r);
      this.lastHud = '';
    });
  }
  open(): void {
    if (this.g.role === 'solo' && this.g.mode !== 'title') this.g.paused = true;
    this.draw(); this.g.screens.show('trials');
  }
  private back(): void {
    if (trialsState(this.g).run?.result) return this.showResult(trialsState(this.g).run!);
    this.g.screens.show(this.g.mode === 'title' ? (this.g.role === 'solo' ? 'modes' : 'online') : 'pause');
  }
  private draw(): void {
    const records = trialsState(this.g).records, points = trialPoints(records);
    this.el.innerHTML = localizeHtml(`<header><div class="tl-kicker">${esc(t('trials.points', { n: points }))}</div><h1>${t('trials.title')}</h1><p>${t('trials.subtitle')}</p></header>
      <div class="tl-tabs menu row">${CATEGORIES.map(c => `<button data-nav data-category="${c}" class="${c === this.category ? 'on' : ''}">${t(`trials.${c}`)}</button>`).join('')}</div>
      <div class="tl-grid">${TRIALS.filter(d => this.category === 'all' || d.category === this.category).map(d => {
        const b = records[d.id], open = trialUnlocked(d, records);
        return `<button data-nav data-trial="${d.id}" class="tl-tile ${open ? '' : 'tl-locked'}" ${open ? '' : 'disabled'}>
          <span class="tl-number" aria-hidden="true">${String(TRIALS.indexOf(d) + 1).padStart(2, '0')}</span><span class="tl-copy"><small>${t('trials.tier', { n: d.tier + 1 })} · ${t(`trials.${d.category}`)}</small><b>${esc(name(d))}</b><span>${open ? t('trials.limit', { n: d.seconds }) : t('trials.locked', { n: TRIAL_TIER_POINTS[d.tier] })}</span><small class="tl-medal m${b?.medal ?? 0}">${b ? `★ ${t(`trials.${MEDALS[b.medal]}`)} · ${t('trials.best', { time: b.time.toFixed(1) })}` : '◇ ◇ ◇'}</small></span></button>`;
      }).join('')}</div><footer><p>${t('trials.reward')}</p><button data-nav data-back>${t('trials.back')}</button></footer>`);
  }
  intro(d: TrialDef): void {
    this.selected = d;
    const hero = HEROES.find(h => h.id === d.hero)?.name ?? d.hero;
    const kit = d.kit.map(id => localize(WEAPONS[id]?.name ?? id)).join(' + ') || t('trials.unarmed');
    this.card.innerHTML = localizeHtml(`<div class="tl-card"><div class="tl-kicker">${t('trials.tier', { n: d.tier + 1 })} · ${t('trials.limit', { n: d.seconds })}</div><h1>${esc(name(d))}</h1><p class="tl-description">${esc(desc(d))}</p><p class="tl-kit">${esc(t('trials.kit', { hero: localize(hero), kit }))}</p>${this.targets(d)}<p>${t('trials.fixed')}</p><p>${t('trials.controls', { dash: prompt('dash'), parry: prompt('parry') })}</p>${d.players ? `<p>${t('trials.pairHint')}</p>` : ''}${!canStartTrial(this.g, d) ? `<p class="tl-warning">${!trialUnlocked(d, trialsState(this.g).records) ? t('trials.locked', { n: TRIAL_TIER_POINTS[d.tier] }) : t(this.g.role === 'client' ? 'trials.hostOnly' : d.players ? 'trials.pairHint' : 'trials.soloHint')}</p>` : ''}<div class="menu row"><button data-nav data-start ${canStartTrial(this.g, d) ? '' : 'disabled'}>${t('trials.start')}</button><button data-nav data-back>${t('trials.back')}</button></div></div>`);
    this.g.screens.show('trialintro');
  }
  private targets(d: TrialDef): string {
    return `<div class="tl-targets">${d.medals.map((n, i) => `<div class="tl-target m${i + 1}"><strong>★ ${t(`trials.${MEDALS[i + 1]}`)}</strong><span>${t(`trials.${d.metric}`, { n })}</span></div>`).join('')}</div>`;
  }
  showResult(r: TrialRun): void {
    const v = r.result!;
    this.hideHud();
    this.result.innerHTML = localizeHtml(`<div class="tl-card"><div class="tl-kicker">${t(v.success ? 'trials.complete' : 'trials.failed')}</div><h1>${esc(name(r.def))}</h1><div class="tl-award m${v.medal} ${settings.reduceFlash || settings.reduceScreenEffects ? '' : 'tl-pop'}" aria-hidden="true">${v.medal ? '★' : '◇'}</div><h2 class="m${v.medal}">${t(`trials.${MEDALS[v.medal]}`)}</h2><p>${t('trials.result', { time: v.time.toFixed(1), kills: v.kills, damage: Math.ceil(v.damage), combo: v.combo })}</p>${this.targets(r.def)}<p class="tl-reward">${t(r.practice ? 'trials.practice' : 'trials.xp', { n: r.xp })}</p>${this.g.role === 'client' ? `<p>${t('trials.hostOnly')}</p>` : ''}<div class="menu row"><button data-nav data-retry ${this.g.role === 'client' ? 'disabled' : ''}>${t('trials.retry')}</button><button data-nav data-back>${t('trials.browse')}</button><button data-nav data-exit>${t('trials.back')}</button></div></div>`);
    this.g.screens.show('trialresult');
  }
  updateHud(r: TrialRun): void {
    if (r.result) { this.hideHud(); return; }
    if (!this.hud) { this.hud = document.createElement('div'); this.hud.id = 'tl-hud'; document.getElementById('goals')?.prepend(this.hud); }
    this.hud.hidden = false;
    this.hud.dataset.objective = String(r.def.goal === 'escort' || r.def.goal === 'zones');
    const text = `${name(r.def)}\n${t('trials.progress', { n: Math.floor(r.progress), target: r.def.target, left: Math.max(0, Math.ceil(r.def.seconds - r.time)) })}${r.def.goal === 'puzzle' ? '\n' + t('trials.sequence', { next: [1, 3, 5, 2, 4, 6][r.progress] ?? 6, order: '1 → 3 → 5 → 2 → 4 → 6' }) : ''}`;
    if (text !== this.lastHud) { this.lastHud = text; this.hud.textContent = localize(text); }
  }
  hideHud(): void { if (this.hud) this.hud.hidden = true; }
}
const CSS = `
.tl-screen {gap:calc(3 * var(--p));padding:calc(5 * var(--p));text-align:center;}
#scr-trials {overflow:hidden;justify-content:flex-start;}
.tl-screen header h1 {color:var(--yellow);margin:0;font-size:calc(20 * var(--p));line-height:1;}
.tl-screen p {margin:calc(2 * var(--p)) 0;}
.tl-kicker {color:var(--cyan);font-family:var(--label);font-size:calc(4 * var(--p));}
.tl-tabs {flex-wrap:wrap;justify-content:center;gap:calc(2 * var(--p));}
.tl-tabs button {font-size:calc(5 * var(--p));padding:calc(2 * var(--p)) calc(3 * var(--p));}
.tl-tabs .on {color:var(--yellow);--bg:var(--blue);}
.tl-grid {max-height:calc(100vh - 270px);flex:1 1 auto;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:calc(3 * var(--p));width:min(1100px,94vw);overflow:auto;min-height:0;padding:calc(2 * var(--p));text-align:start;}
.tl-grid .tl-tile {display:flex;gap:calc(3 * var(--p));align-items:center;text-align:start;min-height:calc(35 * var(--p));padding:calc(4 * var(--p));white-space:normal;}
.tl-number {font-family:var(--display);font-size:calc(15 * var(--p));color:var(--cyan);min-width:calc(13 * var(--p));}
.tl-copy {display:flex;flex-direction:column;gap:var(--p);}
.tl-copy b {font-size:calc(7 * var(--p));line-height:1;}
.tl-copy small {font-size:calc(4 * var(--p));}
.tl-copy span {font-size:calc(5 * var(--p));}
.tl-locked {opacity:.55;}
.tl-screen footer {max-width:1000px;display:flex;align-items:center;gap:calc(5 * var(--p));font-size:calc(5 * var(--p));}
.tl-card {max-width:850px;width:92vw;max-height:90vh;overflow:auto;padding:calc(7 * var(--p));background:var(--night);--hi:var(--blue);--lo:var(--ink);--ring:var(--ink);box-shadow:inset var(--p) var(--p) 0 var(--hi),inset calc(-1 * var(--p)) calc(-1 * var(--p)) 0 var(--lo),0 0 0 var(--p) var(--ring);}
.tl-card h1 {font-size:calc(16 * var(--p));color:var(--yellow);margin:calc(2 * var(--p)) 0;}
.tl-card h2 {font-size:calc(10 * var(--p));margin:0;}
.tl-description {font-size:calc(8 * var(--p));line-height:1.15;}
.tl-card p {font-size:calc(6 * var(--p));}
.tl-kit {color:var(--cyan);}
.tl-targets {display:grid;grid-template-columns:repeat(3,1fr);gap:calc(3 * var(--p));margin:calc(5 * var(--p)) 0;}
.tl-target {display:flex;flex-direction:column;gap:calc(2 * var(--p));padding:calc(3 * var(--p));background:var(--ink);font-size:calc(6 * var(--p));}
.tl-target span {color:var(--white);}
.tl-screen .m0 {color:var(--mist);}.tl-screen .m1 {color:var(--orange);}.tl-screen .m2 {color:var(--sky);}.tl-screen .m3 {color:var(--yellow);}
.tl-award {font-family:var(--display);font-size:calc(35 * var(--p));line-height:1.1;}
.tl-pop {animation:tl-medal .5s steps(5) both;}@keyframes tl-medal {from {transform:scale(.4) translateY(-20px);}to {transform:scale(1) translateY(0);}}
.tl-warning {color:var(--orange);}.tl-reward {color:var(--lime);}
body:has(#tl-hud:not([hidden])) #timer {visibility:hidden;}
body:has(#tl-hud:not([hidden])) :is(#bombpip,#ultpip,#rewindpip,#chestptr,#spice,#loadout .s-special) {display:none!important;}
body:has(#tl-hud:not([hidden])[data-objective="false"]) :is(#objective,#objptr) {display:none!important;}
#tl-hud {white-space:pre-line;color:var(--cyan);background:var(--night);padding:calc(3 * var(--p));font-size:calc(5 * var(--p));box-shadow:0 0 0 var(--p) var(--blue);}
@media(max-width:720px){.tl-grid{grid-template-columns:repeat(2,minmax(0,1fr));}.tl-number{display:none;}.tl-targets{gap:var(--p);}.tl-target{font-size:calc(5 * var(--p));}.tl-card{padding:calc(4 * var(--p));}.tl-screen footer{font-size:calc(4 * var(--p));}.tl-card h1{font-size:calc(12 * var(--p));}}
@media(prefers-reduced-motion:reduce){.tl-pop{animation:none;}}
`;
function injectCss(): void { if (document.getElementById('tl-css')) return; const style = document.createElement('style'); style.id = 'tl-css'; style.textContent = CSS; document.head.append(style); }
