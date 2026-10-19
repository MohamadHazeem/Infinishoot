import type { Game } from '../game';
import { StoryScreen, type StoryPage } from '../../ui/storyScreen';
import { StoryWorld } from './world';
import { StoryNarrator } from './narrator';
import {
  STORY_INTRO,
  STORY_BOSSES,
  chapterKey,
  endingKey,
  endingText,
  introBeat,
  storyTuning,
  unlockStory,
} from '../../data/story';
import { save, saveLock, persist } from '../save';
import { settings } from '../settings';
import { reduceMotion } from '../../ui/hud';
import { music, type TrackId } from '../../audio/music';
import { t } from '../../i18n';
import { navLock } from '../titlePlay';

type Sequence = 'intro' | 'ending' | 'credits';
export class Story {
  readonly ui: StoryScreen;
  private world: StoryWorld | null = null;
  private narrator = new StoryNarrator();
  private sequence: Sequence | null = null;
  private frame = 0;
  private time = 0;
  private beat = -1;
  private hero = 'rookie';
  private first = true;
  private stage = 0;
  private previousTrack: TrackId | null = null;
  private audioStartedAt = -1;
  private preview = false;
  private pendingEnding = false;
  private automaticEnding = false;
  /** Test links pin a sequence page (no profile writes). */
  pin = false;
  constructor(
    private g: Game,
    root: HTMLElement,
  ) {
    this.ui = new StoryScreen(root, g.screens, {
      intro: () => this.play('intro'),
      ending: (id) => this.play('ending', id),
      credits: () => this.play('credits'),
      next: () => this.next(),
      skip: () => this.close(),
    });
  }
  get active(): boolean {
    return this.sequence !== null;
  }
  play(sequence: Sequence, hero = this.g.hero.heroDef.id, preview = false, frame?: number): void {
    this.close();
    this.preview = preview;
    this.automaticEnding = false;
    this.sequence = sequence;
    this.hero = hero;
    this.stage = this.g.stage;
    this.frame = frame ?? (sequence === 'intro' ? -2 : sequence === 'credits' ? 2 : 0);
    this.previousTrack = music.jukebox;
    this.page();
  }
  /** Delivered only by the host's existing effects bus, including on clients. */
  event(kind: string, id: string): boolean {
    if (kind === 'story-chapter') {
      if (
        this.g.mode !== 'title' &&
        !saveLock.on &&
        STORY_BOSSES.some((b) => b.id === id) &&
        unlockStory(save.discovered, chapterKey(id))
      ) {
        persist();
        this.g.hud.toast(t('story.unlocked'), 3);
      }
      return true;
    }
    if (kind !== 'ending') return false;
    if (this.g.mode === 'title' || saveLock.on) return true;
    if (unlockStory(save.discovered, endingKey(this.g.hero.heroDef.id))) persist();
    this.pendingEnding = settings.cinematics !== 'off';
    return false;
  }
  finishEnding(skipped: boolean): void {
    if (this.pendingEnding && !skipped) {
      this.play('ending');
      this.automaticEnding = true;
    }
    this.pendingEnding = false;
  }
  tick(dt: number): boolean {
    const g = this.g;
    if (this.first) {
      this.first = false;
      const test =
        typeof location !== 'undefined' && new URLSearchParams(location.search).has('test');
      if (
        typeof location !== 'undefined' &&
        !test &&
        g.mode === 'title' &&
        g.screens.current === 'title' &&
        !g.online &&
        !save.discovered.includes(STORY_INTRO) &&
        settings.cinematics !== 'off'
      )
        this.play('intro');
    }
    if (!this.sequence) return false;
    if (
      this.automaticEnding &&
      this.sequence === 'ending' &&
      (g.mode === 'fight' || g.mode === 'title' || g.stage !== this.stage)
    ) {
      this.close();
      return false;
    }
    if (
      !this.preview &&
      this.sequence === 'intro' &&
      (g.mode !== 'title' || !['title', 'story'].includes(g.screens.current))
    ) {
      this.close();
      return false;
    }
    // Online playback never holds the team. Leave immediately when they move on.
    if (g.online && (g.stage !== this.stage || g.mode === 'transition' || g.mode === 'fight')) {
      this.close();
      return false;
    }
    navLock.move = false;
    this.ui.tick(g.input, dt);
    if (!this.sequence) {
      g.input.endStep();
      return false;
    }
    if (this.frame !== -2 && !this.pin) this.time += dt;
    if (this.frame === -1) {
      const b = introBeat(this.time);
      if (b !== this.beat) {
        this.beat = b;
        this.flightPage();
      }
      if (this.time >= storyTuning.flyover) this.next();
    } else if (this.frame >= 0) {
      this.narrator.tick();
      if (this.narrator.duration > 0 && this.audioStartedAt < 0) this.audioStartedAt = this.time;
      const credits = this.frame === (this.sequence === 'intro' ? 3 : 2);
      if (credits) {
        music.jukebox = 'title';
        this.ui.credits(this.time, reduceMotion());
        // Reduced motion credits are a readable, manually scrollable page.
        if (!reduceMotion() && this.time >= storyTuning.credits) this.next();
      } else {
        const duration =
          settings.cinematics === 'short' ? storyTuning.shortPanel : storyTuning.panel;
        const audioEnd =
          this.audioStartedAt < 0 ? 0 : this.audioStartedAt + this.narrator.duration + 0.4;
        if (this.time >= Math.max(duration, audioEnd)) this.next();
      }
    }
    const hold = this.active && !g.online;
    if (this.active) g.input.endStep();
    return hold;
  }
  draw(): void {
    if (this.sequence === 'intro' && this.frame < 0) {
      this.world ??= new StoryWorld(this.g.scene);
      this.world.draw(this.g.cam.camera, this.frame === -2 ? 0 : this.time, reduceMotion());
    } else this.world?.hide(this.g.cam.camera);
  }
  next(): void {
    if (!this.sequence) return;
    if (!this.pin && this.frame !== -2 && this.time < storyTuning.minSkip) return;
    this.pin = false;
    if (this.sequence !== 'intro' && this.frame === 2 && reduceMotion() && this.ui.advanceCredits())
      return;
    this.frame++;
    if (this.frame >= 3) {
      this.close();
      return;
    }
    this.page();
  }
  close(): void {
    if (this.sequence === 'intro' && !this.preview && unlockStory(save.discovered, STORY_INTRO))
      persist();
    if (this.sequence && music.jukebox === 'title') music.jukebox = this.previousTrack;
    this.sequence = null;
    this.pin = false;
    this.narrator.stop();
    this.ui.close();
    this.world?.hide(this.g.cam.camera);
  }
  private flightPage(): void {
    this.ui.showPage({
      title: ['story.islands', 'story.swarm', 'story.landing'][this.beat] as StoryPage['title'],
      caption: '',
      flight: true,
    });
  }
  private page(): void {
    this.time = 0;
    this.audioStartedAt = -1;
    this.narrator.cue('');
    this.beat = -1;
    if (this.frame === -2) {
      this.ui.showPage({ title: 'story.intro', caption: 'story.sound', flight: true, gate: true });
      return;
    }
    if (this.frame === -1) {
      this.beat = 0;
      this.flightPage();
      return;
    }
    if (this.frame === 2 && this.sequence !== 'intro') {
      this.ui.showPage({ title: 'story.credits', caption: 'story.thanks', credits: true });
      this.narrator.cue('story_credits');
      this.ui.credits(0, reduceMotion());
      return;
    }
    if (this.sequence === 'intro') {
      this.ui.showPage({
        title: ['story.islands', 'story.swarm', 'story.landing'][this.frame] as StoryPage['title'],
        caption: ['story.intro1', 'story.intro2', 'story.intro3'][
          this.frame
        ] as StoryPage['caption'],
        comic: this.frame,
      });
      this.narrator.cue(`story_intro_${this.frame + 1}`);
    } else {
      this.ui.showPage({
        title: this.frame === 0 ? 'story.ending' : 'story.home',
        caption: this.frame === 0 ? 'story.endingVoice' : endingText(this.hero),
        comic: this.frame,
        ending: true,
        hero: this.hero,
      });
      if (this.frame === 0) this.narrator.cue('story_ending');
    }
  }
}
