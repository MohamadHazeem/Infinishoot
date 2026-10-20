import type { Game } from '../game/game';
import { save } from '../game/save';
import { escapeHtml, getLanguage, localize, localizeHtml, t } from '../i18n';
import {
  CHALLENGE_BY_ID,
  CHALLENGE_XP,
  SEASON_EMOTE_BY_ID,
  challengeText,
  seasonMsLeft,
  seasonParts,
  seasonTrack,
  seasonView,
  themeFor,
  THEME_BY_ID,
  tierOf,
  unclaimed,
  weekMsLeft,
  seasonTuning,
  type ClaimResult,
  type SeasonItem,
  type TierReward,
} from '../data/season';
import { equipSeasonItem, isEquipped, seasonClaim, seasonRoll } from '../game/systems/season';

/**
 * EXTRAS > SEASON (seasonpass lane): the month's 50-tier cosmetic track, the
 * season XP bar, the week's three challenges, how to earn, past seasons, and
 * the claim moment. Also the SEASON banner on the title screen.
 * Plain DOM with its own CSS; every string goes through t()/localize().
 */
const CSS = `
#scr-season .sp-wrap { width: min(1000px, 95vw); max-height: 70vh; overflow-y: auto; text-align: start; }
#scr-season h1 { font-size: 60px; }
.sp-head { --bg: var(--sp); --hi: var(--white); --lo: var(--ink); display: flex; gap: calc(5 * var(--p)); align-items: center; padding: calc(3 * var(--p)) calc(5 * var(--p)); margin: calc(2 * var(--p)); }
.sp-head .sp-tier { font: 56px var(--display); color: var(--yellow); line-height: 0.9; text-shadow: var(--outline); text-align: center; min-width: calc(22 * var(--p)); }
.sp-head .sp-tier small { display: block; font: 10px var(--label); color: var(--white); letter-spacing: 1px; text-shadow: none; }
.sp-head .sp-id { flex: 1; min-width: 0; }
.sp-head .sp-id small { font: 10px var(--label); color: var(--white); letter-spacing: 1px; }
.sp-head .sp-id b { display: block; font: 34px var(--display); color: var(--white); text-shadow: var(--outline); line-height: 1; }
.sp-head .sp-id em { display: block; font: 16px var(--font); font-style: normal; color: var(--white); }
.sp-xpbar { height: calc(3 * var(--p)); background: var(--ink); box-shadow: 0 0 0 calc(0.5 * var(--p)) var(--white); margin: calc(2 * var(--p)) 0 var(--p); }
.sp-xpbar i { display: block; height: 100%; background: var(--yellow); box-shadow: inset 0 calc(-1 * var(--p)) 0 var(--orange); }
#scr-season button.sp-claimbtn { --bg: var(--green); --hi: var(--lime); --lo: var(--teal); font-size: 24px; white-space: nowrap; }
#scr-season button.sp-claimbtn.focused { --bg: var(--orange); --hi: var(--yellow); --lo: var(--red); }
#scr-season button.sp-claimbtn:disabled { --bg: var(--night); --hi: var(--slate); --lo: var(--ink); color: var(--mist); }
.sp-sec { font: 12px var(--label); letter-spacing: 1px; color: var(--cyan); margin: calc(4 * var(--p)) calc(2 * var(--p)) calc(2 * var(--p)); display: flex; justify-content: space-between; gap: calc(2 * var(--p)); }
.sp-sec span { color: var(--mist); }
.sp-track { display: grid; grid-template-columns: repeat(10, minmax(0, 1fr)); gap: calc(2 * var(--p)); padding: 0 calc(2 * var(--p)); }
#scr-season button.sp-cell { --bg: var(--night); --hi: var(--slate); --lo: var(--ink); padding: var(--p) var(--p) calc(1.5 * var(--p)); min-width: 0; display: grid; grid-template-rows: auto auto auto; justify-items: center; gap: 0; text-shadow: none; }
#scr-season button.sp-cell small { justify-self: start; font: 9px var(--label); color: var(--mist); letter-spacing: 0; }
#scr-season button.sp-cell svg { width: 30px; height: 30px; margin: 0 0 var(--p); }
#scr-season button.sp-cell b { font: 13px var(--font); color: var(--white); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; letter-spacing: 0; }
#scr-season button.sp-cell.cos { --bg: var(--navy); --hi: var(--blue); }
#scr-season button.sp-cell.got { --bg: var(--ink); --hi: var(--night); --lo: var(--ink); }
#scr-season button.sp-cell.got::after { content: ''; position: absolute; inset-inline-end: var(--p); top: var(--p); width: calc(2 * var(--p)); height: calc(2 * var(--p)); background: var(--lime); box-shadow: 0 0 0 calc(0.5 * var(--p)) var(--ink); }
#scr-season button.sp-cell.got.worn::after { background: var(--yellow); }
#scr-season button.sp-cell.ready { --bg: var(--green); --hi: var(--lime); --lo: var(--teal); --ring: var(--yellow); animation: sp-ready 0.8s steps(2) infinite; }
#scr-season button.sp-cell.ready small { color: var(--white); }
#scr-season button.sp-cell.locked svg { opacity: 0.45; }
#scr-season button.sp-cell.locked b { color: var(--mist); }
#scr-season button.sp-cell.cap { --hi: var(--yellow); }
#scr-season button.sp-cell.focused { --bg: var(--orange); --hi: var(--yellow); --lo: var(--red); --ring: var(--white); animation: none; }
#scr-season button.sp-cell .sp-mini { width: 100%; height: var(--p); background: var(--ink); margin-top: var(--p); }
#scr-season button.sp-cell .sp-mini i { display: block; height: 100%; background: var(--yellow); }
#scr-season button.sp-cell.pop { animation: sp-pop 0.45s steps(3) 1; }
@keyframes sp-ready { 50% { --ring: transparent; } }
@keyframes sp-pop { 0% { transform: scale(1); } 33% { transform: scale(1.25); background-color: var(--white); } 66% { transform: scale(0.95); } 100% { transform: scale(1); } }
.sp-detail { --bg: var(--ink); --hi: var(--night); --lo: var(--ink); display: flex; gap: calc(4 * var(--p)); align-items: center; margin: calc(3 * var(--p)) calc(2 * var(--p)) 0; padding: calc(2 * var(--p)) calc(4 * var(--p)); min-height: 64px; }
.sp-detail svg { width: 48px; height: 48px; flex: none; }
.sp-detail b { display: block; font: 24px var(--font); color: var(--white); }
.sp-detail small { font: 10px var(--label); letter-spacing: 1px; color: var(--cyan); }
.sp-detail span { display: block; font: 15px var(--font); color: var(--mist); }
.sp-detail span.ok { color: var(--lime); }
.sp-detail span.go { color: var(--yellow); }
.sp-cols { display: grid; grid-template-columns: 3fr 2fr; gap: calc(4 * var(--p)); padding: 0 calc(2 * var(--p)); }
.sp-list { --bg: var(--night); --hi: var(--slate); --lo: var(--ink); padding: calc(2 * var(--p)) calc(3 * var(--p)); }
.sp-ch { font: 17px var(--font); color: var(--white); padding: var(--p) 0; display: grid; grid-template-columns: 1fr auto; gap: 0 calc(2 * var(--p)); }
.sp-ch em { font-style: normal; color: var(--yellow); }
.sp-ch.done { color: var(--lime); }
.sp-ch .bar { grid-column: 1 / -1; height: var(--p); background: var(--ink); margin-top: calc(0.5 * var(--p)); }
.sp-ch .bar i { display: block; height: 100%; background: var(--lime); }
.sp-ch small { grid-column: 1 / -1; font: 10px var(--label); color: var(--mist); letter-spacing: 1px; }
.sp-row { font: 16px var(--font); color: var(--white); padding: calc(0.5 * var(--p)) 0; display: flex; justify-content: space-between; gap: calc(2 * var(--p)); }
.sp-row em { font-style: normal; color: var(--yellow); }
.sp-row.note { color: var(--mist); font-size: 14px; }
.sp-reveal { position: absolute; inset-inline-start: 50%; top: 40%; transform: translate(-50%, -50%); z-index: 5; --bg: var(--ink); --hi: var(--yellow); --lo: var(--orange); --ring: var(--white); padding: calc(4 * var(--p)) calc(8 * var(--p)); min-width: 300px; text-align: center; animation: sp-reveal 0.3s steps(3) both; }
[dir=rtl] .sp-reveal { transform: translate(50%, -50%); }
.sp-reveal h2 { font: 40px var(--display); color: var(--yellow); margin: 0; text-shadow: var(--outline); }
.sp-reveal .it { display: flex; gap: calc(3 * var(--p)); align-items: center; justify-content: center; margin: calc(2 * var(--p)) 0; }
.sp-reveal .it svg { width: 48px; height: 48px; }
.sp-reveal .it b { font: 26px var(--font); color: var(--white); display: block; text-align: start; }
.sp-reveal .it small { font: 10px var(--label); color: var(--cyan); letter-spacing: 1px; display: block; text-align: start; }
.sp-reveal .xp { font: 20px var(--font); color: var(--lime); }
.sp-reveal .spark { position: absolute; width: calc(2 * var(--p)); height: calc(2 * var(--p)); background: var(--yellow); animation: sp-spark 0.7s steps(4) both; }
@keyframes sp-reveal { from { transform: translate(-50%, -50%) scale(0.4); opacity: 0; } }
@keyframes sp-spark { to { transform: translate(var(--dx), var(--dy)); opacity: 0; } }
body.reduce-flash #scr-season button.sp-cell.ready, body.reduce-flash #scr-season button.sp-cell.pop, body.reduce-flash .sp-reveal, body.reduce-flash .sp-reveal .spark, body.reduce-flash #sp-title .cl { animation: none; }
body.reduce-flash .sp-reveal .spark { display: none; }
#sp-title { --bg: var(--ink); --hi: var(--slate); --lo: var(--ink); margin-top: calc(3 * var(--p)); padding: 0; cursor: pointer; text-align: start; width: 100%; max-width: 100%; box-sizing: border-box; }
@media (min-width: 901px) { #scr-title.menu-home #sp-title { position: absolute; top: calc(39.5 * var(--p)); inset-inline-end: calc(10 * var(--p)); width: calc(104 * var(--p)); margin: 0; z-index: 2; } }
#sp-title .hd { background: var(--sp); padding: calc(1.5 * var(--p)) calc(3 * var(--p)); display: flex; gap: calc(2 * var(--p)); align-items: baseline; }
#sp-title .hd small { font: 10px var(--label); letter-spacing: 1px; color: var(--white); }
#sp-title .hd b { font: 24px var(--display); color: var(--white); text-shadow: var(--outline); flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#sp-title .hd .cl { font: 16px var(--font); color: var(--yellow); padding: 0; white-space: nowrap; text-shadow: var(--outline); }
#sp-title .rw { display: flex; gap: calc(2 * var(--p)); align-items: center; padding: var(--p) calc(3 * var(--p)) calc(1.5 * var(--p)); }
#sp-title .rw .tr { font: 20px var(--display); color: var(--yellow); white-space: nowrap; }
#sp-title .rw .sp-xpbar { flex: 1; margin: 0; height: calc(1.5 * var(--p)); box-shadow: 0 0 0 calc(0.5 * var(--p)) var(--slate); }
#sp-title .rw span { font: 10px var(--label); color: var(--mist); letter-spacing: 1px; white-space: nowrap; }
#sp-title .cl { animation: sp-blink 0.8s steps(2) infinite; }
#sp-title:hover, #sp-title:focus-visible { --hi: var(--yellow); }
@keyframes sp-blink { 50% { color: var(--white); } }
[dir=rtl] #sp-title .hd b, [dir=rtl] #sp-title .rw .tr { font-size: 20px; }
[dir=rtl] #sp-title .hd .cl { font-size: 13px; }
#scr-gameover .sp-strip { --bg: var(--night); --hi: var(--slate); --lo: var(--ink); margin: var(--p) auto; padding: var(--p) calc(3 * var(--p)); width: min(560px, 90vw); box-sizing: border-box; display: flex; gap: calc(3 * var(--p)); align-items: center; flex-wrap: wrap; text-align: start; }
#scr-gameover .sp-strip .sp-t { font: 20px var(--display); color: var(--yellow); white-space: nowrap; }
#scr-gameover .sp-strip .sp-n { font: 11px var(--label); color: var(--sp); letter-spacing: 1px; white-space: nowrap; filter: brightness(1.4); }
#scr-gameover .sp-strip .sp-bar { flex: 1; height: calc(2 * var(--p)); background: var(--ink); box-shadow: 0 0 0 calc(0.5 * var(--p)) var(--slate); min-width: 60px; }
#scr-gameover .sp-strip .sp-bar i { display: block; height: 100%; background: var(--yellow); }
#scr-gameover .sp-strip .sp-x { font: 18px var(--display); color: var(--lime); white-space: nowrap; }
#scr-gameover .sp-strip small { font: 10px var(--label); color: var(--mist); letter-spacing: 1px; }
#scr-gameover .sp-strip small.sp-c { color: var(--lime); }
@media (max-width: 900px) { .sp-track { grid-template-columns: repeat(5, minmax(0, 1fr)); } .sp-cols { grid-template-columns: 1fr; } .sp-head .sp-tier { font-size: 40px; } }
`;

