/** Stable effects-bus names; recordings layer over a short offline fallback. */
import type { Bus, SynthKit } from './sfx';
interface FeatureCue { sample: string; bus: Bus; gap: number; recipe(k: SynthKit): void }
const ding = (k: SynthKit) => { k.tone('triangle', 784, 784, 0.12, 0.08); k.tone('sine', 1175, 1175, 0.25, 0.06, 0.08); };
const horn = (k: SynthKit) => { k.swell('sawtooth', 147, 147, 0.7, 0.08, 0.08); k.swell('triangle', 220, 220, 0.7, 0.08, 0.08); };
const down = (k: SynthKit) => { k.tone('triangle', 392, 294, 0.25, 0.09); k.tone('triangle', 262, 196, 0.4, 0.08, 0.2); };
const page = (k: SynthKit) => k.noise(0.12, 0.14, 1800, 4000, 2);
export const FEATURE_CUES: Readonly<Record<string, FeatureCue>> = {
  achievement: { sample: 'achievement', bus: 'ui', gap: 0.5, recipe: ding },
  questDone: { sample: 'quest_done', bus: 'ui', gap: 0.5, recipe: ding },
  profileLevel: { sample: 'profile_level', bus: 'ui', gap: 0.5, recipe: ding },
  pageTurn: { sample: 'page_turn', bus: 'ui', gap: 0.1, recipe: page },
  trophy: { sample: 'trophy', bus: 'ui', gap: 1, recipe: ding },
  readyDing: { sample: 'ready_ding', bus: 'ui', gap: 0.3, recipe: ding },
  chatPop: { sample: 'chat_pop', bus: 'ui', gap: 0.12, recipe: k => k.tone('sine', 880, 440, 0.06, 0.07) },
  coinTransfer: { sample: 'coin_transfer', bus: 'sfx', gap: 0.2, recipe: ding },
  reconnect: { sample: 'reconnect', bus: 'ui', gap: 1, recipe: ding },
  hostMigrate: { sample: 'host_migrate', bus: 'ui', gap: 1, recipe: ding },
  roundBell: { sample: 'round_bell', bus: 'ui', gap: 1, recipe: ding },
  victoryFanfare: { sample: 'victory_fanfare', bus: 'ui', gap: 2, recipe: ding },
  defeatSting: { sample: 'defeat_sting', bus: 'ui', gap: 2, recipe: down },
  raidAlarm: { sample: 'raid_alarm', bus: 'threat', gap: 1, recipe: horn },
  raidHorn: { sample: 'raid_horn', bus: 'threat', gap: 1, recipe: horn },
  carryLift: { sample: 'carry_lift', bus: 'sfx', gap: 0.3, recipe: page },
  teammatePing: { sample: 'ready_ding', bus: 'sfx', gap: 0.12, recipe: ding },
};
