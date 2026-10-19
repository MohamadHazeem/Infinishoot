import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRetroMaterial, type RetroMaterial } from '../render/retroMaterial';
import type { SkinDef } from '../data/skins';
import { deathFall, toLocal, wrapAngle } from './animMath';

/**
 * Chunky armoured adventurer: layered plates, painted anime eyes and a
 * readable three-head silhouette. Static parts merge by joint/material,
 * preserving skin uniforms, procedural animation and the outline budget. Faces +Z.
 */
const PALETTE = {
  armor: '#2f7bff',
  armorDark: '#1f4fc4',
  accent: '#ffd23f',
  skin: '#ffd7b0',
  suit: '#2b2f4a',
  red: '#ff3d5a',
  hair: '#5a3a22',
};

export type Expression = 'normal' | 'blink' | 'hurt' | 'focus' | 'happy' | 'ko';

export interface HeroRig {
  /** Named materials so a skin can recolour the rig in place. */
  mats: { armor: RetroMaterial; armorDark: RetroMaterial; accent: RetroMaterial; suit: RetroMaterial; red: RetroMaterial; hair: RetroMaterial; face: RetroMaterial };
  /** Current face (swap with setExpression). */
  expression: Expression;
  iris: string;
  root: THREE.Group;
  body: THREE.Group; // bobs / leans
  legL: THREE.Group;
  legR: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  head: THREE.Group;
  materials: RetroMaterial[];
  /** Animation state (presentation only, see animateHero). */
  anim: HeroAnimState;
}

