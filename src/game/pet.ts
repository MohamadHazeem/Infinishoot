import { Pets2State, Pet2Model, isPets2 } from './pets2';
import * as THREE from 'three';
import { createRetroMaterial } from '../render/retroMaterial';
import { PET_BY_ID, PET_MAX_LEVEL, petRanks, petSkillAt, petTuning, type PetDef, type PetSkillId } from '../data/pets';

/**
 * A hero's pet in the run: level, learned skills and their timers. The host
 * simulates it (src/game/systems/companion.ts); clients mirror it from the
 * snapshot (`net()` / `setNet()`). Reset at the start of every run.
 */
export class PetState {
  readonly extra = new Pets2State();
  def: PetDef = PET_BY_ID.none;
  level = 1;
  ranks: Record<PetSkillId, number> = petRanks(PET_BY_ID.none, 1);
  /** The shield is up (once per stage). */
  shieldReady = false;
  /** The once-per-run revive has been spent. */
  reviveUsed = false;
  zapT = 1.5;
  fetchT = 2;
  tauntCd = 5;
  /** Taunting: seconds left, and where the decoy hovers. */
  tauntT = 0;
  tauntX = 0;
  tauntZ = 0;
  /** Cosmetic counters (synced, wrap at 256): every machine plays a zap / fetch when they change. */
  zaps = 0;
  fetches = 0;
  /** Where the last zap landed. */
  zapX = 0;
  zapZ = 0;

  get has(): boolean {
    return this.def.id !== 'none';
  }
  get maxLevel(): number {
    return Math.min(PET_MAX_LEVEL, this.def.tree.length);
  }
  get reviveReady(): boolean {
    return this.ranks.revive > 0 && !this.reviveUsed;
  }
  /** Extra magnet (pickup range) from Fetch. */
  get magnetBonus(): number {
    return this.ranks.fetch * petTuning.fetchMagnet;
  }

  setDef(def: PetDef): void {
    this.def = def;
    this.reset();
  }

  reset(): void {
    this.extra.reset();
    this.level = 1;
    this.ranks = petRanks(this.def, 1);
    this.shieldReady = this.ranks.shield > 0;
    this.reviveUsed = false;
    this.zapT = 1.5;
    this.fetchT = 2;
    this.tauntCd = 5;
    this.tauntT = 0;
  }

  /** One level up (stage clear). Returns the skill learned, or null at the cap / without a pet. */
  levelUp(): PetSkillId | null {
    if (!this.has || this.level >= this.maxLevel) return null;
    this.level++;
    this.ranks = petRanks(this.def, this.level);
    const s = petSkillAt(this.def, this.level);
    if (s === 'shield') this.shieldReady = true;
    return s;
  }

  /** New stage: the shield comes back. */
  stageRefresh(): void {
    this.extra.reset();
    this.shieldReady = this.ranks.shield > 0;
    this.tauntT = 0;
  }

  /** Snapshot record: [level, flags, tauntX, tauntZ, zaps, fetches, zapX, zapZ]. */
  net(): number[] {
    const r1 = (v: number) => Math.round(v * 10) / 10;
    const flags = (this.shieldReady ? 1 : 0) | (this.reviveUsed ? 2 : 0) | (this.tauntT > 0 ? 4 : 0);
    return [this.level, flags, r1(this.tauntX), r1(this.tauntZ), this.zaps & 255, this.fetches & 255, r1(this.zapX), r1(this.zapZ)];
  }

  setNet(a: number[]): void {
    const [level, flags, tx, tz, zaps, fetches, zx, zz] = a;
    if (level !== this.level) {
      this.level = level;
      this.ranks = petRanks(this.def, level);
    }
    this.shieldReady = (flags & 1) !== 0;
    this.reviveUsed = (flags & 2) !== 0;
    this.tauntT = flags & 4 ? 1 : 0;
    this.tauntX = tx;
    this.tauntZ = tz;
    this.zaps = zaps;
    this.fetches = fetches;
    this.zapX = zx;
    this.zapZ = zz;
  }
}

