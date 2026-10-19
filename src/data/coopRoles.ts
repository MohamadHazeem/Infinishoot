/**
 * Co-op roles (coop2 lane). Every hero has one role; a party that mixes roles
 * gets team bonuses for everyone (host-applied through live stats, see
 * src/game/systems/coop2.ts `coopRoleStats`). Each distinct role in the party
 * adds its gift; the gifts grow with the number of distinct roles:
 * 1 role: nothing, 2 roles: x1, 3 roles: x1.5, 4 roles (a full party): x2.
 */
export type CoopRole = 'tank' | 'healer' | 'damage' | 'support';

export interface RoleDef {
  id: CoopRole;
  name: string;
  color: string;
  /** What this role gives the whole team (at x1). */
  gift: string;
}

export const ROLES: Record<CoopRole, RoleDef> = {
  tank: { id: 'tank', name: 'TANK', color: '#ffcd75', gift: '+1 ARMOR' },
  healer: { id: 'healer', name: 'MEDIC', color: '#a7f070', gift: '+0.6 LIFE/S' },
  damage: { id: 'damage', name: 'DAMAGE', color: '#ef7d57', gift: '+8% DAMAGE' },
  support: { id: 'support', name: 'SUPPORT', color: '#73eff7', gift: '+8% SPEED, +15% PICKUP' },
};

export const ROLE_ORDER: CoopRole[] = ['tank', 'healer', 'damage', 'support'];

/** Hero id -> role (src/data/heroes.ts). Unknown heroes are support. */
export const HERO_ROLES: Record<string, CoopRole> = {
  rookie: 'healer',
  bulwark: 'tank',
  furnace: 'tank',
  ace: 'damage',
  duelist: 'damage',
  dash: 'support',
  twin: 'support',
};

export function roleOf(heroId: string): CoopRole {
  return HERO_ROLES[heroId] ?? 'support';
}

export const roleTuning = {
  /** Bonus scale by distinct roles in the party (index = count). */
  scale: [0, 0, 1, 1.5, 2],
  armor: 1,
  regen: 0.6,
  damage: 0.08,
  speed: 0.08,
  magnet: 0.15,
};

export interface RoleBonus {
  /** Distinct roles present. */
  distinct: number;
  /** Multiplier applied to every gift (0 = no bonus). */
  scale: number;
  armor: number;
  regen: number;
  damageMul: number;
  moveSpeedMul: number;
  magnetMul: number;
  roles: CoopRole[];
}

/** The team bonus for a party with these roles (one entry per hero in the run). */
export function roleBonus(roles: readonly CoopRole[]): RoleBonus {
  const set = ROLE_ORDER.filter((r) => roles.includes(r));
  const T = roleTuning;
  const k = roles.length < 2 ? 0 : T.scale[Math.min(T.scale.length - 1, set.length)] ?? 0;
  const has = (r: CoopRole) => (set.includes(r) ? k : 0);
  return {
    distinct: set.length,
    scale: k,
    armor: T.armor * has('tank'),
    regen: T.regen * has('healer'),
    damageMul: T.damage * has('damage'),
    moveSpeedMul: T.speed * has('support'),
    magnetMul: T.magnet * has('support'),
    roles: set,
  };
}

/** "+1 ARMOR · +8% DAMAGE" for the HUD and lobby ('' when there's no bonus). */
export function bonusText(b: RoleBonus): string {
  if (b.scale <= 0) return '';
  const parts: string[] = [];
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  if (b.armor) parts.push(`+${Math.round(b.armor * 10) / 10} ARMOR`);
  if (b.regen) parts.push(`+${Math.round(b.regen * 10) / 10} LIFE/S`);
  if (b.damageMul) parts.push(`+${pct(b.damageMul)} DAMAGE`);
  if (b.moveSpeedMul) parts.push(`+${pct(b.moveSpeedMul)} SPEED`);
  return parts.join(' · ');
}
