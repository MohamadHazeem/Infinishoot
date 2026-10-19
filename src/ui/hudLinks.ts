import type { Game } from '../game/game';
import { applySettings, settings } from '../game/settings';
import { promptState, type PromptMode } from './prompts';

/** HUD-lane test-link options (src/dev/testLinks.ts): prompts, UI scale, damage numbers, charge mode, weather, a level-up. */
export function hudLinks(game: Game, q: URLSearchParams): void {
  const pad = q.get('pad');
  if (pad && ['kbm', 'xbox', 'ps', 'touch'].includes(pad)) promptState.force = pad as PromptMode;
  if (q.get('ui')) settings.uiScale = Number(q.get('ui'));
  const dn = q.get('dmgnums');
  if (dn === 'all' || dn === 'mine' || dn === 'off') settings.damageNumbers = dn;
  if (q.get('charge') === 'toggle') settings.chargeMode = 'toggle';
  if (q.has('noweather')) settings.weather = false;
  applySettings();
  if (q.has('levelup')) setTimeout(() => game.debugLevelUp(), (Number(q.get('levelup')) || 1) * 1000);
}
