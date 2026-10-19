/**
 * Shop lane UI pieces: number lines on level-up and shop cards, the Mod order
 * preview panel, and the banish / lock controls. Screens (src/ui/screens.ts)
 * calls these; the styles are injected once from here so the shared
 * stylesheet stays untouched. Pixel-art rules: Sweetie 16 colours, sizes in
 * --p, no radii, blur or gradient shading, steps() animations.
 */
import type { CardNum } from '../game/cardNumbers';
import { activeRows, diffRows, rowLabel, rowValue, type PreviewRow, type ShopPreview } from '../game/shopPreview';

/** "DPS 70 ▸ 84" lines; the new number is highlighted (lime better, orange worse). */
export function numsHtml(nums: CardNum[] | undefined, cls = ''): string {
  if (!nums?.length) return '';
  return `<div class="cnums ${cls}">${nums
    .map((n) => `<div class="cn"><i>${n.l}</i>${n.a !== undefined ? `<span>${n.a}</span><em>▸</em>` : ''}<b class="${n.d === 1 ? 'up' : n.d === -1 ? 'down' : ''}">${n.b}</b></div>`)
    .join('')}</div>`;
}

/** Damage lines a shop Mod would change on this build, biggest change first (from the preview). */
export function buyDamageNums(p: ShopPreview | undefined, i: number, max = 2): CardNum[] {
  const after = p?.buy[i];
  if (!p || !after) return [];
  return diffRows(p, p.now, after)
    .filter((d) => d.changed && d.a)
    .sort((x, y) => Math.abs(y.b.m - y.a!.m) - Math.abs(x.b.m - x.a!.m))
    .slice(0, max)
    .map((d) => ({ l: (d.k === 'all' || d.k.startsWith('w:') ? '' : 'IF ') + rowLabel(d.k), a: rowValue(d.a!), b: rowValue(d.b), d: d.b.m > d.a!.m || d.b.a > d.a!.a ? 1 : -1 }));
}

/** What the preview panel is showing: the current order, or a hypothetical change. */
export interface PreviewFocus {
  title: string;
  after?: PreviewRow[] | null;
  /** Why there's nothing to compare (e.g. "MOD SLOTS FULL"). */
  note?: string;
}

/** The order preview panel: per weapon and per condition, what the slots do to a hit. */
export function previewPanelHtml(p: ShopPreview, f: PreviewFocus, before?: PreviewRow[]): string {
  const base = before ?? p.now;
  const chips =
    f.after
      ? diffRows(p, base, f.after)
          .map((d) => `<span class="pv ${d.changed ? 'chg' : ''} ${cond(d.k)}"><i>${rowLabel(d.k)}</i>${d.a && d.changed ? `<s>${rowValue(d.a)}</s><em>▸</em>` : ''}<b class="${d.changed && d.a ? (better(d.a, d.b) ? 'up' : 'down') : ''}">${rowValue(d.b)}</b></span>`)
          .join('')
      : activeRows(p, base)
          .map((r) => `<span class="pv ${cond(r.k)}"><i>${rowLabel(r.k)}</i><b>${rowValue(r)}</b></span>`)
          .join('');
  const live = p.live.length ? `<div class="pv-note">LIVE IN FIGHTS (SHOWN NOW): ${p.live.join(', ').toUpperCase()}</div>` : '';
  return `<div class="pv-head"><b>${f.title}</b>${f.note ? `<span class="pv-why">${f.note}</span>` : ''}</div><div class="pv-rows">${chips}</div>${live}`;
}

const cond = (k: string) => (k === 'all' || k.startsWith('w:') ? '' : 'cond');
const better = (a: PreviewRow, b: PreviewRow) => b.m > a.m + 1e-9 || (Math.abs(b.m - a.m) < 1e-9 && b.a > a.a);

