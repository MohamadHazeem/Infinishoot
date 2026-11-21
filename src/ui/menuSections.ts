import { localize, t } from '../i18n';
import { played } from './menuRun';
import type { Screens } from './screens';
import { prompt } from './prompts';

function button(label: string, action?: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.dataset.nav = '';
  b.textContent = label;
  if (action) b.onclick = action;
  return b;
}

/** Keep delegated actions and third-party redraw anchors inside their original screens. */
function fold(el: HTMLElement, selector: string, closed: boolean): void {
  for (const child of el.querySelectorAll<HTMLElement>(selector)) {
    child.toggleAttribute('data-menu-folded', closed);
    child.toggleAttribute('inert', closed);
  }
}

const lobbyDetails = [
  '.relay-field', '.mp-choice > :not([data-act=mp-host]):not([data-act=lb-open])', '.join-row .sp-joinbtn',
  '.lobby > :not(.code-label,.code-big,.players,.lob-x,.section,.mp-kind-row,.mp-diff-row,.mp-kind-note,.mp-diff-note)',
  '.lob-kicks', '.lob-acts [data-act=lob-invite]', '.chat-box', '.lob-chat', '.mp-heat', '[data-act=lo-online]', '.tl-entry',
].join(',');

export function onlineMenu(el: HTMLElement): void {
  const room = !el.querySelector<HTMLElement>('.lobby')!.hidden;
  let more = el.querySelector<HTMLButtonElement>('[data-room-more]');
  const footer = el.querySelector('[data-act=mp-leave]')!.parentElement!;
  if (!more) {
    more = button(t('menus.more'), () => {
      more!.setAttribute('aria-expanded', String(more!.getAttribute('aria-expanded') !== 'true'));
      onlineMenu(el);
      el.scrollTop = 0;
      const list = el.querySelector<HTMLElement>('.lobby');
      if (list) list.scrollTop = 0;
    });
    more.dataset.roomMore = '';
    footer.prepend(more);
  }
  if (more.dataset.room !== String(room)) {
    more.dataset.room = String(room);
    more.setAttribute('aria-expanded', 'false');
  }
  const expanded = more.getAttribute('aria-expanded') === 'true';
  more.textContent = (expanded ? '− ' : '+ ') + t('menus.more');
  el.classList.toggle('room-options', expanded);
  el.querySelector('h1')!.textContent = expanded ? t('menus.more') : t('menus.online');
  if (room) {
    fold(el, '.lobby > .section,.lobby > .mp-diff-row,.lobby > .mp-kind-row,.mp-diff-note,.mp-kind-note', expanded);
  }
  fold(el, lobbyDetails, !expanded);
  const browse = el.querySelector<HTMLElement>('[data-act=lb-open]');
  if (browse) {
    let row = el.querySelector<HTMLElement>('.room-browser');
    if (!row) {
      row = document.createElement('div');
      row.className = 'menu row room-browser';
      el.querySelector('.join-row')!.after(row);
      row.append(browse);
    }
    row.hidden = room;
  }
  const note = el.querySelector<HTMLElement>(':scope > .note');
  if (note) { note.hidden = room; note.textContent = t('menus.onlineHint'); }
}

export function pauseMenu(el: HTMLElement, reset: boolean): void {
  let build = el.querySelector<HTMLButtonElement>('[data-menu-build]');
  if (!build) {
    build = button(t('menus.build'), () => {
      build!.setAttribute('aria-expanded', String(build!.getAttribute('aria-expanded') !== 'true'));
      pauseMenu(el, false);
    });
    build.dataset.menuBuild = '';
    el.querySelector('[data-act=settings]')!.after(build);
  }
  if (reset) build.setAttribute('aria-expanded', 'false');
  const expanded = build.getAttribute('aria-expanded') === 'true';
  el.classList.toggle('build-open', expanded);
  fold(el, ':scope > .build, :scope > .pause-info, .sets-col, [data-act=photo], .tl-entry, [data-tr=open]', !expanded);
}

