import { modWeapon } from '../../mods/weapon';
import { Crosswind } from './crosswind';
import { Tesla } from './tesla';
import { Swarm } from './swarm';
import { Prism } from './prism';
import { Whip } from './whip';
import { Sentry } from './sentry';
import type * as THREE from 'three';
import { WEAPONS } from '../../data/weapons';
import { Aura } from './aura';
import type { Weapon } from './base';
import { Buster } from './buster';
import { ChargeShot } from './charge';
import { Discs } from './discs';
import { Drones } from './drones';
import { Fire } from './fire';
import { Lightning } from './lightning';
import { Mines } from './mines';
import { Missiles } from './missiles';
import { Nova } from './nova';
import { PlasmaOrb } from './orb';
import { Grenade } from './grenade';
import { GravityWell } from './well';
import { Laser } from './laser';
import { OrbitalStrike } from './orbital';
import { Rail } from './rail';
import { Scatter } from './scatter';
import { Shield } from './shield';
import { Sweeper } from './sweeper';
import { Pellets } from './pellets';
import { Bouncer } from './bouncer';
import { Starfall } from './starfall';
import { FusionWeapon } from './fusion';
import type { WeaponDef } from '../../data/weapons';

export { Weapon } from './base';
export type { WeaponCtx, DamageOpts } from './base';
export { Buster } from './buster';
export { ChargeShot } from './charge';

/** Create a weapon instance by id. */
export function createWeapon(id: string, scene: THREE.Scene, def: WeaponDef = WEAPONS[id]): Weapon {
  // Fusions (src/data/fusions.ts) build their two parts through this same factory.
  if (def?.fusion) return new FusionWeapon(def, scene, createWeapon);
  switch (def?.behavior ?? id) {
    case 'crosswind': return new Crosswind(def, scene);
    case 'tesla': return new Tesla(def, scene);
    case 'swarm': return new Swarm(def, scene);
    case 'prism': return new Prism(def, scene);
    case 'whip': return new Whip(def, scene);
    case 'sentry': return new Sentry(def, scene);

    case 'buster':
      return new Buster(def);
    case 'charge':
      return new ChargeShot(def);
    case 'drones':
      return modWeapon(new Drones(def, scene));
    case 'aura':
      return modWeapon(new Aura(def, scene));
    case 'lightning':
      return new Lightning(def, scene);
    case 'discs':
      return new Discs(def, scene);
    case 'missiles':
      return new Missiles(def, scene);
    case 'mines':
      return new Mines(def, scene);
    case 'nova':
      return modWeapon(new Nova(def));
    case 'fire':
      return new Fire(def, scene);
    case 'scatter':
      return new Scatter(def);
    case 'laser':
      return new Laser(def, scene);
    case 'orb':
      return new PlasmaOrb(def, scene);
    case 'grenade':
      return new Grenade(def, scene);
    case 'well':
      return new GravityWell(def, scene);
    case 'shield':
      return new Shield(def, scene);
    case 'rail':
      return new Rail(def, scene);
    case 'orbital':
      return new OrbitalStrike(def, scene);
    case 'sweeper':
      return new Sweeper(def, scene);
    case 'pellets':
      return new Pellets(def);
    case 'bouncer':
      return new Bouncer(def, scene);
    case 'starfall':
      return new Starfall(def);
    default:
      throw new Error(`Unknown weapon: ${id}`);
  }
}
