/**
 * Audio accessibility overlays: the CAPTIONS strip (announcer and hero voice
 * lines) and SOUND ARROWS (screen-edge pointers toward off-screen threat
 * telegraphs). Plain DOM in the pixel UI style; its CSS is injected from here
 * (the test bundler can't import .css files).
 */
import { a11yAudio, setCaptionSink, setThreatSink, type Caption } from '../audio/captions';
import { THREAT_CUES, threatTuning } from '../audio/threats';

const CSS = `
#caps {
  position: absolute;
  left: 50%;
  bottom: calc(34 * var(--p));
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: calc(2 * var(--p));
  pointer-events: none;
  z-index: 40;
}
#caps .cap {
  --bg: var(--ink);
  --hi: var(--night);
  --lo: var(--ink);
  --ring: transparent;
  background-color: var(--bg);
  box-shadow:
    inset var(--p) var(--p) 0 0 var(--hi),
    0 calc(-1 * var(--p)) 0 0 var(--ink),
    0 var(--p) 0 0 var(--ink),
    calc(-1 * var(--p)) 0 0 0 var(--ink),
    var(--p) 0 0 0 var(--ink);
  padding: var(--p) calc(3 * var(--p));
  font: 20px var(--font);
  color: var(--white);
  white-space: nowrap;
  max-width: 90vw;
  overflow: hidden;
  text-overflow: ellipsis;
  animation: cap-in 0.2s steps(2) both;
}
#caps .cap b {
  font: 10px var(--label);
  color: var(--c);
  margin-right: calc(2 * var(--p));
  vertical-align: middle;
}
#caps .cap.out {
  animation: cap-out 0.3s steps(3) forwards;
}
@keyframes cap-in {
  from { transform: translateY(calc(2 * var(--p))); opacity: 0; }
  to { transform: none; opacity: 1; }
}
@keyframes cap-out {
  to { opacity: 0; }
}
#sndarrows {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 39;
}
#sndarrows .snd {
  --a: var(--yellow);
  position: absolute;
  left: 0;
  top: 0;
  display: grid;
  place-items: center;
}
#sndarrows .snd[hidden] {
  display: none;
}
#sndarrows .snd span {
  font: 10px var(--label);
  color: var(--white);
  background: var(--ink);
  box-shadow: 0 0 0 var(--p) var(--a);
  padding: 0 var(--p);
  text-shadow: none;
  animation: hop 0.5s steps(1) infinite;
}
#sndarrows .snd i {
  position: absolute;
  left: 50%;
  top: 50%;
  width: var(--p);
  height: var(--p);
  background: var(--a);
  box-shadow:
    calc(-1 * var(--p)) calc(-1 * var(--p)) 0 var(--a),
    calc(-1 * var(--p)) 0 0 var(--a),
    calc(-1 * var(--p)) var(--p) 0 var(--a),
    calc(-2 * var(--p)) calc(-2 * var(--p)) 0 var(--a),
    calc(-2 * var(--p)) calc(-1 * var(--p)) 0 var(--a),
    calc(-2 * var(--p)) 0 0 var(--a),
    calc(-2 * var(--p)) var(--p) 0 var(--a),
    calc(-2 * var(--p)) calc(2 * var(--p)) 0 var(--a);
  filter: drop-shadow(var(--p) var(--p) 0 var(--ink));
  scale: 1.5;
}
`;

const MAX_CAPS = 3;
const CAP_TIME = 2.8;

interface Arrow {
  el: HTMLElement;
  arrow: HTMLElement;
  x: number;
  z: number;
  t: number;
  dir: number;
}

/** Projects a world point (y = ground) to CSS pixels; `null` when behind the camera. */
export type Project = (x: number, z: number) => { x: number; y: number } | null;

export class AudioA11y {
  readonly caps: HTMLElement;
  readonly arrowsRoot: HTMLElement;
  private lines: { el: HTMLElement; t: number }[] = [];
  private arrows = new Map<string, Arrow>();

  constructor(parent: HTMLElement) {
    const doc = parent.ownerDocument;
    if (!doc.getElementById('audio-a11y-css')) {
      const style = doc.createElement('style');
      style.id = 'audio-a11y-css';
      style.textContent = CSS;
      doc.head.appendChild(style);
    }
    this.caps = doc.createElement('div');
    this.caps.id = 'caps';
    this.caps.setAttribute('aria-live', 'polite');
    this.arrowsRoot = doc.createElement('div');
    this.arrowsRoot.id = 'sndarrows';
    parent.appendChild(this.arrowsRoot);
    parent.appendChild(this.caps);
    setCaptionSink((c) => this.caption(c));
    setThreatSink((cue, x, z) => this.threat(cue, x, z));
  }

