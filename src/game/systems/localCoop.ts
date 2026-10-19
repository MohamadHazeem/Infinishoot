import { accessibilityInput } from './aimAssist';
/**
 * Shared-screen local co-op (MP lane): 2-4 heroes on one PC, no network.
 * Game methods (`this` is the Game), installed on the class as fields.
 *
 * The run is a normal co-op run with `role` 'solo' (this machine simulates
 * everything; revives, enemy scaling and co-op items work because there are
 * several heroes). Hero 0 reads the shared Input (keyboard + mouse, plus its
 * pad if player 1 joined with one); every other hero gets its own PadInput and
 * runs through the same Game.updateHero with that pad swapped in. The camera
 * frames the whole team and a leash keeps everyone on screen. Level-up cards
 * and the shop go round in turn: whoever still has to choose gets the menu
 * (and the shared Input reads their pad while it's open).
 */
import type { Game } from '../game';
import { playerName, cheats } from '../game';
import type { Input } from '../../core/input';
import { PadInput, browserPads, type PadSource } from '../../core/padInput';
import { KBM, leashPoint, padMap, teamZoom, type LocalSlot } from '../localCoop';
import { HEROES, heroOf } from '../../data/heroes';
import { validLoadout } from '../../data/loadout';
import type { ModeId } from '../../data/modes';
import type { Hero } from '../hero';
import { save, unlockedLoadout, unlockedWeapons } from '../save';
import { settings } from '../settings';

export interface LocalCoopRun {
  slots: LocalSlot[];
  /** PadInput per hero index (null for hero 0, which reads the shared Input). */
  pads: (PadInput | null)[];
  /** What the shared Input reads during the fight (Input.padIndex). */
  mainPad: number;
  /** Hero whose menu turn it is (-1 = none). */
  turn: number;
  swapping: boolean;
  /** Pad whose Start opened the pause menu (it navigates the menu), or -1. */
  pausePad: number;
}

export function heroUnlocked(id: string): boolean {
  const d = heroOf(id);
  return d.id === id && (!d.unlock || save.achievements.includes(d.unlock) || cheats.unlockAll);
}

export function unlockedHeroes(): string[] {
  return HEROES.filter((h) => heroUnlocked(h.id)).map((h) => h.id);
}

/** Start a local co-op run from the join screen's slots (slot 0 is player 1). */
export function localCoopStart(this: Game, slots: LocalSlot[], mode: ModeId = 'standard', source: PadSource = browserPads): void {
  if (slots.length < 1) return;
  this.leaveToTitle();
  const unlocked = cheats.unlockAll ? undefined : unlockedLoadout();
  const map = padMap(slots);
  // Player 1 is this machine's player: its loadout and hero come from its pick (startRun reads settings.loadout).
  settings.loadout = validLoadout(slots[0].loadout, unlocked);
  const heroes: Hero[] = slots.map((s, i) => {
    const id = heroUnlocked(s.hero) ? s.hero : 'rookie';
    const h = i === 0 ? this.hero : this.makeHero(i, `P${i + 1}`, unlockedWeapons(), '', settings.skin, 'none', id);
    if (i === 0) {
      h.name = playerName();
      h.setHeroDef(id);
    }
    h.loadoutPick = validLoadout(s.loadout, unlocked);
    return h;
  });
  this.setHeroes(heroes);
  this.local = 0;
  this.localCoop = { slots: slots.map((s) => ({ ...s, loadout: { ...s.loadout } })), pads: map.pads.map((p) => (p === null || p === KBM ? null : new PadInput(p, source))), mainPad: map.mainPad, turn: -1, swapping: false, pausePad: -1 };
  this.input.usePad(map.mainPad);
  this.runMode = mode;
  this.startRun();
}

/**
 * Game.updateHero hook: pad heroes are updated with their own PadInput in place
 * of the shared Input (and as "this machine's hero" for that call), then
 * everyone is leashed to the team. Returns true when it handled the hero.
 */