const GOLD = '#ffcd75';

/**
 * A pet's body: a round little bot with big eyes and flapping fins that
 * trails its hero on a soft spring and bobs. Presentation only. It grows
 * with its level (size, a tail fin, an orbit ring, a crown, a glow), wears a
 * golden halo while its revive is ready and an orbiting blue gem while its
 * shield is up, and flies out to its decoy spot while taunting.
 */
export class PetView {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private custom: Pet2Model | null = null;
  private finL: THREE.Mesh;
  private finR: THREE.Mesh;
  private tail: THREE.Mesh;
  private ring: THREE.Mesh;
  private crown: THREE.Group;
  private halo: THREE.Mesh;
  private gem: THREE.Mesh;
  private x = 0;
  private z = 0;
  private placed = false;
  private t = Math.random() * 10;
  private zapT = 0;
  private popT = 0;
  private shownLevel = 1;
  private bodyMat;
  private color = new THREE.Color();

  constructor(
    private scene: THREE.Scene,
    def: PetDef,
    private state: PetState,
  ) {
    this.color.set(def.color);
    this.bodyMat = createRetroMaterial({ color: def.color, unlit: 0.35 });
    const dark = createRetroMaterial({ color: '#1a1c2c', unlit: 0.6 });
    const white = createRetroMaterial({ color: '#f4f4f4', unlit: 0.8 });
    const gold = createRetroMaterial({ color: GOLD, unlit: 1 });
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.26, 8, 6), this.bodyMat);
    this.body.add(shell);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.04), white);
      eye.position.set(0.09 * s, 0.04, 0.24);
      const pupil = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.07, 0.02), dark);
      pupil.position.set(0.09 * s, 0.03, 0.265);
      this.body.add(eye, pupil);
    }
    const fin = () => new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 0.14), this.bodyMat);
    this.finL = fin();
    this.finR = fin();
    this.finL.position.set(-0.28, 0.06, 0);
    this.finR.position.set(0.28, 0.06, 0);
    this.body.add(this.finL, this.finR);
    // Level 2: a tail fin.
    this.tail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.16, 0.2), this.bodyMat);
    this.tail.position.set(0, 0.1, -0.3);
    this.body.add(this.tail);
    // Level 3: a spinning ring around the body.
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.025, 4, 14), createRetroMaterial({ color: def.color, unlit: 1 }));
    this.ring.rotation.x = Math.PI / 2;
    this.body.add(this.ring);
    // Level 4: a little crown.
    this.crown = new THREE.Group();
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.06, 6, 1, true), gold);
    this.crown.add(band);
    for (let i = 0; i < 3; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.09, 4), gold);
      const a = (i / 3) * Math.PI * 2;
      spike.position.set(Math.sin(a) * 0.1, 0.07, Math.cos(a) * 0.1);
      this.crown.add(spike);
    }
    this.crown.position.y = 0.27;
    this.body.add(this.crown);
    // Revive ready: a golden halo.
    this.halo = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.03, 4, 12), gold);
    this.halo.rotation.x = Math.PI / 2;
    this.halo.position.y = 0.42;
    this.body.add(this.halo);
    // Shield up: a blue gem orbiting the pet.
    this.gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.07, 0), createRetroMaterial({ color: '#41a6f6', unlit: 1 }));
    this.root.add(this.gem);
    if (def.id === 'sparky') {
      const ant = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.22, 0.03), dark);
      ant.position.y = 0.34;
      const tip = new THREE.Mesh(new THREE.OctahedronGeometry(0.06, 0), createRetroMaterial({ color: '#fff35c', unlit: 1 }));
      tip.position.y = 0.47;
      this.body.add(ant, tip);
    }
    if (isPets2(def.id)) {
      // Keep the first child Group as the hat socket used by meta2.
      for (const child of this.body.children) child.visible = false;
      this.custom = new Pet2Model(def.id, def.color, this.body, this.root, scene);
    }
    this.root.add(this.body);
    scene.add(this.root);
    this.shownLevel = state.level;
  }

  /** Flash for a zap. */
  zap(): void {
    this.zapT = 0.15;
  }

  /** Follow a point behind-left of the hero (or the decoy spot while taunting). */
  render(dt: number, hx: number, hz: number, facing: number, visible: boolean, still = false): void {
    this.root.visible = visible;
    if (!visible) {
      this.placed = false;
      this.custom?.hide();
      return;
    }
    const st = this.state;
    this.t += dt;
    const taunting = st.tauntT > 0;
    const tx = taunting ? st.tauntX : hx - Math.sin(facing + 0.9) * 1.1;
    const tz = taunting ? st.tauntZ : hz - Math.cos(facing + 0.9) * 1.1;
    const k = 1 - Math.exp(-dt * (taunting ? 9 : 5));
    if (!this.placed || Math.hypot(tx - this.x, tz - this.z) > 14) {
      this.x = tx;
      this.z = tz;
      this.placed = true;
    }
    this.x += (tx - this.x) * k;
    this.z += (tz - this.z) * k;

    // Growth and the level-up pop.
    if (st.level > this.shownLevel) this.popT = 0.7;
    this.shownLevel = st.level;
    this.popT = Math.max(0, this.popT - dt);
    const lv = st.level;
    const pop = !still && this.popT > 0 ? Math.sin((this.popT / 0.7) * Math.PI) * 0.6 : 0;
    const s = 1 + petTuning.growPerLevel * (lv - 1) + pop;
    this.body.scale.setScalar(s);
    this.body.rotation.y = !still && this.popT > 0 ? (1 - this.popT / 0.7) * Math.PI * 4 : 0;
    this.tail.visible = !this.custom && lv >= 2;
    this.ring.visible = !this.custom && lv >= 3;
    this.ring.rotation.z = this.t * 2.5;
    this.crown.visible = !this.custom && lv >= 4 && !this.body.getObjectByName('m2hat');
    this.halo.visible = st.reviveReady;
    this.gem.visible = st.shieldReady;
    const ga = still ? 0 : this.t * 3.2;
    this.gem.position.set(Math.cos(ga) * 0.55 * s, 0.15 + (still ? 0 : Math.sin(this.t * 5) * 0.06), Math.sin(ga) * 0.55 * s);
    this.gem.rotation.y = this.t * 4;

    const bob = still ? 0 : taunting ? Math.abs(Math.sin(this.t * 9)) * 0.3 : Math.sin(this.t * 3) * 0.12;
    this.root.position.set(this.x, 1.5 + (lv - 1) * 0.06 + bob, this.z);
    this.root.rotation.y = taunting && !still ? this.t * 6 : Math.atan2(hx - this.x, hz - this.z);
    const flap = still ? 0 : Math.sin(this.t * (taunting ? 30 : 18)) * 0.5;
    this.finL.rotation.z = flap;
    this.finR.rotation.z = -flap;
    this.zapT = Math.max(0, this.zapT - dt);
    const f = this.bodyMat.uniforms.uFlash.value;
    if (still) f.set(1, 1, 1, 0);
    else if (this.zapT > 0) f.set(1, 1, 0.6, 0.8);
    else if (taunting) f.set(1, 0.3, 0.3, Math.sin(this.t * 14) > 0 ? 0.55 : 0);
    else if (this.popT > 0) f.set(1, 1, 1, 0.6 * (this.popT / 0.7));
    else if (lv >= PET_MAX_LEVEL) f.set(this.color.r, this.color.g, this.color.b, 0.25 + 0.2 * Math.sin(this.t * 4));
    else f.set(1, 1, 1, 0);
    this.custom?.render(st, this.t, still);
  }

  dispose(): void {
    this.custom?.dispose();
    this.scene.remove(this.root);
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }
}
