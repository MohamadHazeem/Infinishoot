import { localize, localizeHtml } from '../i18n';
import type { Game } from '../game/game';
import { samples } from '../audio/samples';
import { sfx } from '../audio/sfx';
import { retroGlobals } from '../render/retroMaterial';
import { access } from '../game/settings';
import {
  PHOTO_FILTERS,
  applyPhotoFilter,
  clampPhotoCam,
  filterScratch,
  photoCamPosition,
  photoFileName,
  photoScale,
  photoTuning,
  type PhotoCam,
  type PhotoFilter,
} from './photoFilters';

/**
 * PHOTO MODE (pause menu, solo only): the world stays frozen, the HUD hides
 * and a free camera pans, zooms, tilts and orbits within limits around where
 * the photo mode opened. Filters, frames, stickers and the logo are drawn
 * over the game's own low-resolution pixels (src/ui/photoFilters.ts), shown
 * live and saved as a PNG (whole-number upscale to about 1080p; a download,
 * which the desktop app turns into a save dialog).
 *
 * Solo only: online the world keeps running behind the pause menu and a
 * host-wide pause would freeze everyone, so the button explains that instead.
 *
 * Wiring: Game.update hands control here while `active` (game.ts), and
 * main.ts calls `frame()` after Game.render (camera) and `afterRender()`
 * right after the WebGL frame (the canvas is only readable in that task).
 */
export const PHOTO_FRAMES = [
  { id: 'none', name: 'NONE' },
  { id: 'snapshot', name: 'SNAPSHOT' },
  { id: 'film', name: 'FILM' },
  { id: 'arcade', name: 'ARCADE' },
  { id: 'comic', name: 'COMIC' },
] as const;
type FrameId = (typeof PHOTO_FRAMES)[number]['id'];

export const PHOTO_STICKERS = ['none', 'star', 'heart', 'bolt', 'crown', 'skull', 'pow', 'gg', 'wow', 'oneup'] as const;
type StickerId = (typeof PHOTO_STICKERS)[number];
/** Word stickers: text, colour, burst colour (or none). */
const WORDS = {
  pow: ['POW!', '#b13e53', '#ffcd75'],
  gg: ['GG!', '#73eff7', ''],
  wow: ['WOW!', '#a7f070', '#5d275d'],
  oneup: ['1UP', '#a7f070', ''],
} as const;
const STICKER_NAMES: Record<StickerId, string> = { none: 'OFF', star: 'STAR', heart: 'HEART', bolt: 'BOLT', crown: 'CROWN', skull: 'SKULL', pow: 'POW!', gg: 'GG!', wow: 'WOW!', oneup: '1UP' };

interface Placed {
  id: StickerId;
  /** Centre in 0..1 of the image. */
  u: number;
  v: number;
}

const C = {
  ink: '#1a1c2c',
  plum: '#5d275d',
  red: '#b13e53',
  orange: '#ef7d57',
  yellow: '#ffcd75',
  lime: '#a7f070',
  green: '#38b764',
  teal: '#257179',
  navy: '#29366f',
  blue: '#3b5dc9',
  sky: '#41a6f6',
  cyan: '#73eff7',
  white: '#f4f4f4',
  mist: '#94b0c2',
  slate: '#566c86',
  night: '#333c57',
};

/** Pad buttons (standard mapping). */
const PAD = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, select: 8, l3: 10, r3: 11, up: 12, down: 13, left: 14, right: 15 };

export class PhotoMode {
  active = false;
  filter: PhotoFilter = 'normal';
  frameId: FrameId = 'none';
  sticker: StickerId = 'none';
  logo = true;
  stickers: Placed[] = [];
  /** Size in bytes of the last saved PNG (tests and the dev console). */
  lastSaved = 0;
  lastName = '';

  private cam: PhotoCam = { x: 0, z: 0, yaw: 0, pitch: 58, dist: 25 };
  private shown: PhotoCam = { x: 0, z: 0, yaw: 0, pitch: 58, dist: 25 };
  private ox = 0;
  private oz = 0;
  private fog = { near: 0, far: 0, camFar: 120 };
  private dirty = true;
  private pendingSave = false;
  private uiHidden = false;
  private pointer = { u: 0.5, v: 0.5, inside: false };
  private drag: { button: number; x: number; y: number; moved: number } | null = null;
  private pos = { x: 0, y: 0, z: 0 };
  private scratch = filterScratch();
  private flashT = 0;
  private toastT = 0;

  private root: HTMLElement | null = null;
  private view: HTMLCanvasElement | null = null;
  private base: HTMLCanvasElement | null = null;
  private els: Record<string, HTMLElement> = {};
  private sprites = new Map<string, HTMLCanvasElement>();
  private pauseLabel = '';

