import type { Game } from './game';
import type { Enemy } from './enemies';
import type { HeroRig } from './heroModel';
import { titanTuning } from './titan';
import { introTuning } from './bossIntro';
import type { Settings } from './settings';
import { localize, t } from '../i18n';
import { prompt } from '../ui/prompts';
import { iconHtml } from '../ui/pixelIcons';
import { CinematicCamera, type CinematicKeyframe } from '../render/cinematicCamera';

export type ShotPose = 'salute' | 'ready' | 'victory';
export function poseRig(r: HeroRig, pose: ShotPose): void {
  r.root.visible = true; // A paused invulnerability blink must not erase the performer.
  r.head.rotation.set(-0.08, pose === 'ready' ? -0.24 : 0.12, 0);
  r.body.rotation.set(pose === 'ready' ? 0.14 : -0.05, 0, 0);
  r.armL.rotation.set(pose === 'salute' ? -2.55 : -0.52, 0, pose === 'salute' ? -0.38 : 0.24);
  r.armR.rotation.set(pose === 'victory' ? -2.85 : pose === 'ready' ? -1.48 : -0.32, 0, pose === 'victory' ? 0.32 : -0.2);
  r.legL.rotation.set(0.12, 0, -0.1);
  r.legR.rotation.set(-0.16, 0, 0.1);
}

type Kind = 'bossintro' | 'finisher' | 'evolution';
interface Beat { at: number; line?: string; sound?: () => void; pose?: ShotPose }
interface Script {
  title: string;
  line: string;
  duration: number;
  frames: readonly CinematicKeyframe[];
  beats: readonly Beat[];
  hero?: HeroRig;
  icon?: { id: string; color: string; glyph: string };
  skip: () => void;
}
const playing = new WeakMap<Game, Cutscene>();
const hudGames = new WeakMap<HTMLElement, Game>();
export function cutsceneGame(hud: HTMLElement): Game {
  const g = hudGames.get(hud);
  if (!g) throw Error('Cutscene needs the session HUD');
  return g;
}

export const compactScene = (g: Game) => g.role !== 'solo' || !!g.pvp || !!g.race || g.heroes.length > 1;

/** Shot-local camera coordinates. +Z looks at the subject's front. Times are normalized. */
export function shotFrame(time: number, x: number, z: number, facing: number, side: number, height: number, distance: number, eye: number, fov: number, cut = false): CinematicKeyframe {
  const sin = Math.sin(facing), cos = Math.cos(facing);
  return { time, position: [x + side * cos + distance * sin, height, z - side * sin + distance * cos], target: [x, eye, z], fov, cut };
}

const STAGING: Record<string, readonly [number, number, number, number, string]> = {
  king: [-4.5, 7.6, 12, 2.4, 'text.bow_before_the_bounce_3b3370'],
  rex: [7, 7.6, 12, 2.3, 'text.no_wall_can_stop_me_0dd67e'],
  queen: [-6, 9.4, 14, 2.8, 'text.my_swarm_hungers_6b4ebd'],
  titan: [10, 11, 25, 3.2, 'cine.titan'],
  omega: [6, 9.2, 15, 3.4, 'text.i_am_the_final_program_1dd7a4'],
};