function ensureCss(): void {
  if (typeof document === 'undefined' || document.getElementById('sp-css')) return;
  const st = document.createElement('style');
  st.id = 'sp-css';
  st.textContent = CSS;
  document.head.appendChild(st);
}

// ---------------------------------------------------------------- pixel glyphs (8x8)

const GLYPH: Record<string, string[]> = {
  title: ['........', '.######.', '##....##', '.#.##.#.', '.#....#.', '##.##.##', '.######.', '........'],
  banner: ['k.......', 'k######.', 'k######o', 'k######.', 'k.......', 'k.......', 'k.......', 'k.......'],
  hud: ['########', '#......#', '#.oo.#.#', '#......#', '########', '...kk...', '..kkkk..', '........'],
  trail: ['........', '......##', '....oo##', '..xxoo..', 'xxxx....', 'xx......', '........', '........'],
  hat: ['........', '..####..', '.######.', '.######.', '.oooooo.', '########', '########', '........'],
  sticker: ['...##...', '...##...', '########', '.######.', '..####..', '.##..##.', '##....##', '........'],
  skin: ['..hhh...', '.hhhhh..', '..aaa...', '.ccacc..', 'c.aaa.c.', '..s.s...', '..s.s...', '.aa.aa..'],
  xp: ['...##...', '..####..', '.##oo##.', '###oo###', '.##oo##.', '..####..', '...##...', '........'],
};
const INK = '#1a1c2c';

