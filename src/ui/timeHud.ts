import { localizeHtml, localize } from '../i18n';
import { prompt } from './prompts';
import { reduceMotion, restartClass } from './hud';

/**
 * Time lane HUD: the REWIND tank next to the DASH / special / ULT meters, the
 * VHS overlay while time runs backwards, the LAST STAND counter, the
 * bullet-time letterbox, the death replay's cinema bars and "so close!"
 * card, the clutch-revive hand-grab panel and the co-op TEAM REWIND vote.
 * Plain DOM with its own injected CSS (pixel frames, Sweetie 16, steps()).
 */
const CSS = `
#rewindpip { --c: var(--cyan); }
#rewindpip.ready { --ring: var(--cyan); }
#rewindpip.used { --c: var(--slate); opacity: 0.55; }
#rewindpip.vote { --ring: var(--yellow); animation: hop 0.5s steps(2) infinite; }
#rewindpip .pg { margin: 0 auto 2px; }
.reduce-flash #rewindpip { animation: none !important; }
#touch .rewind { right: 216px; bottom: 220px; --bg: var(--teal); --hi: var(--cyan); }

.tm-layer { position: absolute; inset: 0; pointer-events: none; z-index: 6; display: none; }
.tm-layer.on { display: block; }

/* ---- VHS rewind */
#tm-vhs .lines {
  position: absolute; inset: 0;
  background: repeating-linear-gradient(to bottom, rgba(26, 28, 44, 0.32) 0 var(--p), transparent var(--p) calc(3 * var(--p)));
}
#tm-vhs .track {
  position: absolute; left: 0; right: 0; top: 0;
  height: calc(5 * var(--p));
  background: var(--white); opacity: 0.16;
  animation: tmTrack 0.55s steps(7) infinite;
}
#tm-vhs .track.b { height: calc(2 * var(--p)); opacity: 0.22; animation-duration: 0.37s; animation-delay: -0.2s; }
@keyframes tmTrack { from { transform: translateY(0); } to { transform: translateY(100vh); } }
#tm-vhs .tag {
  position: absolute; top: 24vh; left: 50%;
  transform: translateX(-50%);
  display: flex; align-items: center; gap: 14px;
  font: 64px/1 var(--display); color: var(--white);
  text-shadow: var(--outline);
  animation: tmBlink 0.5s steps(1) infinite;
}
#tm-vhs .ctr {
  position: absolute; top: calc(24vh + 70px); left: 50%;
  transform: translateX(-50%);
  font: 22px var(--label); letter-spacing: 3px; color: var(--cyan);
  text-shadow: var(--outline);
}
#tm-vhs .tc {
  position: absolute; bottom: 26px; right: 30px;
  font: 22px var(--label); letter-spacing: 2px; color: var(--white);
  text-shadow: var(--outline);
}
#tm-vhs.play .tag { animation: none; color: var(--lime); }
#tm-vhs.play .lines, #tm-vhs.play .track { display: none; }
@keyframes tmBlink { 50% { opacity: 0.35; } }
body.tm-vhs #game { filter: saturate(0.3) contrast(1.3) brightness(1.08); }
body.tm-hold #reticle, body.tm-cine #reticle { visibility: hidden !important; }
body.tm-cine #ingame { visibility: hidden; }
.reduce-flash #tm-vhs .tag, .reduce-flash #tm-vhs .track { animation: none !important; }

/* ---- Letterbox (bullet time, replay, clutch revive) */
#tm-bars .bar {
  position: absolute; left: 0; right: 0; height: 0;
  background: var(--ink);
  transition: height 0.24s steps(4);
}
#tm-bars .bar.t { top: 0; }
#tm-bars .bar.b { bottom: 0; }
#tm-bars.on .bar { height: 6vh; }
#tm-bars.wide.on .bar { height: 11vh; }
#tm-bars .cc {
  position: absolute; left: 50%; bottom: calc(6vh + 120px);
  transform: translateX(-50%);
  font: 40px/1 var(--display); color: var(--yellow);
  text-shadow: var(--outline);
  white-space: nowrap;
  display: none;
}
#tm-bars.close .cc { display: block; animation: tmPop 0.3s steps(3); }
@keyframes tmPop { 0% { transform: translateX(-50%) scale(1.8); } 60% { transform: translateX(-50%) scale(0.9); } 100% { transform: translateX(-50%); } }

/* ---- Death replay */
#tm-replay .rec {
  position: absolute; top: calc(11vh + 16px); left: 26px;
  display: flex; align-items: center; gap: 10px;
  font: 22px var(--label); letter-spacing: 3px; color: var(--white);
  text-shadow: var(--outline);
}
#tm-replay .rec i { width: calc(4 * var(--p)); height: calc(4 * var(--p)); background: var(--red); box-shadow: 0 0 0 var(--p) var(--ink); animation: tmBlink 0.8s steps(1) infinite; }
#tm-replay .spd { position: absolute; top: calc(11vh + 16px); right: 28px; font: 22px var(--label); letter-spacing: 2px; color: var(--yellow); text-shadow: var(--outline); }
#tm-replay .skip {
  position: absolute; bottom: 2.6vh; right: 28px;
  font: 14px var(--label); letter-spacing: 2px; color: var(--mist);
  display: flex; align-items: center; gap: 8px;
}
#tm-replay .card {
  position: absolute; left: 50%; bottom: calc(11vh + 26px);
  transform: translateX(-50%);
  --bg: var(--navy); --hi: var(--blue); --lo: var(--ink); --ring: var(--yellow);
  padding: 10px 26px 12px;
  text-align: center;
  display: none;
  zoom: var(--ui, 1);
}
#tm-replay .card.on { display: block; animation: tmCard 0.36s steps(4); }
@keyframes tmCard { 0% { transform: translateX(-50%) translateY(40px); opacity: 0; } 100% { transform: translateX(-50%); opacity: 1; } }
#tm-replay .card b { display: block; font: 46px/1 var(--display); color: var(--yellow); text-shadow: var(--outline); }
#tm-replay .card span { display: block; margin-top: 4px; font: 20px var(--font); color: var(--white); letter-spacing: 1px; }
body.tm-replay #game { filter: saturate(0.55) contrast(1.15); }
.reduce-flash #tm-replay .rec i { animation: none; }

/* ---- Last stand */
#tm-stand {
  position: absolute; top: 124px; left: 50%;
  transform: translateX(-50%);
  --bg: var(--plum); --hi: var(--red); --lo: var(--ink); --ring: var(--red);
  min-width: 230px;
  padding: 8px 18px 12px;
  text-align: center;
  display: none;
  pointer-events: none;
  z-index: 6;
  zoom: var(--ui, 1);
}
#tm-stand.on { display: block; }
#tm-stand .ttl { font: 14px var(--label); letter-spacing: 3px; color: var(--yellow); }
#tm-stand .cnt { font: 54px/1 var(--display); color: var(--white); text-shadow: var(--outline); }
#tm-stand .cnt small { font: 26px var(--display); color: var(--mist); }
#tm-stand .bar { display: flex; gap: var(--p); margin-top: 6px; height: calc(3 * var(--p)); }
#tm-stand .bar i { flex: 1; background: var(--yellow); }
#tm-stand .bar i.off { background: var(--ink); }
#tm-stand.go { animation: tmPop2 0.36s steps(3); }
#tm-stand.win { --bg: var(--teal); --hi: var(--green); --ring: var(--lime); }
#tm-stand.fail { --bg: var(--ink); --hi: var(--night); --ring: var(--red); }
@keyframes tmPop2 { 0% { transform: translateX(-50%) scale(1.6); } 100% { transform: translateX(-50%); } }
#tm-vig { box-shadow: inset 0 0 0 calc(5 * var(--p)) var(--red); animation: tmVig 0.5s steps(2) infinite; opacity: 0.7; }
@keyframes tmVig { 50% { box-shadow: inset 0 0 0 calc(9 * var(--p)) var(--red); } }
body.tm-stand #game { filter: saturate(0.7) contrast(1.15); }
.reduce-flash #tm-vig, .reduce-flash #tm-stand.go { animation: none !important; }

/* ---- Clutch revive */
#tm-revive .panel {
  position: absolute; top: 13vh; left: 50%;
  transform: translateX(-50%);
  --bg: var(--navy); --hi: var(--blue); --lo: var(--ink); --ring: var(--yellow);
  padding: 10px 22px 14px;
  text-align: center;
  zoom: var(--ui, 1);
}
#tm-revive .hands { position: relative; width: 300px; height: 64px; margin: 0 auto 4px; overflow: hidden; }
#tm-revive .hands .h { position: absolute; top: 4px; }
#tm-revive .hands .h.l { left: 0; }
#tm-revive .hands .h.r { right: 0; }
#tm-revive .hands .boom { position: absolute; left: 50%; top: 0; transform: translateX(-50%); opacity: 0; }
#tm-revive.on .h.l { animation: tmReachL 0.55s steps(5) forwards; }
#tm-revive.on .h.r { animation: tmReachR 0.55s steps(5) forwards; }
#tm-revive.on .boom { animation: tmBoom 0.5s steps(2) 0.55s forwards; }
@keyframes tmReachL { from { transform: translateX(-30px); } to { transform: translateX(74px); } }
@keyframes tmReachR { from { transform: translateX(30px); } to { transform: translateX(-74px); } }
@keyframes tmBoom { 0% { opacity: 1; transform: translateX(-50%) scale(0.6); } 50% { transform: translateX(-50%) scale(1.15); } 100% { opacity: 1; transform: translateX(-50%) scale(1); } }
#tm-revive .ttl { font: 44px/1 var(--display); color: var(--yellow); text-shadow: var(--outline); }
#tm-revive .who { margin-top: 4px; font: 18px var(--font); color: var(--white); letter-spacing: 1px; }
.reduce-flash #tm-revive .h, .reduce-flash #tm-revive .boom { animation-duration: 0.01s !important; }

/* ---- Team rewind vote */
#tm-vote {
  position: absolute; bottom: 176px; left: 50%;
  transform: translateX(-50%);
  --bg: var(--night); --hi: var(--slate); --lo: var(--ink); --ring: var(--cyan);
  padding: 6px 16px 10px;
  text-align: center;
  display: none;
  pointer-events: none;
  z-index: 6;
  zoom: var(--ui, 1);
}
#tm-vote.on { display: block; }
#tm-vote .ttl { font: 26px/1.1 var(--display); color: var(--cyan); text-shadow: var(--outline); }
#tm-vote .line { font: 12px var(--label); letter-spacing: 1px; color: var(--white); display: flex; align-items: center; justify-content: center; gap: 6px; }
#tm-vote .line.ok { color: var(--lime); }
#tm-vote .bar { margin-top: 5px; height: var(--p); background: var(--ink); }
#tm-vote .bar i { display: block; height: 100%; background: var(--cyan); transform-origin: left; }
`;

