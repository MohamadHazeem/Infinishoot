import type { Game } from '../game/game';
import { voice } from '../net/voice';
import { ensureVoiceUi } from '../ui/voiceUi';

/**
 * Voicechat lane test links (notes/lanes/voicechat.md), for screenshots without a network or a microphone:
 *  - &voicedemo: a fake voice roster over the current heroes (use with &heroes=4): P2 talking, P3 muted by you,
 *    P4 with voice on; your mic chip shows TALKING.
 *  - &voicedemo=screen: the same roster on the VOICE CHAT screen (mic meter, threshold, per-player volume).
 */
export function voiceLinks(game: Game, q: URLSearchParams): void {
  if (!q.has('voicedemo')) return;
  const names = game.heroes.length >= 2 ? game.heroes.map((h) => h.name) : ['YOU', 'BEE', 'SEA', 'KAI'];
  const inRun = game.heroes.length >= 2;
  voice.demo = {
    roster: names.map((name, i) => ({ id: `demo${i}`, name, on: i !== 4, hero: inRun ? i : -1 })),
    talk: names.map((_, i) => i === 0 || i === 1),
    me: 0,
  };
  voice.prefs.mute[names[2] ?? 'SEA'] = true;
  voice.prefs.vol[names[3] ?? 'KAI'] = 1.5;
  if (q.get('voicedemo') === 'screen') {
    ensureVoiceUi(game);
    game.screens.show('voicechat');
  }
}
