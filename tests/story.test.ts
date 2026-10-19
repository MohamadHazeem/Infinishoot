import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import {
  STORY_BOSSES,
  STORY_HEROES,
  STORY_CREDITS,
  STORY_INTRO,
  chapterKey,
  endingKey,
  endingText,
  unlockStory,
  introBeat,
  creditOffset,
} from '../src/data/story';
import { HEROES } from '../src/data/heroes';
import { ENEMIES } from '../src/data/enemies';
import { storyEn, storyAr } from '../src/game/story/strings';
import { FxEncoder, decodeFx, fxRelevant } from '../src/net/fxCodec';

assert.deepEqual(
  STORY_HEROES.map((x) => x.id),
  HEROES.map((x) => x.id),
);
assert.deepEqual(
  STORY_BOSSES.map((x) => x.id).sort(),
  Object.values(ENEMIES)
    .filter((x) => x.boss || x.miniboss)
    .map((x) => x.id)
    .sort(),
);
assert(
  STORY_BOSSES.some((x) => x.id === 'titan'),
  'hidden Titan is a character, not an omitted render primitive',
);
for (const entry of [...STORY_HEROES, ...STORY_BOSSES]) {
  for (const key of [entry.bio, entry.chapter, entry.chapterTitle].filter(Boolean)) {
    assert(storyEn[key!] && storyAr[key!], `${entry.id} has complete bilingual copy`);
  }
}
for (const h of HEROES) assert(storyEn[endingText(h.id)] && storyAr[endingText(h.id)]);
assert.equal(
  new Set(HEROES.map((h) => storyEn[endingText(h.id)])).size,
  HEROES.length,
  'every ending is distinct',
);
assert.equal(endingText('unknown'), endingText('rookie'));
assert.deepEqual(Object.keys(storyEn), Object.keys(storyAr));
const sounds = readFileSync('scripts/audio/sounds.mjs', 'utf8');
for (const [key, id] of [
  ['story.intro1', 'story_intro_1'],
  ['story.intro2', 'story_intro_2'],
  ['story.intro3', 'story_intro_3'],
  ['story.endingVoice', 'story_ending'],
  ['story.thanks', 'story_credits'],
] as const) {
  assert(
    sounds.includes(`id: '${id}', text: "${storyEn[key]}"`),
    `${id} captions match the recording verbatim`,
  );
  assert(readFileSync(`public/audio/${id}.mp3`).byteLength > 1000);
}
assert(STORY_CREDITS.some((k) => storyEn[k].includes('CC BY 3.0')));
assert(STORY_CREDITS.some((k) => storyEn[k].includes('Mansour')));
assert.deepEqual([-1, 0, 2.9, 3, 6, 9].map(introBeat), [0, 0, 0, 1, 2, 2]);
assert.equal(creditOffset(0, 900, 300), 300);
assert.equal(creditOffset(28, 900, 300), -900);
assert.equal(creditOffset(100, 900, 300), -900);
const progress: string[] = [];
assert(unlockStory(progress, STORY_INTRO));
assert(!unlockStory(progress, STORY_INTRO));
assert(!unlockStory(progress, 'story:boss:swarmer'));
assert(unlockStory(progress, chapterKey('omega')));
assert(unlockStory(progress, endingKey('twin')));

// Exercise the real UI, profile normalization, victory hook and effects bus in a DOM.
const dom = new JSDOM(readFileSync('index.html', 'utf8'), {
  url: 'http://localhost/?test',
  pretendToBeVisual: true,
});
const noop: any = new Proxy(function () {}, {
  get: (_t, k) =>
    k === 'data'
      ? new Uint8ClampedArray(64 * 64 * 4)
      : k === Symbol.toPrimitive
        ? () => 0
        : k === 'measureText'
          ? () => ({ width: 10 })
          : noop,
  apply: () => noop,
  set: () => true,
});
(dom.window.HTMLCanvasElement.prototype as any).getContext = function () {
  return new Proxy(noop, {
    get: (_t, k) =>
      k === 'createImageData' || k === 'getImageData'
        ? (w: number, h: number) => ({ data: new Uint8ClampedArray(4 * (w || 64) * (h || 64)) })
        : k === 'canvas'
          ? this
          : noop[k as never],
  });
};
for (const k of [
  'window',
  'document',
  'navigator',
  'localStorage',
  'location',
  'HTMLElement',
  'HTMLCanvasElement',
  'HTMLInputElement',
  'Event',
  'KeyboardEvent',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'getComputedStyle',
  'innerWidth',
  'innerHeight',
  'addEventListener',
  'dispatchEvent',
  'Node',
  'MouseEvent',
]) {
  Object.defineProperty(globalThis, k, { value: (dom.window as any)[k], configurable: true });
}
(globalThis as any).Path2D = class {};
(globalThis as any).__APP_VERSION__ = 'test';
(dom.window.HTMLElement.prototype as any).scrollIntoView = () => {};
(globalThis as any).matchMedia = (dom.window as any).matchMedia = () => ({
  matches: false,
  addEventListener() {},
});
(dom.window.HTMLCanvasElement.prototype as any).toDataURL = () => 'data:image/png;base64,';
const { Game } = await import('../src/game/game');
const { Input } = await import('../src/core/input');
const { save, normalize, saveLock } = await import('../src/game/save');
const { settings } = await import('../src/game/settings');
const { setLanguage } = await import('../src/i18n');
const g = new Game(
  new Input(document.querySelector('canvas')!),
  16 / 9,
  document.getElementById('hud')!,
  document.getElementById('reticle')!,
);
assert.equal(
  normalize({ discovered: progress }).discovered.join(),
  progress.join(),
  'story progress survives old-profile normalization',
);
assert(
  !normalize({ version: 1 }).discovered.includes(STORY_INTRO),
  'legacy saves safely default to unseen',
);
assert(!g.story.tick(0), 'test links never auto-open a first-launch gate');
g.story.play('intro', 'rookie', true, 0);
assert(g.story.tick(0.1), 'solo comic holds simulation');
assert(document.querySelector('#story-play')?.textContent?.includes(storyEn['story.intro1']));
g.story.close();
assert(!save.discovered.includes(STORY_INTRO), 'preview never marks intro seen');
g.story.play('intro');
g.story.close();
assert(save.discovered.includes(STORY_INTRO), 'skip counts as a first viewing');
assert(
  !document.getElementById('hud')!.classList.contains('story-playing'),
  'skip restores underlying menus',
);

