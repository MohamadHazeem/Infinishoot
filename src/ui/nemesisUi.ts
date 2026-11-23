import * as THREE from 'three';
import { viewCull } from '../render/viewCull';
import { PickupType } from '../game/pickups';
import { portraits } from './portraits';
import { netInterpAlpha } from '../game/systems/netcode';
import { TROPHY_CHEST, traitPercent } from '../game/nemesis';
import { ENEMIES } from '../data/enemies';
import type { Enemy } from '../game/enemies';
import type { Game } from '../game/game';
import type { Story } from '../game/nemesis';
import { damageFamilies, resists, resistanceTuning, type AdaptiveResistance } from '../game/adaptive';
import { getLanguage, localize, t } from '../i18n';
import { commit, instanceMatrix } from '../render/instancing';
import { createRetroMaterial } from '../render/retroMaterial';

export function rivalName(s: Story): string {
  return t('hunt.title' + ((s.mark >> 2) % 4), { first: t('hunt.first' + (s.mark % 4)) });
}
export const familyLabel = (i: number) => t('hunt.' + damageFamilies[i]);

// A pixel shield with a dark rim, and three pale stitches across a red scar.
function emblem(rows: string[], colors: string[]): THREE.BufferGeometry {
  const vertices: number[] = [],
    rgb: number[] = [];
  const color = new THREE.Color();
  for (let y = 0; y < rows.length; y++)
    for (let x = 0; x < rows[y].length; x++) {
      const pixel = rows[y][x];
      if (pixel === '.') continue;
      color.set(colors[Number(pixel)]);
      const l = (x - rows[y].length / 2) / rows.length,
        b = (rows.length / 2 - y - 1) / rows.length;
      const r = l + 1 / rows.length,
        h = b + 1 / rows.length;
      vertices.push(l, b, 0, r, b, 0, r, h, 0, l, b, 0, r, h, 0, l, h, 0);
      for (let i = 0; i < 6; i++) rgb.push(color.r, color.g, color.b);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(rgb, 3));
  geo.computeVertexNormals();
  return geo;
}

export class NemesisUi {
  private shield!: THREE.InstancedMesh;
  private scar!: THREE.Mesh;
  private chestMark!: THREE.Mesh;
  private pose!: THREE.Object3D;
  private towardCamera!: THREE.Vector3;
  private card = document.createElement('aside');
  private label = document.createElement('small');
  private name = document.createElement('strong');
  private detail = document.createElement('span');
  private identity = 0;
  private shownAt = 0;
  private language = '';
  private alpha = 1;
  private uid = 0;
  private adapt!: AdaptiveResistance;
  private count = 0;
  private draw = (e: Enemy, uid: number) => {
    if (!e.active || e.hp <= 0 || e.under || e.phaseOut) return;
    const named = uid === this.uid;
    const shielded = this.adapt.levels(uid) && resists(e.def);
    if ((!named && !shielded) || !viewCull.sphere(e.x, e.hopY + e.radius, e.z, e.radius * 3)) return;
    const pose = this.pose;
    pose.position.set(
      e.px + (e.x - e.px) * this.alpha,
      e.hopY + e.radius * 2.6 + 0.2,
      e.pz + (e.z - e.pz) * this.alpha,
    );
    if (shielded && this.count < this.shield.instanceMatrix.count) {
      pose.scale.setScalar(0.5);
      pose.updateMatrix();
      instanceMatrix(this.shield, this.count++, pose.matrix);
    }
    if (named) {
      this.scar.position.copy(pose.position);
      this.scar.position.y = e.hopY + e.radius;
      this.towardCamera.subVectors(this.g.cam.camera.position, this.scar.position).normalize();
      this.scar.position.addScaledVector(this.towardCamera, e.radius * 1.08);
      this.scar.quaternion.copy(pose.quaternion);
      this.scar.scale.setScalar(Math.max(0.48, Math.min(1.6, e.radius * 0.95)));
      this.scar.visible = true;
    }
  };

  constructor(
    private g: Game,
    root: HTMLElement,
  ) {
    this.card.className = 'px nemesis-intro';
    this.card.hidden = true;
    this.card.setAttribute('role', 'status');
    this.card.append(this.label, this.name, this.detail);
    this.bindHud();
    root.querySelector('#ingame')?.append(this.card);
    if (!document.getElementById('nemesis-css')) {
      const css = document.createElement('style');
      css.id = 'nemesis-css';
      css.textContent = `
      .nemesis-intro { --bg:var(--ink); --hi:var(--orange); --lo:var(--plum); --ring:var(--ink);
        position:absolute; top:18%; left:50%; transform:translateX(-50%); text-align:center;
        width:max-content; max-width:42%; padding:calc(2 * var(--p)) calc(5 * var(--p)); pointer-events:none }
      .nemesis-intro small,.nemesis-intro strong,.nemesis-intro span { display:block }
      .nemesis-intro small { color:var(--orange); font:calc(4 * var(--p))/1.3 var(--label) }
      .nemesis-intro strong { color:var(--yellow); font:calc(10 * var(--p))/1.1 var(--display) }
      .nemesis-intro span { color:var(--white); font:calc(5 * var(--p))/1.4 var(--font) }
      [dir=rtl] .nemesis-intro > * { font-family:inherit; line-height:1.5 }
      @media (max-height:500px) {
        .nemesis-intro { top:20%; left:72%; max-width:43%; padding:var(--p) calc(2 * var(--p)) }
        .nemesis-intro small { font-size:calc(3.5 * var(--p)) }
        .nemesis-intro strong { font-size:calc(6 * var(--p)) }
        .nemesis-intro span { font-size:calc(4 * var(--p)) }
        [dir=rtl] .nemesis-intro { left:28% }
        [dir=rtl] .nemesis-intro > * { line-height:1.25 }
      }
      .nemesis-intro[hidden] { display:none }`;
      document.head.append(css);
    }
  }

