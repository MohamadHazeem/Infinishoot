import { localize, localizeHtml, setLanguage, t } from '../i18n';

import { loadJson } from '../core/storage';

/** Milestones count completed work, not guessed download bytes. */
export function loadingPercent(done: number, total: number): number {
  return total > 0 && Number.isFinite(done) && Number.isFinite(total) ? Math.round(Math.min(1, Math.max(0, done / total)) * 100) : 0;
}

export const LOADING_TIPS = ['menu.tip.move', 'menu.tip.charge', 'menu.tip.gear', 'menu.tip.build'] as const;
export function loadingTip(index: number): string {
  return LOADING_TIPS[((Math.floor(index) || 0) % LOADING_TIPS.length + LOADING_TIPS.length) % LOADING_TIPS.length];
}

/** Tiny code-native hero illustration: available before the game / Three.js chunk downloads. */
const HERO_ART = `<svg viewBox="0 0 64 64" shape-rendering="crispEdges" aria-hidden="true">
<path fill="#29366f" d="M4 54h56v6H4zM8 48h48v6H8z"/>
<path fill="#1a1c2c" d="M22 5h20v4h5v23h-4v4h7v10h-6v13H32v-9h-4v9H16V43h-5V30h9V9h2z"/>
<path fill="#3b5dc9" d="M23 9h18v4h3v18H21V13h2zM21 33h21v15H21zM17 45h10v11H17zM34 45h9v11h-9zM13 32h9v11h-9z"/>
<path fill="#41a6f6" d="M24 10h8v9H22v-6h2zM22 34h17v6H22zM18 47h5v7h-5z"/>
<path fill="#73eff7" d="M23 20h18v9H23zM34 11h5v5h-5z"/>
<path fill="#1a1c2c" d="M26 22h3v4h-3zM35 22h3v4h-3z"/>
<path fill="#ffcd75" d="M28 34h7v4h-7zM42 34h12v10H42z"/>
<path fill="#ef7d57" d="M47 35h8v8h-8z"/><path fill="#f4f4f4" d="M52 36h6v6h-6zM27 10h4v5h-4z"/>
<path fill="#ffcd75" d="M7 13h3v3H7zM53 9h3v3h-3zM55 24h4v4h-4z"/></svg>`;

export class LoadingScreen {
  readonly el: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly label: HTMLElement;
  private readonly status: HTMLElement;
  constructor(compact = false) {
    ensureLoadingCss();
    this.el = document.createElement('section');
    this.el.className = 'menu-loading' + (compact ? ' menu-loading-compact' : '');
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', 'polite');
    this.el.innerHTML = localizeHtml(`<div class="menu-loading-card px">
      <div class="menu-loading-art">${HERO_ART}</div>
      <small>${t('text.infinishoot_3c78cb')}</small><h1>${t('menu.loading')}</h1>
      <p class="menu-loading-status"></p><div class="menu-loading-track" role="progressbar" aria-label="${t('menu.loading')}" aria-valuemin="0" aria-valuemax="100"><i></i></div>
      <b class="menu-loading-count"></b><p class="menu-loading-tip">${t(loadingTip(Math.floor(Date.now() / 1000)))}</p>
    </div>`);
    this.bar = this.el.querySelector('.menu-loading-track')!;
    this.label = this.el.querySelector('.menu-loading-count')!;
    this.status = this.el.querySelector('.menu-loading-status')!;
    document.body.append(this.el);
  }
  progress(done: number, total: number, key: string): void {
    const percent = loadingPercent(done, total);
    this.bar.setAttribute('aria-valuenow', String(percent));
    this.bar.style.setProperty('--loaded', percent + '%');
    this.label.textContent = localize(`${percent}%`);
    this.status.textContent = t(key);
  }
  close(): void { this.el.remove(); }
  fail(retry: () => void): void {
    this.status.textContent = t('menu.load.error');
    const button = document.createElement('button');
    button.textContent = t('menu.load.retry');
    button.onclick = retry;
    this.el.querySelector('.menu-loading-card')!.append(button);
    button.focus();
  }
}

