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
import { Katana } from './katana';
import { Iaido } from './iaido';
import { Beacon } from './beacon';
import type { WeaponDef } from '../../data/weapons';

export { Weapon } from './base';
export type { WeaponCtx, DamageOpts } from './base';
export { Buster } from './buster';
export { ChargeShot } from './charge';

/** Create a weapon instance by id. */
export function createWeapon(id: string, scene: THREE.Scene, def: WeaponDef = WEAPONS[id]): Weapon {
  // Fusions (src/data/fusions.ts) build their two parts through this same factory.
  if (def?.fusion) return new FusionWeapon(def, scene, createWeapon);
  switch (id) {
    case 'buster':
      return new Buster(def);
    case 'charge':
      return new ChargeShot(def);
    case 'drones':
      return new Drones(def, scene);
    case 'aura':
      return new Aura(def, scene);
    case 'lightning':
      return new Lightning(def, scene);
    case 'discs':
      return new Discs(def, scene);
    case 'missiles':
      return new Missiles(def, scene);
    case 'mines':
      return new Mines(def, scene);
    case 'nova':
      return new Nova(def);
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
    // Hero kits (src/data/heroWeapons.ts): the Ronin's sword and dash-strike, the Tinker's beacon.
    case 'katana':
      return new Katana(def, scene);
    case 'iaido':
      return new Iaido(def, scene);
    case 'beacon':
      return new Beacon(def, scene);
    default:
      throw new Error(`Unknown weapon: ${id}`);
  }
}
