import { DEFAULT_LOADOUT, loadoutOptions, type Loadout, type LoadoutSlot } from '../data/loadout';

/**
 * Shared-screen local co-op (MP lane): 2-4 players on one PC. Player 1 may use
 * the keyboard and mouse; everyone else (and player 1, if they like) uses a
 * gamepad. This is the join-screen model: who joined with which device, their
 * hero and loadout, and whether they're ready. Pure, so tests/mp.test.ts can
 * check join order and the pad mapping; the run itself is
 * src/game/systems/localCoop.ts.
 */
export const localCoopTuning = {
  maxPlayers: 4,
  /** Heroes further than this from the rest of the team are held back (the shared camera has to fit everyone). */
  leash: 15,
  /** Shared camera: zoom 1 up to this spread (m), then zooms out up to zoomMax. */
  zoomFrom: 9,
  zoomPer: 0.055,
  zoomMax: 2,
  /** Seconds of countdown once everyone is ready. */
  countdown: 2,
};

/** Keyboard + mouse in a slot's `pad` field. */
export const KBM = -1;

export const SLOT_ROWS = ['hero', 'primary', 'secondary', 'special'] as const;
export type SlotRow = (typeof SLOT_ROWS)[number];

export interface LocalSlot {
  /** Gamepad index, or KBM. */
  pad: number;
  hero: string;
  loadout: Loadout;
  ready: boolean;
  /** Row the player is editing on the join screen. */
  row: number;
}

export class LocalLobby {
  slots: LocalSlot[] = [];

  constructor(
    private heroes: () => string[] = () => ['rookie'],
    private unlocked: () => string[] | undefined = () => undefined,
  ) {}

  slotOf(pad: number): number {
    return this.slots.findIndex((s) => s.pad === pad);
  }

  /** A device joins. The keyboard always takes player 1 (pad players shift down). Returns the slot index or -1. */
  join(pad: number, base?: Partial<LocalSlot>): number {
    if (this.slotOf(pad) >= 0) return this.slotOf(pad);
    if (this.slots.length >= localCoopTuning.maxPlayers) return -1;
    const slot: LocalSlot = { pad, hero: base?.hero ?? this.heroes()[0] ?? 'rookie', loadout: { ...DEFAULT_LOADOUT, ...base?.loadout }, ready: false, row: 0 };
    if (pad === KBM) this.slots.unshift(slot);
    else this.slots.push(slot);
    return this.slotOf(pad);
  }

  leave(pad: number): void {
    const i = this.slotOf(pad);
    if (i >= 0) this.slots.splice(i, 1);
  }

  /** Move the row cursor (-1 up / 1 down) or change the row's value (-1 left / 1 right). */
  nav(pad: number, dRow: number, dVal: number): void {
    const s = this.slots[this.slotOf(pad)];
    if (!s || s.ready) return;
    if (dRow) s.row = (s.row + dRow + SLOT_ROWS.length) % SLOT_ROWS.length;
    if (!dVal) return;
    const row = SLOT_ROWS[s.row];
    if (row === 'hero') s.hero = cycle(this.heroes(), s.hero, dVal);
    else s.loadout = { ...s.loadout, [row]: cycle(this.options(row), s.loadout[row], dVal) };
  }

  options(row: LoadoutSlot): string[] {
    const u = this.unlocked();
    const all = loadoutOptions(row);
    const open = u ? all.filter((id) => u.includes(id)) : all;
    return open.length ? open : [DEFAULT_LOADOUT[row]];
  }

  toggleReady(pad: number): void {
    const s = this.slots[this.slotOf(pad)];
    if (s) s.ready = !s.ready;
  }

  get canStart(): boolean {
    return this.slots.length >= 2 && this.slots.every((s) => s.ready);
  }
}

function cycle(list: string[], cur: string, d: number): string {
  if (!list.length) return cur;
  const i = list.indexOf(cur);
  return list[(((i < 0 ? 0 : i + d) % list.length) + list.length) % list.length];
}

/**
 * Which device drives which hero. Hero 0 is the "local" hero and reads the
 * shared Input (keyboard + mouse, plus its pad if it has one); every other hero
 * gets its own PadInput. `mainPad` is what the shared Input should read
 * (Input.padIndex: -2 = no pad, so pad 2's stick can't move player 1).
 */
export function padMap(slots: readonly Pick<LocalSlot, 'pad'>[]): { mainPad: number; pads: (number | null)[] } {
  const first = slots[0]?.pad ?? KBM;
  return { mainPad: first === KBM ? -2 : first, pads: slots.map((s, i) => (i === 0 ? null : s.pad)) };
}

/** Shared camera zoom for a team spread (largest distance from the team's centre). */
export function teamZoom(spread: number): number {
  const t = localCoopTuning;
  return Math.min(t.zoomMax, Math.max(1, 1 + (spread - t.zoomFrom) * t.zoomPer));
}

/** Pull a hero back toward its team: returns the clamped position (or the same one if within the leash). */
export function leashPoint(x: number, z: number, cx: number, cz: number, leash = localCoopTuning.leash): { x: number; z: number; held: boolean } {
  const dx = x - cx;
  const dz = z - cz;
  const d = Math.hypot(dx, dz);
  if (d <= leash) return { x, z, held: false };
  return { x: cx + (dx / d) * leash, z: cz + (dz / d) * leash, held: true };
}