const collectionLabels: Record<string, string> = {
  'ob-codex': 'menus.gearGuide', wardrobe: 'menus.outfits', 'cu-open': 'menus.look',
  rewards: 'menus.specialRewards', 'cp-open': 'menus.compete',
};
const groups = [
  { key: 'menus.personal', actions: ['m2-profile', 'sp-season', 'm2-achievements', 'unlocks', 'rewards', 'history', 'activity'] },
  { key: 'menus.library', actions: ['wardrobe', 'cu-open', 'ob-codex', 'bestiary', 'codex', 'jukebox', 'event'] },
  { key: 'menus.challenges', actions: ['cp-open', 'gh-open', 'gr-open', 'ae-open', 'fr-open-x'] },
] as const;

export class CollectionMenu {
  private readonly panel: HTMLElement;
  private readonly activity: HTMLElement;
  private readonly back: HTMLElement;
  constructor(private readonly root: HTMLElement, private readonly screens: Screens) {
    const screen = root.querySelector<HTMLElement>('#scr-extras')!;
    this.panel = screen.querySelector('.menu')!;
    this.back = this.panel.querySelector('[data-act=ex-back]')!;
    screen.querySelector('h1')!.textContent = t('menus.collection');
    for (const group of groups) {
      const section = document.createElement('section');
      section.dataset.group = group.key;
      const heading = document.createElement('h2');
      heading.textContent = t(group.key);
      section.append(heading);
      this.panel.append(section);
    }
    const add = (act: string, label: string, open?: () => void) => {
      const b = button(label, open); b.dataset.act = act; this.panel.append(b);
    };
    add('activity', t('menus.activity'), () => screens.show('activity'));
    add('codex', localize('CODEX & LORE'));
    add('event', t('menus.event'), () => root.querySelector<HTMLElement>('.ha-booth')?.click());
    this.activity = document.createElement('div');
    this.activity.id = 'scr-activity'; this.activity.className = 'screen dim';
    this.activity.innerHTML = `<h1>${t('menus.activity')}</h1><div class="activity-list"></div>`;
    const leave = button(localize('BACK'), () => screens.show('extras'));
    leave.dataset.menuBack = '';
    leave.innerHTML = prompt('back') + ' ' + localize('BACK');
    this.activity.append(leave);
    screens.addScreen('activity', this.activity, { onBack: () => screens.show('extras') });
  }

  open(): void {
    const unlocks = this.root.querySelector<HTMLElement>('#scr-title [data-act=unlocks]');
    if (unlocks) this.panel.append(unlocks);
    for (const b of this.panel.querySelectorAll<HTMLElement>('button')) {
      if (b === this.back) continue;
      const label = collectionLabels[b.dataset.act ?? ''];
      if (label) b.textContent = t(label);
      const group = groups.find(g => (g.actions as readonly string[]).includes(b.dataset.act ?? '')) ?? groups[1];
      const section = this.panel.querySelector(`[data-group="${group.key}"]`)!;
      if (b.parentElement !== section) section.append(b);
    }
    this.panel.append(this.back);
    const booth = this.root.querySelector<HTMLElement>('.ha-booth');
    this.panel.querySelector<HTMLElement>('[data-act=event]')!.hidden = !booth || booth.hidden || (!played() && !this.root.querySelector('#scr-title.ha-title'));
    for (const act of ['history','gr-open','gh-open']) {
      const b = this.panel.querySelector<HTMLElement>(`[data-act="${act}"]`);
      if (b) b.hidden = !played();
    }
  }

  showActivity(): void {
    const list = this.activity.querySelector('.activity-list')!;
    list.replaceChildren();
    const title = this.root.querySelector('#scr-title')!;
    for (const node of title.querySelectorAll<HTMLElement>('.ft-list, .hiscores, #m2-title')) {
      if (node.hidden || !node.textContent?.trim()) continue;
      const copy = node.cloneNode(true) as HTMLElement;
      copy.removeAttribute('id'); copy.classList.add('activity-card');
      for (const b of copy.querySelectorAll<HTMLElement>('[data-act]')) {
        b.onclick = event => {
          event.stopPropagation();
          node.querySelector<HTMLElement>(`[data-act="${b.dataset.act}"]`)?.click();
          this.showActivity(); this.screens.refreshNav();
        };
      }
      list.append(copy);
    }
  }
}
