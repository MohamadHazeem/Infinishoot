import * as THREE from 'three';
import { createRetroMaterial, type RetroMaterial } from '../render/retroMaterial';
import type { SkinDef } from '../data/skins';

/**
 * Placeholder chunky anime hero built from primitives: big head with a
 * painted face, helmet, oversized hands and boots, arm cannon. About three
 * heads tall. Faces +Z.
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
    // Big boot
    leg.add(mesh(new THREE.BoxGeometry(0.34, 0.26, 0.48), armor, 0, -0.46, 0.05));
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

  // --- Arms (pivot at shoulder) ---
  const makeArm = (side: number, cannon: boolean) => {
    const arm = new THREE.Group();
    arm.position.set(0.38 * side, 1.12, 0);
    arm.add(mesh(new THREE.SphereGeometry(0.17, 7, 5), armor, 0, 0, 0)); // shoulder pad
    arm.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.3, 6), suit, 0.02 * side, -0.22, 0));
    if (cannon) {
      // Arm buster along the forearm (-Y); the arm is raised forward when aiming
      arm.add(mesh(new THREE.CylinderGeometry(0.17, 0.15, 0.52, 8), armor, 0.04 * side, -0.42, 0));
      arm.add(mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 8), accent, 0.04 * side, -0.64, 0));
      arm.add(mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.04, 8), suit, 0.04 * side, -0.69, 0));
    } else {
      arm.add(mesh(new THREE.SphereGeometry(0.15, 6, 5), armor, 0.03 * side, -0.42, 0.02)); // big glove
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
  // Painted face decal
  const facePlane = mesh(new THREE.PlaneGeometry(0.52, 0.52), face, 0, -0.04, 0.345);
  head.add(facePlane);

  root.traverse((o) => {
    o.castShadow = false;
    o.receiveShadow = false;
  });

  return { mats: { armor, armorDark, accent, suit, red, hair, face }, expression: 'normal', iris, root, body, legL, legR, armL, armR, head, materials };
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

/** Victory pose: both arms up, bouncing on the spot. `k` 0..1 blends it in. */
export function poseVictory(rig: HeroRig, time: number, k: number): void {
  const hop = Math.abs(Math.sin(time * 6));
  rig.armR.rotation.x += (-Math.PI + 0.2 - rig.armR.rotation.x) * k;
  rig.armL.rotation.x += (-Math.PI + 0.3 + Math.sin(time * 12) * 0.25 - rig.armL.rotation.x) * k;
  rig.armL.rotation.z = -0.3 * k;
  rig.armR.rotation.z = 0.3 * k;
  rig.body.position.y += hop * 0.35 * k;
  rig.legL.rotation.x = (hop - 0.5) * 0.6 * k;
  rig.legR.rotation.x = (hop - 0.5) * -0.6 * k;
  rig.head.rotation.z = Math.sin(time * 6) * 0.12 * k;
}

/**
 * Procedural walk/idle animation. `speed01` = current speed / max speed,
 * `recoil01` = 1 right after a shot, decaying to 0.
 */
export function animateHero(rig: HeroRig, time: number, speed01: number, recoil01 = 0): void {
  const walk = time * 11;
  const swing = Math.sin(walk) * 0.75 * speed01;
  rig.legL.rotation.x = swing;
  rig.legR.rotation.x = -swing;
  rig.armL.rotation.x = -swing * 0.6;
  rig.armL.rotation.z = rig.armR.rotation.z = 0;
  rig.armR.rotation.x = -Math.PI / 2 + 0.1 - recoil01 * 0.45; // buster arm points forward, kicks up on fire
  const bob = Math.abs(Math.sin(walk)) * 0.08 * speed01 + Math.sin(time * 2.2) * 0.015 * (1 - speed01);
  rig.body.position.y = bob;
  rig.body.rotation.x = 0.12 * speed01 - recoil01 * 0.08; // lean into run, rock back on recoil
  rig.head.rotation.z = Math.sin(walk * 0.5) * 0.05 * speed01;
}