/** Discrete cues cross at most once, including a frame which crosses several beats. */
export class Cutscene {
  private camera: CinematicCamera;
  private root: HTMLElement;
  private heading: HTMLElement;
  private icon: HTMLElement;
  private caption: HTMLElement;
  private skipButton: HTMLButtonElement;
  private script: Script | null = null;
  private cue = 0;
  private pose?: ShotPose;
  private time = 0;
  private quiet = false;
  private wide = false;
  constructor(private g: Game, hud: HTMLElement, readonly kind: Kind) {
    this.camera = new CinematicCamera(g.cam.camera);
    this.root = document.createElement('section');
    this.root.id = kind;
    this.root.className = 'cine-shot';
    this.root.dataset.moment = kind;
    this.root.hidden = true;
    this.root.innerHTML = '<div class="cine-strip"><i hidden></i><div><strong></strong><span></span></div><button type="button" data-nav></button></div>';
    this.heading = this.root.querySelector('strong')!;
    this.icon = this.root.querySelector('i')!;
    this.caption = this.root.querySelector('span')!;
    this.skipButton = this.root.querySelector('button')!;
    this.skipButton.onclick = () => this.script?.skip();
    hud.appendChild(this.root);
    installStyle();
  }
  get active(): boolean { return !!this.script; }
  /** Sample controller edges before another fixed step can clear them. */
  static padSkip(g: Game): void {
    const shot = playing.get(g);
    if (shot && shot.time >= 0.14 && g.input.padButtonPressed(0)) shot.script?.skip();
  }
  private press = (e: Event) => {
    if (e instanceof KeyboardEvent && e.repeat) return;
    if (e.target === this.skipButton || this.time < 0.14) return;
    this.script?.skip();
  };
  start(script: Script): void {
    this.stop();
    playing.get(this.g)?.stop();
    playing.set(this.g, this);
    this.script = script;
    this.cue = this.time = 0;
    this.pose = undefined;
    this.wide = !compactScene(this.g);
    this.quiet = this.g.bossIntro.stillCamera();
    this.root.classList.toggle('compact', !this.wide);
    if (this.wide) this.root.parentElement?.classList.add('shot-' + this.kind);
    this.heading.textContent = script.title;
    this.icon.hidden = !script.icon;
    if (script.icon) this.icon.innerHTML = iconHtml(script.icon.id, script.icon.color, script.icon.glyph);
    this.caption.textContent = script.line;
    this.skipButton.innerHTML = prompt('confirm') + ' ' + t('text.skip_a2b998');
    this.root.hidden = false;
    window.addEventListener('keydown', this.press);
    window.addEventListener('pointerdown', this.press);
  }
  sample(t: number): void {
    const s = this.script;
    if (!s) return;
    this.time = t;
    const u = Math.max(0, Math.min(1, t / s.duration));
    while (this.cue < s.beats.length && s.beats[this.cue].at <= u) {
      const b = s.beats[this.cue++];
      if (b.line) this.caption.textContent = b.line;
      if (b.pose) this.pose = b.pose;
      b.sound?.();
    }
    if (this.wide && this.pose && s.hero) poseRig(s.hero, this.pose);
    if (this.wide && !this.quiet) {
      if (!this.camera.active) this.camera.play(s.frames);
      this.camera.seek(u);
    }
  }
  stop(): void {
    if (!this.script) return;
    this.camera.stop();
    this.script = null;
    if (playing.get(this.g) === this) playing.delete(this.g);
    this.root.hidden = true;
    this.root.parentElement?.classList.remove('shot-' + this.kind);
    window.removeEventListener('keydown', this.press);
    window.removeEventListener('pointerdown', this.press);
  }
}

function installStyle(): void {
  if (document.getElementById('shot-style')) return;
  const s = document.createElement('style');
  s.id = 'shot-style';
  s.textContent = `
#hud .cine-shot { position:absolute; inset:0; z-index:16; pointer-events:none; color:var(--white); }
.cine-shot[hidden] {display:none}
.cine-shot:not(.compact)::before {content:"";position:absolute;inset:0 0 auto;height:6vh;background:var(--ink);border-bottom:var(--p) solid var(--slate)}
.cine-strip {position:absolute;inset:auto 0 0;background:var(--ink);border-top:var(--p) solid var(--yellow);padding:calc(3 * var(--p)) 6vw;display:flex;align-items:center;justify-content:space-between;gap:calc(4 * var(--p));text-align:start}
.cine-strip>div {flex:1;min-width:0}
.cine-strip>i img {width:48px;height:48px;image-rendering:pixelated;vertical-align:middle}
.cine-strip strong,.cine-strip span {display:block}
.cine-strip strong {font:clamp(24px,4.8vh,56px)/1.15 var(--display);color:var(--yellow)}
.cine-strip span {font:clamp(16px,2.8vh,32px)/1.45 var(--font)}
.cine-strip button {pointer-events:auto;color:var(--mist);background:var(--ink);border:0;font:inherit;cursor:pointer}
.cine-shot.compact .cine-strip {inset:auto auto 12vh 50%;transform:translateX(-50%);width:max-content;max-width:78vw;padding:var(--p) calc(4 * var(--p));border-color:var(--cyan)}
.cine-shot.compact .cine-strip strong {font-size:clamp(16px,2.8vh,32px)}
.cine-shot.compact .cine-strip span {font-size:clamp(14px,2.1vh,24px)}
#hud:is(.shot-finisher,.shot-bossintro,.shot-evolution)>:not(.cine-shot):not([id^="scr-"]) {display:none !important}
#hud:is(.shot-finisher,.shot-bossintro,.shot-evolution) ~ #reticle {visibility:hidden}
`;
  document.head.appendChild(s);
}

