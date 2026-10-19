import { INSTRUMENTS, INSTRUMENT_IDS, type InstrumentId } from '../audio/instruments';
import { DJ_NAME, STATION } from '../audio/radio';

/**
 * Sound lane HUD bits (pixel UI, CSS injected once, Sweetie 16 only):
 * - ON AIR: a small radio panel while the DJ talks between stages (station,
 *   blinking light, the line when CAPTIONS is off, so it isn't gibberish).
 * - BAND: the instruments this run's soundtrack has picked up, as pixel chips
 *   in the goals stack (top left).
 * - The boss duel's turn under the boss bar: BOSS'S TURN / YOUR TURN!
 */
const CSS = `
#s2-onair {
  position: absolute;
  left: calc(5 * var(--p));
  bottom: calc(40 * var(--p));
  z-index: 41;
  max-width: min(360px, 60vw);
  padding: calc(2 * var(--p)) calc(3 * var(--p));
  --bg: var(--navy);
  --hi: var(--blue);
  --lo: var(--ink);
  background-color: var(--bg);
  box-shadow:
    inset var(--p) var(--p) 0 0 var(--hi),
    inset calc(-1 * var(--p)) calc(-1 * var(--p)) 0 0 var(--lo),
    0 calc(-1 * var(--p)) 0 0 var(--ink),
    0 var(--p) 0 0 var(--ink),
    calc(-1 * var(--p)) 0 0 0 var(--ink),
    var(--p) 0 0 0 var(--ink),
    0 calc(2 * var(--p)) 0 0 var(--ink);
  pointer-events: none;
  text-shadow: var(--outline);
  zoom: var(--ui, 1);
}
#s2-onair[hidden] { display: none; }
#s2-onair:not([hidden]) { animation: s2-in 0.3s steps(4) both; }
@keyframes s2-in { from { transform: translateY(12px); opacity: 0; } to { transform: none; opacity: 1; } }
#s2-onair .h { display: flex; align-items: center; gap: calc(2 * var(--p)); font: 10px var(--label); letter-spacing: 1px; color: var(--yellow); }
#s2-onair .h .live { width: calc(2 * var(--p)); height: calc(2 * var(--p)); background: var(--red); box-shadow: 0 0 0 var(--p) var(--ink); animation: s2-blink 0.8s steps(2) infinite; }
#s2-onair .h .tag { color: var(--white); background: var(--red); padding: 0 var(--p); text-shadow: none; }
#s2-onair .radio { width: calc(7 * var(--p)); height: calc(5 * var(--p)); background: var(--orange); position: relative; box-shadow: 0 0 0 var(--p) var(--ink); }
#s2-onair .radio::before { content: ''; position: absolute; left: var(--p); top: var(--p); width: calc(2 * var(--p)); height: calc(3 * var(--p)); background: var(--ink); }
#s2-onair .radio::after { content: ''; position: absolute; right: calc(-1 * var(--p)); top: calc(-3 * var(--p)); width: var(--p); height: calc(3 * var(--p)); background: var(--mist); }
#s2-onair .who { font: 12px var(--label); color: var(--cyan); margin-top: 2px; }
#s2-onair .line { font: 17px var(--font); color: var(--white); line-height: 1.1; min-height: 1.1em; }
#s2-onair .eq { display: flex; gap: var(--p); align-items: flex-end; height: calc(4 * var(--p)); margin-left: auto; }
#s2-onair .eq i { width: var(--p); background: var(--lime); animation: s2-eq 0.45s steps(3) infinite alternate; }
#s2-onair .eq i:nth-child(2) { animation-delay: -0.15s; }
#s2-onair .eq i:nth-child(3) { animation-delay: -0.3s; }
@keyframes s2-eq { from { height: var(--p); } to { height: calc(4 * var(--p)); } }
@keyframes s2-blink { 50% { opacity: 0.2; } }
#s2-band {
  margin-top: calc(2 * var(--p));
  padding: calc(1 * var(--p)) calc(2 * var(--p));
  display: flex; align-items: center; gap: calc(2 * var(--p));
  --bg: var(--night); --hi: var(--slate); --lo: var(--ink);
  background-color: var(--bg);
  box-shadow:
    inset var(--p) var(--p) 0 0 var(--hi),
    inset calc(-1 * var(--p)) calc(-1 * var(--p)) 0 0 var(--lo),
    0 calc(-1 * var(--p)) 0 0 var(--ink), 0 var(--p) 0 0 var(--ink),
    calc(-1 * var(--p)) 0 0 0 var(--ink), var(--p) 0 0 0 var(--ink), 0 calc(2 * var(--p)) 0 0 var(--ink);
  pointer-events: none;
  width: max-content;
}
#s2-band[hidden] { display: none; }
#s2-band .h { font: 10px var(--label); letter-spacing: 1px; color: var(--yellow); text-shadow: var(--outline); }
#s2-band img { width: 24px; height: 24px; image-rendering: pixelated; }
#s2-band img.new { animation: s2-pop 0.5s steps(5) 3; }
@keyframes s2-pop { 50% { transform: translateY(-4px) scale(1.25); } }
#s2-duel { margin-top: calc(1 * var(--p)); font: 12px var(--label); letter-spacing: 1px; text-shadow: var(--outline); }
#s2-duel[hidden] { display: none; }
#s2-duel.boss { color: var(--red); }
#s2-duel.hero { color: var(--lime); animation: s2-blink 0.5s steps(2) infinite; }
.reduce-flash #s2-duel.hero, .reduce-flash #s2-onair .h .live { animation: none; }
`;