/** `armorColor` tints the suit so co-op players are easy to tell apart; `skin` paints the rest. */
export function createHero(armorColor: string = PALETTE.armor, skin?: SkinDef): HeroRig {
  const materials: RetroMaterial[] = [];
  const mat = (color: string, extra: Parameters<typeof createRetroMaterial>[0] = {}) => {
    const m = createRetroMaterial({ color, ...extra });
    materials.push(m);
    return m;
  };
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => {
    const o = new THREE.Mesh(g, m);
    o.position.set(x, y, z);
    return o;
  };

  const armor = mat(armorColor);
  const armorDark = mat(darker(armorColor));
  const accent = mat(skin?.accent ?? PALETTE.accent);
  const skinMat = mat(PALETTE.skin);
  const suit = mat(skin?.suit ?? PALETTE.suit);
  const red = mat(skin?.gem ?? PALETTE.red);
  const hair = mat(skin?.hair ?? PALETTE.hair);
  const iris = skin?.iris ?? '#2a9d4b';
  const face = mat('#ffffff', { map: faceTexture('normal', iris), alphaTest: 0.5 });

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  // --- Legs (pivot at hip) ---
  const makeLeg = (side: number) => {
    const leg = new THREE.Group();
    leg.position.set(0.2 * side, 0.62, 0);
    leg.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.36, 6), suit, 0, -0.18, 0));
    // Layered shin guard, bevelled toe and heel. The sole stays planted at y=0.
    leg.add(mesh(new THREE.CylinderGeometry(0.13, 0.17, 0.22, 6), armor, 0, -0.28, 0));
    leg.add(mesh(new THREE.BoxGeometry(0.23, 0.11, 0.07), accent, 0, -0.25, 0.14));
    leg.add(mesh(new THREE.BoxGeometry(0.26, 0.1, 0.12), armorDark, 0, -0.49, -0.2));
    // Big boot
    leg.add(mesh(new THREE.CylinderGeometry(0.2, 0.23, 0.26, 6).scale(0.9, 1, 1.3), armor, 0, -0.46, 0.07));
    leg.add(mesh(new THREE.BoxGeometry(0.36, 0.08, 0.52), accent, 0, -0.58, 0.06));
    leg.add(mesh(new THREE.BoxGeometry(0.3, 0.12, 0.2), armorDark, 0, -0.3, 0.02));
    return leg;
  };
  const legL = makeLeg(-1);
  const legR = makeLeg(1);
  body.add(legL, legR);

  // --- Torso ---
  body.add(mesh(new THREE.BoxGeometry(0.42, 0.18, 0.3), suit, 0, 0.7, 0)); // hips
  body.add(mesh(new THREE.BoxGeometry(0.56, 0.42, 0.38), armor, 0, 0.98, 0));
  body.add(mesh(new THREE.BoxGeometry(0.3, 0.22, 0.06), accent, 0, 1.0, 0.2)); // chest plate
  body.add(mesh(new THREE.BoxGeometry(0.1, 0.08, 0.04), red, 0, 1.0, 0.24)); // gem

  // Floating breastplate over a darker undershell, waist clasp and back vents.
  body.add(mesh(new THREE.BoxGeometry(0.5, 0.1, 0.42), suit, 0, 0.8, 0));
  body.add(mesh(new THREE.BoxGeometry(0.46, 0.1, 0.1), suit, 0, 1.15, 0.2));
  for (const side of [-1, 1]) {
    body.add(mesh(new THREE.BoxGeometry(0.12, 0.2, 0.1).rotateZ(side * 0.18), armor, side * 0.24, 0.9, 0.18));
    body.add(mesh(new THREE.BoxGeometry(0.08, 0.22, 0.06), suit, side * 0.13, 0.98, -0.21));
  }
  body.add(mesh(new THREE.BoxGeometry(0.13, 0.1, 0.06), accent, 0, 0.73, 0.18));

  // --- Arms (pivot at shoulder) ---
  const makeArm = (side: number, cannon: boolean) => {
    const arm = new THREE.Group();
    arm.position.set(0.38 * side, 1.12, 0);
    arm.add(mesh(new THREE.SphereGeometry(0.19, 6, 4).scale(1, 0.8, 1), armor, 0, 0, 0));
    arm.add(mesh(new THREE.BoxGeometry(0.25, 0.06, 0.24), armorDark, 0, -0.11, 0));
    arm.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.3, 6), suit, 0.02 * side, -0.22, 0));
    if (cannon) {
      // Arm buster along the forearm (-Y); the arm is raised forward when aiming
      arm.add(mesh(new THREE.CylinderGeometry(0.17, 0.15, 0.52, 8), armor, 0.04 * side, -0.42, 0));
      arm.add(mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 8), accent, 0.04 * side, -0.64, 0));
      arm.add(mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.04, 8), suit, 0.04 * side, -0.69, 0));
      arm.add(mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.042, 6), accent, 0.04 * side, -0.7, 0));
      arm.add(mesh(new THREE.BoxGeometry(0.06, 0.2, 0.05), accent, 0.04 * side, -0.4, 0.16));
    } else {
      arm.add(mesh(new THREE.BoxGeometry(0.22, 0.23, 0.25), armor, 0.03 * side, -0.42, 0.02));
      arm.add(mesh(new THREE.BoxGeometry(0.24, 0.08, 0.24), accent, 0.03 * side, -0.3, 0.02));
      arm.add(mesh(new THREE.BoxGeometry(0.09, 0.13, 0.14), armor, -0.09 * side, -0.41, 0.12));
      arm.add(mesh(new THREE.BoxGeometry(0.18, 0.055, 0.04), suit, 0.03 * side, -0.46, 0.16));
    }
    return arm;
  };
  const armL = makeArm(-1, false);
  const armR = makeArm(1, true);
  body.add(armL, armR);

  // --- Head (big!) ---
  const head = new THREE.Group();
  head.position.set(0, 1.5, 0);
  body.add(head);
  head.add(mesh(new THREE.SphereGeometry(0.36, 10, 8), skinMat));
  // Hair tuft poking out the front
  head.add(mesh(new THREE.BoxGeometry(0.5, 0.1, 0.12), hair, 0, 0.2, 0.27));
  // Helmet: upper hemisphere shell, slightly bigger than head
  const helmet = mesh(
    new THREE.SphereGeometry(0.41, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.42),
    armor,
    0,
    0.04,
    -0.02,
  );
  helmet.rotation.x = -0.25;
  head.add(helmet);
  // Back of helmet
  head.add(mesh(new THREE.SphereGeometry(0.38, 8, 6), armorDark, 0, 0.02, -0.08));
  // Ear pieces
  for (const s of [-1, 1]) {
    const ear = mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.12, 8), accent, 0.37 * s, 0, 0);
    ear.rotation.z = Math.PI / 2;
    head.add(ear);
    const fin = mesh(new THREE.BoxGeometry(0.04, 0.22, 0.14), red, 0.44 * s, 0.1, -0.02);
    head.add(fin);
  }
  // Raised brow rim and cheek guards frame the expression without covering the eyes.
  head.add(mesh(new THREE.BoxGeometry(0.53, 0.055, 0.1), armorDark, 0, 0.205, 0.31));
  head.add(mesh(new THREE.BoxGeometry(0.13, 0.18, 0.07), accent, 0, 0.33, 0.23));
  for (const side of [-1, 1])
    head.add(mesh(new THREE.BoxGeometry(0.075, 0.2, 0.12).rotateZ(side * -0.18), armor, side * 0.29, -0.15, 0.24));
  // Painted face decal
  const facePlane = mesh(new THREE.PlaneGeometry(0.52, 0.52), face, 0, -0.04, 0.345);
  head.add(facePlane);

  for (const joint of [body, head, armL, armR, legL, legR]) mergeJoint(joint);
  root.traverse((o) => {
    o.castShadow = false;
    o.receiveShadow = false;
  });

  return { mats: { armor, armorDark, accent, suit, red, hair, face }, expression: 'normal', iris, root, body, legL, legR, armL, armR, head, materials, anim: newAnimState() };
}

