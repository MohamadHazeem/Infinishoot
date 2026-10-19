import { settings } from '../game/settings';
/** Sound mapping stays on the existing volume bus and has recorded/synth fallbacks. */
export function pet2Sound(name: string): string | null {
  if (settings.petSounds === false) return null;
  switch (name) {
    case 'bark':
      return 'jumpPad';
    case 'gulp':
      return 'w:block';
    case 'flame':
      return 'w:flame';
    case 'swipe':
      return 'coin';
    case 'plant':
      return 'w:mine';
    case 'turret':
      return 'w:shoot';
    default:
      return null;
  }
}
