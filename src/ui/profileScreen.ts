import { escapeHtml, localize, localizeHtml } from '../i18n';
import type { Screens } from './screens';
import { save, persist } from '../game/save';
import { PROFILE_REWARDS, REWARD_BY_ID, REWARD_KIND_NAME, levelOf, rewardOpen, type ProfileReward, type RewardKind } from '../data/profile';
import { QUEST_ALL_BONUS } from '../data/quests';
import { ENEMIES } from '../data/enemies';
import { HERO_BY_ID } from '../data/heroes';
import { MODE_BY_ID } from '../data/modes';
import { WEAPONS } from '../data/weapons';
import { SPECIALS } from '../data/specials';
import { ACHIEVEMENTS } from '../data/meta';
import { applyHudTheme, equipped, questView } from '../game/systems/meta2';

/**
 * EXTRAS > PROFILE (meta2 lane): profile level and title on a banner, the
 * cosmetics picker, lifetime stats, favourites, kills by enemy, bosses, co-op,
 * best run per mode and a timeline of best runs. Also the PROFILE / DAILY
 * QUESTS panel on the title screen.
 */
const CSS = `
#scr-profile .pf-wrap { width: min(980px, 94vw); max-height: 66vh; overflow-y: auto; text-align: left; }
#scr-profile .pf-head { --bg: var(--pf-banner); --hi: var(--white); --lo: var(--ink); display: flex; gap: calc(5 * var(--p)); align-items: center; padding: calc(4 * var(--p)) calc(6 * var(--p)); margin: calc(2 * var(--p)); }
#scr-profile .pf-lv { font: 56px var(--display); color: var(--yellow); line-height: 0.9; text-shadow: var(--outline); }
#scr-profile .pf-lv small { display: block; font: 10px var(--label); color: var(--white); letter-spacing: 1px; text-shadow: none; }
#scr-profile .pf-id { flex: 1; min-width: 0; }
#scr-profile .pf-id b { display: block; font: 30px var(--display); color: var(--white); text-shadow: var(--outline); }
#scr-profile .pf-id small { font: 11px var(--label); color: var(--white); letter-spacing: 1px; }
.m2-xpbar { height: calc(3 * var(--p)); background: var(--ink); box-shadow: 0 0 0 calc(0.5 * var(--p)) var(--white); margin: calc(2 * var(--p)) 0 var(--p); }
.m2-xpbar i { display: block; height: 100%; background: var(--lime); box-shadow: inset 0 calc(-1 * var(--p)) 0 var(--green); }
#scr-profile .pf-sec { font: 12px var(--label); letter-spacing: 1px; color: var(--cyan); margin: calc(5 * var(--p)) calc(2 * var(--p)) calc(2 * var(--p)); }
#scr-profile .pf-cos { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: calc(3 * var(--p)); padding: 0 calc(2 * var(--p)); }
#scr-profile .pf-cos button { text-align: left; white-space: normal; padding: calc(3 * var(--p)); min-width: 0; }
#scr-profile .pf-cos button b { display: block; font: 18px var(--font); }
#scr-profile .pf-cos button small { display: block; font: 10px var(--label); letter-spacing: 1px; color: var(--mist); }
#scr-profile .pf-cos .sw { display: inline-block; width: calc(3 * var(--p)); height: calc(3 * var(--p)); background: var(--c); margin-right: var(--p); box-shadow: 0 0 0 calc(0.5 * var(--p)) var(--ink); vertical-align: middle; }
#scr-profile .pf-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: calc(2 * var(--p)); padding: 0 calc(2 * var(--p)); }
#scr-profile .pf-stat { --bg: var(--night); --hi: var(--slate); --lo: var(--ink); padding: calc(2 * var(--p)) calc(3 * var(--p)); }
#scr-profile .pf-stat b { display: block; font: 24px var(--display); color: var(--yellow); }
#scr-profile .pf-stat small { font: 10px var(--label); color: var(--mist); letter-spacing: 1px; }
#scr-profile .pf-cols { display: grid; grid-template-columns: 1fr 1fr; gap: calc(4 * var(--p)); padding: 0 calc(2 * var(--p)); }
#scr-profile .pf-list { --bg: var(--night); --hi: var(--slate); --lo: var(--ink); padding: calc(2 * var(--p)) calc(3 * var(--p)); }
#scr-profile .pf-row { display: grid; grid-template-columns: 1fr auto; gap: calc(2 * var(--p)); font: 16px var(--font); color: var(--white); padding: calc(0.5 * var(--p)) 0; }
#scr-profile .pf-row em { font-style: normal; color: var(--yellow); }
#scr-profile .pf-row .bar { grid-column: 1 / -1; height: var(--p); background: var(--ink); }
#scr-profile .pf-row .bar i { display: block; height: 100%; background: var(--orange); }
#scr-profile .pf-tl { position: relative; padding: calc(2 * var(--p)) calc(3 * var(--p)) calc(2 * var(--p)) calc(9 * var(--p)); }
#scr-profile .pf-tl::before { content: ''; position: absolute; left: calc(4 * var(--p)); top: 0; bottom: 0; width: var(--p); background: var(--slate); }
#scr-profile .pf-tl .ev { position: relative; font: 16px var(--font); color: var(--white); padding: var(--p) 0; }
#scr-profile .pf-tl .ev::before { content: ''; position: absolute; left: calc(-6 * var(--p)); top: calc(2 * var(--p)); width: calc(3 * var(--p)); height: calc(3 * var(--p)); background: var(--yellow); box-shadow: 0 0 0 calc(0.5 * var(--p)) var(--ink); }
#scr-profile .pf-tl .ev.top::before { background: var(--lime); }
#scr-profile .pf-tl small { font: 10px var(--label); color: var(--mist); letter-spacing: 1px; }
#scr-profile .pf-road { display: flex; gap: calc(2 * var(--p)); flex-wrap: wrap; padding: 0 calc(2 * var(--p)); }
#scr-profile .pf-road span { --bg: var(--night); --hi: var(--slate); --lo: var(--ink); font: 14px var(--font); color: var(--mist); padding: var(--p) calc(2 * var(--p)); }
#scr-profile .pf-road span em { font-style: normal; color: var(--yellow); }
#m2-title { position: absolute; inset-inline-start: calc(5 * var(--p)); top: 34%; width: 300px; --bg: var(--ink); --hi: var(--slate); --lo: var(--ink); padding: 0; text-align: left; cursor: pointer; z-index: 2; }
#m2-title .hd { background: var(--pf-banner); padding: calc(2 * var(--p)) calc(3 * var(--p)); display: flex; gap: calc(2 * var(--p)); align-items: baseline; }
#m2-title .hd b { font: 28px var(--display); color: var(--yellow); text-shadow: var(--outline); }
#m2-title .hd span { font: 11px var(--label); letter-spacing: 1px; color: var(--white); flex: 1; }
#m2-title .hd .m2-xpbar { flex-basis: 100%; margin: 0; height: calc(1.5 * var(--p)); }
#m2-title .hd { flex-wrap: wrap; }
#m2-title .qs { padding: calc(2 * var(--p)) calc(3 * var(--p)); }
#m2-title .qh { font: 10px var(--label); letter-spacing: 1px; color: var(--cyan); display: flex; justify-content: space-between; }
#m2-title .q { font: 17px var(--font); color: var(--white); margin-top: var(--p); line-height: 1.05; }
#m2-title .q.done { color: var(--lime); }
#m2-title .q em { font-style: normal; color: var(--yellow); float: right; margin-left: var(--p); }
#m2-title .q .m2-bar { height: var(--p); margin: calc(0.5 * var(--p)) 0 0; }
#m2-title .qf { font: 10px var(--label); letter-spacing: 1px; color: var(--mist); margin-top: calc(2 * var(--p)); }
.lobby-player small.pf { color: var(--white); background: var(--pf); padding: 0 var(--p); }
@media (max-width: 900px) { #m2-title { display: none; } #scr-profile .pf-cos { grid-template-columns: repeat(2, 1fr); } #scr-profile .pf-stats { grid-template-columns: repeat(2, 1fr); } #scr-profile .pf-cols { grid-template-columns: 1fr; } }
`;