/** Merge only direct mesh children: animation pivots and skin material identities stay intact. */
function mergeJoint(joint: THREE.Group): void {
  const buckets = new Map<THREE.Material, THREE.Mesh[]>();
  for (const child of joint.children) {
    if (!(child instanceof THREE.Mesh) || Array.isArray(child.material)) continue;
    const list = buckets.get(child.material) ?? [];
    list.push(child);
    buckets.set(child.material, list);
  }
  for (const [material, parts] of buckets) {
    if (parts.length < 2) continue;
    const geometries = parts.map((p) => {
      p.updateMatrix();
      const g = (p.geometry.index ? p.geometry.toNonIndexed() : p.geometry.clone()).applyMatrix4(p.matrix);
      joint.remove(p);
      p.geometry.dispose();
      return g;
    });
    const merged = mergeGeometries(geometries)!;
    const geometry = mergeVertices(merged);
    merged.dispose();
    for (const g of geometries) g.dispose();
    joint.add(new THREE.Mesh(geometry, material));
  }
}

const silhouettes = new WeakMap<HeroRig, { id: string; parts: THREE.Mesh[] }>();

/** Hero identity is independent of the wardrobe. Called on every machine when the hero changes. */
export function setHeroModel(rig: HeroRig, id: string): void {
  const old = silhouettes.get(rig);
  if (old?.id === id) return;
  for (const m of old?.parts ?? []) { m.removeFromParent(); m.geometry.dispose(); }
  // Restore the base palette after switching away from Twin.
  for (const joint of [rig.legL, rig.legR, rig.armL]) joint.traverse((o) => {
    if (o instanceof THREE.Mesh && o.userData.baseMaterial) o.material = o.userData.baseMaterial;
  });
  const body = new THREE.Group(), head = new THREE.Group();
  const m = rig.mats;
  const put = (parent: THREE.Group, g: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(g, mat); mesh.position.set(x, y, z); parent.add(mesh);
  };
  const box = (parent: THREE.Group, mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number) =>
    put(parent, new THREE.BoxGeometry(w, h, d), mat, x, y, z);
  switch (id) {
    case 'bulwark':
      for (const side of [-1, 1]) {
        box(body, m.armor, 0.34, 0.26, 0.5, side * 0.43, 1.18, 0);
        box(body, m.accent, 0.36, 0.07, 0.52, side * 0.43, 1.31, 0);
        box(head, m.armorDark, 0.15, 0.3, 0.28, side * 0.34, -0.12, 0.12);
      }
      box(body, m.armorDark, 0.52, 0.3, 0.1, 0, 0.99, 0.27);
      box(body, m.accent, 0.35, 0.08, 0.12, 0, 1.08, 0.28);
      break;
    case 'dash':
      box(body, m.red, 0.55, 0.12, 0.42, 0, 1.25, 0);
      put(body, new THREE.BoxGeometry(0.2, 0.07, 0.84).rotateX(-0.3).rotateY(-0.3), m.red, -0.13, 1.08, -0.58);
      put(body, new THREE.BoxGeometry(0.16, 0.07, 0.6).rotateX(-0.5).rotateY(0.25), m.accent, 0.1, 1.08, -0.5);
      for (const side of [-1, 1]) put(head, new THREE.ConeGeometry(0.09, 0.4, 4).rotateX(-0.65), m.armor, side * 0.36, 0.2, -0.16);
      break;
    case 'ace':
      put(head, new THREE.CylinderGeometry(0.025, 0.04, 0.45, 5).rotateZ(-0.25), m.accent, 0.25, 0.56, -0.05);
      put(head, new THREE.OctahedronGeometry(0.09), m.red, 0.3, 0.8, -0.05);
      box(head, m.armorDark, 0.22, 0.14, 0.12, -0.26, 0, 0.32);
      box(head, m.accent, 0.13, 0.07, 0.13, -0.26, 0, 0.34);
      box(body, m.armorDark, 0.38, 0.34, 0.2, 0, 1, -0.26);
      break;
    case 'duelist':
      // The existing plume/scarf remains; this broad, split cape makes the back view distinct.
      for (const side of [-1, 1]) {
        put(body, new THREE.BoxGeometry(0.31, 0.8, 0.07).rotateX(0.32).rotateZ(side * 0.1), m.red, side * 0.16, 0.84, -0.37);
        put(body, new THREE.BoxGeometry(0.3, 0.08, 0.075).rotateX(0.32), m.accent, side * 0.2, 0.47, -0.49);
      }
      break;
    case 'furnace':
      box(body, m.armorDark, 0.62, 0.57, 0.38, 0, 0.98, -0.35);
      box(body, m.red, 0.4, 0.29, 0.05, 0, 0.97, -0.56);
      for (const side of [-1, 1]) box(body, m.accent, 0.055, 0.34, 0.07, side * 0.12, 0.97, -0.58);
      box(body, m.accent, 0.66, 0.07, 0.4, 0, 0.72, -0.35);
      break;
    case 'twin':
      // Split armour is mirrored across the chest and carried through to opposing limbs.
      for (const joint of [rig.legL, rig.armL]) joint.traverse((o) => {
        if (o instanceof THREE.Mesh && o.material === m.armor) { o.userData.baseMaterial = o.material; o.material = m.accent; }
      });
      box(body, m.accent, 0.25, 0.33, 0.06, -0.135, 1, 0.24);
      box(body, m.armorDark, 0.25, 0.33, 0.06, 0.135, 1, 0.24);
      box(head, m.accent, 0.1, 0.2, 0.08, -0.12, 0.32, 0.24);
      break;
  }
  mergeJoint(body); mergeJoint(head);
  const parts = [...body.children, ...head.children] as THREE.Mesh[];
  for (const child of [...body.children]) rig.body.add(child);
  for (const child of [...head.children]) rig.head.add(child);
  silhouettes.set(rig, { id, parts });
  rig.root.userData.modelRevision = (rig.root.userData.modelRevision ?? 0) + 1;
}

