import { loadJson, saveJson } from '../core/storage';
import { abyssUnlocked } from '../game/abyss';
import { MODE_BY_ID } from '../data/modes';
import { gauntletProfile } from '../data/ascension';
import { HEROES } from '../data/heroes';
import { loadoutOptions, validLoadout, type LoadoutSlot } from '../data/loadout';
import { DIFFICULTIES, MODES, type ModeId } from '../data/modes';
import { SPECIALS } from '../data/specials';
import { WEAPONS } from '../data/weapons';
import { save, unlockedLoadout } from '../game/save';
import { settings, saveSettings } from '../game/settings';
import { escapeHtml, localize, t } from '../i18n';
import { prompt, type PromptId } from './prompts';
import { iconHtml } from './pixelIcons';

const seenKey = 'menus.seenModes.v1';
type PlayChoice = ModeId | 'trials' | 'ascension';
const choices: PlayChoice[] = [...MODES.map(m => m.id), 'trials', 'ascension', 'abyss'];
export function seenModes(raw: unknown): PlayChoice[] {
  return choices.filter(id => Array.isArray(raw) && raw.includes(id));
}
export function hasPlayed(runs: number, goals: readonly string[], history: number): boolean {
  return runs > 0 || history > 0 || goals.includes('run');
}
export function played(): boolean {
  return hasPlayed(save.lifetime.runs, save.firstten.done, save.history.length);
}
export function visibleModes(experienced: boolean, current: string) {
  if (experienced && abyssUnlocked()) return [...MODES, MODE_BY_ID.abyss];
  return MODES.filter(m => experienced || m.id === 'standard' || m.id === current);
}
export function chooseMode(id: ModeId): void {
  if (!visibleModes(played(), settings.mode).some(m => m.id === id)) return;
  settings.mode = id;
  saveSettings();
  acknowledgeMode(id);
}
export function acknowledgeMode(id: PlayChoice): void {
  const seen = seenModes(loadJson(seenKey, []));
  if (!seen.includes(id)) saveJson(seenKey, [...seen, id]);
}

const slots = ['primary', 'secondary', 'special'] as const;
const controls: Record<LoadoutSlot, PromptId> = { primary: 'fire', secondary: 'charge', special: 'bomb' };
const gear = (slot: LoadoutSlot, id: string) => slot === 'special' ? SPECIALS[id] : WEAPONS[id];
function forcedDifficulty() {
  if (settings.mode === 'abyss' || settings.mode === 'daily' || settings.mode === 'weekly') return 'normal';
  if ((settings.mode === 'standard' || settings.mode === 'endless') && Math.min(gauntletProfile.selected, gauntletProfile.unlocked) > 0) return 'hard';
}
function kit() {
  const hero = HEROES.find(h => h.id === settings.hero && (!h.unlock || save.achievements.includes(h.unlock))) ?? HEROES[0];
  const loadout = validLoadout(settings.loadout, unlockedLoadout());
  return { hero, loadout: { ...loadout, ...hero.clicks } };
}

export function runSummary(): string {
  const weekly = settings.mode === 'weekly';
  const { hero, loadout } = weekly ? { hero: HEROES[0], loadout: validLoadout() } : kit();
  const diff = DIFFICULTIES.find(d => d.id === (forcedDifficulty() ?? settings.difficulty) && !d.coopOnly && (!d.unlock || save.achievements.includes(d.unlock)));
  return [localize(hero.name), slots.map(s => localize(gear(s, loadout[s]).name)).join(' / '),
    localize(diff?.name ?? 'Medium')].join(' · ');
}

export function playModes(hasTrials: boolean): string {
  const seen = seenModes(loadJson(seenKey, []));
  const row = (id: PlayChoice, label: string, desc: string, attr: string) => {
    const badge = id !== 'standard' && !seen.includes(id) ? `<em>${t('menus.new')}</em>` : '';
    return `<button data-nav ${attr}><b>${escapeHtml(label)} ${badge}</b><small>${desc}</small></button>`;
  };
  const modes = visibleModes(played(), settings.mode).map(m => row(m.id, localize(m.name), t(`menus.${m.id}`),
    `data-run-mode="${m.id}" aria-pressed="${m.id === settings.mode}"`));
  if (played() && hasTrials) modes.push(row('trials', t('trials.title'), t('menus.trials'), 'data-run-extra="trials"'));
  if (gauntletProfile.unlocked > 0) modes.push(row('ascension', t('menus.ascensionName'), t('menus.ascension'), 'data-run-extra="ascension"'));
  return modes.join('');
}

export function setupGear(): string {
  const open = unlockedLoadout(), { hero, loadout } = kit();
  return slots.map(slot => {
    const id = loadout[slot], d = gear(slot, id);
    const fixed = (slot !== 'special' && !!hero.clicks?.[slot]) || loadoutOptions(slot).filter(s => open.includes(s)).length < 2;
    const icon = typeof window.CanvasRenderingContext2D === 'function' ? iconHtml(slot === 'special' ? 'sp_' + id : id, d.color, d.icon) : escapeHtml(d.icon);
    return `<button data-nav data-gear="${slot}" title="${escapeHtml(localize(d.desc))}" ${fixed ? 'disabled' : ''}>
      ${icon}<span><small>${slot === 'special' ? localize('SPECIAL') : t(`menus.${slot}`)} ${prompt(controls[slot])}</small><b>${escapeHtml(localize(d.name))}</b></span>${fixed ? '' : ' ↻'}</button>`;
  }).join('');
}
export function cycleGear(slot: LoadoutSlot): void {
  const ids = loadoutOptions(slot).filter(id => unlockedLoadout().includes(id));
  if (ids.length < 2) return;
  settings.loadout = { ...settings.loadout, [slot]: ids[(ids.indexOf(settings.loadout[slot]) + 1) % ids.length] };
  saveSettings();
}

