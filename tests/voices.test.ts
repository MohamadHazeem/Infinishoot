/** Voices lane: voice channel priorities, boss voices, hero barks, materials, sound tuning. */
import { ok } from './check';
import { readFileSync } from 'node:fs';
(globalThis as any).window = { addEventListener() {} };
const V = await import('../src/audio/voices');
const { voiceGate } = await import('../src/audio/announcer');
const { ENEMIES, ENEMY_MATERIALS, BOSS_ORDER, MINI_BOSSES } = await import('../src/data/enemies');
const T = await import('../src/audio/soundTuning');
const { HEROES } = await import('../src/data/heroes');

const manifest = JSON.parse(readFileSync('public/audio/manifest.json', 'utf8')) as { sfx: string[]; voice: string[] };
const have = new Set([...manifest.sfx, ...manifest.voice]);

// ---- voice channel
{
  const c = new V.VoiceChannel();
  let stopped = 0;
  c.claim(5, 0, 2, () => stopped++);
  ok(c.blocks(5, 0.5) && c.blocks(3, 0.5), 'equal or lower priority waits while a line plays');
  ok(!c.blocks(20, 0.5), 'a higher priority may cut a line that has a while left');
  c.claim(20, 0.5, 2, () => {});
  ok(stopped === 1, 'cutting in stops the lower line');
  ok(c.blocks(30, 2.2), 'a higher line waits politely when the current one is about to end');
  ok(!c.blocks(1, 2.5 + V.voiceTuning.gap + 0.01), 'free again after the line and the gap');
  let ran = '';
  const line = (p: number, tag: string) => () => (c.claim(p, 3, 1, () => {}), (ran += tag), true);
  c.enqueue(4, 3, 10, line(4, 'a'));
  c.enqueue(9, 3, 10, line(9, 'b'));
  c.enqueue(9, 3, 10, line(9, 'B'));
  ok(c.queued === 2, 'one queued line per priority (newest wins)');
  c.update(2.9);
  ok(ran === '', 'queued lines wait for their start time');
  c.update(3);
  ok(ran === 'B', 'the best queued line plays first');
  c.update(3.1);
  ok(ran === 'B', 'one queued line at a time per frame (the started one claims the channel)');
  c.enqueue(1, 0, 0.5, () => ((ran += 'x'), true));
  c.update(4);
  ok(!ran.includes('x'), 'expired queued lines are dropped');
  for (let i = 0; i < 8; i++) c.enqueue(i, 100, 200, () => true);
  ok(c.queued <= 4, 'the queue stays short');
  c.reset();
  ok(c.queued === 0 && c.remaining(0) === 0 && c.current === -1, 'reset clears everything');
}

// ---- the announcer shares the channel
{
  let now = 0;
  V.setVoiceClock(() => now);
  V.voiceChannel.reset();
  V.voiceChannel.claim(V.VOICE_PRIORITY.boss.intro, 0, 3, () => {});
  let retried = false;
  ok(voiceGate.blocks(10 + 9, () => ((retried = true), true)), 'announcer waits while a boss talks');
  now = 3 + V.voiceTuning.gap + 0.01;
  V.updateVoices();
  ok(retried, 'the blocked announcement is retried when the boss is done');
  V.voiceChannel.reset();
  V.voiceChannel.claim(V.VOICE_PRIORITY.bark.start, now, 2, () => {});
  ok(!voiceGate.blocks(10 + 1, undefined), 'any announcement outranks a hero bark');
  ok(V.VOICE_PRIORITY.boss.phase > 20 && Math.max(...Object.values(V.VOICE_PRIORITY.bark)) < 11, 'barks < announcer (11..20) < boss lines');
  V.voiceChannel.reset();
}

