import { noiseTuning, type NoiseGovernor } from '../render/noiseGovernor';
import * as THREE from 'three';
import { reduceMotion } from './hud';
import { settings } from '../game/settings';

export type DamageNumberKind = 'hit' | 'crit' | 'player' | 'heal' | 'score' | 'fire' | 'shock' | 'frost' | 'shield';
export type DamageAccent = 'fire' | 'shock' | 'frost' | 'shield';
export const damageNumberTuning = { pool: 48, life: 0.8, mergeWindow: 0.14, mergeRadius: 0.35, maxScale: 1.65 };

/** Human-readable labels fit the existing string-valued effects bus, including older clients. */
export function damageNumberLabel(value: number, accent?: DamageAccent): number | string {
  return accent ? `${value} ${accent.toUpperCase()}` : value;
}

export function damageNumberKind(value: number | string, kind: DamageNumberKind): DamageNumberKind {
  if (typeof value !== 'string') return kind;
  if (value === 'SHIELD BROKEN!' || value.endsWith(' SHIELD')) return 'shield';
  if (kind !== 'hit') return kind;
  if (value.endsWith(' FIRE')) return 'fire';
  if (value.endsWith(' SHOCK')) return 'shock';
  if (value.endsWith(' FROST')) return 'frost';
  return kind;
}

const NUMERIC_LABEL = /^[+-]?\d+(?:\.\d+)?(?:!| FIRE| SHOCK| FROST| SHIELD)?$/;

/** Only numeric hits can merge; messages such as “25 COMBO!” must stay messages. */
export function damageNumberValue(value: number | string): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  return NUMERIC_LABEL.test(value) ? parseFloat(value) : NaN;
}

export function damageNumberScale(value: number): number {
  return Number.isFinite(value) ? Math.min(damageNumberTuning.maxScale, 1 + Math.log2(1 + Math.max(0, value) / 25) * 0.16) : 1;
}

export type DamageNumberMode = 'auto' | 'all' | 'mine' | 'off';

/**
 * SETTINGS > DAMAGE NUMBERS. `by` is the hero index that dealt the hit
 * (undefined for messages, heals, hits on heroes and events from older hosts,
 * which always show). MINE keeps only the local hero's hits.
 */
export function showDamageNumber(mode: DamageNumberMode, by: number | undefined, me: number): boolean {
  if (by === undefined || by < 0) return true;
  if (mode === 'off') return false;
  return mode !== 'mine' || by === me;
}

interface Num {
  el: HTMLDivElement;
  x: number;
  y: number;
  z: number;
  t: number;
  pop: number;
  drift: number;
  value: number;
  scale: number;
  kind: DamageNumberKind;
  active: boolean;
}

/** Fixed DOM pool. Merge only matching kinds near the original hit, never extend a number's lifetime. */
export class DamageNumbers {
  noise?: NoiseGovernor;
  private pool: Num[] = [];
  private next = 0;
  private v = new THREE.Vector3();
  /** Index of this machine's hero (MINE filter); Game sets it. */
  localHero: () => number = () => 0;

  constructor(parent: HTMLElement) {
    for (let i = 0; i < damageNumberTuning.pool; i++) {
      const el = document.createElement('div');
      el.className = 'dmg';
      el.style.display = 'none';
      el.setAttribute('aria-hidden', 'true');
      parent.appendChild(el);
      this.pool.push({ el, x: 0, y: 0, z: 0, t: 0, pop: 0, drift: 0, value: NaN, scale: 1, kind: 'hit', active: false });
    }
  }