const KINDS: RewardKind[] = ['title', 'banner', 'hud', 'hat', 'trail'];
const n = (v: number | undefined) => Math.floor(v ?? 0).toLocaleString('en-US');
/** Hours and minutes, kept left-to-right in Arabic. */
const hm = (s: number) => {
  const m = Math.floor((s ?? 0) / 60);
  return `<span dir="ltr">${Math.floor(m / 60)}H ${String(m % 60).padStart(2, '0')}M</span>`;
};
/** Separately localized pieces of a "A · B · C" line. */
const dots = (...parts: string[]) => parts.filter(Boolean).map((x) => `<span>${x}</span>`).join(' · ');

function ensureCss(): void {
  if (document.getElementById('pf-css')) return;
  const st = document.createElement('style');
  st.id = 'pf-css';
  st.textContent = CSS;
  document.head.appendChild(st);
}

function owned(kind: RewardKind): ProfileReward[] {
  const lv = levelOf(save.profile.xp).level;
  const q = save.profile.stats.quests ?? 0;
  return PROFILE_REWARDS.filter((r) => r.kind === kind && rewardOpen(r, lv, q));
}

function bannerColor(): string {
  return REWARD_BY_ID[equipped('banner') || 'b_navy']?.color ?? '#29366f';
}

function titleName(): string {
  return REWARD_BY_ID[equipped('title') || 't_rookie']?.name ?? 'Rookie';
}

