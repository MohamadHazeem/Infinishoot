import type { Weapon, WeaponCtx } from '../game/weapons/base';
/** One adapter per weapon/context; no new per-frame objects. Keeps damage attribution and tags on the custom ID. */
export function modWeapon<T extends Weapon>(weapon: T): T {
  if (!weapon.def.behavior) return weapon;
  const contexts = new WeakMap<WeaponCtx, WeaponCtx>();
  const update = weapon.update;
  weapon.update = (dt, ctx) => {
    let adapted = contexts.get(ctx);
    if (!adapted) {
      adapted = Object.create(ctx) as WeaponCtx;
      adapted.damage = (enemy, amount, options) => {
        if (options.source === weapon.def.behavior) options.source = weapon.def.id;
        return ctx.damage(enemy, amount, options);
      };
      contexts.set(ctx, adapted);
    }
    update.call(weapon, dt, adapted);
  };
  return weapon;
}