  caption(c: Caption): void {
    // The same line twice in a row just refreshes.
    const last = this.lines[this.lines.length - 1];
    if (last && last.el.dataset.key === c.who + c.text) {
      last.t = CAP_TIME;
      last.el.classList.remove('out');
      return;
    }
    const el = this.caps.ownerDocument.createElement('div');
    el.className = 'cap ' + c.kind;
    el.dataset.key = c.who + c.text;
    el.style.setProperty('--c', c.color);
    const who = this.caps.ownerDocument.createElement('b');
    who.textContent = c.who;
    el.append(who, c.text);
    this.caps.appendChild(el);
    this.lines.push({ el, t: CAP_TIME });
    while (this.lines.length > MAX_CAPS) this.lines.shift()!.el.remove();
  }

  threat(cue: string, x: number, z: number): void {
    const def = THREAT_CUES[cue];
    if (!def) return;
    let a = this.arrows.get(def.id);
    if (!a) {
      const doc = this.arrowsRoot.ownerDocument;
      const el = doc.createElement('div');
      el.className = 'snd';
      el.style.setProperty('--a', def.color);
      const arrow = doc.createElement('i');
      const label = doc.createElement('span');
      label.textContent = def.label;
      el.append(arrow, label);
      el.hidden = true;
      this.arrowsRoot.appendChild(el);
      a = { el, arrow, x, z, t: 0, dir: 99 };
      this.arrows.set(def.id, a);
    }
    a.x = x;
    a.z = z;
    a.t = threatTuning.arrowTime;
  }

  /** Per rendered frame: age captions, place arrows for off-screen sources. */
  update(dt: number, project: Project, width: number, height: number): void {
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const l = this.lines[i];
      l.t -= dt;
      if (l.t <= 0.3 && !l.el.classList.contains('out')) l.el.classList.add('out');
      if (l.t <= 0) {
        l.el.remove();
        this.lines.splice(i, 1);
      }
    }
    if (!a11yAudio.captions && this.lines.length) this.clearCaptions();
    for (const a of this.arrows.values()) {
      a.t -= dt;
      const s = a.t > 0 && a11yAudio.arrows ? project(a.x, a.z) : null;
      const place = s ? ringPoint(s.x, s.y, width, height) : null;
      a.el.hidden = !place;
      if (!place) continue;
      a.el.style.transform = `translate(${Math.round(place.x)}px, ${Math.round(place.y)}px) translate(-50%, -50%)`;
      // 8 directions keep the arrow a clean pixel sprite.
      const dir = Math.round(place.angle / 45) * 45;
      if (dir !== a.dir) {
        a.dir = dir;
        a.arrow.style.transform = `rotate(${dir}deg) translateX(30px)`;
      }
    }
  }

  clearCaptions(): void {
    for (const l of this.lines) l.el.remove();
    this.lines.length = 0;
  }

  /** Visible arrows (tests). */
  get shown(): string[] {
    const out: string[] = [];
    for (const [id, a] of this.arrows) if (!a.el.hidden) out.push(id);
    return out;
  }
}

/**
 * Sound arrows sit on an ellipse around the screen centre (the hero), in the
 * source's direction: clear of the HUD panels in the corners and edges, and
 * where the eye already is. `null` if the source is on screen.
 */
export function ringPoint(sx: number, sy: number, w: number, h: number): { x: number; y: number; angle: number } | null {
  const seen = 12;
  if (sx > seen && sx < w - seen && sy > seen && sy < h - seen) return null;
  const r = Math.min(w, h) * 0.36;
  const a = Math.atan2(sy - h / 2, sx - w / 2);
  return { x: w / 2 + Math.cos(a) * r * 1.35, y: h / 2 + Math.sin(a) * r, angle: (a * 180) / Math.PI };
}

/**
 * Where an off-screen point's pointer goes: on a rectangle inset `margin` from
 * the screen edge, along the line from the centre. `null` if the point is on
 * screen (no pointer needed).
 */
export function edgePoint(sx: number, sy: number, w: number, h: number, margin: number): { x: number; y: number; angle: number } | null {
  const seen = 12;
  if (sx > seen && sx < w - seen && sy > seen && sy < h - seen) return null;
  const cx = w / 2;
  const cy = h / 2;
  const dx = sx - cx;
  const dy = sy - cy;
  const k = Math.min((cx - margin) / Math.abs(dx || 1e-6), (cy - margin) / Math.abs(dy || 1e-6));
  return { x: cx + dx * k, y: cy + dy * k, angle: (Math.atan2(dy, dx) * 180) / Math.PI };
}