  // Build once on the first visible hunt. Idle runs need no geometry, and
  // Three's UUID generation must not perturb their seeded fixture setup.
  private createMarkers(): void {
    this.shield = new THREE.InstancedMesh(
      emblem(['00000', '01210', '01110', '.010.', '..0..'], ['#1a1c2c', '#41a6f6', '#f4f4f4']),
      createRetroMaterial({ vertexColors: true, unlit: 1 }),
      700,
    );
    this.scar = new THREE.Mesh(
      emblem(['....010', '...0120', '..0100.', '.0120..', '0100...', '020....'], ['#1a1c2c', '#b13e53', '#ffcd75']),
      createRetroMaterial({ vertexColors: true, unlit: 1 }),
    );
    this.chestMark = new THREE.Mesh(this.scar.geometry, this.scar.material);
    this.pose = new THREE.Object3D();
    this.towardCamera = new THREE.Vector3();
    this.shield.count = 0;
    this.shield.frustumCulled = false;
    this.scar.visible = false;
    this.chestMark.visible = false;
    this.g.scene.add(this.shield, this.scar, this.chestMark);
  }

  private bindHud(): void {
    const g = this.g;
    const huntState = g.nemesis;
    const cine = g.onCine.bind(g);
    g.onCine = (kind, seat, x, z, data) => {
      if (kind === 'hunt-resist') {
        const line = t('hunt.adapts', { type: familyLabel(seat) });
        if (portraits.enabled) portraits.popIn('announcer', 'determined', line, 4);
        else g.hud.toast(line, 4);
      } else if (kind === 'hunt-drop' || kind === 'hunt-earned')
        g.hud.toast(t(kind === 'hunt-drop' ? 'hunt.drop' : 'hunt.earned'), 3);
      else cine(kind, seat, x, z, data);
    };
    const bars = g.renderEliteBars.bind(g);
    g.renderEliteBars = (alpha) => {
      bars(alpha);
      this.render(
        g.role === 'client' ? netInterpAlpha(g) : alpha,
        huntState.uid,
        huntState.story,
        huntState.adaptive,
        huntState.trophy,
      );
    };
    const spice = g.spiceLines.bind(g);
    let lastFamily = -1,
      lastLevel = -1,
      lastStory: Story | undefined,
      language = '';
    const resist = { text: '', kind: 'event' as const },
      hunt = { text: '', kind: 'challenge' as const };
    g.spiceLines = () => {
      const lines = spice();
      const a = huntState.adaptive,
        lv = a.thresholds.length;
      const lang = document.documentElement.lang;
      if (lv) {
        if (a.family !== lastFamily || lv !== lastLevel || lang !== language)
          resist.text = t('hunt.badge', {
            type: familyLabel(a.family),
            n: Math.round(lv * resistanceTuning.step * 100),
          });
        lines.push(resist);
      }
      if (huntState.uid && huntState.story) {
        if (huntState.story.id !== lastStory?.id || lang !== language) hunt.text = rivalName(huntState.story);
        lines.push(hunt);
      }
      language = lang;
      lastFamily = a.family;
      lastLevel = lv;
      lastStory = huntState.story;
      return lines;
    };
  }

  render(alpha: number, uid: number, story: Story | undefined, adapt: AdaptiveResistance, hasTrophy: boolean) {
    const g = this.g;
    const visible = g.mode === 'fight' && g.screens.current === 'none';
    if (!this.shield) {
      if (!visible || (!uid && !hasTrophy && !adapt.thresholds.length)) return;
      this.createMarkers();
    }
    this.count = 0;
    this.scar.visible = false;
    if (visible && (uid || adapt.thresholds.length)) {
      this.alpha = alpha;
      this.uid = uid;
      this.adapt = adapt;
      this.pose.quaternion.copy(g.cam.camera.quaternion);
      if (g.role === 'client') g.netEnemies.forEach(this.draw);
      else for (const e of g.enemies.list) this.draw(e, e.uid);
    }
    this.chestMark.visible = false;
    if (visible && hasTrophy)
      for (let i = 0; i < g.pickups.count; i++) {
        if (g.pickups.type[i] === PickupType.Chest && g.pickups.value[i] === TROPHY_CHEST) {
          this.chestMark.visible = true;
          this.chestMark.position.set(g.pickups.x[i], 1.5, g.pickups.z[i]);
          this.chestMark.quaternion.copy(g.cam.camera.quaternion);
          break;
        }
      }
    this.shield.count = this.count;
    if (this.count) commit(this.shield.instanceMatrix, this.count);
    if (!uid) this.identity = 0;
    if (!visible || !story || !uid || g.bossIntro.active) {
      this.card.hidden = true;
      return;
    }
    if (this.identity !== uid || this.language !== getLanguage()) {
      if (this.identity !== uid) this.shownAt = g.runTime;
      this.identity = uid;
      this.language = getLanguage();
      this.label.textContent = t('hunt.return');
      this.name.textContent = rivalName(story);
      const def = ENEMIES[story.foe];
      const ward = !!(story.mark & 16);
      const trait = t(ward ? 'hunt.ward' : 'hunt.shell', { n: traitPercent(story.mark, def) });
      this.detail.textContent = localize(def.name) + ' · ' + trait;
    }
    this.card.hidden = g.runTime - this.shownAt > 4;
  }
}