const REW = ['...#...#', '..##..##', '.###.###', '########', '.###.###', '..##..##', '...#...#'];
const PLAY = ['#...', '##..', '###.', '####', '###.', '##..', '#...'];
/** A gloved hand reaching right: # outline, s sleeve, c cuff, w glove, h glove shade. */
const HAND = [
  '..........###...',
  '.........#www#..',
  '####....#wwh#...',
  'sssc##.#wwwh####',
  'ssscww#wwwwwwww#',
  'ssscwwwwwwwwwww#',
  'ssscwwwwwhhhhh#.',
  'sssc#wwwwwww##..',
  '####.#######....',
];
const BOOM = ['...#...#...', '#..#.#.#..#', '.#.......#.', '...#####...', '##.#####.##', '...#####...', '.#.......#.', '#..#.#.#..#', '...#...#...'];

/** Palette colours for hero sleeves (by hero index, matching HERO_COLORS' hues). */
const SLEEVES = ['var(--blue)', 'var(--green)', 'var(--yellow)', 'var(--mist)', 'var(--red)', 'var(--plum)', 'var(--cyan)', 'var(--lime)']; // 5-8: eightp lane

function pixels(rows: string[], px: number, paint: (ch: string) => string | null, flip = false): string {
  let r = '';
  rows.forEach((row, y) => {
    const s = flip ? [...row].reverse().join('') : row;
    [...s].forEach((ch, x) => {
      const c = paint(ch);
      if (c) r += `<rect x="${x}" y="${y}" width="1" height="1" style="fill:${c}"/>`;
    });
  });
  const w = rows[0].length;
  return `<svg class="pg" viewBox="0 0 ${w} ${rows.length}" width="${w * px}" height="${rows.length * px}" shape-rendering="crispEdges" aria-hidden="true">${r}</svg>`;
}