function darker(c: string): string {
  return '#' + new THREE.Color(c).multiplyScalar(0.68).getHexString();
}

/** Recolour a rig in place (wardrobe preview, joining players). */
export function applySkin(rig: HeroRig, armorColor: string, skin: SkinDef): void {
  rig.mats.armor.uniforms.uColor.value.set(armorColor);
  rig.mats.armorDark.uniforms.uColor.value.set(darker(armorColor));
  rig.mats.accent.uniforms.uColor.value.set(skin.accent);
  rig.mats.suit.uniforms.uColor.value.set(skin.suit);
  rig.mats.red.uniforms.uColor.value.set(skin.gem);
  rig.mats.hair.uniforms.uColor.value.set(skin.hair);
  rig.iris = skin.iris;
  setExpression(rig, rig.expression, true);
}

export function setExpression(rig: HeroRig, e: Expression, force = false): void {
  if (rig.expression === e && !force) return;
  rig.expression = e;
  rig.mats.face.uniforms.uMap.value = faceTexture(e, rig.iris);
}

const faceCache = new Map<string, THREE.Texture>();

/** Painted anime face, 32x32 pixel art: big eyes, small mouth, transparent background. */
export function faceTexture(e: Expression, iris: string): THREE.Texture {
  const key = e + iris;
  const hit = faceCache.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 32;
  const g = cv.getContext('2d')!;
  const px = (x: number, y: number, c: string, w = 1, h = 1) => {
    g.fillStyle = c;
    g.fillRect(x, y, w, h);
  };
  const ink = '#1b1f4a';
  const pupil = '#' + new THREE.Color(iris).multiplyScalar(0.4).getHexString();
  const openEye = (cx: number, squint = 0) => {
    const top = 9 + squint;
    px(cx - 3, top, ink, 7, 1);
    px(cx - 3, top + 1, ink, 1, 9 - squint);
    px(cx + 3, top + 1, ink, 1, 9 - squint);
    px(cx - 2, 19, ink, 5, 1);
    px(cx - 2, top + 1, '#ffffff', 5, 9 - squint);
    px(cx - 2, Math.max(top + 1, 12), iris, 4, 19 - Math.max(top + 1, 12));
    px(cx - 1, Math.max(top + 2, 14), pupil, 2, 19 - Math.max(top + 2, 14) - 1);
    px(cx - 2, Math.max(top + 1, 12), '#ffffff', 2, 2);
  };
  const closedEye = (cx: number) => {
    px(cx - 3, 16, ink, 7, 1);
    px(cx - 3, 15, ink, 1, 1);
    px(cx + 3, 15, ink, 1, 1);
  };
  const happyEye = (cx: number) => {
    // ^ shape
    px(cx - 3, 16, ink, 1, 2);
    px(cx - 2, 14, ink, 1, 2);
    px(cx - 1, 13, ink, 3, 1);
    px(cx + 2, 14, ink, 1, 2);
    px(cx + 3, 16, ink, 1, 2);
  };
  const crossEye = (cx: number) => {
    for (let i = 0; i < 5; i++) {
      px(cx - 2 + i, 12 + i, ink, 1, 1);
      px(cx + 2 - i, 12 + i, ink, 1, 1);
    }
  };
  const hurtEye = (cx: number, side: number) => {
    // > <
    for (let i = 0; i < 3; i++) {
      px(cx - side * (2 - i) , 12 + i, ink, 2, 1);
      px(cx - side * (2 - i), 16 - i, ink, 2, 1);
    }
  };
  switch (e) {
    case 'normal':
      openEye(10);
      openEye(21);
      px(14, 24, '#b5384a', 4, 1);
      px(15, 25, '#e0606f', 2, 1);
      break;
    case 'blink':
      closedEye(10);
      closedEye(21);
      px(14, 24, '#b5384a', 4, 1);
      break;
    case 'focus':
      openEye(10, 4);
      openEye(21, 4);
      px(7, 11, ink, 6, 1); // angled brows
      px(19, 11, ink, 6, 1);
      px(14, 25, '#b5384a', 4, 1);
      break;
    case 'happy':
      happyEye(10);
      happyEye(21);
      px(12, 23, '#b5384a', 8, 1);
      px(13, 24, '#b5384a', 6, 2);
      px(14, 25, '#ff9fa8', 4, 1);
      break;
    case 'hurt':
      hurtEye(10, -1);
      hurtEye(21, 1);
      px(13, 23, '#b5384a', 6, 4);
      px(14, 24, '#5d275d', 4, 2);
      break;
    case 'ko':
      crossEye(10);
      crossEye(21);
      px(13, 24, '#b5384a', 6, 1);
      px(13, 25, '#5d275d', 1, 1);
      px(18, 25, '#5d275d', 1, 1);
      break;
  }
  // Blush
  px(5, 21, '#ff9fa8', 3, 1);
  px(24, 21, '#ff9fa8', 3, 1);
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  faceCache.set(key, tex);
  return tex;
}