export function refreshSetup(el: HTMLElement, redraw: () => void): void {
  el.querySelector('h1')!.textContent = t('menus.setup');
  const footer = el.querySelector<HTMLElement>('[data-act=md-back]')!.parentElement!;
  const grid = el.querySelector<HTMLElement>('.mode-grid')!;
  grid.hidden = true;
  for (const section of el.querySelectorAll<HTMLElement>('.section')) {
    if (section.nextElementSibling?.matches('.casual-preset, .mode-grid')) section.hidden = true;
  }
  const weekly = settings.mode === 'weekly';
  let gear = el.querySelector<HTMLElement>('.setup-gear');
  if (!gear) {
    gear = document.createElement('section'); gear.className = 'setup-gear px';
    el.querySelector('.hero-note')!.after(gear);
    gear.addEventListener('click', e => {
      const slot = (e.target as HTMLElement).closest<HTMLElement>('[data-gear]')?.dataset.gear;
      if (slot) { cycleGear(slot as LoadoutSlot); redraw(); }
    });
  }
  gear.innerHTML = `<h2>${t('menus.gear')}</h2><div>${setupGear()}</div>`;
  if (weekly) gear.innerHTML = `<p>${t('menus.modeFixed')}</p>`;
  else if (gear.querySelector('button:not(:disabled)')) gear.insertAdjacentHTML('beforeend', `<p>${t('menus.kitHint')}</p>`);

  for (const locked of el.querySelectorAll<HTMLElement>('.hero-row .locked, .diff-row .locked')) locked.hidden = true;
  if (weekly) {
    for (const button of el.querySelectorAll<HTMLButtonElement>('[data-hero]')) {
      button.disabled = true;
      button.classList.toggle('on', button.dataset.hero === HEROES[0].id);
    }
    el.querySelector('.hero-note')!.textContent = localize(HEROES[0].desc);
  }
  if (settings.mode === 'abyss') {
    for (const b of el.querySelectorAll<HTMLButtonElement>('[data-diff]')) {
      b.disabled = true;
      b.classList.toggle('on', b.dataset.diff === 'normal');
    }
    el.querySelector('.mode-note')!.textContent = t('menus.abyss');
  }
  if (forcedDifficulty() === 'hard') {
    for (const button of el.querySelectorAll<HTMLButtonElement>('[data-diff]')) {
      button.disabled = true;
      button.classList.toggle('on', button.dataset.diff === 'hard');
    }
    el.querySelector('.mode-note')!.textContent = localize(DIFFICULTIES.find(d => d.id === 'hard')!.desc);
  }
  const veteran = played();
  for (const item of el.querySelectorAll<HTMLElement>('.g-options, .g-note, .tl-entry, [data-act=heat], [data-act=weekly], .menu.row:last-child > button:not([data-act])')) item.hidden = !veteran;
  const heat = el.querySelector<HTMLElement>('[data-act=heat]')!;
  heat.title = t('menus.heat');
  let help = el.querySelector<HTMLElement>('.challenge-help');
  if (!help) {
    help = document.createElement('p'); help.className = 'challenge-help note';
    footer.before(help);
  }
  help.hidden = !veteran;
  help.textContent = t('menus.heat');

  const ascension = el.querySelector<HTMLElement>('[data-act=g-up]');
  if (ascension) { ascension.title = t('menus.ascension'); ascension.hidden = ascension.hasAttribute('disabled') && !el.querySelector('[data-act=g-down]:not(:disabled)'); }
  const ng = el.querySelector<HTMLElement>('[data-act=g-ng]');
  if (ascension && !ascension.hidden) help.textContent += ' ' + t('menus.ascension');
  if (ng) ng.hidden = ng.hasAttribute('disabled');
  const minus = el.querySelector<HTMLElement>('[data-act=g-down]');
  if (minus) minus.hidden = !!ascension?.hidden;
  const start = el.querySelector<HTMLElement>('[data-act=play]')!;
  start.textContent = t('menus.start') + ' ▶';
  if (!el.querySelector('.setup-layout')) {
    const layout = document.createElement('div'); layout.className = 'setup-layout';
    const main = document.createElement('section'); main.className = 'setup-main px';
    const side = document.createElement('section'); side.className = 'setup-side px';
    const sideHeading = document.createElement('h2'); sideHeading.textContent = t('menus.runOptions');
    side.append(sideHeading);
    for (const row of el.querySelectorAll('.hero-row,.diff-row')) {
      const heading = row.previousElementSibling;
      if (heading?.matches('.section')) main.append(heading);
      main.append(row);
      if (row.matches('.hero-row')) main.append(el.querySelector('.hero-note')!, gear);
      else main.append(el.querySelector('.mode-note')!);
    }
    for (const selector of ['.squad-options','.casual-preset','.g-options','.g-note','.challenge-help']) {
      const item = el.querySelector(selector);
      if (item) side.append(item);
    }
    layout.append(main, side);
    footer.before(layout); footer.prepend(start);
  }
  const quick = el.querySelector<HTMLElement>('.ft-quick');
  if (quick) { quick.inert = true; quick.dataset.menuFolded = ''; }
}

