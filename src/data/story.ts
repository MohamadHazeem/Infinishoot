import { HEROES } from './heroes';
import { ENEMIES } from './enemies';
import { storyEn } from '../game/story/strings';

export type StoryKey = keyof typeof storyEn;
export interface StoryEntry {
  id: string;
  name: string;
  kind: 'hero' | 'boss';
  bio: StoryKey;
  chapter?: StoryKey;
  chapterTitle?: StoryKey;
}
export const STORY_HEROES: StoryEntry[] = HEROES.map((h) => ({
  id: h.id,
  name: h.name,
  kind: 'hero',
  bio: `story.hero.${h.id}` as StoryKey,
}));
// Include the hidden Titan body, but never its targetable armour pieces.
export const STORY_BOSSES: StoryEntry[] = Object.values(ENEMIES)
  .filter((e) => e.boss || e.miniboss)
  .map((e) => ({
    id: e.id,
    name: e.name,
    kind: 'boss',
    bio: `story.boss.${e.id}` as StoryKey,
    chapter: `story.chapter.${e.id}` as StoryKey,
    chapterTitle: `story.chapter.${e.id}.title` as StoryKey,
  }));
export const STORY_CREDITS: StoryKey[] = [
  'story.creditTeam',
  'story.creditBuilders',
  'story.creditIcons',
  'story.creditFonts',
  'story.creditArabic',
  'story.creditPalette',
  'story.creditAudio',
  'story.creditTech',
  'story.thanks',
];
export const storyTuning = { flyover: 9, panel: 8, credits: 28, shortPanel: 5, minSkip: 0.25 };
export const STORY_INTRO = 'story:intro';
export const chapterKey = (id: string): string => `story:boss:${id}`;
export const endingKey = (id: string): string => `story:ending:${id}`;
export function endingText(id: string): StoryKey {
  return `story.end.${STORY_HEROES.some((h) => h.id === id) ? id : 'rookie'}` as StoryKey;
}
/** Mutate the existing exportable discovery list, without changing the save schema. */
export function unlockStory(discovered: string[], key: string): boolean {
  if (discovered.includes(key)) return false;
  if (
    key !== STORY_INTRO &&
    !STORY_BOSSES.some((b) => chapterKey(b.id) === key) &&
    !STORY_HEROES.some((h) => endingKey(h.id) === key)
  )
    return false;
  discovered.push(key);
  return true;
}
export function introBeat(seconds: number): number {
  return Math.min(2, Math.max(0, Math.floor(seconds / 3)));
}
export function creditOffset(
  seconds: number,
  height: number,
  viewport: number,
  duration = storyTuning.credits,
): number {
  return viewport - Math.min(1, Math.max(0, seconds / duration)) * (height + viewport);
}
