import { localize, localizeHtml } from '../i18n';
import { WEAPONS } from '../data/weapons';
import { SPECIALS } from '../data/specials';
import { HEAT, cleanHeat, heatPoints, heatMultiplier } from '../data/heat';
import { weeklyChallenge } from '../data/weekly';
import { CODEX, META_REWARDS, META_KITS, rewardAvailable } from '../data/codex';
import { save, persist, buyMeta, unlockMeta } from '../game/save';
import { settings, saveSettings } from '../game/settings';

export type MetaScreen = 'heat' | 'weekly' | 'codex' | 'rewards';
export const META_SCREENS: MetaScreen[] = ['heat', 'weekly', 'codex', 'rewards'];
export const metaScreenHtml = META_SCREENS.map(
  (id) =>
    `<div id="scr-${id}" class="screen dim meta-screen" hidden><h1>${id === 'rewards' ? 'SOUVENIRS' : id.toUpperCase()}</h1><p class="note meta-note"></p><div class="scroll"><div class="meta-content"></div></div><div class="menu row"><button data-nav data-act="meta-back">BACK</button></div></div>`,
).join('');
const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export function applyMetaTheme(): void {
  const r = META_REWARDS.find(
    (r) => r.id === save.meta.theme && r.kind === 'theme' && save.meta.rewards.includes(r.id),
  );
  document.documentElement.style.setProperty('--meta-accent', r?.color ?? '#ffcd75');
}
export function renderMeta(el: HTMLElement, screen: MetaScreen): void {
  unlockMeta();
  const note = el.querySelector('.meta-note')!;
  const body = el.querySelector('.meta-content')!;
  if (screen === 'heat') {
    note.textContent = localize(`HEAT ${heatPoints(save.meta.heat)} · SCORE & BOLTS ×${heatMultiplier(save.meta.heat).toFixed(1)} · Host settings apply in co-op. Daily, weekly and PvP ignore heat.`);
    body.innerHTML = localizeHtml(`<div class="meta-grid">${HEAT.map((h) => `<button data-nav data-act="meta-heat" data-id="${h.id}" class="mode ${save.meta.heat.includes(h.id) ? 'on' : ''}" aria-pressed="${save.meta.heat.includes(h.id)}"><b>${save.meta.heat.includes(h.id) ? '✓ ' : ''}${h.name.toUpperCase()} <em>+${h.points}</em></b><small>${h.desc}</small></button>`).join('')}</div><p class="note">BEST LOOP CLEAR · ${['standard', 'endless', 'bossrush'].map((m) => `${m.toUpperCase()}: ${save.meta.bestHeat[m] ?? 0}`).join(' · ')}</p><div class="menu row"><button data-nav data-act="meta-reset">CLEAR HEAT</button></div>`);
  } else if (screen === 'weekly') {
    const w = weeklyChallenge();
    note.textContent = localize(`${w.week} · UTC MONDAY RESET · MEDIUM · ROOKIE · BUSTER / CHARGE / BOMB · NO PET`);
    body.innerHTML = localizeHtml(`<div class="meta-grid">${w.rules.map((r) => `<article class="bst"><b>${r.name.toUpperCase()}</b><p>${r.desc}</p></article>`).join('')}</div><p class="note">All entrants use the same starting kit and auto-weapon pool. Your best score per week stays here. Online posting is optional.</p><div class="menu row"><button data-nav data-act="meta-weekly">PLAY THIS WEEK</button></div><div class="section">LOCAL WEEKLY BESTS</div><table class="history">${save.meta.weekly.length ? save.meta.weekly.map((r) => `<tr><td>${esc(r.week)}</td><td>${r.score.toLocaleString('en-US')}</td><td>STAGE ${r.stage}</td></tr>`).join('') : '<tr><td>No weekly run yet.</td></tr>'}</table>`);
  } else if (screen === 'codex') {
    note.textContent = localize(`${CODEX.filter((c) => save.meta.codex.includes(c.id)).length} / ${CODEX.length} DISCOVERED · Meet enemies, visit islands and play heroes.`);
    body.innerHTML = localizeHtml(`<div class="meta-grid">${CODEX.map((c) => `<article class="bst" data-nav tabindex="0"><small>${c.kind}</small><b>${save.meta.codex.includes(c.id) ? esc(c.name.toUpperCase()) : '???'}</b><p>${save.meta.codex.includes(c.id) ? esc(c.text) : 'Keep exploring to uncover this entry.'}</p></article>`).join('')}</div>`);
  } else {
    note.textContent = localize(`${save.meta.bolts} BOLTS · COSMETICS AND STARTING OPTIONS ONLY · NO PERMANENT STAT UPGRADES`);
    body.innerHTML = localizeHtml(`<div class="meta-grid">${META_REWARDS.map((r) => {
      const owned = save.meta.rewards.includes(r.id);
      const available = rewardAvailable(r.id, { achievements: save.achievements, ...save.meta });
      return `<button data-nav data-act="meta-reward" data-id="${r.id}" class="mode ${save.meta.theme === r.id || settings.skin === r.id ? 'on' : ''}" ${!owned && (!available || save.meta.bolts < r.cost) ? 'disabled' : ''}><b style="color:${r.color}">${r.name.toUpperCase()}</b><small>${owned ? (r.kind === 'skin' ? (settings.skin === r.id ? 'WEARING' : 'WEAR ARMOUR') : r.kind === 'theme' ? (save.meta.theme === r.id ? 'EQUIPPED · HUD COLOUR' : 'EQUIP HUD COLOUR') : 'USE STARTING KIT') : `${r.condition} ${r.cost ? localize(`Then ${r.cost} Bolts.`) : 'Free unlock.'}`}</small>${r.kind === 'loadout' ? `<small>${Object.values(META_KITS[r.id]).map(id => WEAPONS[id]?.name ?? SPECIALS[id]?.name ?? id).join(' / ').toUpperCase()}</small>` : ''}</button>`;
    }).join(
      '',
    )}</div><div class="menu row"><button data-nav data-act="meta-default-theme">DEFAULT HUD</button></div><p class="note">Bolts: 1 per 25 kills + 10 per boss, multiplied by heat. A heat clear means defeating a stage 4 final boss.</p>`);
  }
}
export function metaAction(action: string, id: string): boolean {
  if (action === 'meta-heat')
    save.meta.heat = cleanHeat(
      save.meta.heat.some((x) => x === id)
        ? save.meta.heat.filter((x) => x !== id)
        : [...save.meta.heat, id],
    );
  else if (action === 'meta-reset') save.meta.heat = [];
  else if (action === 'meta-default-theme') {
    save.meta.theme = '';
    applyMetaTheme();
  } else if (action === 'meta-reward') {
    if (!save.meta.rewards.includes(id) && !buyMeta(id)) return false;
    const r = META_REWARDS.find((r) => r.id === id);
    if (r?.kind === 'theme') {
      save.meta.theme = id;
      applyMetaTheme();
    } else if (r?.kind === 'skin') {
      settings.skin = id;
      saveSettings();
    } else if (r?.kind === 'loadout') {
      settings.loadout = { ...META_KITS[id] };
      saveSettings();
    }
  } else return false;
  persist();
  return true;
}