g.mode = 'cleared';
g.stage = 4;
settings.cinematics = 'full';
settings.finishers = false;
g.mode = 'fight';
const mini = g.enemies.spawn(ENEMIES.prince, 3, 3, g.spawnOpts({ instant: true }));
assert(!save.discovered.includes(chapterKey('prince')), 'meeting a boss is not a defeat');
g.killEnemy(mini, 'buster', g.hero);
assert(save.discovered.includes(chapterKey('prince')), 'actual killing blow unlocks the chapter');
g.mode = 'cleared';
g.vfx.recording = true;
g.vfx.cine('story-chapter', 0, 0, 0, 'queen');
const event = g.vfx.drain().find((e) => e[0] === 'C')!;
assert(fxRelevant(event, 10000, 10000), 'chapter events reach distant teammates');
let decoded: typeof event | undefined;
decodeFx(new FxEncoder().encode([event]), (e) => {
  decoded = e as typeof event;
});
assert.deepEqual(decoded, event, 'new chapter kind survives the binary effects codec');
assert(save.discovered.includes(chapterKey('queen')));
save.discovered = save.discovered.filter((k) => k !== chapterKey('queen'));
g.role = 'client';
g.vfx.apply(event);
assert(
  save.discovered.includes(chapterKey('queen')),
  'client earns the same chapter from the host effect',
);
g.vfx.apply(event);
assert.equal(
  save.discovered.filter((k) => k === chapterKey('queen')).length,
  1,
  'repeated events cannot duplicate unlocks',
);
saveLock.on = true;
g.story.event('story-chapter', 'rex');
saveLock.on = false;
assert(!save.discovered.includes(chapterKey('rex')), 'attract simulation cannot unlock chapters');
g.story.event('story-chapter', 'made-up');
assert(!save.discovered.includes(chapterKey('made-up')));

g.role = 'solo';
g.story.event('ending', '');
assert(!g.story.active, 'existing painted cinematic runs first');
g.story.finishEnding(true);
assert(!g.story.active, 'skip bypasses the whole epilogue');
g.story.event('ending', '');
g.story.finishEnding(false);
assert(
  g.story.active && save.discovered.includes(endingKey(g.hero.heroDef.id)),
  'normal Omega completion plays and remembers hero ending',
);
g.story.close();
settings.cinematics = 'off';
g.story.event('ending', '');
g.story.finishEnding(false);
assert(!g.story.active, 'cinematics OFF keeps the unlock without playback');
settings.cinematics = 'full';
g.role = 'client';
g.mode = 'shop';
g.story.play('ending');
assert(!g.story.tick(0.1) && g.story.active, 'online epilogue does not hold the team');
g.mode = 'transition';
g.story.tick(0.1);
assert(!g.story.active, 'teammates moving on dismiss the online epilogue');
g.role = 'solo';
g.mode = 'title';
g.screens.show('story');
assert.equal(document.querySelectorAll('#scr-story [data-entry]').length, HEROES.length);
(document.querySelector('[data-tab="chapters"]') as HTMLElement).click();
(document.querySelector('[data-entry="queen"]') as HTMLElement).click();
assert(
  document.querySelector('.story-detail')!.textContent!.includes(storyEn['story.chapter.queen']),
);
(document.querySelector('[data-entry="rex"]') as HTMLElement).click();
assert(document.querySelector('.story-detail')!.textContent!.includes(storyEn['story.locked']));
setLanguage('ar');
assert(document.querySelector('#scr-story h1')!.textContent === storyAr['story.menu']);
setLanguage('en');
(document.querySelector('[data-tab=heroes]') as HTMLElement).click();
(document.querySelector('[data-story=ending]') as HTMLElement).click();
assert(g.story.tick(0.1) && g.story.active, 'unlocked endings replay from the title Story library');
g.story.close();
g.story.play('credits', 'rookie', true);
g.story.close();
console.log(
  'Story: bilingual content, audio captions, profile migration, controls and co-op effects passed.',
);