  spawn(x: number, y: number, z: number, value: number | string, kind: DamageNumberKind = 'hit', by?: number): void {
    if (!showDamageNumber(settings.damageNumbers, by, this.localHero())) return;
    kind = damageNumberKind(value, kind);
    const amount = damageNumberValue(value);
    const automatic = settings.damageNumbers === 'auto' && !!this.noise?.active;
    const pressure = automatic ? this.noise!.pressure : 0;
    const combat = Number.isFinite(amount) && kind !== 'score' && kind !== 'player' && kind !== 'heal';
    // Keep labels/heals/player damage; AUTO filters hit spam relative to this build's recent damage.
    const big = combat && automatic ? this.noise!.bigHit(amount, kind === 'crit') : true;
    if (combat && automatic && pressure >= noiseTuning.numberDensity && !big) return;
    let n: Num | undefined;
    let distance = (damageNumberTuning.mergeRadius + (noiseTuning.clusterRadius - damageNumberTuning.mergeRadius) * pressure) ** 2;
    const window = damageNumberTuning.mergeWindow + (noiseTuning.clusterWindow - damageNumberTuning.mergeWindow) * pressure;
    if (Number.isFinite(amount) && kind !== 'score' && kind !== 'player') {
      for (const candidate of this.pool) {
        if (!candidate.active || candidate.kind !== kind || candidate.t > window || !Number.isFinite(candidate.value)) continue;
        const d = (candidate.x - x) ** 2 + (candidate.z - z) ** 2;
        if (d <= distance && Math.abs(candidate.y - y) < 0.25) {
          n = candidate;
          distance = d;
        }
      }
    }
    if (n) {
      n.value += amount;
      n.pop = 0;
    } else {
      if (combat && automatic && !this.noise!.take('numbers')) return;
      // Prefer a free slot before evicting the next (oldest) slot at capacity.
      for (let i = 0; i < this.pool.length; i++) {
        const index = (this.next + i) % this.pool.length;
        if (!this.pool[index].active) { this.next = index; break; }
      }
      n = this.pool[this.next];
      this.next = (this.next + 1) % this.pool.length;
      n.x = x;
      n.y = y;
      n.z = z;
      n.t = n.pop = 0;
      n.drift = (this.next % 2 ? -1 : 1) * (16 + this.next % 4 * 4);
      n.value = amount;
      n.kind = kind;
      n.active = true;
      n.el.className = `dmg dmg-${kind}`;
      n.el.style.display = '';
    }
    n.scale = damageNumberScale(n.value);
    const number = Math.round(n.value);
    n.el.textContent = Number.isFinite(n.value)
      ? kind === 'crit' ? `${number}!` : kind === 'heal' ? `+${number}` : String(number)
      : String(value);
  }

  clear(): void {
    for (const n of this.pool) {
      n.active = false;
      n.el.style.display = 'none';
    }
    this.next = 0;
  }

  render(frameDt: number, camera: THREE.Camera): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const still = reduceMotion();
    for (const n of this.pool) {
      if (!n.active) continue;
      n.t += frameDt;
      n.pop += frameDt;
      if (n.t >= damageNumberTuning.life) {
        n.active = false;
        n.el.style.display = 'none';
        continue;
      }
      const k = n.t / damageNumberTuning.life;
      this.v.set(n.x, n.y, n.z).project(camera);
      const visible = this.v.z >= -1 && this.v.z <= 1;
      const sx = ((this.v.x + 1) / 2) * w + (still ? 0 : n.drift * k);
      const arc = still ? k * 6 : 64 * k - 28 * k * k + (n.kind === 'crit' ? Math.abs(Math.sin(k * Math.PI * 2)) * 9 : 0);
      const sy = ((1 - this.v.y) / 2) * h - arc;
      const p = Math.min(1, n.pop / 0.22);
      const pop = still ? 1 : p < 0.35 ? 0.75 + p * 1.9 : 1 + (1 - p) * 0.65;
      n.el.style.transform = `translate(${Math.round(sx)}px, ${Math.round(sy)}px) translate(-50%, -50%) scale(${pop * n.scale})`;
      n.el.style.opacity = visible ? String(k > 0.65 ? (1 - k) / 0.35 : 1) : '0';
    }
  }
}