// ---- boss voices
{
  ok(BOSS_ORDER.every((id) => V.bossVoiceId(ENEMIES[id]) === id), 'each stage boss has its own voice');
  ok(BOSS_ORDER.every((id) => ['intro', 'phase', 'defeat'].every((l) => have.has(`boss_${id}_${l}`)) && have.has('roar_' + id)), 'every boss line and roar is in the pack');
  ok(have.has('choir_stab'), 'choir stab is in the pack');
  ok(V.bossVoiceCue(ENEMIES.rex, 'phase') === 'v:b:rex:phase', 'stage boss cue');
  ok(MINI_BOSSES.every((m) => V.bossVoiceCue(ENEMIES[m.id], 'intro') === `v:m:${m.of}:intro`), 'mini-bosses borrow their parent roar');
  ok(V.bossVoiceCue(ENEMIES.bopper, 'intro') === '' && V.bossVoiceCue(ENEMIES.reaper, 'defeat') === '', 'regular enemies and the Reaper have no voice');
  ok(V.playVoiceCue('v:b:king:intro', 1, 0, 1) && !V.playVoiceCue('v:b:king:bogus', 1, 0, 1) && !V.playVoiceCue('hit', 1, 0, 1), 'voice cues parse safely without audio');
}

// ---- hero barks
{
  const kinds = Object.keys(V.VOICE_PRIORITY.bark) as (keyof typeof V.VOICE_PRIORITY.bark)[];
  ok(HEROES.every((h) => kinds.every((k) => have.has(V.barkSample(h.id, k)))), 'every hero has every bark in the pack');
  ok(V.barkSample('nobody', 'win') === 'bark_rookie_win', 'unknown heroes use the Rookie voice');

  const b = new V.BarkBrain();
  const base = { now: 0, fighting: true, hp01: 1, dead: false, level: 1, kills: 0, evolved: 0, boss: false, cleared: false, heroes: 1 };
  const yes = () => 0;
  const no = () => 0.99;
  let call = b.step({ ...base }, no);
  ok(call?.kind === 'start' && call.delay > 0, 'run start bark, after the GO');
  ok(b.step({ ...base, now: 1 }, yes) === null, 'nothing more without events');
  // Low HP: once per dip, and barks keep their distance.
  call = b.step({ ...base, now: 5, hp01: 0.2 }, no);
  ok(call === null, 'min gap holds even for urgent lines right after another bark');
  call = b.step({ ...base, now: 20, hp01: 0.2 }, no);
  ok(call === null, 'the low-HP dip that was skipped is not repeated while still low');
  b.step({ ...base, now: 21, hp01: 0.8 }, no);
  call = b.step({ ...base, now: 30, hp01: 0.25 }, no);
  ok(call?.kind === 'lowhp', 'low HP bark after recovering and dipping again');
  ok(b.step({ ...base, now: 60, hp01: 0.25 }, no) === null, 'only once per dip');
  // Revive.
  b.step({ ...base, now: 61, dead: true, hp01: 0 }, no);
  call = b.step({ ...base, now: 70, dead: false, hp01: 0.5 }, no);
  ok(call?.kind === 'revive', 'revived bark');
  // Level-ups are rare.
  ok(b.step({ ...base, now: 100, level: 2 }, no) === null, 'level-up bark skipped on a failed roll');
  call = b.step({ ...base, now: 101, level: 3 }, yes);
  ok(call?.kind === 'level', 'level-up bark on a lucky roll');
  ok(b.step({ ...base, now: 120, level: 4 }, yes) === null, 'level-up bark has its own long cooldown');
  // Boss, evolution, win.
  call = b.step({ ...base, now: 200, level: 4, boss: true }, no);
  ok(call?.kind === 'boss' && call.delay >= 3, 'boss bark waits for the boss intro');
  call = b.step({ ...base, now: 230, level: 4, boss: true, evolved: 1 }, no);
  ok(call?.kind === 'evolve', 'evolution bark');
  call = b.step({ ...base, now: 260, level: 4, boss: false, evolved: 1, cleared: true }, no);
  ok(call?.kind === 'win', 'stage win bark');
  // Multi-kill: a burst of kills inside the window; co-op needs more.
  b.step({ ...base, now: 300, level: 4, evolved: 1, kills: 100 }, yes);
  call = b.step({ ...base, now: 300.5, level: 4, evolved: 1, kills: 113 }, yes);
  ok(call?.kind === 'bigkill', 'multi-kill bark');
  b.step({ ...base, now: 400, level: 4, evolved: 1, kills: 200, heroes: 3 }, yes);
  ok(b.step({ ...base, now: 400.5, level: 4, evolved: 1, kills: 215, heroes: 3 }, yes) === null, 'co-op multi-kill needs a bigger burst');
  // Never spammy: over a long simulated run with constant events, barks stay rare.
  const s = new V.BarkBrain();
  let n = 0;
  for (let t = 0; t < 600; t += 1 / 30) {
    const k = Math.floor(t * 30);
    if (s.step({ ...base, now: t, level: 1 + Math.floor(t / 20), kills: k * 2, hp01: 0.2 + 0.7 * (Math.floor(t / 7) % 2) }, Math.random)) n++;
  }
  ok(n <= 600 / V.barkTuning.minGap + 1, `barks stay occasional under constant events (${n} in 10 min)`);
}