/** An 8x8 pixel sprite as inline SVG. Colour keys: # main, o second, x third, k ink, and a/c/s/h for skins. */
function pix(rows: string[], cols: Record<string, string>): string {
  let r = '';
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = cols[row[x]];
      if (c) r += `<rect x="${x}" y="${y}" width="1" height="1" fill="${c}"/>`;
    }
  });
  return `<svg viewBox="0 0 8 8" shape-rendering="crispEdges" aria-hidden="true">${r}</svg>`;
}

function itemIcon(it: SeasonItem | null): string {
  if (!it) return pix(GLYPH.xp, { '#': '#94b0c2', o: '#ffcd75' });
  const [a, b = a, c = b, d = c] = it.colors;
  if (it.kind === 'emote') return pix(SEASON_EMOTE_BY_ID[it.id]?.glyph ?? GLYPH.xp, { o: a, '#': INK });
  if (it.kind === 'skin') return pix(GLYPH.skin, { a, c: b, s: c, h: d });
  if (it.slot === 'champion') return pix(GLYPH.title, { '#': '#ffcd75' });
  return pix(GLYPH[it.kind], { '#': a, o: b === a ? '#f4f4f4' : b, x: c, k: INK });
}

// ---------------------------------------------------------------- formatting

const n = (v: number) => Math.floor(v).toLocaleString('en-US');
/** "11D 4H" (or "4H 12M"), kept left-to-right in Arabic. */
function left(ms: number): string {
  const m = Math.floor(ms / 60000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  // Built here, not as catalog templates: "⟪d⟫D ⟪h⟫H" would match unrelated text in localize().
  if (getLanguage() === 'ar') return `<bdi>${d > 0 ? `${d} ي ${h} س` : `${h} س ${m % 60} د`}</bdi>`;
  return `<span dir="ltr">${d > 0 ? `${d}D ${h}H` : `${h}H ${m % 60}M`}</span>`;
}

export function seasonLabel(key: string): string {
  const { year, month } = seasonParts(key);
  return `${t(`season.month.${month}`)} ${year}`;
}

const kindName = (it: SeasonItem | null) => (it ? (it.slot === 'set' ? t('season.kind.set') : t(`season.kind.${it.kind}`)) : t('season.kind.xp'));
const itemName = (tr: TierReward) => (tr.item ? localize(tr.item.name) : `+${tr.xp} XP`);

// ---------------------------------------------------------------- screen

export class SeasonScreen {
  readonly el: HTMLElement;
  private focusEl: HTMLElement | null = null;
  private revealT = 0;

  constructor(private g: Game) {
    ensureCss();
    this.el = document.createElement('div');
    this.el.id = 'scr-season';
    this.el.className = 'screen dim';
    g.screens.addScreen('season', this.el, { columns: 10, onBack: () => g.screens.show('extras') });
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-sp]');
      if (!b) {
        if ((e.target as HTMLElement).closest('.sp-reveal')) this.hideReveal();
        return;
      }
      const act = b.dataset.sp;
      if (act === 'back') g.screens.show('extras');
      else if (act === 'claim') this.claim(Number.POSITIVE_INFINITY, b);
      else if (act === 'tier') this.clickTier(Number(b.dataset.t), b);
    });
  }

  open(focus?: number): void {
    seasonRoll(this.g);
    this.render();
    this.g.screens.show('season');
    const nav = this.g.screens.nav('season');
    // Focus the first tier to claim, else the next tier to reach.
    const sp = seasonView(save.seasonPass);
    const reached = tierOf(sp.xp).tier;
    const cells = [...this.el.querySelectorAll<HTMLElement>('[data-nav]')];
    const want = focus ?? cells.findIndex((c) => c.dataset.t === String(Math.min(seasonTuning.tiers, unclaimed(sp) ? sp.claimed + 1 : reached + 1)));
    nav.refresh(Math.max(0, want));
    this.focusEl = null;
    this.tick();
  }

  /** Every frame while open: the detail panel follows the focused tier, the reveal box times out. */
  tick(): void {
    const el = this.g.screens.nav('season').element ?? null;
    if (el !== this.focusEl) {
      this.focusEl = el;
      this.renderDetail(el?.dataset.t ? Number(el.dataset.t) : 0);
    }
    if (this.revealT > 0 && performance.now() > this.revealT) this.hideReveal();
  }

  private clickTier(tier: number, b: HTMLElement): void {
    const sp = seasonView(save.seasonPass);
    if (tier > sp.claimed && tier <= tierOf(sp.xp).tier) return this.claim(tier, b);
    const tr = seasonTrack(sp.season)[tier - 1];
    if (tier <= sp.claimed && tr?.item && sp.owned.includes(tr.item.id)) {
      equipSeasonItem(this.g, tr.item.id);
      this.rerender();
    }
  }

  /** Claim tiers up to `upTo` (in order), then pop them and reveal the cosmetics. */
  private claim(upTo: number, from: HTMLElement): void {
    const sp = seasonView(save.seasonPass);
    const target = Math.min(upTo, tierOf(sp.xp).tier);
    const got: ClaimResult[] = [];
    while (sp.claimed < target) {
      const c = seasonClaim(this.g, false);
      if (!c.length) break;
      got.push(...c);
    }
    if (!got.length) return;
    void from;
    this.rerender();
    for (const c of got) this.el.querySelector(`[data-t="${c.tier}"]`)?.classList.add('pop');
    this.reveal(got);
  }

  private rerender(): void {
    const nav = this.g.screens.nav('season');
    const focus = nav.focus;
    this.render();
    nav.refresh(focus);
    this.focusEl = null;
    this.tick();
  }

  private reveal(got: ClaimResult[]): void {
    this.hideReveal();
    const items = got.filter((c) => c.item && !c.dup).slice(0, 4);
    const xp = got.reduce((a, c) => a + c.xp, 0);
    const box = document.createElement('div');
    box.className = 'sp-reveal px';
    const rows = items
      .map((c) => `<div class="it">${itemIcon(c.item)}<div><small>${escapeHtml(kindName(c.item))}</small><b>${escapeHtml(localize(c.item!.name))}</b></div></div>`)
      .join('');
    const more = got.filter((c) => c.item && !c.dup).length - items.length;
    let sparks = '';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      sparks += `<i class="spark" style="left:50%;top:50%;--dx:${Math.round(Math.cos(a) * 180)}px;--dy:${Math.round(Math.sin(a) * 110)}px;background:${i % 2 ? '#73eff7' : '#ffcd75'}"></i>`;
    }
    box.innerHTML = `${sparks}<h2>${items.length ? t('season.reveal.new') : t('season.reveal.claimed', { n: got.length })}</h2>${rows}${more > 0 ? `<div class="xp">${t('season.reveal.more', { n: more })}</div>` : ''}${xp ? `<div class="xp">+${n(xp)} ${t('season.profile_xp')}</div>` : ''}<div class="xp" style="color:var(--mist);font-size:14px">${t('season.reveal.wear')}</div>`;
    this.el.appendChild(box);
    this.revealT = performance.now() + 2800;
  }

  private hideReveal(): void {
    this.revealT = 0;
    this.el.querySelector('.sp-reveal')?.remove();
  }

  private render(): void {
    const sp = seasonView(save.seasonPass);
    const theme = themeFor(sp.season);
    const tr = tierOf(sp.xp);
    const track = seasonTrack(sp.season);
    const ready = unclaimed(sp);
    const cells = track
      .map((r) => {
        const got = r.tier <= sp.claimed;
        const can = !got && r.tier <= tr.tier;
        const worn = got && r.item ? isEquipped(r.item) : false;
        const cls = ['sp-cell', r.item ? 'cos' : '', got ? 'got' : can ? 'ready' : 'locked', worn ? 'worn' : '', r.tier === seasonTuning.tiers ? 'cap' : ''].filter(Boolean).join(' ');
        const mini = r.tier === tr.tier + 1 ? `<div class="sp-mini"><i style="width:${Math.round(tr.frac * 100)}%"></i></div>` : '';
        return `<button data-nav data-sp="tier" data-t="${r.tier}" class="${cls}"><small>${r.tier}</small>${itemIcon(r.item)}<b>${escapeHtml(itemName(r))}</b>${mini}</button>`;
      })
      .join('');
    const ch = sp.ch
      .map((id, i) => {
        const c = CHALLENGE_BY_ID[id];
        if (!c) return '';
        const cur = Math.min(c.goal, sp.prog[i] ?? 0);
        const done = !!sp.done[i];
        const prog = c.stat === 'style' ? t('season.ch.best_style', { r: ['D', 'C', 'B', 'A', 'S', 'SS'][cur] ?? '-' }) : `${n(cur)} / ${n(c.goal)}`;
        return `<div class="sp-ch ${done ? 'done' : ''}"><span>${done ? '✓ ' : ''}${escapeHtml(localize(challengeText(c)))}</span><em>+${CHALLENGE_XP[c.group]} ${t('season.sxp')}</em><div class="bar"><i style="width:${Math.round((cur / c.goal) * 100)}%"></i></div><small><bdi dir="ltr">${prog}</bdi></small></div>`;
      })
      .join('');
    const past = sp.past.length
      ? sp.past
          .slice(0, 8)
          .map((p) => `<div class="sp-row"><span>${escapeHtml(seasonLabel(p.season))} · ${escapeHtml(localize(THEME_BY_ID[p.theme]?.name ?? p.theme))}</span><em>${t('season.tier_n', { n: p.tier })}</em></div>`)
          .join('')
      : `<div class="sp-row note">${t('season.past.none')}</div>`;
    const need = tr.need ? t('season.head.next', { into: n(tr.into), need: n(tr.need), n: tr.tier + 1 }) : t('season.head.max');
    this.el.style.setProperty('--sp', theme.color);
    this.el.innerHTML = localizeHtml(`<h1>${t('season.title')}</h1>
      <div class="sp-wrap">
        <div class="sp-head px">
          <div class="sp-tier"><small>${t('season.tier')}</small>${tr.tier}</div>
          <div class="sp-id"><small>${escapeHtml(seasonLabel(sp.season))} · ${t('season.free')}</small><b>${escapeHtml(localize(theme.name).toUpperCase())}</b><em>${escapeHtml(localize(theme.tagline))}</em>
            <div class="sp-xpbar"><i style="width:${Math.round(tr.frac * 100)}%"></i></div>
            <small>${need} · ${t('season.ends_in')} ${left(seasonMsLeft())}</small></div>
          <button data-nav data-sp="claim" class="sp-claimbtn" ${ready ? '' : 'disabled'}>${ready ? t('season.claim_n', { n: ready }) : t('season.claim_none')}</button>
        </div>
        <div class="sp-sec">${t('season.track')}<span>${t('season.track_hint')}</span></div>
        <div class="sp-track">${cells}</div>
        <div class="sp-detail px"></div>
        <div class="sp-cols">
          <div><div class="sp-sec">${t('season.weekly')}<span>${t('season.new_in')} ${left(weekMsLeft())}</span></div><div class="sp-list px">${ch}</div></div>
          <div><div class="sp-sec">${t('season.how')}</div><div class="sp-list px">
            <div class="sp-row"><span>${t('season.how.runs')}</span><em>1 XP = 1 ${t('season.sxp')}</em></div>
            <div class="sp-row"><span>${t('season.how.coop')}</span><em>+${Math.round((seasonTuning.coopBonus - 1) * 100)}%</em></div>
            <div class="sp-row"><span>${t('season.how.weekly')}</span><em>+${CHALLENGE_XP.medium}-${CHALLENGE_XP.feature}</em></div>
            <div class="sp-row note"><span>${t('season.how.note')}</span></div></div>
            <div class="sp-sec">${t('season.past')}</div><div class="sp-list px">${past}</div></div>
        </div>
      </div>
      <div class="menu row"><button data-nav data-sp="back">${t('season.back')}</button></div>`);
  }

  private renderDetail(tier: number): void {
    const box = this.el.querySelector<HTMLElement>('.sp-detail');
    if (!box) return;
    const sp = seasonView(save.seasonPass);
    const r = tier ? seasonTrack(sp.season)[tier - 1] : null;
    if (!r) {
      box.innerHTML = localizeHtml(`<div><small>${t('season.detail.hint_title')}</small><span>${t('season.detail.hint')}</span></div>`);
      return;
    }
    const reached = tierOf(sp.xp).tier;
    const got = r.tier <= sp.claimed;
    const it = r.item;
    let state: string;
    if (!got && r.tier <= reached) state = `<span class="go">${t('season.detail.ready')}</span>`;
    else if (!got) state = `<span>${t('season.detail.locked', { n: r.tier, xp: n(Math.max(0, xpNeeded(r.tier) - sp.xp)) })}</span>`;
    else if (!it) state = `<span class="ok">${t('season.detail.claimed')}</span>`;
    else if (it.kind === 'sticker') state = `<span class="ok">${t('season.detail.sticker')}</span>`;
    else if (isEquipped(it)) state = `<span class="ok">${t('season.detail.worn')}</span>`;
    else state = `<span class="ok">${t('season.detail.wear')}</span>`;
    const where = it ? `<span>${t(`season.where.${it.kind}`)}</span>` : `<span>${t('season.where.xp')}</span>`;
    box.innerHTML = localizeHtml(`${itemIcon(it)}<div><small>${t('season.tier_n', { n: r.tier })} · ${escapeHtml(kindName(it))}</small><b>${escapeHtml(itemName(r))}</b>${where}${state}</div>`);
  }
}