/** 12x12 pixel art per instrument (. empty, # ink outline, o the colour, w white highlight). */
const ART: Readonly<Record<InstrumentId, string[]>> = {
  cowbell: [
    '....####....',
    '....#ww#....',
    '...######...',
    '...#oooo#...',
    '..#ooooo#...',
    '..#owooo#...',
    '.#oowoooo#..',
    '.#oooooooo#.',
    '#oooooooooo#',
    '############',
    '.....##.....',
    '.....##.....',
  ],
  sax: [
    '.........##.',
    '........#ww#',
    '.......#oo#.',
    '......#oo#..',
    '.....#oo#...',
    '....#oo#....',
    '...#ooo#....',
    '..#owoo#....',
    '.#oo#oo#....',
    '#ooo##oo#...',
    '#oooooooo#..',
    '.########...',
  ],
  steel: [
    '............',
    '..########..',
    '.#owwoooooo#',
    '#oowoooowoo#',
    '#ooooowoooo#',
    '#oowooooooo#',
    '.#oooooooo#.',
    '..########..',
    '...#....#...',
    '..#......#..',
    '..#......#..',
    '............',
  ],
  choir: [
    '...######...',
    '..#oooooo#..',
    '.#oowoooow#.',
    '.#o##oo##o#.',
    '.#oooooooo#.',
    '.#ooo##ooo#.',
    '.#oo#..#oo#.',
    '.#oo#..#oo#.',
    '..#oo##oo#..',
    '...#oooo#...',
    '....####....',
    '............',
  ],
  slap: [
    '..........##',
    '.........#w#',
    '........#o#.',
    '.......#o#..',
    '......#o#...',
    '..###oo#....',
    '.#oow###....',
    '#oooooo#....',
    '#oo##ooo#...',
    '#ooooooo#...',
    '.#ooooo#....',
    '..#####.....',
  ],
};

const iconCache = new Map<InstrumentId, string>();
/** A data-URL pixel icon for an instrument (12 px art, shown at 24 px). */
export function instrumentIcon(id: InstrumentId): string {
  let url = iconCache.get(id);
  if (url) return url;
  url = '';
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 12;
    const g = c.getContext('2d');
    if (g) {
      const colors: Record<string, string> = { '#': '#1a1c2c', o: INSTRUMENTS[id].color, w: '#f4f4f4' };
      ART[id].forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
          const col = colors[row[x]];
          if (!col) continue;
          g.fillStyle = col;
          g.fillRect(x, y, 1, 1);
        }
      });
      url = c.toDataURL();
    }
  } catch {
    url = '';
  }
  iconCache.set(id, url);
  return url;
}

export class SoundLaneHud {
  private onair: HTMLElement;
  private line: HTMLElement;
  private band: HTMLElement | null = null;
  private duel: HTMLElement | null = null;
  private lastBand = -1;
  private lastLine = '';
  private lastDuel = '';

  constructor(private hudRoot: HTMLElement) {
    if (!document.getElementById('s2-css')) {
      const st = document.createElement('style');
      st.id = 's2-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    this.onair = document.createElement('div');
    this.onair.id = 's2-onair';
    this.onair.hidden = true;
    this.onair.innerHTML = `<div class="h"><i class="radio"></i><span>${STATION}</span><b class="tag">ON AIR</b><i class="live"></i><span class="eq"><i></i><i></i><i></i></span></div><div class="who">${DJ_NAME}</div><div class="line"></div>`;
    this.line = this.onair.querySelector('.line')!;
    hudRoot.appendChild(this.onair);
  }

  /** Every frame. `line` is shown only when CAPTIONS is off (the caption strip already has it). */
  update(onAir: boolean, line: string, showLine: boolean, band: number, duel: 'boss' | 'hero' | null, inRun: boolean): void {
    this.onair.hidden = !onAir;
    const text = onAir && showLine ? line : '';
    if (text !== this.lastLine) {
      this.lastLine = text;
      this.line.textContent = text;
      this.line.hidden = !showLine;
    }
    this.updateBand(inRun ? band : 0);
    this.updateDuel(inRun ? duel : null);
  }

  private updateBand(mask: number): void {
    if (!this.band) {
      const goals = this.hudRoot.querySelector('#goals');
      if (!goals) return;
      this.band = document.createElement('div');
      this.band.id = 's2-band';
      this.band.hidden = true;
      goals.appendChild(this.band);
    }
    if (mask === this.lastBand) return;
    const added = this.lastBand < 0 ? 0 : mask & ~this.lastBand;
    this.lastBand = mask;
    this.band.hidden = mask === 0;
    if (!mask) {
      this.band.innerHTML = '';
      return;
    }
    let html = '<span class="h">♪ BAND</span>';
    INSTRUMENT_IDS.forEach((id, i) => {
      if (!(mask & (1 << i))) return;
      html += `<img src="${instrumentIcon(id)}" alt="${INSTRUMENTS[id].name}" title="${INSTRUMENTS[id].name}"${added & (1 << i) ? ' class="new"' : ''}>`;
    });
    this.band.innerHTML = html;
  }

  private updateDuel(turn: 'boss' | 'hero' | null): void {
    const key = turn ?? '';
    if (!this.duel) {
      const bar = this.hudRoot.querySelector('#bossbar');
      if (!bar) return;
      this.duel = document.createElement('div');
      this.duel.id = 's2-duel';
      this.duel.hidden = true;
      bar.appendChild(this.duel);
    }
    if (key === this.lastDuel) return;
    this.lastDuel = key;
    this.duel.hidden = !turn;
    this.duel.className = key;
    this.duel.textContent = turn === 'boss' ? "♪ BOSS'S TURN" : turn === 'hero' ? '♪ YOUR TURN! HIT IT!' : '';
  }
}