  constructor(
    private game: Game,
    private glCanvas: HTMLCanvasElement,
  ) {
    this.build();
    // The pause menu's PHOTO MODE button (screens.ts) is handled here.
    document.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement | null)?.closest?.('[data-act="photo"]');
      // Keyboard/pad presses click from inside the menu's update step, which would unpause the
      // game once the menu closes: open after the step instead.
      if (b) setTimeout(() => this.open(), 0);
    });
  }

  /** Photo mode can open: a solo run, paused in a fight. */
  get allowed(): boolean {
    const g = this.game;
    return g.role === 'solo' && !g.pvp && g.isCombatMode && g.paused;
  }

  open(): boolean {
    const g = this.game;
    if (this.active) return true;
    if (!this.allowed || !this.root) {
      sfx.deny();
      return false;
    }
    this.active = true;
    g.screens.show('none');
    document.body.classList.add('photo-mode');
    this.root.hidden = false;
    // Start from what the game camera sees right now.
    const cam = g.cam.camera;
    const dir = cam.getWorldDirection(cam.position.clone());
    const t = dir.y < -0.05 ? -cam.position.y / dir.y : 25;
    const fx = cam.position.x + dir.x * t;
    const fz = cam.position.z + dir.z * t;
    const dist = Math.hypot(cam.position.x - fx, cam.position.y, cam.position.z - fz);
    const pitch = (Math.asin(Math.min(1, cam.position.y / Math.max(0.01, dist))) * 180) / Math.PI;
    this.cam = { x: fx, z: fz, yaw: 0, pitch, dist };
    this.shown = { ...this.cam };
    this.ox = fx;
    this.oz = fz;
    this.fog = { near: retroGlobals.uFogNear.value, far: retroGlobals.uFogFar.value, camFar: cam.far };
    this.dirty = true;
    this.uiHidden = false;
    this.root.classList.remove('ph-hide');
    // Sprites drawn before the pixel fonts load would keep a fallback font: rebuild them once they're in.
    void Promise.all([document.fonts?.load?.('20px "Jersey 10"'), document.fonts?.load?.('8px "Silkscreen"')]).then(() => {
      this.sprites.clear();
      this.dirty = true;
    });
    this.refreshUi();
    return true;
  }

  close(): void {
    if (!this.active) return;
    const g = this.game;
    this.active = false;
    this.pendingSave = false;
    document.body.classList.remove('photo-mode');
    if (this.root) this.root.hidden = true;
    retroGlobals.uFogNear.value = this.fog.near;
    retroGlobals.uFogFar.value = this.fog.far;
    g.cam.camera.far = this.fog.camFar;
    g.cam.camera.updateProjectionMatrix();
    // Back to the pause menu (the game is still paused); the next frame puts the game camera back.
    g.screens.show('pause');
  }

  /** Test links and the dev console: set several things at once (unknown ids are ignored). */
  configure(o: { filter?: string; frame?: string; sticker?: string; stickers?: { id: string; u: number; v: number }[]; logo?: boolean; yaw?: number; pitch?: number; dist?: number; hideUi?: boolean }): void {
    if (PHOTO_FILTERS.some((f) => f.id === o.filter)) this.filter = o.filter as PhotoFilter;
    if (PHOTO_FRAMES.some((f) => f.id === o.frame)) this.frameId = o.frame as FrameId;
    if ((PHOTO_STICKERS as readonly string[]).includes(o.sticker ?? '')) this.sticker = o.sticker as StickerId;
    if (o.stickers) for (const st of o.stickers) if ((PHOTO_STICKERS as readonly string[]).includes(st.id) && st.id !== 'none') this.stickers.push({ id: st.id as StickerId, u: st.u, v: st.v });
    if (o.logo !== undefined) this.logo = o.logo;
    if (o.yaw !== undefined) this.cam.yaw = o.yaw;
    if (o.pitch !== undefined) this.cam.pitch = o.pitch;
    if (o.dist !== undefined) this.cam.dist = o.dist;
    clampPhotoCam(this.cam, this.ox, this.oz);
    if (o.hideUi !== undefined && o.hideUi !== this.uiHidden) this.toggleUi();
    this.dirty = true;
    this.refreshUi();
  }

  // ---------------------------------------------------------------- input (fixed step)

  /** Called from Game.update instead of the game while active. */
  update(dt: number): void {
    const input = this.game.input;
    this.game.paused = true; // the world stays frozen while photo mode is up
    const t = photoTuning;
    const c = this.cam;
    if (input.keyPressed('Escape') || input.padButtonPressed(PAD.b) || input.padButtonPressed(9)) {
      this.close();
      return;
    }
    const fast = input.key('ShiftLeft') || input.key('ShiftRight') ? 3 : 1;
    const k = c.dist / 25;
    // Pan: WASD / arrows / left stick, relative to the view.
    let mx = input.move.x;
    let my = input.move.y;
    if (input.key('ArrowLeft')) mx -= 1;
    if (input.key('ArrowRight')) mx += 1;
    if (input.key('ArrowUp')) my -= 1;
    if (input.key('ArrowDown')) my += 1;
    if (mx || my) this.panBy(mx * t.pan * k * fast * dt, -my * t.pan * k * fast * dt);
    // Orbit (Q/E, right stick x), tilt (R/F, right stick y), zoom (Z/X, -/=, triggers).
    let rot = (input.key('KeyE') ? 1 : 0) - (input.key('KeyQ') ? 1 : 0) + input.padAim.x;
    let tilt = (input.key('KeyR') ? 1 : 0) - (input.key('KeyF') ? 1 : 0) - input.padAim.y;
    let zoom = (input.key('KeyX') || input.key('Minus') ? 1 : 0) - (input.key('KeyZ') || input.key('Equal') ? 1 : 0);
    if (input.padButton(PAD.lt)) zoom += 1;
    if (input.padButton(PAD.rt)) zoom -= 1;
    if (rot) c.yaw += rot * t.rotate * fast * dt;
    if (tilt) c.pitch += tilt * t.tilt * 60 * fast * dt;
    if (zoom) c.dist *= Math.exp(zoom * t.zoom * fast * dt);
    rot = tilt = zoom = 0;
    // Hotkeys.
    if (input.keyPressed('Digit1') || input.padButtonPressed(PAD.lb)) this.cycleFilter(-1);
    if (input.keyPressed('Digit2') || input.padButtonPressed(PAD.rb)) this.cycleFilter(1);
    if (input.keyPressed('Digit3') || input.padButtonPressed(PAD.up)) this.cycleFrame();
    if (input.keyPressed('Digit4') || input.padButtonPressed(PAD.y)) this.cycleSticker();
    if (input.keyPressed('Digit5') || input.padButtonPressed(PAD.down)) this.toggleLogo();
    if (input.padButtonPressed(PAD.x)) this.place(this.pointer.inside ? this.pointer.u : 0.5, this.pointer.inside ? this.pointer.v : 0.5);
    if (input.keyPressed('Backspace') || input.keyPressed('Delete') || input.padButtonPressed(PAD.left)) this.undoSticker();
    if (input.keyPressed('KeyC') || input.padButtonPressed(PAD.right)) this.clearStickers();
    if (input.keyPressed('KeyH') || input.padButtonPressed(PAD.select)) this.toggleUi();
    if (input.keyPressed('Digit0') || input.keyPressed('Home') || input.padButtonPressed(PAD.l3) || input.padButtonPressed(PAD.r3)) this.resetCam();
    if (input.keyPressed('Enter') || input.keyPressed('KeyP') || input.keyPressed('Space') || input.padButtonPressed(PAD.a)) this.snap();
    clampPhotoCam(c, this.ox, this.oz);
  }

  /** Move the focus by (right, forward) metres in view space. */
  private panBy(right: number, forward: number): void {
    const c = this.cam;
    c.x += Math.cos(c.yaw) * right - Math.sin(c.yaw) * forward;
    c.z += -Math.sin(c.yaw) * right - Math.cos(c.yaw) * forward;
  }

  private resetCam(): void {
    this.cam = { x: this.ox, z: this.oz, yaw: 0, pitch: this.cam.pitch, dist: this.cam.dist };
    this.cam.pitch = 58;
    this.cam.dist = 25;
  }

  cycleFilter(d: number): void {
    const i = PHOTO_FILTERS.findIndex((f) => f.id === this.filter);
    this.filter = PHOTO_FILTERS[(i + d + PHOTO_FILTERS.length) % PHOTO_FILTERS.length].id;
    this.changed();
  }
  cycleFrame(): void {
    const i = PHOTO_FRAMES.findIndex((f) => f.id === this.frameId);
    this.frameId = PHOTO_FRAMES[(i + 1) % PHOTO_FRAMES.length].id;
    this.changed();
  }
  cycleSticker(): void {
    const i = PHOTO_STICKERS.indexOf(this.sticker);
    this.sticker = PHOTO_STICKERS[(i + 1) % PHOTO_STICKERS.length];
    this.changed();
  }
  toggleLogo(): void {
    this.logo = !this.logo;
    this.changed();
  }
  /** Put the selected sticker at (u, v) in 0..1 of the picture. */
  place(u: number, v: number): void {
    if (this.sticker === 'none') {
      this.toast('PICK A STICKER FIRST (4)');
      sfx.deny();
      return;
    }
    if (this.stickers.length >= 24) this.stickers.shift();
    this.stickers.push({ id: this.sticker, u: Math.min(1, Math.max(0, u)), v: Math.min(1, Math.max(0, v)) });
    sfx.menuMove();
    this.changed();
  }
  private undoSticker(): void {
    if (this.stickers.pop()) this.changed();
  }
  private clearStickers(): void {
    if (!this.stickers.length) return;
    this.stickers.length = 0;
    this.changed();
  }
  private toggleUi(): void {
    this.uiHidden = !this.uiHidden;
    this.root?.classList.toggle('ph-hide', this.uiHidden);
  }

  /** Take the picture: shutter now, the PNG right after the next frame is drawn. */
  snap(): void {
    if (this.pendingSave) return;
    this.pendingSave = true;
    this.dirty = true;
    if (!samples.play('photo_shutter', { bus: 'ui', priority: 3 })) sfx.menuSelect();
    this.flashT = 1;
  }

  private changed(): void {
    this.dirty = true;
    sfx.menuMove();
    this.refreshUi();
  }

  // ---------------------------------------------------------------- per frame

  /** After Game.render, before the WebGL frame: point the camera, keep the pause button honest. */
  frame(frameDt: number): void {
    if (!this.active) {
      this.syncPauseButton();
      return;
    }
    const g = this.game;
    // Ease toward the target so moves feel smooth.
    const s = this.shown;
    const c = this.cam;
    const k = 1 - Math.exp(-14 * Math.min(0.1, frameDt));
    let dy = c.yaw - s.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    const before = s.x + s.z * 7 + s.yaw * 13 + s.pitch * 17 + s.dist * 19;
    s.x += (c.x - s.x) * k;
    s.z += (c.z - s.z) * k;
    s.yaw += dy * k;
    s.pitch += (c.pitch - s.pitch) * k;
    s.dist += (c.dist - s.dist) * k;
    if (Math.abs(before - (s.x + s.z * 7 + s.yaw * 13 + s.pitch * 17 + s.dist * 19)) > 1e-4) this.dirty = true;
    const cam = g.cam.camera;
    const p = photoCamPosition(s, this.pos);
    cam.up.set(0, 1, 0);
    cam.position.set(p.x, p.y, p.z);
    cam.lookAt(s.x, 0, s.z);
    // Zoomed out: push the fog back like the mouse-wheel zoom does.
    const fz = Math.max(1, s.dist / 25);
    retroGlobals.uFogNear.value = this.fog.near * fz;
    retroGlobals.uFogFar.value = this.fog.far * fz;
    const far = Math.max(this.fog.camFar, s.dist * 4);
    if (cam.far !== far) {
      cam.far = far;
      cam.updateProjectionMatrix();
    }
    // Flash and toast timers.
    if (this.flashT > 0) {
      this.flashT = Math.max(0, this.flashT - frameDt * 3);
      this.els.flash?.style.setProperty('opacity', String(this.flashT * (access.reduceFlash ? 0.15 : 0.85)));
    }
    if (this.toastT > 0 && (this.toastT -= frameDt) <= 0) this.els.toast?.classList.remove('on');
  }

  /** Right after the WebGL frame: grab the pixels, filter and compose the preview; save if asked. */
  afterRender(): void {
    if (!this.active || !this.view || !this.base) return;
    if (!this.dirty && !this.pendingSave) return;
    this.dirty = false;
    const w = this.glCanvas.width;
    const h = this.glCanvas.height;
    if (!w || !h) return;
    const base = this.base;
    if (base.width !== w || base.height !== h) {
      base.width = w;
      base.height = h;
    }
    const bx = base.getContext('2d', { willReadFrequently: true });
    if (!bx) return;
    bx.imageSmoothingEnabled = false;
    bx.drawImage(this.glCanvas, 0, 0);
    if (this.filter !== 'normal') {
      const img = bx.getImageData(0, 0, w, h);
      applyPhotoFilter(img.data, w, h, this.filter, this.scratch);
      bx.putImageData(img, 0, 0);
    }
    // Preview: twice the game's pixels (sharp overlays without a full-size redraw every frame).
    const ps = h <= 400 ? 2 : 1;
    if (this.view.width !== w * ps || this.view.height !== h * ps) {
      this.view.width = w * ps;
      this.view.height = h * ps;
    }
    this.compose(this.view, ps, true);
    if (this.pendingSave) {
      this.pendingSave = false;
      this.save(w, h);
    }
  }

  private save(w: number, h: number): void {
    const s = photoScale(h);
    const out = document.createElement('canvas');
    out.width = w * s;
    out.height = h * s;
    this.compose(out, s, false);
    const name = photoFileName(new Date());
    out.toBlob((blob) => {
      if (!blob) {
        this.toast('COULD NOT SAVE THE PHOTO');
        return;
      }
      this.lastSaved = blob.size;
      this.lastName = name;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      this.toast(`SAVED ${name}`);
    }, 'image/png');
  }

  private toast(msg: string): void {
    const t = this.els.toast;
    if (!t) return;
    t.textContent = localize(msg);
    t.classList.add('on');
    this.toastT = 2.4;
  }

  // ---------------------------------------------------------------- drawing

  /** Draw the filtered picture plus frame, stickers and logo into `out` (`s` = output pixels per game pixel). */
  private compose(out: HTMLCanvasElement, s: number, preview: boolean): void {
    const x = out.getContext('2d');
    if (!x || !this.base) return;
    const W = out.width;
    const H = out.height;
    x.imageSmoothingEnabled = false;
    x.drawImage(this.base, 0, 0, W, H);
    // One "UI pixel" in the picture: chunky at every size.
    const u = Math.max(1, Math.round(H / 270));
    this.drawFrame(x, W, H, u);
    for (const st of this.stickers) this.drawSticker(x, st.id, st.u * W, st.v * H, u, 1);
    if (preview && this.sticker !== 'none' && this.pointer.inside && !this.drag) this.drawSticker(x, this.sticker, this.pointer.u * W, this.pointer.v * H, u, 0.55);
    if (this.logo) this.drawLogo(x, W, H, u);
    void s;
  }

  private drawFrame(x: CanvasRenderingContext2D, W: number, H: number, u: number): void {
    const g = this.game;
    switch (this.frameId) {
      case 'snapshot': {
        const side = 8 * u;
        const bottom = 30 * u;
        x.fillStyle = C.white;
        x.fillRect(0, 0, W, side);
        x.fillRect(0, 0, side, H);
        x.fillRect(W - side, 0, side, H);
        x.fillRect(0, H - bottom, W, bottom);
        x.fillStyle = C.mist;
        x.fillRect(side, H - bottom, W - side * 2, u);
        x.fillRect(side - u, side - u, W - side * 2 + 2 * u, u);
        x.fillRect(side - u, side - u, u, H - bottom - side + 2 * u);
        const cap = this.pixelText(`STAGE ${g.stage} - ${g.hero.name.toUpperCase()} - ${g.score.toLocaleString('en-US')} PTS`, 8, C.ink, null);
        x.drawImage(cap, side + 2 * u, H - bottom + 10 * u, cap.width * u, cap.height * u);
        break;
      }
      case 'film': {
        const band = 16 * u;
        x.fillStyle = C.ink;
        x.fillRect(0, 0, W, band);
        x.fillRect(0, H - band, W, band);
        x.fillStyle = C.mist;
        const hole = 6 * u;
        for (let px = 4 * u; px < W; px += 14 * u) {
          x.fillRect(px, 5 * u, hole + 2 * u, hole);
          x.fillRect(px, H - band + 5 * u, hole + 2 * u, hole);
        }
        const lab = this.pixelText(`INFINISHOOT ${String(g.stage).padStart(2, '0')}A`, 8, C.orange, null);
        x.drawImage(lab, W - lab.width * u - 8 * u, 4 * u, lab.width * u, lab.height * u);
        break;
      }
      case 'arcade': {
        const b = 6 * u;
        x.fillStyle = C.ink;
        x.fillRect(0, 0, W, b + u);
        x.fillRect(0, H - b - u, W, b + u);
        x.fillRect(0, 0, b + u, H);
        x.fillRect(W - b - u, 0, b + u, H);
        x.fillStyle = C.blue;
        x.fillRect(u, u, W - 2 * u, b - u);
        x.fillRect(u, H - b, W - 2 * u, b - u);
        x.fillRect(u, u, b - u, H - 2 * u);
        x.fillRect(W - b, u, b - u, H - 2 * u);
        x.fillStyle = C.sky;
        x.fillRect(u, u, W - 2 * u, u);
        x.fillRect(u, u, u, H - 2 * u);
        const top = this.pixelText(`1UP ${String(g.score).padStart(7, '0')}`, 8, C.white, C.ink);
        x.drawImage(top, b + 4 * u, b + 3 * u, top.width * u, top.height * u);
        const st = this.pixelText(`STAGE ${g.stage}`, 8, C.yellow, C.ink);
        x.drawImage(st, W - b - 4 * u - st.width * u, b + 3 * u, st.width * u, st.height * u);
        break;
      }
      case 'comic': {
        const b = 5 * u;
        x.fillStyle = C.ink;
        x.fillRect(0, 0, W, b);
        x.fillRect(0, H - b, W, b);
        x.fillRect(0, 0, b, H);
        x.fillRect(W - b, 0, b, H);
        const t = this.pixelText(`MEANWHILE, ON STAGE ${g.stage}...`, 8, C.ink, null);
        const bw = t.width * u + 10 * u;
        const bh = t.height * u + 8 * u;
        x.fillStyle = C.ink;
        x.fillRect(b, b, bw + 2 * u, bh + 2 * u);
        x.fillStyle = C.yellow;
        x.fillRect(b, b, bw, bh);
        x.drawImage(t, b + 5 * u, b + 4 * u, t.width * u, t.height * u);
        break;
      }
    }
  }

  private drawLogo(x: CanvasRenderingContext2D, W: number, H: number, u: number): void {
    const logo = this.sprite('logo', () => this.makeLogo());
    const s = u;
    const inset = this.frameId === 'snapshot' ? 30 * u : this.frameId === 'film' ? 18 * u : this.frameId === 'arcade' || this.frameId === 'comic' ? 9 * u : 4 * u;
    const lx = W - logo.width * s - (this.frameId === 'none' ? 5 * u : inset);
    const ly = H - logo.height * s - inset;
    x.drawImage(logo, lx, ly, logo.width * s, logo.height * s);
  }

  private drawSticker(x: CanvasRenderingContext2D, id: StickerId, cx: number, cy: number, u: number, alpha: number): void {
    if (id === 'none') return;
    const sp = this.sprite(`st-${id}`, () => this.makeSticker(id));
    const s = u * (WORDS[id as keyof typeof WORDS] ? 3 : 2);
    x.globalAlpha = alpha;
    x.drawImage(sp, Math.round(cx - (sp.width * s) / 2), Math.round(cy - (sp.height * s) / 2), sp.width * s, sp.height * s);
    x.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- pixel sprites

  private sprite(key: string, make: () => HTMLCanvasElement): HTMLCanvasElement {
    let c = this.sprites.get(key);
    if (!c) this.sprites.set(key, (c = make()));
    return c;
  }

  /**
   * Shapes and text are drawn small, then snapped to hard pixels (alpha
   * threshold) and given a 1-pixel ink outline and a drop pixel, like the UI.
   */
  private crisp(src: HTMLCanvasElement, outline: string | null): HTMLCanvasElement {
    const w = src.width;
    const h = src.height;
    const sx = src.getContext('2d')!;
    const img = sx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 3; i < d.length; i += 4) d[i] = d[i] > 110 ? 255 : 0;
    const out = document.createElement('canvas');
    out.width = w + 3;
    out.height = h + 4;
    const ox = out.getContext('2d')!;
    if (outline) {
      // Outline: every empty pixel next to a filled one; drop shadow one pixel lower.
      const o = ox.createImageData(out.width, out.height);
      const set = (x: number, y: number) => {
        if (x < 0 || y < 0 || x >= out.width || y >= out.height) return;
        const k = (y * out.width + x) * 4;
        const c = hex(outline);
        o.data[k] = c[0];
        o.data[k + 1] = c[1];
        o.data[k + 2] = c[2];
        o.data[k + 3] = 255;
      };
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          if (d[(y * w + x) * 4 + 3] === 0) continue;
          for (let dy = -1; dy <= 2; dy++) for (let dx = -1; dx <= 1; dx++) set(x + 1 + dx, y + 1 + dy);
        }
      ox.putImageData(o, 0, 0);
    }
    const t = document.createElement('canvas');
    t.width = w;
    t.height = h;
    t.getContext('2d')!.putImageData(img, 0, 0);
    ox.drawImage(t, 1, 1);
    return out;
  }

  private canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return [c, c.getContext('2d')!];
  }

  /** Small caps text in Silkscreen (an 8-pixel font, so it stays crisp when scaled by whole numbers). */
  private pixelText(text: string, size: number, color: string, outline: string | null): HTMLCanvasElement {
    return this.sprite(`t-${text}-${size}-${color}-${outline}`, () => {
      const font = `${size}px "Silkscreen", monospace`;
      const [m, mx] = this.canvas(4, 4);
      mx.font = font;
      const w = Math.ceil(mx.measureText(text).width) + 2;
      const [c, x] = this.canvas(w, size + 2);
      void m;
      x.font = font;
      x.textBaseline = 'top';
      x.fillStyle = color;
      x.fillText(text, 1, 1);
      return this.crisp(c, outline);
    });
  }

  private makeLogo(): HTMLCanvasElement {
    const text = 'INFINISHOOT';
    const size = 20;
    const font = `${size}px "Jersey 10", "Jersey 15", monospace`;
    const [, mx] = this.canvas(4, 4);
    mx.font = font;
    // Letters one by one with a pixel of air, so the outline never fuses them.
    const widths = [...text].map((ch) => Math.ceil(mx.measureText(ch).width));
    const w = widths.reduce((a, b) => a + b + 1, 0) + 2;
    const [m, x] = this.canvas(w, size + 2);
    x.font = font;
    x.textBaseline = 'top';
    x.fillStyle = C.yellow;
    let px = 1;
    [...text].forEach((ch, i) => {
      x.fillText(ch, px, 1);
      px += widths[i] + 1;
    });
    const img = x.getImageData(0, 0, m.width, m.height);
    for (let i = 3; i < img.data.length; i += 4) img.data[i] = img.data[i] > 110 ? 255 : 0;
    x.putImageData(img, 0, 0);
    // Extrude: the face stamped 3 px deep in red and orange below it, then the yellow face and a white glint row.
    const [c, cx] = this.canvas(w, size + 6);
    const tint = (color: string) => {
      const [t, tx] = this.canvas(m.width, m.height);
      tx.drawImage(m, 0, 0);
      tx.globalCompositeOperation = 'source-in';
      tx.fillStyle = color;
      tx.fillRect(0, 0, t.width, t.height);
      return t;
    };
    cx.drawImage(tint(C.red), 0, 3);
    cx.drawImage(tint(C.orange), 0, 2);
    cx.drawImage(tint(C.orange), 0, 1);
    cx.drawImage(m, 0, 0);
    return this.crisp(c, C.ink);
  }

  private makeSticker(id: StickerId): HTMLCanvasElement {
    const S = 18;
    const [c, x] = this.canvas(S, S);
    const poly = (pts: number[], fill: string) => {
      x.beginPath();
      x.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) x.lineTo(pts[i], pts[i + 1]);
      x.closePath();
      x.fillStyle = fill;
      x.fill();
    };
    const dot = (px: number, py: number, fill: string, w = 1, h = 1) => {
      x.fillStyle = fill;
      x.fillRect(px, py, w, h);
    };
    switch (id) {
      case 'star': {
        const pts: number[] = [];
        for (let i = 0; i < 10; i++) {
          const a = -Math.PI / 2 + (i * Math.PI) / 5;
          const r = i % 2 ? 3.8 : 8.6;
          pts.push(9 + Math.cos(a) * r, 9.5 + Math.sin(a) * r);
        }
        poly(pts, C.yellow);
        dot(7, 6, C.white, 2, 2);
        dot(8, 13, C.orange, 3, 1);
        break;
      }
      case 'heart':
        x.fillStyle = C.red;
        x.beginPath();
        x.arc(5.6, 6.5, 4.2, 0, Math.PI * 2);
        x.arc(12.4, 6.5, 4.2, 0, Math.PI * 2);
        x.fill();
        poly([1.6, 8, 16.4, 8, 9, 16.5], C.red);
        dot(4, 4, C.white, 2, 2);
        dot(10, 12, C.plum, 2, 1);
        break;
      case 'bolt':
        poly([11, 0.5, 3, 10, 8.5, 10, 6, 17.5, 15, 7, 9.5, 7, 12.5, 0.5], C.yellow);
        dot(9, 3, C.white, 1, 2);
        break;
      case 'crown':
        poly([1.5, 5, 5.5, 9, 9, 3, 12.5, 9, 16.5, 5, 15, 14, 3, 14], C.yellow);
        dot(3, 12, C.orange, 12, 2);
        dot(8, 9, C.red, 2, 2);
        dot(4, 11, C.cyan);
        dot(13, 11, C.lime);
        break;
      case 'skull':
        x.fillStyle = C.white;
        x.beginPath();
        x.arc(9, 7.5, 6.6, 0, Math.PI * 2);
        x.fill();
        dot(5, 11, C.white, 8, 5);
        dot(5, 7, C.ink, 3, 3);
        dot(10, 7, C.ink, 3, 3);
        dot(8, 11, C.ink, 2, 1);
        dot(6, 14, C.mist, 1, 2);
        dot(9, 14, C.mist, 1, 2);
        dot(11, 14, C.mist, 1, 2);
        break;
      case 'pow':
      case 'gg':
      case 'wow':
      case 'oneup': {
        const [word, color, burst] = WORDS[id];
        const font = '8px "Silkscreen", monospace';
        const [, mx] = this.canvas(4, 4);
        mx.font = font;
        const tw = Math.ceil(mx.measureText(word).width);
        const W = tw + (burst ? 12 : 4);
        const H = burst ? 18 : 12;
        const [cc, cx] = this.canvas(W, H);
        if (burst) {
          // A spiky comic burst behind the word.
          cx.beginPath();
          for (let i = 0; i < 18; i++) {
            const a = (i / 18) * Math.PI * 2;
            const r = i % 2 ? 0.66 : 1;
            const px = W / 2 + Math.cos(a) * (W / 2 - 0.5) * r;
            const py = H / 2 + Math.sin(a) * (H / 2 - 0.5) * r;
            if (i) cx.lineTo(px, py);
            else cx.moveTo(px, py);
          }
          cx.closePath();
          cx.fillStyle = burst;
          cx.fill();
        }
        cx.font = font;
        cx.textBaseline = 'top';
        const tx = Math.round((W - tw) / 2);
        const ty = Math.round((H - 8) / 2) - 1;
        // Letters with a hard ink drop, then the colour.
        cx.fillStyle = C.ink;
        cx.fillText(word, tx + 1, ty + 1);
        cx.fillStyle = color;
        cx.fillText(word, tx, ty);
        return this.crisp(cc, C.ink);
      }
    }
    return this.crisp(c, C.ink);
  }

  // ---------------------------------------------------------------- DOM

  private build(): void {
    if (typeof document === 'undefined' || !document.body) return;
    // Canvas 2D may be missing (jsdom in the smoke test): photo mode just stays off.
    const probe = document.createElement('canvas');
    let has2d = false;
    try {
      has2d = !!probe.getContext('2d');
    } catch {
      has2d = false;
    }
    if (!has2d) return;
    injectCss();
    const root = document.createElement('div');
    root.id = 'photo';
    root.hidden = true;
    root.innerHTML = localizeHtml(`
      <canvas class="ph-view"></canvas>
      <div class="ph-flash"></div>
      <div class="ph-ui">
        <div class="ph-top">
          <div class="ph-title px">PHOTO MODE</div>
          <div class="ph-help px">
            <div><b>WASD</b> MOVE <b>Q E</b> TURN <b>R F</b> TILT <b>Z X</b> / WHEEL ZOOM <b>SHIFT</b> FAST</div>
            <div><b>DRAG</b> MOVE <b>RIGHT-DRAG</b> TURN + TILT <b>CLICK</b> PLACE STICKER <b>BKSP</b> UNDO <b>C</b> CLEAR <b>0</b> RESET</div>
            <div class="pad"><b>L-STICK</b> MOVE <b>R-STICK</b> TURN + TILT <b>LT RT</b> ZOOM <b>LB RB</b> FILTER <b>X</b> STICKER <b>A</b> SNAP <b>B</b> BACK</div>
          </div>
        </div>
        <div class="ph-toast px"></div>
        <div class="ph-bar">
          <button class="px" data-ph="filter-prev" title="1">&lt;</button>
          <button class="px wide" data-ph="filter"><i>1 2</i>FILTER <b data-v="filter"></b></button>
          <button class="px" data-ph="filter-next" title="2">&gt;</button>
          <button class="px" data-ph="frame"><i>3</i>FRAME <b data-v="frame"></b></button>
          <button class="px" data-ph="sticker"><i>4</i>STICKER <b data-v="sticker"></b></button>
          <button class="px" data-ph="logo"><i>5</i>LOGO <b data-v="logo"></b></button>
          <button class="px" data-ph="hide"><i>H</i>HIDE UI</button>
          <button class="px snap" data-ph="snap"><i>ENTER</i>SNAP!</button>
          <button class="px" data-ph="exit"><i>ESC</i>BACK</button>
        </div>
      </div>
      <div class="ph-hint">H: SHOW UI</div>`);
    document.body.appendChild(root);
    this.root = root;
    this.view = root.querySelector('.ph-view');
    this.base = document.createElement('canvas');
    for (const k of ['flash', 'toast']) this.els[k] = root.querySelector(`.ph-${k}`)!;
    root.querySelectorAll<HTMLElement>('[data-v]').forEach((el) => (this.els[`v-${el.dataset.v}`] = el));
    root.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('button')) e.preventDefault();
    });
    root.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-ph]');
      if (!b) return;
      switch (b.dataset.ph) {
        case 'filter':
        case 'filter-next':
          return this.cycleFilter(1);
        case 'filter-prev':
          return this.cycleFilter(-1);
        case 'frame':
          return this.cycleFrame();
        case 'sticker':
          return this.cycleSticker();
        case 'logo':
          return this.toggleLogo();
        case 'hide':
          return this.toggleUi();
        case 'snap':
          return this.snap();
        case 'exit':
          return this.close();
      }
    });
    const view = this.view!;
    const at = (e: PointerEvent | WheelEvent) => {
      const r = view.getBoundingClientRect();
      this.pointer.u = (e.clientX - r.left) / Math.max(1, r.width);
      this.pointer.v = (e.clientY - r.top) / Math.max(1, r.height);
      this.pointer.inside = true;
    };
    view.addEventListener('contextmenu', (e) => e.preventDefault());
    view.addEventListener('pointerdown', (e) => {
      at(e);
      this.drag = { button: e.button, x: e.clientX, y: e.clientY, moved: 0 };
      view.setPointerCapture?.(e.pointerId);
    });
    view.addEventListener('pointermove', (e) => {
      at(e);
      if (this.sticker !== 'none') this.dirty = true;
      const d = this.drag;
      if (!d) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      d.x = e.clientX;
      d.y = e.clientY;
      d.moved += Math.abs(dx) + Math.abs(dy);
      if (d.moved < 4) return;
      const c = this.cam;
      if (d.button === 0) {
        // Drag the ground: metres per screen pixel at the focus distance.
        const fov = (this.game.cam.camera.fov * Math.PI) / 180;
        const mpp = (2 * c.dist * Math.tan(fov / 2)) / Math.max(1, view.clientHeight);
        const sp = Math.max(0.3, Math.sin((c.pitch * Math.PI) / 180));
        this.panBy(-dx * mpp, (dy * mpp) / sp);
      } else {
        c.yaw += dx * 0.008;
        c.pitch += dy * 0.25;
      }
      clampPhotoCam(c, this.ox, this.oz);
    });
    const end = (e: PointerEvent) => {
      const d = this.drag;
      this.drag = null;
      if (d && d.button === 0 && d.moved < 4 && this.sticker !== 'none') {
        at(e);
        this.place(this.pointer.u, this.pointer.v);
      }
    };
    view.addEventListener('pointerup', end);
    view.addEventListener('pointercancel', () => (this.drag = null));
    view.addEventListener('pointerleave', () => {
      this.pointer.inside = false;
      this.dirty = true;
    });
    // The wheel zooms the photo camera, not the game's.
    root.addEventListener(
      'wheel',
      (e) => {
        e.stopPropagation();
        if (e.deltaY === 0) return;
        this.cam.dist *= 1 + Math.sign(e.deltaY) * 0.1;
        clampPhotoCam(this.cam, this.ox, this.oz);
      },
      { passive: true },
    );
  }

  private refreshUi(): void {
    const set = (k: string, v: string) => {
      const el = this.els[`v-${k}`];
      if (el) el.textContent = localize(v);
    };
    set('filter', PHOTO_FILTERS.find((f) => f.id === this.filter)?.name ?? '');
    set('frame', PHOTO_FRAMES.find((f) => f.id === this.frameId)?.name ?? '');
    set('sticker', STICKER_NAMES[this.sticker]);
    set('logo', this.logo ? 'ON' : 'OFF');
  }

  /** The pause menu's button says when photo mode isn't available. */
  private syncPauseButton(): void {
    const g = this.game;
    if (g.screens.current !== 'pause') return;
    const label = g.role === 'solo' && !g.pvp ? 'PHOTO MODE' : 'PHOTO MODE (SOLO ONLY)';
    if (label === this.pauseLabel) return;
    const b = document.querySelector<HTMLElement>('#scr-pause [data-act="photo"]');
    if (!b) return;
    this.pauseLabel = label;
    b.textContent = localize(label);
    b.classList.toggle('cant', label !== 'PHOTO MODE');
  }
}