const CSS = `
/* ---- shop lane: card numbers */
.cnums { display: flex; flex-direction: column; gap: calc(0.5 * var(--p)); align-self: stretch; padding: var(--p) calc(2 * var(--p)); background: var(--ink); }
.cnums .cn { display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: baseline; column-gap: calc(1.5 * var(--p)); font-size: 18px; line-height: 1.1; color: var(--mist); white-space: nowrap; }
.cnums .cn i { font: 10px var(--label); letter-spacing: 1px; font-style: normal; color: var(--mist); margin-right: auto; white-space: normal; text-align: left; }
.cnums .cn em { font-style: normal; color: var(--slate); }
.cnums .cn b { color: var(--white); font-weight: normal; }
.cnums .cn b.up { color: var(--lime); }
.cnums .cn b.down { color: var(--orange); }
.mod-card .cnums { margin: 0 calc(-1 * var(--p)); }
/* ---- banish */
#scr-levelup .reroll-row button.banish { color: var(--orange); }
#scr-levelup .reroll-row button.banish.armed { --bg: var(--red); --ring: var(--yellow); color: var(--white); animation: flash 0.5s steps(1) infinite; }
#scr-levelup.banishing h1::after { content: ' BANISH WHICH?'; color: var(--orange); }
#scr-levelup.banishing .card.ban-ok { --ring: var(--orange); }
.card .ban-stamp { display: none; }
#scr-levelup.banishing .card.ban-ok .ban-stamp { display: block; position: absolute; left: 50%; top: 24%; transform: translate(-50%, -50%) rotate(-12deg); padding: var(--p) calc(3 * var(--p)); font: 22px var(--display); letter-spacing: 2px; color: var(--white); background: var(--red); box-shadow: 0 0 0 var(--p) var(--ink), var(--p) var(--p) 0 var(--p) var(--ink); pointer-events: none; z-index: 3; }
#scr-levelup.banishing .card.ban-no { filter: saturate(0.3) brightness(0.7); }
.ban-left { font: 11px var(--label); color: var(--mist); align-self: center; }
/* ---- shop lock */
.offer-slot { display: flex; flex-direction: column; align-items: stretch; gap: calc(2 * var(--p)); }
.offer-slot > .mod-card { flex: 1; }
.screen .offer-slot button.lock { --drop: transparent; padding: var(--p) calc(2 * var(--p)) calc(1.5 * var(--p)); font: 11px var(--label); letter-spacing: 1px; color: var(--mist); }
.screen .offer-slot button.lock.on { --bg: var(--teal); --hi: var(--cyan); color: var(--white); }
.screen .offer-slot.locked button.mod-card { --ring: var(--cyan); }
/* ---- order preview */
.mod-preview { --bg: var(--ink); --hi: var(--night); --lo: var(--ink); --drop: transparent; display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--p) calc(4 * var(--p)); width: min(100%, 940px); padding: calc(1.5 * var(--p)) calc(3 * var(--p)); }
.mod-preview[hidden] { display: none; }
.mod-preview .pv-head { display: flex; gap: calc(3 * var(--p)); align-items: baseline; font: 12px var(--label); letter-spacing: 1px; color: var(--yellow); }
.mod-preview .pv-head b { font-weight: normal; }
.mod-preview .pv-why { color: var(--orange); }
.mod-preview .pv-rows { display: flex; flex-wrap: wrap; gap: calc(1.5 * var(--p)) calc(4 * var(--p)); }
.mod-preview .pv { display: inline-flex; align-items: baseline; gap: calc(1.5 * var(--p)); font-size: 20px; line-height: 1; color: var(--white); }
.mod-preview .pv i { font: 10px var(--label); font-style: normal; color: var(--mist); letter-spacing: 1px; }
.mod-preview .pv.cond i::before { content: 'IF '; color: var(--slate); }
.mod-preview .pv s { text-decoration: none; color: var(--slate); }
.mod-preview .pv em { font-style: normal; color: var(--slate); }
.mod-preview .pv b { font-weight: normal; }
.mod-preview .pv b.up { color: var(--lime); }
.mod-preview .pv b.down { color: var(--orange); }
.mod-preview .pv.chg { animation: pv-pop 0.2s steps(2) both; }
.mod-preview .pv-note { flex-basis: 100%; font: 10px var(--label); color: var(--slate); }
@keyframes pv-pop { from { transform: translateY(calc(-1 * var(--p))); } }
`;

/** Inject the lane's styles once. */
export function ensureShopCss(): void {
  if (typeof document === 'undefined' || document.getElementById('shop-lane-css')) return;
  const st = document.createElement('style');
  st.id = 'shop-lane-css';
  st.textContent = CSS;
  document.head.appendChild(st);
}