// ---- materials
{
  ok(Object.values(ENEMIES).every((d) => !!d.material), 'every enemy (veterans included) has a material');
  ok(Object.keys(ENEMY_MATERIALS).every((id) => ENEMIES[id]), 'material table names real enemies');
  ok(ENEMIES.v_splitter.material === 'slime' && ENEMIES.shielder.material === 'shield', 'veterans inherit; shield bots clang');
  ok(Object.values(V.MATERIAL_SAMPLES).every((id) => have.has(id)), 'every material has an impact sample');
  ok(V.impactCue('slime', false) === 'm:slime' && V.impactCue('slime', true) === 'm:slime:c', 'hit and crit cues per material');
  ok(V.impactCue('flesh', false, true) === 'm:shield' && V.impactCue(undefined, false) === 'm:flesh', 'shielded hits clang, unknown is flesh');
  ok(V.impactCue('stone', true) === V.impactCue('stone', true), 'impact cues are prebuilt strings');
  ok(new Set(Object.values(ENEMY_MATERIALS)).size === 5, 'all five materials are used');
}

// ---- sound tuning
{
  const [g, p, v, c] = T.tuned('choir_stab', 1, 1, 0.07, 0.08);
  ok(Math.abs(g - (T.SAMPLE_TUNING.choir_stab.gain ?? 1)) < 1e-9 && p === 1 && v === 0 && c === 0.08, 'shipped tuning multiplies gain and replaces variation');
  ok(T.sampleTune('nothing_here') === T.sampleTune('also_nothing'), 'untuned samples share one empty object (no allocation)');
  T.setSampleTune('w_buster', 'pitch', 1.2);
  T.setSampleTune('w_buster', 'cooldown', 0.2);
  ok(T.tuned('w_buster', 0.5, 1, 0.07, 0.03)[1] === 1.2 && T.tuned('w_buster', 0.5, 1, 0.07, 0.03)[3] === 0.2, 'live edits apply');
  const json = JSON.parse(T.exportSampleTuning()) as Record<string, { pitch?: number }>;
  ok(json.w_buster?.pitch === 1.2 && !!json.choir_stab, 'export merges data and edits');
  T.resetSampleTune('w_buster');
  ok(T.sampleTune('w_buster').pitch === undefined, 'reset drops the edit');
  T.resetSampleTune();
}

// ---- a queued important line keeps the floor
{
  const c = new V.VoiceChannel();
  c.enqueue(22, 1, 5, () => true);
  ok(!c.canStart(3, 0) && c.canStart(3, -5), 'a bark does not start right before a queued boss line');
  ok(c.canStart(30, 0), 'more important lines still can');
}
