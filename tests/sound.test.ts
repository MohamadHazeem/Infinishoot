import { ok } from './check';
import { readFileSync } from 'node:fs';
import {
  biomeAudio,
  comboLine,
  cueSamples,
  cuePriority,
  distanceCutoff,
  groundAudio,
  soundTuning,
  swarmGap,
  VoiceBudget,
  weaponSamples,
} from '../src/audio/mix';
import { manifestIds, SampleEngine, samples } from '../src/audio/samples';
import { announcementCooldown, announcer, announcerSettings } from '../src/audio/announcer';

ok(
  [1, 2, 3, 4, 5, 7, 9].map(biomeAudio).join() === 'meadow,dunes,peaks,magma,neon,sky,meadow',
  'biome audio follows the stage\'s actual biome',
);
ok(
  groundAudio('peaks') === 'snow' && groundAudio('magma') === 'metal',
  'biome footsteps match ground',
);
ok(
  distanceCutoff(0.3) < distanceCutoff(1) && distanceCutoff(-1) === 2800,
  'far sound low-pass is bounded',
);
ok(
  swarmGap(150) === swarmGap(500) && swarmGap(150) > swarmGap(0),
  'swarm thinning is gradual and capped',
);
ok(
  comboLine(49) === null &&
    comboLine(50) === 'great' &&
    comboLine(100) === 'awesome' &&
    comboLine(150) === 'unstoppable',
  'combo lines use rising milestones',
);
ok(
  weaponSamples.scatter !== weaponSamples.shoot && weaponSamples.laser !== weaponSamples.zap,
  'formerly generic weapons have distinct samples',
);
ok(
  cuePriority('bossSlam') > cuePriority('die') && cuePriority('w:shoot') > cuePriority('hit'),
  'important cues outrank swarm impacts',
);
ok(
  announcementCooldown('level_up') === 45 && announcementCooldown('elite') === 18,
  'routine announcements have long cooldowns',
);
ok(
  manifestIds({ voice: ['vo_go', '../bad', 'vo_go'], sfx: ['dash', 'x.mp3', null] }).join() ===
    'vo_go,dash',
  'manifest ids validated, deduplicated and voice-first',
);
ok(
  manifestIds(null).length === 0 && manifestIds({ sfx: 'bad' }).length === 0,
  'malformed optional manifest is harmless',
);

const pack = manifestIds(JSON.parse(readFileSync('public/audio/manifest.json', 'utf8')));
ok(
  [...Object.values(weaponSamples), ...Object.values(cueSamples)].every((id) => pack.includes(id)),
  'every mapped sample exists in the recorded manifest',
);

let stolen = 0;
const budget = new VoiceBudget(2);
const end = budget.acquire('die', 0, 1, () => stolen++);
ok(!!end && !budget.acquire('die', 0, 1, () => {}), 'per-sound limit enforced');
budget.acquire('weapon', 3, 2, () => stolen++);
ok(
  !budget.acquire('swarm', 0, 2, () => {}) && budget.count === 2,
  'low priority cannot overrun global budget',
);
const bossEnd = budget.acquire('boss', 4, 1, () => {});
ok(!!bossEnd && stolen === 1 && budget.count === 2, 'boss steals the weakest voice at capacity');
end?.();
ok(budget.count === 2, 'late end callback from stolen voice cannot release a replacement');
bossEnd?.();
bossEnd?.();
ok(budget.count === 1, 'release is idempotent');