/** The existing entrance signal/uid travels in boss snapshots. Its clock is local. */
export class SceneBossIntro {
  t = -1;
  uid = 0;
  onSkip: (() => void) | null = null;
  private shot: Cutscene | null = null;
  private length = introTuning.length;
  private riseUntil = -1;
  private revealTitan?: () => void;
  constructor(private hud: HTMLElement, private g: Game, readonly preferences: Settings, readonly stillCamera: () => boolean) { hudGames.set(hud, g); }
  get active(): boolean { return this.t >= 0; }
  /** A solo close-up never costs health off camera. Advance on fixed steps so the
   * headless bots, a slow frame and a skipped shot all release the same hold. */
  hold(dt: number): boolean {
    if (this.revealTitan && this.g.runTime >= this.riseUntil) {
      const show = this.revealTitan;
      this.revealTitan = undefined;
      if (this.g.boss?.active && this.g.boss.uid === this.uid && this.g.mode === 'fight') show();
    }
    if (!this.active || compactScene(this.g) || this.g.mode !== 'fight' || this.g.paused) return false;
    this.advance(dt);
    return this.active;
  }
  start(uid: number, name: string, title: string, _color: string, at = 0): void {
    this.stop();
    this.uid = uid;
    const g = this.g;
    if (g.online) g.slowMoT = 0;
    if (this.preferences.cinematics === 'off' || !this.preferences.bossIntros) return;
    const e = g.role === 'client' ? g.netEnemies.get(uid) : g.boss;
    if (!e) return;
    this.length = compactScene(g) || this.preferences.cinematics === 'short' || this.stillCamera() ? 1.1 : introTuning.length;
    if (at >= this.length) return;
    const show = () => this.show(e, name, title, at);
    if (e.def.id === 'titan' && !compactScene(g)) {
      this.riseUntil = g.runTime + titanTuning.rise * 0.88;
      this.revealTitan = show;
    } else show();
  }
  private show(e: Enemy, name: string, title: string, at: number): void {
    const g = this.g;
    this.t = at;
    const [side, height, distance, eye, line] = STAGING[e.def.model] ?? STAGING[e.def.id] ?? [4, 5, 11, 1.6, ''];
    const face = e.def.id === 'titan' ? 0 : e.facing;
    const frame = (time: number, x: number, y: number, z: number, fov: number) => shotFrame(time, e.x, e.z, face, x, y, z, eye, fov);
    (this.shot ??= new Cutscene(g, this.hud, 'bossintro')).start({
      title: localize(name), line: localize(title), duration: this.length,
      frames: [frame(0, side, height + 2, distance * 1.22, 47), frame(0.58, side * 0.42, height, distance, 39), frame(1, side * 0.28, height + 1, distance * 1.1, 43)],
      beats: line ? [{ at: 0.3, line: t(line) }] : [], skip: () => this.skip(),
    });
  }
  update(dt: number, _from: unknown, _boss: Pick<Enemy, 'x' | 'z'> | null, _lead: unknown, _camera: unknown): void {
    if (compactScene(this.g)) this.advance(dt);
  }
  private advance(dt: number): void {
    if (!this.active) return;
    if (!this.preferences.bossIntros || this.preferences.cinematics === 'off') { this.stop(); return; }
    this.t += dt;
    if (this.t >= this.length) this.stop();
  }
  draw(): void { if (this.active) this.shot?.sample(this.t); }
  skip(): void { if (this.active) { this.stop(); if (!this.g.online) this.onSkip?.(); } }
  stop(_camera?: unknown): void { this.t = -1; this.revealTitan = undefined; this.shot?.stop(); }
}