function hex(c: string): [number, number, number] {
  const v = parseInt(c.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

let cssDone = false;
function injectCss(): void {
  if (cssDone) return;
  cssDone = true;
  const s = document.createElement('style');
  s.textContent = `
body.photo-mode #hud, body.photo-mode #reticle, body.photo-mode #stats, body.photo-mode #touch { visibility: hidden !important; }
#photo { position: fixed; inset: 0; z-index: 50; color: var(--white); font-family: var(--font); text-shadow: var(--outline); }
#photo[hidden] { display: none; }
#photo .ph-view { position: absolute; inset: 0; width: 100vw; height: 100vh; image-rendering: pixelated; cursor: grab; touch-action: none; }
#photo .ph-view:active { cursor: grabbing; }
#photo .ph-flash { position: absolute; inset: 0; background: var(--white); opacity: 0; pointer-events: none; }
#photo .ph-ui { position: absolute; inset: 0; pointer-events: none; }
#photo.ph-hide .ph-ui { display: none; }
#photo .ph-hint { position: absolute; left: calc(4 * var(--p)); bottom: calc(3 * var(--p)); font: 14px var(--label); opacity: 0.7; display: none; pointer-events: none; }
#photo.ph-hide .ph-hint { display: block; }
#photo .ph-top { position: absolute; left: calc(5 * var(--p)); top: calc(5 * var(--p)); display: flex; flex-direction: column; gap: calc(4 * var(--p)); align-items: flex-start; }
#photo .ph-title { --bg: var(--plum); --hi: var(--red); --lo: var(--ink); font: 34px/1 var(--display); padding: calc(2 * var(--p)) calc(5 * var(--p)) calc(3 * var(--p)); color: var(--yellow); letter-spacing: 1px; }
#photo .ph-help { --bg: var(--ink); --hi: var(--night); --lo: var(--ink); --drop: transparent; font: 12px/1.7 var(--label); padding: calc(2 * var(--p)) calc(4 * var(--p)); text-shadow: none; color: var(--mist); }
#photo .ph-help b { color: var(--yellow); font-weight: normal; }
#photo .ph-toast { --bg: var(--green); --hi: var(--lime); --lo: var(--teal); position: absolute; left: 50%; top: calc(6 * var(--p)); transform: translateX(-50%); font: 22px var(--font); padding: calc(2 * var(--p)) calc(5 * var(--p)); opacity: 0; transition: opacity 0.2s steps(2); white-space: nowrap; }
#photo .ph-toast.on { opacity: 1; }
#photo .ph-bar { position: absolute; left: 0; right: 0; bottom: calc(5 * var(--p)); display: flex; flex-wrap: wrap; justify-content: center; gap: calc(4 * var(--p)); padding: 0 calc(4 * var(--p)); pointer-events: auto; }
#photo .ph-bar button { --bg: var(--blue); --hi: var(--sky); --lo: var(--navy); font: 22px var(--font); color: var(--white); text-shadow: var(--o) 0 0 var(--ink), 0 var(--o) 0 var(--ink), var(--o) var(--o) 0 var(--ink); padding: calc(2 * var(--p)) calc(4 * var(--p)) calc(3 * var(--p)); cursor: pointer; position: relative; }
#photo .ph-bar button:hover { --bg: var(--orange); --hi: var(--yellow); --lo: var(--red); --ring: var(--white); }
#photo .ph-bar button:active { transform: translateY(var(--p)); }
#photo .ph-bar button b { color: var(--yellow); font-weight: normal; }
#photo .ph-bar button.snap { --bg: var(--red); --hi: var(--orange); --lo: var(--plum); color: var(--yellow); }
#photo .ph-bar button i { position: absolute; top: calc(-3 * var(--p)); left: calc(-1 * var(--p)); font: 9px/1 var(--label); font-style: normal; background: var(--ink); color: var(--mist); padding: 2px 3px; text-shadow: none; }
#scr-pause [data-act="photo"].cant { opacity: 0.6; }
`;
  document.head.appendChild(s);
}