function xpNeeded(tier: number): number {
  let x = 0;
  for (let i = 1; i <= tier; i++) x += i <= seasonTuning.earlyTiers ? seasonTuning.earlyXp : seasonTuning.tierXp;
  return x;
}

// ---------------------------------------------------------------- title banner

let banner: HTMLElement | null = null;

/** The SEASON banner on the title screen (under the main menu). Click to open the track. */
export function seasonTitleBanner(onOpen: () => void): void {
  const title = document.getElementById('scr-title');
  if (!title) return;
  ensureCss();
  if (!banner || !banner.isConnected) {
    banner = document.createElement('div');
    banner.id = 'sp-title';
    banner.className = 'px';
    banner.setAttribute('role', 'button');
    banner.tabIndex = 0;
    banner.addEventListener('click', onOpen);
    banner.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') onOpen();
    });
    (title.querySelector('.menu-primary') ?? title).appendChild(banner);
  }
  const sp = seasonView(save.seasonPass);
  const theme = themeFor(sp.season);
  const tr = tierOf(sp.xp);
  const ready = unclaimed(sp);
  banner.style.setProperty('--sp', theme.color);
  banner.title = localize(theme.tagline);
  banner.innerHTML = localizeHtml(`<div class="hd"><small>${t('season.title')}</small><b>${escapeHtml(localize(theme.name).toUpperCase())}</b>${ready ? `<span class="cl">${t('season.claim_ready', { n: ready })}</span>` : ''}</div>
    <div class="rw"><span class="tr">${t('season.tier_n', { n: tr.tier })}</span><div class="sp-xpbar"><i style="width:${Math.round(tr.frac * 100)}%"></i></div><span>${left(seasonMsLeft())}</span></div>`);
}