// ------------------------------------------------------------------ animation

/** What the hero is doing this frame. Owned and mutated in place by Player (no per-frame allocation). */
export interface HeroPose {
  dt: number;
  /** World velocity divided by the run speed. */
  vx: number;
  vz: number;
  /** Root yaw (the hero faces its aim). */
  facing: number;
  /** 1 right after a shot, decaying to 0. */
  recoil: number;
  dashing: boolean;
  /** > 0 right after a hit (rising edge starts a flinch). */
  hurtFlash: number;
  /** World direction the last hit pushed the hero (unit, or 0 when unknown). */
  hitX: number;
  hitZ: number;
  dead: boolean;
  cheer: boolean;
  /** Squash spring (positive = stretch up) and build proportions. */
  sq: number;
  bw: number;
  bh: number;
}

export function newPose(): HeroPose {
  return { dt: 0, vx: 0, vz: 0, facing: 0, recoil: 0, dashing: false, hurtFlash: 0, hitX: 0, hitZ: 0, dead: false, cheer: false, sq: 0, bw: 1, bh: 1 };
}

/** Smoothed animation state per rig. */
export interface HeroAnimState {
  time: number;
  /** Walk cycle phase (radians) and smoothed speed 0..1. */
  phase: number;
  speed: number;
  /** Smoothed move direction in the rig's local frame (forward, side). */
  mf: number;
  ms: number;
  /** Lean into movement (radians). */
  leanF: number;
  leanS: number;
  /** Two-handed aim stance while firing, 0..1. */
  fire: number;
  /** Dash pose, 0..1. */
  dash: number;
  /** Hurt flinch amount and its local push direction. */
  flinch: number;
  flF: number;
  flS: number;
  prevFlash: number;
  /** Seconds since death (0 while alive) and since the victory pose started. */
  deathT: number;
  cheerT: number;
  cheerK: number;
}