export interface StandHud {
  kills: number;
  need: number;
  /** Time left 0..1 and in seconds. */
  left01: number;
}

export interface VoteHud {
  yes: number;
  need: number;
  left01: number;
  caller: string;
  mine: boolean;
}

export class TimeHud {
  private pip: HTMLElement | null = null;
  private vhs: HTMLElement;
  private vhsCtr: HTMLElement;
  private vhsTc: HTMLElement;
  private vhsTag: HTMLElement;
  private bars: HTMLElement;
  private barsText: HTMLElement;
  private replay: HTMLElement;
  private card: HTMLElement;
  private stand: HTMLElement;
  private standCnt: HTMLElement;
  private standBar: HTMLElement;
  private standTtl: HTMLElement;
  private vig: HTMLElement;
  private revive: HTMLElement;
  private vote: HTMLElement;
  private voteLine: HTMLElement;
  private voteTtl: HTMLElement;
  private voteBar: HTMLElement;
  // Shown values (DOM writes only on change).
  private pipK = -1;
  private pipCls = '';
  private ctrText = '';
  private standKey = '';
  private voteKey = '';
  private standEndT = 0;
  private playT = 0;

  constructor(root: HTMLElement) {
    if (!document.getElementById('time-css')) {
      const st = document.createElement('style');
      st.id = 'time-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    const add = (html: string): HTMLElement => {
      root.insertAdjacentHTML('beforeend', localizeHtml(html));
      return root.lastElementChild as HTMLElement;
    };
    this.vhs = add(`<div id="tm-vhs" class="tm-layer"><div class="lines"></div><div class="track"></div><div class="track b"></div><div class="tag"><span class="ic"></span><span class="tx">REWIND</span></div><div class="ctr"></div><div class="tc"></div></div>`);
    this.vhsTag = this.vhs.querySelector('.tag')!;
    this.vhsCtr = this.vhs.querySelector('.ctr')!;
    this.vhsTc = this.vhs.querySelector('.tc')!;
    this.setTag(false);
    this.bars = add(`<div id="tm-bars" class="tm-layer"><div class="bar t"></div><div class="bar b"></div><div class="cc">CLOSE CALL!</div></div>`);
    this.barsText = this.bars.querySelector('.cc')!;
    this.replay = add(
      `<div id="tm-replay" class="tm-layer"><div class="rec"><i></i>REPLAY</div><div class="spd">x0.5</div><div class="skip">${prompt('back')} SKIP</div><div class="card px"><b></b><span></span></div></div>`,
    );
    this.card = this.replay.querySelector('.card')!;
    this.vig = add(`<div id="tm-vig" class="tm-layer"></div>`);
    this.stand = add(`<div id="tm-stand" class="px"><div class="ttl">LAST STAND</div><div class="cnt"></div><div class="bar"></div></div>`);
    this.standTtl = this.stand.querySelector('.ttl')!;
    this.standCnt = this.stand.querySelector('.cnt')!;
    this.standBar = this.stand.querySelector('.bar')!;
    this.standBar.innerHTML = localizeHtml('<i></i>'.repeat(10));
    this.revive = add(`<div id="tm-revive" class="tm-layer"><div class="panel px"><div class="hands"></div><div class="ttl">CLUTCH SAVE!</div><div class="who"></div></div></div>`);
    this.vote = add(`<div id="tm-vote" class="px"><div class="ttl">TEAM REWIND?</div><div class="line"></div><div class="bar"><i></i></div></div>`);
    this.voteTtl = this.vote.querySelector('.ttl')!;
    this.voteLine = this.vote.querySelector('.line')!;
    this.voteBar = this.vote.querySelector('.bar i')!;
  }

