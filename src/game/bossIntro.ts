import * as THREE from 'three';

/**
 * Boss entrance cinematic: letterbox bars slide in, the camera pans and zooms
 * to the boss, and a title card shows its name and subtitle, for about two
 * seconds. Purely local presentation: the host starts it when the boss spawns
 * (and slows the world for a moment), clients start it when the snapshot says
 * an entrance is playing (src/game/systems/bossFight.ts). Any key, click or
 * pad button skips it. SETTINGS > BOSS INTROS turns it off.
 */
export const introTuning = {
  length: 2.2, // seconds
  zoom: 0.28, // extra camera zoom at the peak
  panIn: 0.35, // seconds to pan onto the boss
  panOut: 0.45, // seconds to pan back to the hero
};

/** Camera pan envelope 0..1 at time `t` of an intro lasting `len` seconds. */
export function introEnvelope(t: number, len = introTuning.length): number {
  if (t <= 0 || t >= len) return 0;
  const a = Math.min(1, t / introTuning.panIn);
  const b = Math.min(1, (len - t) / introTuning.panOut);
  const k = Math.min(a, b);
  return k * k * (3 - 2 * k);
}

export class BossIntro {
  /** Seconds into the intro (-1 = not playing). */
  t = -1;
  /** Uid of the boss whose intro last played (each boss plays once). */
  uid = 0;
  /** Called when the local player skips. */
  onSkip: (() => void) | null = null;
  private root: HTMLElement;
  private name: HTMLElement;
  private sub: HTMLElement;
  private padDown = false;
  private zoomed = false;

  constructor(private hud: HTMLElement) {
    const hudRoot = hud;
    this.root = document.createElement('div');
    this.root.id = 'bossintro';
    this.root.hidden = true;
    this.root.innerHTML = `<div class="lb top"></div><div class="lb bot"><div class="card"><div class="nm"></div><div class="sb"></div></div><div class="skip">SKIP ▸</div></div>`;
    hudRoot.appendChild(this.root);
    this.name = this.root.querySelector('.nm')!;
    this.sub = this.root.querySelector('.sb')!;
    const skip = (ev: Event) => {
      if (this.t < 0.25) return; // ignore the press that was already held
      if (ev instanceof KeyboardEvent && (ev.code === 'Escape' || ev.repeat)) return;
      this.skip();
    };
    window.addEventListener('keydown', skip);
    window.addEventListener('pointerdown', skip);
  }

  get active(): boolean {
    return this.t >= 0;
  }

  start(uid: number, name: string, title: string, color: string, at = 0): void {
    this.uid = uid;
    this.t = at;
    this.name.textContent = name.toUpperCase();
    this.sub.textContent = title;
    this.root.style.setProperty('--boss', color);
    this.root.hidden = false;
    this.hud.classList.add('cinematic');
    this.root.classList.remove('out');
    this.root.classList.remove('in');
    void this.root.offsetWidth; // restart the CSS animation
    this.root.classList.add('in');
    this.padDown = anyPadButton();
  }

  skip(): void {
    if (this.t < 0) return;
    this.t = introTuning.length - introTuning.panOut;
    this.onSkip?.();
  }

  stop(camera?: THREE.PerspectiveCamera): void {
    this.t = -1;
    this.root.hidden = true;
    this.hud.classList.remove('cinematic');
    if (camera && this.zoomed) {
      camera.zoom = 1;
      camera.updateProjectionMatrix();
      this.zoomed = false;
    }
  }

  /**
   * Advance the intro and steer the camera: `lead` (the camera's offset from
   * the hero) is pulled toward the boss. Call before CameraRig.update.
   */
  update(frameDt: number, from: { x: number; z: number }, boss: { x: number; z: number } | null, lead: THREE.Vector3, camera: THREE.PerspectiveCamera): void {
    if (this.t < 0) return;
    const pad = anyPadButton();
    if (pad && !this.padDown && this.t > 0.25) this.skip();
    this.padDown = pad;
    this.t += frameDt;
    const L = introTuning.length;
    if (this.t >= L) {
      this.stop(camera);
      return;
    }
    if (this.t > L - introTuning.panOut) this.root.classList.add('out');
    const k = introEnvelope(this.t);
    if (boss) {
      lead.x += (boss.x - from.x - lead.x) * k;
      lead.z += (boss.z - from.z - lead.z) * k;
    }
    camera.zoom = 1 + introTuning.zoom * k;
    camera.updateProjectionMatrix();
    this.zoomed = true;
  }
}

function anyPadButton(): boolean {
  const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) if (p) for (const b of p.buttons) if (b.pressed) return true;
  return false;
}
