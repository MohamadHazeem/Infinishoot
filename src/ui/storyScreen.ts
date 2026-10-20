import { t, localize, escapeHtml as esc, onLanguageChange } from '../i18n';
import {
  STORY_HEROES,
  STORY_BOSSES,
  STORY_CREDITS,
  chapterKey,
  endingKey,
  creditOffset,
  type StoryKey,
} from '../data/story';
import { storyPortrait, comicPanel } from '../game/story/art';
import { save } from '../game/save';
import type { Screens } from './screens';
import { MenuNav } from './menu';
import type { Input } from '../core/input';

const CSS = `
.story-playing > :not(#story-play):not(style) { visibility: hidden !important; }
body:has(.story-playing) #reticle { visibility: hidden !important; }
#scr-story { padding: calc(6 * var(--p)); overflow: auto; }
.story-shell { width: min(100%, 1040px); margin: auto; font-size: calc(22px * var(--text-scale, 1)); }
.story-shell h1 { margin: 0 0 calc(3 * var(--p)); color: var(--yellow); }
.story-tabs { display: flex; flex-wrap: wrap; gap: calc(3 * var(--p)); justify-content: center; margin-block: calc(4 * var(--p)); }
.story-tabs button { font-size: 20px; }
.story-columns { display: grid; grid-template-columns: 1fr 1.1fr; gap: calc(6 * var(--p)); }
.story-list { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); align-content: start; gap: calc(3 * var(--p)); }
.story-list button { min-width: 0; padding: calc(2 * var(--p)); font-size: 17px; white-space: normal; display: flex; flex-direction: column; align-items: center; gap: calc(2 * var(--p)); }
.story-list canvas { width: 64px; height: 64px; image-rendering: pixelated; }
.story-detail { --bg: var(--night); --hi: var(--sky); --lo: var(--ink); --ring: var(--cyan); padding: calc(5 * var(--p)); align-self: start; text-align: start; }
.story-detail canvas { width: 128px; height: 128px; image-rendering: pixelated; float: inline-end; margin-inline-start: calc(4 * var(--p)); }
.story-detail h2 { color: var(--yellow); font-size: 28px; margin-block: calc(3 * var(--p)); }
.story-detail p { line-height: 1.35; }
#story-play { position: fixed; inset: 0; z-index: 1000; display: flex; flex-direction: column; justify-content: space-between; padding: calc(5 * var(--p)); background: var(--ink); pointer-events: auto; overflow: auto; }
#story-play[hidden] { display: none; }
#story-play.story-flight { background: transparent; }
#story-play h1 { color: var(--yellow); margin: 0; text-align: center; font-size: clamp(25px, 4vw, 46px); background: var(--ink); padding: calc(2 * var(--p)); }
.story-page { width: min(960px, 100%); margin: auto; }
.story-comic { display: block; width: 100%; image-rendering: pixelated; max-height: 48vh; object-fit: contain; }
.story-caption { background: var(--white); color: var(--ink); padding: calc(4 * var(--p)); font-size: calc(25px * var(--text-scale, 1)); line-height: 1.25; text-align: start; text-shadow: none; margin: 0; }
.story-caption:empty { display: none; }
.story-flight .story-page { margin-block: auto 0; }
.story-controls { display: flex; flex-wrap: wrap; justify-content: center; gap: calc(4 * var(--p)); margin-top: calc(4 * var(--p)); }
.story-credits-window { height: 52vh; overflow: hidden; background: var(--night); text-align: center; }
.story-credits-roll { padding: calc(5 * var(--p)); font-size: calc(23px * var(--text-scale, 1)); line-height: 1.5; }
.story-credits-roll p { margin-block: calc(12 * var(--p)); }
.story-credits-window.calm { overflow: auto; }
.story-credits-window.calm .story-credits-roll { transform: none !important; }
:lang(ar) .story-detail p, :lang(ar) .story-caption { font-size: calc(19px * var(--text-scale, 1)); line-height: 1.65; }
@media(max-width: 650px) { .story-columns { grid-template-columns: 1fr; } .story-list { grid-template-columns: repeat(4, minmax(0, 1fr)); } .story-list canvas { width: 48px; height: 48px; } .story-list button { font-size: 14px; } .story-caption { font-size: 20px; } }
`;
export interface StoryPage {
  title: StoryKey;
  caption: StoryKey | '';
  comic?: number;
  hero?: string;
  ending?: boolean;
  flight?: boolean;
  credits?: boolean;
  gate?: boolean;
}
export class StoryScreen {
  readonly el = document.createElement('div');
  readonly overlay = document.createElement('div');
  private nav: MenuNav;
  private tab = 'heroes';
  private selected = STORY_HEROES[0];
  private page: StoryPage | null = null;
  private roll: HTMLElement | null = null;
  private window: HTMLElement | null = null;
  private rollHeight = 0;
  private windowHeight = 0;
  constructor(
    root: HTMLElement,
    screens: Screens,
    actions: {
      intro(): void;
      ending(id: string): void;
      credits(): void;
      next(): void;
      skip(): void;
    },
  ) {
    if (!document.getElementById('story-css')) {
      const style = document.createElement('style');
      style.id = 'story-css';
      style.textContent = CSS;
      document.head.appendChild(style);
    }
    this.el.id = 'scr-story';
    this.el.className = 'screen dim';
    screens.addScreen('story', this.el, { columns: 3, onBack: () => screens.show('extras') });
    const button = document.createElement('button');
    button.dataset.nav = '';
    button.textContent = t('story.menu');
    button.onclick = () => screens.show('story');
    const extras = root.querySelector('#scr-extras .menu');
    extras?.insertBefore(button, extras.querySelector('[data-act=ex-back]')); // uipolish: BACK stays last
    const oldShow = screens.onShow;
    screens.onShow = (name) => {
      oldShow?.(name);
      if (name === 'story') this.render();
    };
    this.el.onclick = (event) => {
      const b = (event.target as Element).closest<HTMLElement>('button');
      if (!b) return;
      if (b.dataset.tab) {
        this.tab = b.dataset.tab;
        this.selected = this.tab === 'heroes' ? STORY_HEROES[0] : STORY_BOSSES[0];
        this.render();
        screens.show('story');
      }
      if (b.dataset.entry) {
        this.selected = [...STORY_HEROES, ...STORY_BOSSES].find((x) => x.id === b.dataset.entry)!;
        this.detail();
        screens.show(
          'story',
          6 + [...(this.tab === 'heroes' ? STORY_HEROES : STORY_BOSSES)].indexOf(this.selected),
        );
      }
      if (b.dataset.story === 'intro') actions.intro();
      if (b.dataset.story === 'credits') actions.credits();
      if (b.dataset.story === 'ending') actions.ending(this.selected.id);
      if (b.dataset.story === 'back') screens.show('extras');
    };
    this.overlay.id = 'story-play';
    this.overlay.className = 'screen';
    this.overlay.hidden = true;
    this.overlay.setAttribute('role', 'dialog');
    this.overlay.setAttribute('aria-modal', 'true');
    root.appendChild(this.overlay);
    this.nav = new MenuNav(this.overlay, { horizontal: true, onBack: actions.skip });
    this.overlay.onclick = (event) => {
      const action = (event.target as Element).closest<HTMLElement>('[data-story]')?.dataset.story;
      if (action === 'next') actions.next();
      if (action === 'skip') actions.skip();
    };
    onLanguageChange(() => {
      button.textContent = t('story.menu');
      if (screens.current === 'story') this.render();
      if (this.page) this.showPage(this.page);
    });
  }
  render(): void {
    const entries = this.tab === 'heroes' ? STORY_HEROES : STORY_BOSSES;
    this.el.innerHTML = `<div class="story-shell"><h1>${t('story.menu')}</h1><div class="story-tabs">
      ${['heroes', 'bosses', 'chapters'].map((x) => `<button data-nav data-tab="${x}" aria-pressed="${this.tab === x}">${t('story.' + x)}</button>`).join('')}
      <button data-nav data-story="intro">${t('story.replay')}</button><button data-nav data-story="credits">${t('story.credits')}</button><button data-nav data-story="back">${t('story.back')}</button></div>
      <div class="story-columns"><div class="story-list"></div><article class="story-detail px" aria-live="polite"></article></div></div>`;
    const list = this.el.querySelector('.story-list')!;
    for (const entry of entries) {
      const b = document.createElement('button');
      b.dataset.nav = '';
      b.dataset.entry = entry.id;
      b.appendChild(storyPortrait(entry));
      const name = document.createElement('span');
      name.textContent = localize(entry.name);
      b.appendChild(name);
      list.appendChild(b);
    }
    this.detail();
  }
  private detail(): void {
    const e = this.selected,
      box = this.el.querySelector('.story-detail')!;
    const chapter = this.tab === 'chapters',
      unlocked = save.discovered.includes(chapterKey(e.id));
    box.innerHTML = `<small>${t('story.' + (chapter ? 'chapters' : e.kind === 'hero' ? 'heroes' : 'bosses'))}</small><h2>${chapter && unlocked ? t(e.chapterTitle!) : esc(localize(e.name))}</h2><p>${chapter ? t(unlocked ? e.chapter! : 'story.locked') : t(e.bio)}</p>`;
    box.prepend(storyPortrait(e));
    if (e.kind === 'hero') {
      if (save.discovered.includes(endingKey(e.id))) {
        const b = document.createElement('button');
        b.dataset.nav = '';
        b.dataset.story = 'ending';
        b.textContent = t('story.playEnding');
        box.appendChild(b);
      } else {
        const p = document.createElement('p');
        p.textContent = t('story.endingLocked');
        box.appendChild(p);
      }
    }
  }
  showPage(page: StoryPage): void {
    this.page = page;
    this.overlay.hidden = false;
    this.overlay.parentElement?.classList.add('story-playing');
    this.overlay.classList.toggle('story-flight', !!page.flight);
    this.overlay.setAttribute('aria-label', t(page.title));
    this.overlay.innerHTML = `<h1>${t(page.title)}</h1><div class="story-page">${page.comic !== undefined ? '<canvas class="story-comic"></canvas>' : ''}${page.credits ? `<div class="story-credits-window"><div class="story-credits-roll">${STORY_CREDITS.map((k) => `<p>${esc(t(k))}</p>`).join('')}</div></div>` : ''}<p class="story-caption">${page.caption ? esc(t(page.caption)) : ''}</p></div><div class="story-controls"><button data-nav data-story="next">${t(page.gate ? 'story.begin' : 'story.next')}</button><button data-nav data-story="skip">${t('story.skip')}</button></div>`;
    const canvas = this.overlay.querySelector('canvas');
    if (canvas) comicPanel(canvas, page.comic!, page.hero ?? 'rookie', page.ending);
    this.roll = this.overlay.querySelector('.story-credits-roll');
    this.window = this.overlay.querySelector('.story-credits-window');
    this.rollHeight = this.roll?.offsetHeight ?? 0;
    this.windowHeight = this.window?.clientHeight ?? 0;
    this.nav.refresh();
  }
  tick(input: Input, dt: number): void {
    this.nav.update(input, dt);
  }
  credits(time: number, calm: boolean): void {
    if (!this.roll || !this.window) return;
    this.window.classList.toggle('calm', calm);
    if (!calm)
      this.roll.style.transform = `translateY(${Math.round(creditOffset(time, this.rollHeight, this.windowHeight))}px)`;
  }
  advanceCredits(): boolean {
    if (
      !this.window ||
      this.window.scrollTop + this.window.clientHeight >= this.window.scrollHeight - 2
    )
      return false;
    this.window.scrollTop += this.window.clientHeight * 0.8;
    return true;
  }
  close(): void {
    this.overlay.parentElement?.classList.remove('story-playing');
    this.overlay.hidden = true;
    this.page = null;
    this.roll = this.window = null;
  }
}