  private setTag(play: boolean): void {
    const ic = this.vhsTag.querySelector('.ic')!;
    ic.innerHTML = localizeHtml(pixels(play ? PLAY : REW, 6, (c) => (c === '#' ? (play ? 'var(--lime)' : 'var(--white)') : null)));
    this.vhsTag.querySelector('.tx')!.textContent = localize(play ? 'PLAY' : 'REWIND');
  }

  /** The REWIND tank in #meters (created on first use, once the HUD exists). */
  private ensurePip(): HTMLElement | null {
    if (this.pip) return this.pip;
    const meters = document.getElementById('meters');
    if (!meters) return null;
    this.pip = document.createElement('div');
    this.pip.id = 'rewindpip';
    this.pip.className = 'pip';
    this.pip.innerHTML = localizeHtml(`${prompt('rewind')}${pixels(REW, 3, (c) => (c === '#' ? 'var(--white)' : null))}<span>REWIND</span>`);
    meters.appendChild(this.pip);
    return this.pip;
  }

  /** REWIND tank: fill (history gathered), ready, used, a team vote running. */
  meter(visible: boolean, k: number, ready: boolean, used: boolean, vote: boolean): void {
    const pip = this.ensurePip();
    if (!pip) return;
    const kq = Math.round(k * 10) / 10;
    if (kq !== this.pipK) {
      this.pipK = kq;
      pip.style.setProperty('--k', String(kq));
    }
    const cls = !visible ? 'hide' : used ? 'used' : vote ? 'vote' : ready ? 'ready' : '';
    if (cls !== this.pipCls) {
      this.pipCls = cls;
      pip.classList.toggle('used', cls === 'used');
      pip.classList.toggle('ready', cls === 'ready');
      pip.classList.toggle('vote', cls === 'vote');
      pip.hidden = cls === 'hide';
    }
  }

