import type { Game } from '../game';
import { Story } from '../story/controller';

export function installStory(this: Game, root: HTMLElement): Story {
  return new Story(this, root);
}
export function storyStep(this: Game, dt: number): boolean {
  return this.story.tick(dt);
}
export function renderStory(this: Game): void {
  this.story.draw();
}

/** Preview only: no unlock writes. story=intro|ending|credits|codex, storyframe=-1..2. */
export function storyLinks(g: Game, q: URLSearchParams): void {
  const value = q.get('story');
  if (!value) return;
  if (value === 'codex') {
    g.paused = true;
    g.screens.show('story');
    return;
  }
  if (value !== 'intro' && value !== 'ending' && value !== 'credits') return;
  const n = Number(q.get('storyframe'));
  const frame =
    q.has('storyframe') && Number.isInteger(n)
      ? Math.max(value === 'intro' ? -1 : 0, Math.min(2, n))
      : undefined;
  g.story.play(value, g.hero.heroDef.id, true, frame);
  g.story.pin = q.has('storypin');
}
