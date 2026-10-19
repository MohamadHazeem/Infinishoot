/**
 * Boss lane HUD bits: the Titan's weak-point pips under the boss bar (one pixel
 * pip per weak point plus the core: lit while it can be hit, dim while sealed,
 * crossed out once broken) and the SHOWDOWN tag while a boss duel plays.
 * The CSS is injected from here (lanes don't grow style.css).
 */
import { TITAN_PARTS } from '../data/bossRemix';

const CSS = `
#bossbar .titan-pips { display: flex; justify-content: center; gap: calc(2 * var(--p)); margin-top: calc(2 * var(--p)); }
#bossbar .titan-pips[hidden] { display: none; }
#bossbar .titan-pips i {
  --c: var(--mist);
  width: calc(5 * var(--p)); height: calc(5 * var(--p));
  background: var(--c);
  box-shadow: 0 0 0 var(--p) var(--ink), inset calc(-1 * var(--p)) calc(-1 * var(--p)) 0 rgba(26, 28, 44, 0.45);
}
#bossbar .titan-pips i.hand { --c: var(--cyan); }
#bossbar .titan-pips i.eye { --c: var(--red); }
#bossbar .titan-pips i.core { --c: var(--yellow); width: calc(7 * var(--p)); }
#bossbar .titan-pips i.sealed { opacity: 0.35; }
#bossbar .titan-pips i.open { animation: titan-pip 0.6s steps(2) infinite; }
#bossbar .titan-pips i.gone { --c: var(--night); box-shadow: 0 0 0 var(--p) var(--ink), inset 0 0 0 var(--p) var(--slate); }
@keyframes titan-pip { 50% { box-shadow: 0 0 0 var(--p) var(--white); } }
.reduce-flash #bossbar .titan-pips i.open { animation: none; box-shadow: 0 0 0 var(--p) var(--white); }
#bossbar .duel-tag { font: 10px var(--label); color: var(--orange); letter-spacing: 2px; margin-top: var(--p); }
#bossbar .duel-tag[hidden] { display: none; }
`;

let styled = false;
let pips: HTMLElement | null = null;
let tag: HTMLElement | null = null;
let lastKey = '';

function ensure(): HTMLElement | null {
  const bar = typeof document !== 'undefined' ? document.getElementById('bossbar') : null;
  if (!bar) return null;
  if (!styled) {
    styled = true;
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  if (!pips || !bar.contains(pips)) {
    pips = document.createElement('div');
    pips.className = 'titan-pips';
    pips.hidden = true;
    bar.appendChild(pips);
    tag = document.createElement('div');
    tag.className = 'duel-tag';
    tag.hidden = true;
    tag.textContent = 'SHOWDOWN · STAY IN THE RING';
    bar.appendChild(tag);
    lastKey = '';
  }
  return bar;
}

/** Weak-point pips (`hp` = life fractions in TITAN_PARTS order, null hides them) and the duel tag. */
export function setBossLaneHud(hp: readonly number[] | null, phase: number, duel: boolean): void {
  if (!ensure() || !pips || !tag) return;
  if (tag.hidden === duel) tag.hidden = !duel;
  const key = hp ? `${phase}:${hp.map((v) => (v > 0 ? 1 : 0)).join('')}` : '';
  if (key === lastKey) return;
  lastKey = key;
  pips.hidden = !hp;
  if (!hp) return;
  const cells = TITAN_PARTS.map((p, i) => `<i class="${p.kind} ${hp[i] > 0 ? (p.group <= phase ? 'open' : 'sealed') : 'gone'}"></i>`);
  cells.push(`<i class="core ${phase >= 4 ? 'open' : 'sealed'}"></i>`);
  pips.innerHTML = cells.join('');
}