/** Cycle one cosmetic kind to the next unlocked option ('' = none for hats and trails). */
export function cycleCosmetic(kind: RewardKind): string {
  const opts = owned(kind).map((r) => r.id);
  if (kind === 'hat' || kind === 'trail') opts.unshift('');
  const cur = opts.indexOf(save.profile.equip[kind]);
  const next = opts[(cur + 1) % opts.length] ?? '';
  save.profile.equip[kind] = next;
  persist();
  if (kind === 'hud') applyHudTheme();
  return next;
}

function top(rec: Record<string, number>, k = 1): [string, number][] {
  return Object.entries(rec)
    .sort((a, b) => b[1] - a[1])
    .slice(0, k);
}

export class ProfileScreen {
  readonly el: HTMLElement;
  private panel: HTMLElement | null = null;

  constructor(private screens: Screens) {
    ensureCss();
    this.el = document.createElement('div');
    this.el.id = 'scr-profile';
    this.el.className = 'screen dim';
    screens.addScreen('profile', this.el, { columns: 5, onBack: () => screens.show('extras') });
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-pf]');
      if (!b) return;
      if (b.dataset.pf === 'back') screens.show('extras');
      else if (b.dataset.pf === 'cos') {
        cycleCosmetic(b.dataset.kind as RewardKind);
        this.open(Array.from(this.el.querySelectorAll('[data-nav]')).indexOf(b));
      }
    });
  }

  open(focus = 0): void {
    const scroll = this.el.querySelector('.pf-wrap')?.scrollTop ?? 0;
    this.render();
    this.screens.show('profile', focus);
    const w = this.el.querySelector('.pf-wrap');
    if (w) w.scrollTop = scroll;
  }

  private render(): void {
    const P = save.profile;
    const S = P.stats;
    const lv = levelOf(P.xp);
    const q = S.quests ?? 0;
    const cos = KINDS.map((k) => {
      const r = REWARD_BY_ID[equipped(k)];
      const all = PROFILE_REWARDS.filter((x) => x.kind === k);
      const have = owned(k);
      const next = all.find((x) => !rewardOpen(x, lv.level, q));
      const sw = r?.color && k !== 'title' ? `<i class="sw" style="--c:${r.color}"></i>` : '';
      return `<button data-nav data-pf="cos" data-kind="${k}"><small>${dots(REWARD_KIND_NAME[k], `${have.length}/${all.length}`)}</small><b>${sw}<span>${escapeHtml(r?.name ?? 'None')}</span></b><small>${next ? dots('NEXT', escapeHtml(next.name), next.quests ? `${next.quests} QUESTS` : `LV ${next.level}`) : 'ALL UNLOCKED'}</small></button>`;
    }).join('');
    const stat = (v: string, label: string) => `<div class="pf-stat px"><b>${v}</b><small>${label}</small></div>`;
    const stats = [
      stat(hm(S.time ?? 0), 'TIME PLAYED'),
      stat(n(S.runs), 'RUNS'),
      stat(n(S.kills), 'ENEMIES DEFEATED'),
      stat(n(S.bosses), 'BOSSES DEFEATED'),
      stat(n(S.stages), 'STAGES CLEARED'),
      stat(n(S.k_elite), 'ELITES'),
      stat(n(S.chests), 'CHESTS'),
      stat(n(S.evolutions), 'EVOLUTIONS'),
      stat(n(S.parries), 'PARRIES'),
      stat(n(S.perfectDashes), 'PERFECT DASHES'),
      stat(n(S.ultimates), 'ULTIMATES'),
      stat(n(S.flawless), 'FLAWLESS STAGES'),
      stat(n(S.stage), 'BEST STAGE'),
      stat(n(S.level), 'BEST LEVEL'),
      stat(n(S.combo), 'BEST COMBO'),
      stat(`${save.achievements.length}/${ACHIEVEMENTS.length}`, 'ACHIEVEMENTS'),
    ].join('');
    // Favourites.
    const [favHero] = top(P.heroRuns);
    const [favKit] = top(P.kitRuns);
    const kitName = (k: string) => k.split('/').map((id) => WEAPONS[id]?.name ?? SPECIALS[id]?.name ?? id).join(' / ');
    const enemyKills: Record<string, number> = {};
    for (const [id, v] of Object.entries(P.killsBy)) {
      const base = id.startsWith('v_') ? id.slice(2) : id;
      enemyKills[base] = (enemyKills[base] ?? 0) + v;
    }
    const foes = top(enemyKills, 10);
    const maxFoe = foes[0]?.[1] ?? 1;
    const row = (name: string, v: string, frac = -1) => `<div class="pf-row"><span>${escapeHtml(name)}</span><em dir="auto">${v}</em>${frac >= 0 ? `<div class="bar"><i style="width:${Math.round(frac * 100)}%"></i></div>` : ''}</div>`;
    const favs = [
      row('Favourite hero', favHero ? `${(HERO_BY_ID[favHero[0]]?.name ?? favHero[0]).toUpperCase()} · ${favHero[1]} RUNS` : '-'),
      row('Favourite kit', favKit ? `${kitName(favKit[0]).toUpperCase()}` : '-'),
      row('Most defeated', foes[0] ? `${(ENEMIES[foes[0][0]]?.name ?? foes[0][0]).toUpperCase()}` : '-'),
      row('Heroes played', `${P.sets.heroes.length}`),
      row('Islands visited', `${P.sets.biomes.length}`),
      row('Quests done', dots(n(q), `STREAK ${save.quests.streak}`)),
    ].join('');
    const foeRows = foes.length ? foes.map(([id, v]) => row(ENEMIES[id]?.name ?? id, n(v), v / maxFoe)).join('') : row('No kills yet', '-');
    const bosses = [
      row('King Bopper', n(S.b_king)),
      row('Rampage Rex', n(S.b_rex)),
      row('Hive Queen', n(S.b_queen)),
      row('Omega Overlord', n(S.b_omega)),
      row('Titan Goliath', n(S.b_titan)),
      row('Rematches', n(S.b_remix)),
      row('Mini-bosses', n(S.k_mini)),
      row('Reapers', n(S.k_reaper)),
    ].join('');
    const coop = [
      row('Co-op runs', n(S.coopRuns)),
      row('Co-op stages cleared', n(S.coopStages)),
      row('Teammates revived', n(S.revives)),
      row('Local co-op runs', n(S.localRuns)),
      row('PvP duels / wins', `${n(S.pvpDuels)} / ${n(S.pvpWins)}`),
      row('Versus matches / wins', `${n(S.versusRuns)} / ${n(S.versusWins)}`),
    ].join('');
    const modes = Object.entries(P.best)
      .sort((a, b) => b[1].score - a[1].score)
      .map(([m, r]) => row(MODE_BY_ID[m as keyof typeof MODE_BY_ID]?.name ?? m.toUpperCase(), `${n(r.score)} · STAGE ${r.stage}`))
      .join('') || row('No runs yet', '-');
    const best = P.timeline[0]?.score ?? 0;
    const tl = [...P.timeline]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((r) => `<div class="ev ${r.score === best ? 'top' : ''}"><small>${escapeHtml(r.date || '----')} · ${escapeHtml((r.label || r.mode).toUpperCase())}</small><br>${n(r.score)} · STAGE ${r.stage} · ${escapeHtml(r.hero.toUpperCase())} · ${n(r.kills)} KILLS</div>`)
      .join('') || '<div class="ev"><small>Your best runs will show up here.</small></div>';
    const road = PROFILE_REWARDS.filter((r) => !r.quests && r.level > lv.level)
      .slice(0, 6)
      .map((r) => `<span class="px"><em>LV ${r.level}</em> ${REWARD_KIND_NAME[r.kind]}: ${escapeHtml(r.name)}</span>`)
      .join('');
    this.el.innerHTML = localizeHtml(`<h1>PROFILE</h1>
      <div class="pf-wrap">
        <div class="pf-head px" style="--pf-banner:${bannerColor()}">
          <div class="pf-lv"><small>LEVEL</small>${lv.level}</div>
          <div class="pf-id"><b>${escapeHtml(titleName().toUpperCase())}</b>
            <div class="m2-xpbar"><i style="width:${Math.round(lv.frac * 100)}%"></i></div>
            <small>${dots(lv.need ? `${n(lv.into)} / ${n(lv.need)} XP TO LEVEL ${lv.level + 1}` : 'MAX LEVEL', `${n(P.xp)} XP IN ALL`, localize('Cosmetic only: every run starts equal.'))}</small></div>
        </div>
        <div class="pf-sec">COSMETICS · CLICK TO CHANGE</div>
        <div class="pf-cos">${cos}</div>
        ${road ? `<div class="pf-sec">COMING UP</div><div class="pf-road">${road}</div>` : ''}
        <div class="pf-sec">LIFETIME</div>
        <div class="pf-stats">${stats}</div>
        <div class="pf-cols">
          <div><div class="pf-sec">FAVOURITES</div><div class="pf-list px">${favs}</div>
            <div class="pf-sec">BOSSES BEATEN</div><div class="pf-list px">${bosses}</div>
            <div class="pf-sec">CO-OP &amp; PVP</div><div class="pf-list px">${coop}</div></div>
          <div><div class="pf-sec">KILLS BY ENEMY</div><div class="pf-list px">${foeRows}</div>
            <div class="pf-sec">BEST RUN PER MODE</div><div class="pf-list px">${modes}</div>
            <div class="pf-sec">TIMELINE OF BEST RUNS</div><div class="pf-list px pf-tl">${tl}</div></div>
        </div>
      </div>
      <div class="menu row"><button data-nav data-pf="back">BACK</button></div>`);
  }

  // ---------------------------------------------------------------- title panel

  /** The PROFILE / DAILY QUESTS panel on the title screen. */
  renderTitlePanel(onOpen: () => void): void {
    const title = document.getElementById('scr-title');
    if (!title) return;
    if (!this.panel) {
      this.panel = document.createElement('div');
      this.panel.id = 'm2-title';
      this.panel.className = 'px';
      this.panel.title = 'PROFILE';
      this.panel.addEventListener('click', onOpen);
      title.appendChild(this.panel);
    }
    const lv = levelOf(save.profile.xp);
    const qs = questView();
    const allDone = qs.every((x) => x.done);
    const now = new Date();
    const mid = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const left = Math.max(0, Math.round((mid.getTime() - now.getTime()) / 60000));
    this.panel.style.setProperty('--pf-banner', bannerColor());
    this.panel.innerHTML = localizeHtml(`<div class="hd"><b>LV ${lv.level}</b><span>${escapeHtml(titleName().toUpperCase())}</span><div class="m2-xpbar"><i style="width:${Math.round(lv.frac * 100)}%"></i></div></div>
      <div class="qs"><div class="qh"><span>DAILY QUESTS</span><span>${allDone ? 'ALL DONE!' : `ALL 3: +${QUEST_ALL_BONUS} XP`}</span></div>
      ${qs.map((q) => `<div class="q ${q.done ? 'done' : ''}"><em>${q.done ? '✓' : `+${q.xp}`}</em>${escapeHtml(q.text)}<div class="m2-bar"><i style="width:${Math.round((q.cur / q.def.goal) * 100)}%"></i></div></div>`).join('')}
      <div class="qf">${dots(`NEW QUESTS IN ${hm(left * 60)}`, save.quests.streak > 1 ? `STREAK ${save.quests.streak}` : '')}</div></div>`);
  }
}