function newAnimState(): HeroAnimState {
  return { time: 0, phase: 0, speed: 0, mf: 1, ms: 0, leanF: 0, leanS: 0, fire: 0, dash: 0, flinch: 0, flF: -1, flS: 0, prevFlash: 0, deathT: 0, cheerT: 0, cheerK: 0 };
}

/** Animation knobs. */
export const heroAnimTuning = {
  stepHz: 1.45, // walk cycles per second when barely moving
  runHz: 1.0, // extra cycles per second at full run speed
  legSwing: 0.95, // leg swing (radians) at full speed
  armSwing: 0.85,
  bob: 0.1,
  leanFwd: 0.2,
  leanSide: 0.15,
  dashLean: 0.5,
  dashStretch: 0.35,
  flinch: 0.5,
};

const loc = { f: 0, s: 0 };
const fall = { y: 0, back: 0, tilt: 0 };
const ease = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/**
 * Procedural hero animation: walk/run cycle (leg and arm swing, bob, lean into
 * movement, backpedal and strafe), idle breathing, firing recoil and a
 * two-handed aim stance, dash lunge with stretch, hurt flinch, victory dance
 * and the death fall. Writes every animated property each frame.
 */
export function animateHero(rig: HeroRig, p: HeroPose): void {
  const t = heroAnimTuning;
  const a = rig.anim;
  const dt = Math.min(p.dt, 0.05);
  a.time += dt;

  // --- Inputs, smoothed ---
  toLocal(p.vx, p.vz, p.facing, loc);
  const spd = Math.hypot(p.vx, p.vz);
  a.speed += ((p.dashing ? a.speed : Math.min(1, spd)) - a.speed) * ease(12, dt);
  const s = a.speed;
  if (spd > 0.05) {
    const l = Math.hypot(loc.f, loc.s);
    a.mf += (loc.f / l - a.mf) * ease(10, dt);
    a.ms += (loc.s / l - a.ms) * ease(10, dt);
  }
  const ml = Math.hypot(a.mf, a.ms) || 1;
  const mf = a.mf / ml;
  const ms = a.ms / ml;
  const fwd = Math.max(-1, Math.min(1, loc.f));
  const side = Math.max(-1, Math.min(1, loc.s));
  a.leanF += (fwd * t.leanFwd * (fwd < 0 ? 0.6 : 1) - a.leanF) * ease(8, dt);
  a.leanS += (side * t.leanSide - a.leanS) * ease(8, dt);
  a.dash += ((p.dashing ? 1 : 0) - a.dash) * ease(p.dashing ? 30 : 9, dt);
  a.fire += ((p.recoil > 0.12 ? 1 : 0) - a.fire) * ease(p.recoil > 0.12 ? 14 : 2.5, dt);
  if (p.hurtFlash > 0 && a.prevFlash <= 0) {
    a.flinch = 1;
    if (p.hitX !== 0 || p.hitZ !== 0) {
      toLocal(p.hitX, p.hitZ, p.facing, loc);
      a.flF = loc.f;
      a.flS = loc.s;
    } else {
      a.flF = -1;
      a.flS = 0;
    }
  }
  a.prevFlash = p.hurtFlash;
  a.flinch *= Math.exp(-6 * dt);
  a.deathT = p.dead ? a.deathT + dt : 0;
  a.cheerT = p.cheer ? a.cheerT + dt : 0;
  a.cheerK += ((p.cheer ? 1 : 0) - a.cheerK) * ease(6, dt);

  // --- Walk / run cycle ---
  a.phase += dt * Math.PI * 2 * (t.stepHz + t.runHz * s) * Math.min(1, s * 4);
  const sinP = Math.sin(a.phase);
  const cosP = Math.cos(a.phase);
  const amp = s * t.legSwing * (0.55 + 0.45 * s);
  const sw = sinP * amp;
  rig.legL.rotation.set(sw * mf, 0, -sw * ms * 0.8);
  rig.legR.rotation.set(-sw * mf, 0, sw * ms * 0.8);
  // The leg swinging forward lifts its foot.
  rig.legL.position.y = 0.62 + Math.max(0, -cosP) * 0.09 * s;
  rig.legR.position.y = 0.62 + Math.max(0, cosP) * 0.09 * s;

  const idle = 1 - Math.min(1, s * 2);
  const breath = Math.sin(a.time * 2.3);
  const body = rig.body;
  body.position.set(0, Math.abs(cosP) * t.bob * s, 0);
  body.rotation.set(a.leanF, sinP * 0.1 * s, -a.leanS + Math.sin(a.time * 0.8) * 0.025 * idle);

  // Left arm swings against the left leg; the buster arm aims forward.
  rig.armL.position.y = rig.armR.position.y = 1.12 + breath * 0.012 * idle;
  rig.armL.rotation.set(-sinP * s * t.armSwing, 0, -(0.1 + 0.14 * s) - (breath * 0.04 + 0.03) * idle);
  rig.armR.rotation.set(-Math.PI / 2 + 0.1 + Math.sin(a.phase * 2) * 0.05 * s, 0, 0);
  rig.head.position.y = 1.5 + breath * 0.018 * idle;
  rig.head.rotation.set(-a.leanF * 0.6 + breath * 0.025 * idle, -sinP * 0.1 * s + Math.sin(a.time * 0.53) * 0.12 * idle, Math.sin(a.phase * 0.5) * 0.05 * s);

  // --- Firing: recoil kick and a two-handed aim stance while the trigger is held ---
  const r = p.recoil;
  const f = a.fire * (1 - 0.6 * s);
  rig.armR.rotation.x -= r * 0.5;
  body.rotation.y += r * 0.12 - f * 0.1;
  body.rotation.x -= r * 0.09;
  rig.head.rotation.x -= r * 0.05;
  rig.armL.rotation.x = lerp(rig.armL.rotation.x, -1.2, f);
  rig.armL.rotation.z = lerp(rig.armL.rotation.z, 0.55, f);

  // --- Dash: lunge into the dash, trailing leg and arms swept back, stretched along the motion ---
  const d = a.dash;
  let sx = 1;
  let sy = 1;
  let sz = 1;
  if (d > 0.01) {
    body.rotation.x += mf * t.dashLean * d;
    body.rotation.z -= ms * t.dashLean * 0.8 * d;
    rig.legL.rotation.x = lerp(rig.legL.rotation.x, -0.8 * mf, d);
    rig.legR.rotation.x = lerp(rig.legR.rotation.x, 0.9 * mf, d);
    rig.legL.rotation.z = lerp(rig.legL.rotation.z, 0.5 * ms, d);
    rig.legR.rotation.z = lerp(rig.legR.rotation.z, -0.6 * ms, d);
    rig.armL.rotation.x = lerp(rig.armL.rotation.x, 1.1, d);
    rig.armL.rotation.z = lerp(rig.armL.rotation.z, -0.5, d);
    rig.head.rotation.x -= mf * 0.35 * d;
    sx += t.dashStretch * d * Math.abs(ms);
    sz += t.dashStretch * d * Math.abs(mf);
    sy -= 0.14 * d;
  }

  // --- Hurt flinch: knocked the way the hit pushed, head whips, arms fly up ---
  const fl = a.flinch;
  if (fl > 0.01) {
    body.rotation.x += a.flF * t.flinch * fl;
    body.rotation.z -= a.flS * t.flinch * 0.8 * fl + Math.sin(a.time * 38) * 0.1 * fl;
    rig.head.rotation.x -= a.flF * 0.4 * fl;
    rig.armL.rotation.x -= 0.6 * fl;
    rig.armL.rotation.z -= 0.9 * fl;
    rig.armR.rotation.x -= 0.4 * fl;
  }

  // --- Victory: spin-jump toward the camera, then hop and wave ---
  const k = a.cheerK;
  if (k > 0.01) {
    const ct = a.cheerT;
    const hopLen = 0.5;
    const hop = Math.abs(Math.sin((ct * Math.PI) / hopLen));
    const first = ct < hopLen;
    const spin = first ? (ct / hopLen) * (ct / hopLen) * Math.PI * 2 : 0;
    body.rotation.y = lerp(body.rotation.y, wrapAngle(-p.facing) + spin, k);
    body.rotation.x = lerp(body.rotation.x, 0, k);
    body.rotation.z = lerp(body.rotation.z, Math.sin(ct * 6) * 0.08, k);
    body.position.y += hop * (first ? 0.6 : 0.32) * k;
    rig.armR.rotation.x = lerp(rig.armR.rotation.x, -Math.PI + 0.25 + Math.sin(ct * 10) * 0.18, k);
    rig.armR.rotation.z = lerp(rig.armR.rotation.z, 0.3, k);
    rig.armL.rotation.x = lerp(rig.armL.rotation.x, -Math.PI + 0.45, k);
    rig.armL.rotation.z = lerp(rig.armL.rotation.z, -0.35 + Math.sin(ct * 12) * 0.35, k);
    rig.legL.rotation.x = lerp(rig.legL.rotation.x, (hop - 0.5) * 0.6, k);
    rig.legR.rotation.x = lerp(rig.legR.rotation.x, (0.5 - hop) * 0.6, k);
    rig.head.rotation.z = lerp(rig.head.rotation.z, Math.sin(ct * 6) * 0.14, k);
    rig.head.rotation.x = lerp(rig.head.rotation.x, -0.15, k);
  }

  // --- Death: blown off the feet the way the last hit pushed, flat on the back, one bounce ---
  if (p.dead) {
    deathFall(a.deathT, fall);
    const tl = fall.tilt;
    const ang = tl * Math.PI * 0.5;
    body.position.set(a.flS * fall.back, fall.y + 0.38 * tl, a.flF * fall.back);
    body.rotation.set(a.flF * ang, 0, -a.flS * ang);
    const air = a.deathT < 0.5 ? 1 : 0;
    const flail = Math.sin(a.deathT * 28) * 0.5 * air;
    rig.armL.rotation.set(-0.3 + flail, 0, -1.3 * tl);
    rig.armR.rotation.set(-0.3 - flail, 0, 1.2 * tl);
    rig.legL.rotation.set(flail * 0.6, 0, -0.25 * tl);
    rig.legR.rotation.set(-flail * 0.6, 0, 0.25 * tl);
    rig.legL.position.y = rig.legR.position.y = 0.62;
    rig.head.rotation.set(0, 0, 0.4 * tl);
  }

  // Squash spring and build proportions on top of the pose stretch.
  body.scale.set((1 - p.sq * 0.5) * p.bw * sx, (1 + p.sq) * p.bh * sy, (1 - p.sq * 0.5) * p.bw * sz);
}