  /** VHS rewind overlay: how far back the playback is (0..1, -1 = off) of how many seconds it rewinds. */
  vhsAt(k: number, seconds: number, dt: number): void {
    this.playT = Math.max(0, this.playT - dt);
    const on = k >= 0 || this.playT > 0;
    this.vhs.classList.toggle('on', on);
    this.vhs.classList.toggle('play', k < 0 && this.playT > 0);
    if (k >= 0) {
      const text = `-${(seconds * k).toFixed(1)} S`;
      if (text !== this.ctrText) {
        this.ctrText = text;
        this.vhsCtr.textContent = localize(text);
        const t = Math.max(0, seconds * (1 - k));
        this.vhsTc.textContent = localize(`00:00:${String(Math.floor(t)).padStart(2, '0')}:${String(Math.floor((t % 1) * 30)).padStart(2, '0')}`);
      }
    }
    this.body('tm-vhs', k >= 0);
  }

  /** The rewind landed: a short PLAY flash. */
  played(): void {
    this.playT = 0.7;
    this.setTag(true);
    this.vhsCtr.textContent = '';
    setTimeout(() => this.setTag(false), 750);
  }

  /** Letterbox bars: on, wider (cutscenes), with the CLOSE CALL text. */
  letterbox(on: boolean, wide: boolean, closeCall: boolean, text = 'CLOSE CALL!'): void {
    this.bars.classList.toggle('on', on);
    this.bars.classList.toggle('wide', on && wide);
    const was = this.bars.classList.contains('close');
    if (closeCall && !was) {
      this.barsText.textContent = localize(text);
      if (!reduceMotion()) restartClass(this.bars, 'close');
      else this.bars.classList.add('close');
    } else if (!closeCall && was) this.bars.classList.remove('close');
  }

  /** Death replay overlay: null = off; `card` shows once the replay reaches the death. */
  replayAt(r: { speed: number; card: boolean; title: string; text: string } | null): void {
    this.replay.classList.toggle('on', !!r);
    this.body('tm-cine', !!r);
    this.body('tm-replay', !!r);
    if (!r) {
      this.card.classList.remove('on');
      return;
    }
    const spd = this.replay.querySelector('.spd')!;
    const s = `x${r.speed.toFixed(1)}`;
    if (spd.textContent !== s) spd.textContent = localize(s);
    if (r.card && !this.card.classList.contains('on')) {
      this.card.querySelector('b')!.textContent = localize(r.title);
      this.card.querySelector('span')!.textContent = localize(r.text);
      this.card.classList.add('on');
    } else if (!r.card) this.card.classList.remove('on');
  }

