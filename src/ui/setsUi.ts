/**
 * Item sets UI: "INFERNO 2/4" chips on level-up, shop and relic cards, and the SETS column of the
 * pause screen. Counts come from this machine's hero (setsFrame in src/game/systems/sets.ts).
 */
import { SETS, SET_COUNT, SET_TIERS, nextTierAt, setTier, setsOf, setsTuning as T, type SetId } from '../data/sets';
import { t } from '../i18n';

export const setsView: { counts: ArrayLike<number> } = { counts: new Int8Array(SET_COUNT) };

export function setName(id: SetId): string {
  return t(`sets.${id}`);
}

const pct = (v: number) => Math.round(v * 100);

/** Bonus text of one tier (1..3), numbers from setsTuning. */
export function tierText(id: SetId, tier: number): string {
  const p: Record<SetId, Record<string, number>[]> = {
    inferno: [{ pct: pct(T.infernoBurnMul) }, {}, {}],
    storm: [{ pct: pct(T.stormShockMul) }, { hops: T.stormArcHops }, { n: T.stormEvery, bolts: T.stormBolts }],
    glacier: [{ pct: pct(T.glacierFrozenMul) }, { pct: pct(T.glacierFreeze) }, {}],
    bulwark: [{ n: T.bulwarkArmor }, {}, { s: T.bulwarkBarrierCd }],
    speedster: [{ move: pct(T.speedMove), dash: pct(T.speedDash) }, {}, { rate: pct(T.speedBuffRate), dmg: pct(T.speedBuffDmg), s: T.speedBuffTime }],
    boomsmith: [{ pct: pct(T.boomArea) }, { pct: pct(T.boomChance) }, { s: T.carpetEvery }],
    machinist: [{ pct: pct(T.machCooldown) }, {}, { pct: pct(T.machCooldown6) }],
    duelist: [{ pct: pct(T.duelCrit) }, { pct: pct(T.duelCritMult), ex: pct(T.duelExpose) }, { s: T.duelGuaranteed, cd: T.duelCooldown }],
  };
  return t(`sets.${id}.${tier}`, p[id][tier - 1] ?? {});
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function chip(i: number, adds: boolean): string {
  const def = SETS[i];
  const after = setsView.counts[i] + (adds ? 1 : 0);
  const on = adds && (SET_TIERS as readonly number[]).includes(after);
  const goal = on ? after : nextTierAt(after);
  const tip = `${setName(def.id)} ${goal}: ${tierText(def.id, setTier(goal))}`;
  return `<span class="set-chip${on ? ' on' : ''}${adds ? ' adds' : ''}" style="--c:${def.color}" title="${esc(tip)}"><i>${def.glyph}</i>${setName(def.id)} <b>${after}/${goal}</b>${on ? `<em>${t('sets.bonus')}</em>` : ''}</span>`;
}

/** Set chips for an item id; `adds`: taking the card adds a piece (new item, Mod or relic). */
export function setChipsHtml(pieceId: string, adds: boolean): string {
  const sets = setsOf(pieceId);
  if (!sets.length) return '';
  return `<div class="set-chips">${sets.map((i) => chip(i, adds)).join('')}</div>`;
}

/** Level-up cards: new weapons and items add a piece; upgrades of owned ones and the special only show the count. */
export function offerSetChips(o: { kind: string; id: string; tag: string }): string {
  if (o.kind === 'weapon' || o.kind === 'passive' || o.kind === 'evolve') return setChipsHtml(o.id.replace(/_evo$/, ''), o.tag === 'NEW!');
  if (o.kind === 'special') return setChipsHtml(o.id, false);
  return '';
}

/** Pause screen: one row per set you hold pieces of, with its three tiers. */
export function setsPanelHtml(): string {
  injectCss();
  const rows: string[] = [];
  SETS.forEach((d, i) => {
    const n = setsView.counts[i];
    if (n <= 0) return;
    const tier = setTier(n);
    const pips = Array.from({ length: SET_TIERS[2] }, (_, k) => `<i class="${k < n ? 'on' : ''}${(SET_TIERS as readonly number[]).includes(k + 1) ? ' gate' : ''}"></i>`).join('');
    const lines = [1, 2, 3].map((tr) => `<div class="set-b${tr <= tier ? ' on' : ''}"><em>${SET_TIERS[tr - 1]}</em><span>${tierText(d.id, tr)}</span></div>`).join('');
    rows.push(`<div class="set-row" style="--c:${d.color}"><div class="set-h"><i class="g">${d.glyph}</i><b>${setName(d.id)}</b><span class="set-pips">${pips}</span><span class="n">${n}</span></div>${lines}</div>`);
  });
  return `<div class="pi-col sets-col"><div class="pi-t">${t('sets.title')}</div>${rows.join('') || `<div class="set-none">${t('sets.none')}</div>`}</div>`;
}

const CSS = `
.set-chips { display: flex; flex-wrap: wrap; gap: 4px; justify-content: center; margin-top: 2px; }
.set-chip { display: inline-flex; align-items: center; gap: 3px; padding: 1px 5px; font: 10px var(--label); color: var(--c);
  background: var(--ink); box-shadow: inset 0 0 0 var(--p) var(--night), inset calc(2 * var(--p)) 0 0 0 var(--c); white-space: nowrap;
  max-width: 100%; flex-wrap: wrap; justify-content: center; }
.set-chip i { font-style: normal; font-family: var(--font); font-size: 13px; }
.set-chip b { color: var(--white); font-weight: normal; }
.set-chip.adds b { color: var(--lime); }
.set-chip.on { background: var(--c); color: var(--ink); box-shadow: inset 0 0 0 var(--p) var(--ink); animation: set-blink 0.8s steps(2) infinite; }
.set-chip.on b { color: var(--ink); }
.set-chip em { font-style: normal; color: var(--yellow); background: var(--ink); padding: 0 3px; flex-basis: 100%; text-align: center; }
@keyframes set-blink { 50% { background: var(--white); } }
.reduce-flash .set-chip.on { animation: none; }
#scr-pause .sets-col { position: absolute; inset-inline-end: 16px; top: 72px; width: 300px; min-width: 0; max-height: calc(100% - 110px); overflow-y: auto; }
@media (max-width: 1100px) { #scr-pause .sets-col { position: static; width: auto; max-height: none; } }
.set-row { display: grid; gap: 1px; padding: 3px 6px 4px; background: rgba(26, 28, 44, 0.7); box-shadow: inset calc(2 * var(--p)) 0 0 0 var(--c); }
.set-h { display: flex; align-items: center; gap: 6px; font: 18px var(--display); color: var(--c); }
.set-h .g { font-style: normal; font-family: var(--font); }
.set-h .n { margin-inline-start: auto; color: var(--white); }
.set-pips { display: inline-flex; gap: 2px; }
.set-pips i { width: 6px; height: 9px; background: var(--night); }
.set-pips i.on { background: var(--c); }
.set-pips i.gate { margin-inline-end: 4px; }
.set-b { display: flex; gap: 6px; font-size: 14px; line-height: 1.05; color: var(--slate); }
.set-b em { font-style: normal; font: 10px var(--label); color: var(--slate); min-width: 10px; padding-top: 2px; }
.set-b.on { color: var(--white); }
.set-b.on em { color: var(--c); }
.set-none { font-size: 15px; color: var(--mist); }
`;
let injected = false;
export function injectCss(): void {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const s = document.createElement('style');
  s.id = 'sets-css';
  s.textContent = CSS;
  document.head.append(s);
}
injectCss();