// Small WebAudio stand-ins exercise actual loading/playback cleanup and announcement policy.
class Param {
  value = 1;
}
class Node {
  gain = new Param();
  pan = new Param();
  frequency = new Param();
  playbackRate = new Param();
  onended: (() => void) | null = null;
  buffer: unknown;
  type = '';
  disconnected = false;
  connect(node: Node) {
    return node;
  }
  disconnect() {
    this.disconnected = true;
  }
  start() {}
  stop() {
    this.onended?.();
  }
}
let created = 0;
const sources: Node[] = [];
const context = {
  currentTime: 10,
  state: 'running',
  createBufferSource() {
    created++;
    const n = new Node();
    sources.push(n);
    return n;
  },
  createGain: () => new Node(),
  createStereoPanner: () => new Node(),
  createBiquadFilter: () => new Node(),
  async decodeAudioData() {
    return { duration: 0.5 };
  },
} as unknown as AudioContext;
const output = new Node() as unknown as AudioNode;
const originalFetch = globalThis.fetch;
let fetches = 0;
globalThis.fetch = (async (url: string) => {
  fetches++;
  if (url.endsWith('manifest.json'))
    return {
      ok: true,
      json: async () => ({
        voice: ['vo_go', 'vo_boss', 'vo_level_up', 'vo_parry'],
        sfx: ['dash', 'missing'],
      }),
    };
  return { ok: !url.includes('missing'), arrayBuffer: async () => new ArrayBuffer(8) };
}) as typeof fetch;
const engine = new SampleEngine();
ok(
  fetches === 0 && engine.play('dash') === null,
  'no fetch or audio before gesture initialization',
);
engine.init(context, { sfx: output, ui: output }, () => true);
await engine.ready;
ok(
  !!engine.buffer('dash') && !engine.buffer('missing'),
  'pack loads while missing files leave fallback available',
);
const fetched = fetches;
engine.init(context, { sfx: output, ui: output }, () => true);
ok(fetches === fetched, 'repeated gestures do not reload the pack');
const played = engine.play('dash', { pitch: 1.2, variation: 0 });
ok(
  played?.duration === 0.5 / 1.2 && engine.budget.count === 1,
  'sample pitch and lifecycle are tracked',
);
ok(!engine.play('dash'), 'cooldown suppresses repeated sample');
played?.stop();
ok(
  engine.budget.count === 0 && sources.at(-1)!.disconnected,
  'stopping sample releases budget and audio nodes',
);
(context as any).currentTime += 1;
const natural = engine.play('dash');
sources.at(-1)!.onended?.();
natural?.stop();
ok(engine.budget.count === 0, 'natural completion and later stop release once');
const before = created;
(context as any).state = 'suspended';
ok(!engine.play('dash') && created === before, 'suspended context does not allocate voices');
(context as any).state = 'running';

samples.init(context, { sfx: output, ui: output }, () => true);
await samples.ready;
let ducks = 0;
const duckDurations: number[] = [];
announcer.configure(
  () => context.currentTime,
  (seconds) => {
    ducks++;
    duckDurations.push(seconds);
  },
);
ok(
  announcer.say('vo_go') && !announcer.say('level_up'),
  'announcer accepts prefixed ids and drops lower-priority chatter',
);
ok(
  announcer.say('boss') && ducks === 2,
  'boss interrupts a lower-priority announcement and ducks effects',
);
(context as any).currentTime += 4;
ok(announcer.say('level_up'), 'announcer allows next line after spacing');
(context as any).currentTime += 10;
ok(!announcer.say('level_up'), 'occasional level-up cooldown prevents spam');
announcerSettings.enabled = false;
announcer.update();
ok(
  !announcer.say('parry') && samples.budget.count === 0,
  'announcer toggle stops current line and prevents new lines',
);
announcerSettings.enabled = true;
announcer.reset();

ok(announcer.say('parry'), 'enabled announcer resumes after reset');
announcerSettings.enabled = false;
announcer.update();
ok(duckDurations.at(-1) === 0, 'disabling a speaking announcer releases its duck immediately');
announcerSettings.enabled = true;
const held: (() => void)[] = [];
for (let i = 0; i < soundTuning.voices; i++)
  held.push(engine.budget.acquire('held' + i, 100, 1, () => {})!);
(context as any).currentTime += 1;
const countBefore = created;
ok(
  !engine.play('dash') && created === countBefore,
  'budget rejection does not allocate WebAudio nodes',
);
for (const release of held) release();

const offline = new SampleEngine();
globalThis.fetch = async () => {
  throw new Error('offline');
};
offline.init(context, { sfx: output, ui: output }, () => true);
await offline.ready;
ok(
  !offline.play('dash') && offline.budget.count === 0,
  'offline manifest failure resolves without playback or rejection',
);

const undecodable = new SampleEngine();
globalThis.fetch = (async (url: string) =>
  url.endsWith('manifest.json')
    ? { ok: true, json: async () => ({ sfx: ['dash'] }) }
    : { ok: true, arrayBuffer: async () => new ArrayBuffer(0) }) as typeof fetch;
const badDecoder = {
  ...context,
  decodeAudioData: async () => {
    throw new Error('unsupported MP3');
  },
} as AudioContext;
undecodable.init(badDecoder, { sfx: output, ui: output }, () => true);
await undecodable.ready;
ok(
  !undecodable.buffer('dash'),
  'decode rejection leaves synth fallback available without rejecting startup',
);
globalThis.fetch = originalFetch;
ok(soundTuning.voices === 32, 'combined sample/synth cue budget stays bounded');