  /** LAST STAND panel: null = off (after its win/fail flash). */
  standAt(s: StandHud | null, dt: number): void {
    this.standEndT = Math.max(0, this.standEndT - dt);
    const on = !!s || this.standEndT > 0;
    this.stand.classList.toggle('on', on);
    this.vig.classList.toggle('on', !!s);
    this.body('tm-stand', !!s);
    if (!s) return;
    const segs = Math.ceil(s.left01 * 10);
    const key = `${s.kills}/${s.need}/${segs}`;
    if (key === this.standKey) return;
    this.standKey = key;
    this.standCnt.innerHTML = localizeHtml(`${Math.min(s.kills, s.need)}<small>/${s.need}</small>`);
    this.standBar.querySelectorAll('i').forEach((el, i) => el.classList.toggle('off', i >= segs));
  }

  standStart(need: number): void {
    this.stand.classList.remove('win', 'fail');
    this.standTtl.textContent = localize(`LAST STAND · KILL ${need}!`);
    this.standKey = '';
    if (!reduceMotion()) restartClass(this.stand, 'go');
  }

  standEnd(win: boolean): void {
    this.stand.classList.add(win ? 'win' : 'fail');
    this.standTtl.textContent = localize(win ? 'SURVIVED!' : 'OUT OF TIME');
    this.standEndT = 1.2;
  }

  /** Clutch revive panel: the rescuer's and the rescued's names and hero indices. */
  reviveStart(rescuer: string, rescued: string, ia: number, ib: number): void {
    const hands = this.revive.querySelector('.hands')!;
    const paint = (sleeve: string) => (c: string) => (c === '#' ? 'var(--ink)' : c === 's' ? sleeve : c === 'c' || c === 'w' ? 'var(--white)' : c === 'h' ? 'var(--mist)' : null);
    hands.innerHTML =
      localizeHtml(`<div class="h l">${pixels(HAND, 5, paint(SLEEVES[ia % SLEEVES.length]))}</div>` +
      `<div class="h r">${pixels(HAND, 5, paint(SLEEVES[ib % SLEEVES.length]), true)}</div>` +
      `<div class="boom">${pixels(BOOM, 6, (c) => (c === '#' ? 'var(--yellow)' : null))}</div>`);
    this.revive.querySelector('.who')!.textContent = localize(`${rescuer.toUpperCase()} PULLED ${rescued.toUpperCase()} BACK!`);
    this.revive.classList.remove('on');
    if (!reduceMotion()) restartClass(this.revive, 'on');
    else this.revive.classList.add('on');
  }

  reviveEnd(): void {
    this.revive.classList.remove('on');
  }

  /** TEAM REWIND vote: null = none. */
  voteAt(v: VoteHud | null): void {
    this.vote.classList.toggle('on', !!v);
    if (!v) {
      this.voteKey = '';
      return;
    }
    this.voteBar.style.transform = `scaleX(${Math.round(v.left01 * 20) / 20})`;
    const key = `${v.yes}/${v.need}/${v.mine}/${v.caller}`;
    if (key === this.voteKey) return;
    this.voteKey = key;
    this.voteTtl.textContent = localize(`${v.caller.toUpperCase()} WANTS TO REWIND`);
    this.voteLine.classList.toggle('ok', v.mine);
    this.voteLine.innerHTML = localizeHtml(v.mine ? `READY ${v.yes}/${v.need} · WAITING FOR THE TEAM` : `${v.yes}/${v.need} READY · ${prompt('rewind')} AGREE`);
  }

  /** Hide everything (title, new run). */
  reset(): void {
    this.vhsAt(-1, 0, 1);
    this.letterbox(false, false, false);
    this.replayAt(null);
    this.standEndT = 0;
    this.standAt(null, 0);
    this.reviveEnd();
    this.voteAt(null);
    this.body('tm-hold', false);
  }

  /** Body classes drive the canvas filter, hiding the reticle and the in-game HUD in cutscenes. */
  body(cls: string, on: boolean): void {
    if (document.body.classList.contains(cls) !== on) document.body.classList.toggle(cls, on);
  }
}