/** Paint before requesting the heavy graph, and keep the shell until the first game frame. */
export async function boot(load: () => Promise<unknown>): Promise<void> {
  const saved = loadJson<{ language?: string }>('settings.v1', {});
  const language = new URLSearchParams(location.search).get('lang') ?? saved.language;
  if (language === 'ar' || language === 'en') setLanguage(language);
  const screen = new LoadingScreen();
  screen.progress(1, 3, 'menu.load.code');
  await painted();
  try {
    await load();
    screen.progress(2, 3, 'menu.load.scene');
    await painted();
    screen.progress(3, 3, 'menu.load.ready');
    await painted();
    screen.close();
  } catch {
    screen.fail(() => location.reload());
  }
}

const painted = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

/** Optional chunks never pause the host. A compact, non-modal panel leaves gameplay input available. */
export async function withLoading<T>(work: () => Promise<T>, key = 'menu.load.code'): Promise<T> {
  let screen: LoadingScreen | undefined;
  const timer = setTimeout(() => {
    screen = new LoadingScreen(true);
    screen.progress(0, 1, key);
  }, 180);
  try { return await work(); }
  finally { clearTimeout(timer); screen?.close(); }
}

function ensureLoadingCss(): void {
  if (document.getElementById('menu-loading-css')) return;
  const style = document.createElement('style');
  style.id = 'menu-loading-css';
  style.textContent = CSS;
  document.head.append(style);
}
const CSS = `
.menu-loading { position: fixed; inset: 0; z-index: 2000; display: grid; place-items: center; overflow: auto; background: var(--ink); padding: calc(8 * var(--p)); color: var(--white); }
.menu-loading-card { --bg: var(--night); --hi: var(--blue); --lo: var(--ink); --ring: var(--cyan); width: min(calc(135 * var(--p)), 100%); padding: calc(8 * var(--p)); box-sizing: border-box; text-align: center; zoom: var(--ui, 1); }
.menu-loading-art { width: calc(48 * var(--p)); margin: 0 auto calc(5 * var(--p)); }
.menu-loading-art svg { display: block; width: 100%; image-rendering: pixelated; }
.menu-loading h1 { color: var(--yellow); font: calc(17 * var(--p))/1 var(--display); margin: calc(3 * var(--p)) 0; }
.menu-loading small { color: var(--cyan); font: calc(4 * var(--p)) var(--label); }
.menu-loading p { font: calc(6 * var(--p))/1.2 var(--font); margin-block: calc(5 * var(--p)); }
.menu-loading-track { height: calc(5 * var(--p)); background: var(--ink); padding: var(--p); box-shadow: 0 0 0 var(--p) var(--slate); }
.menu-loading-track i { display: block; width: var(--loaded, 0%); height: 100%; background: var(--cyan); }
.menu-loading-count { display: block; color: var(--cyan); font: calc(6 * var(--p)) var(--display); margin-top: calc(3 * var(--p)); }
.menu-loading .menu-loading-tip { color: var(--mist); font-size: calc(5 * var(--p)); }
.menu-loading button { font: calc(7 * var(--p)) var(--font); background: var(--blue); color: var(--white); padding: calc(3 * var(--p)) calc(7 * var(--p)); cursor: pointer; border: var(--p) solid var(--cyan); }
.menu-loading button:focus-visible { outline: var(--p) solid var(--yellow); outline-offset: var(--p); }
.menu-loading-compact { inset: auto calc(5 * var(--p)) calc(5 * var(--p)) auto; background: transparent; padding: 0; pointer-events: none; max-width: 90vw; }
.menu-loading-compact .menu-loading-card { width: calc(90 * var(--p)); padding: calc(4 * var(--p)); }
.menu-loading-compact .menu-loading-art, .menu-loading-compact h1, .menu-loading-compact small, .menu-loading-compact .menu-loading-tip, .menu-loading-compact .menu-loading-count { display: none; }
.menu-loading-compact p { margin-top: 0; }
`;