export function localHeroUpdate(this: Game, h: Hero, dt: number, localControl: boolean): boolean {
  const lc = this.localCoop;
  if (!lc || lc.swapping) return false;
  lc.swapping = true;
  const pad = lc.pads[h.index];
  const g = this as unknown as { input: Input };
  const input = g.input;
  const local = this.local;
  try {
    if (pad && this.local !== h.index) {
      pad.poll();
      pad.rumbleOn = settings.rumble;
      accessibilityInput(pad.asInput(), localControl && !this.paused && this.screens.current === 'none', dt, this.stage, h.player.dead);
      // Any player's Start pauses the shared game.
      if (pad.padButtonPressed(9) && this.isCombatMode && !this.paused && this.screens.current === 'none') {
        this.pause();
        lc.pausePad = pad.index;
      }
      g.input = pad.asInput();
      this.local = h.index;
    }
    this.updateHero(h, dt, localControl);
  } finally {
    g.input = input;
    this.local = local;
    lc.swapping = false;
  }
  leash(this, h);
  return true;
}

/** Keep a hero within the leash of the rest of the (living) team, so the shared camera fits everyone. */
function leash(g: Game, h: Hero): void {
  const p = h.player;
  if (p.dead || h.left || !g.isCombatMode) return;
  let n = 0;
  let cx = 0;
  let cz = 0;
  for (const o of g.heroes) {
    if (o === h || o.left || o.player.dead) continue;
    cx += o.player.x;
    cz += o.player.z;
    n++;
  }
  if (!n) return;
  cx /= n;
  cz /= n;
  const r = leashPoint(p.x, p.z, cx, cz);
  if (!r.held || g.walls.hitCircle(r.x, r.z, p.radius)) return;
  p.pos.x = r.x;
  p.pos.z = r.z;
  // Drop the outward part of the velocity, so pushing against the leash doesn't build up speed.
  const dx = p.x - cx;
  const dz = p.z - cz;
  const d = Math.hypot(dx, dz) || 1;
  const out = (p.vel.x * dx + p.vel.z * dz) / d;
  if (out > 0) {
    p.vel.x -= (dx / d) * out;
    p.vel.z -= (dz / d) * out;
  }
}

/** Every update: hand the level-up / shop menus round in turn, and give the shared Input back to player 1 in the fight. */
export function localCoopTick(this: Game): void {
  const lc = this.localCoop;
  if (!lc) return;
  const menu = this.mode === 'levelup' || this.mode === 'shop';
  if (!menu) {
    if (lc.turn >= 0 || this.local !== 0) {
      lc.turn = -1;
      this.local = 0;
    }
    // The pause menu answers the pad that opened it.
    if (!this.paused) lc.pausePad = -1;
    this.input.usePad(this.paused && lc.pausePad >= 0 ? lc.pausePad : lc.mainPad);
    return;
  }
  const need = (x: Hero) => !x.left && (this.mode === 'levelup' ? x.needsPick : !x.shopDone);
  const next = this.heroes.find(need);
  if (!next || lc.turn === next.index) return;
  const switched = next.index !== this.local;
  lc.turn = next.index;
  this.local = next.index;
  const pad = lc.slots[next.index]?.pad;
  this.input.usePad(pad === undefined || pad === KBM ? -2 : pad);
  if (!switched) return; // its menu is already up
  if (this.mode === 'levelup') this.presentLevelUp(next);
  else this.presentShop(next);
}

/** Render hook: one shared camera on the middle of the team, zoomed out to fit it. */
export function localCoopCamera(g: Game): void {
  if (!g.localCoop || g.mode === 'title') return;
  let n = 0;
  let cx = 0;
  let cz = 0;
  const list = g.heroes.filter((h) => !h.left && !h.player.dead);
  const use = list.length ? list : g.heroes.filter((h) => !h.left);
  for (const h of use) {
    const r = h.player.rig.root.position;
    cx += r.x;
    cz += r.z;
    n++;
  }
  if (!n) return;
  cx /= n;
  cz /= n;
  let spread = 0;
  for (const h of use) spread = Math.max(spread, Math.hypot(h.player.rig.root.position.x - cx, h.player.rig.root.position.z - cz));
  g.playerPos.set(cx, g.playerPos.y, cz);
  g.lead.set(0, 0, 0);
  g.cam.frameTeam(0, 0, teamZoom(spread));
}

/** Device label for a hero ("KEYBOARD", "PAD 2"). */
export function deviceLabel(g: Game, i: number): string {
  const s = g.localCoop?.slots[i];
  if (!s) return '';
  return s.pad === KBM ? 'KEYBOARD' : `PAD ${s.pad + 1}`;
}
