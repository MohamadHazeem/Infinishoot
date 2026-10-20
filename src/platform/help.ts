import { onlineStatusLine } from '../ui/onlineStatus';
import { installControllerKeyboard } from './keyboard';
import type { Screens } from '../ui/screens';
import { settings, saveSettings } from '../game/settings';
import { t, onLanguageChange } from '../i18n';
import { desktop, diagnostics, exportErrorLog, restartRequired, updateRelease } from './desktop';

export function installDesktopUi(screens: Screens): void {
  installControllerKeyboard(screens);
  const el = document.createElement('div'); el.id = 'scr-desktopHelp'; el.className = 'screen dim';
  const heading = document.createElement('h1');
  const menu = document.createElement('div'); menu.className = 'menu desktop-help';
  const info = document.createElement('p');
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  const button = (key: string, action: () => void) => {
    const b = document.createElement('button'); b.dataset.nav = ''; b.dataset.desktopLabel = key; b.textContent = t(key); b.onclick = action; menu.append(b); return b;
  };
  const online = onlineStatusLine();
  menu.append(info, online.el);
  button('desktop.export', () => {
    status.textContent = t('desktop.saving');
    void exportErrorLog().then(result => { status.textContent = t(`desktop.${result}`); });
  });
  const update = button('desktop.download', () => { void desktop?.openRelease(); });
  const updateToggle = button('desktop.updates', () => { settings.autoUpdate = !settings.autoUpdate; saveSettings(); refresh(); });
  if (desktop) {
    button('desktop.minimize', () => { void desktop?.windowAction('minimize'); });
    button('desktop.close', () => { void desktop?.windowAction('close'); });
  }
  // uipolish: the replay/crash-log help (src/game/systems/ci2.ts) moves out of the SETTINGS footer into this screen, so the footer has one HELP.
  const replayHelp = screens.settingsScreen.el.querySelector<HTMLButtonElement>('.settings-footer [data-replay-help]');
  if (replayHelp) {
    replayHelp.dataset.desktopLabel = 'replay.menu';
    menu.append(replayHelp);
  }
  button('desktop.back', () => screens.show('settings'));
  menu.append(status); el.append(heading, menu);
  screens.addScreen('desktopHelp', el, { onBack: () => screens.show('settings') });
  const previousShow = screens.onShow;
  screens.onShow = name => { previousShow?.(name); if (name === 'desktopHelp') online.refresh(); };
  const help = document.createElement('button'); help.dataset.nav = ''; help.textContent = t('desktop.help');
  help.onclick = () => { refresh(); screens.show('desktopHelp'); };
  screens.settingsScreen.el.querySelector('.settings-footer')!.append(help);
  // The banner lives inside existing menu roots, so their MenuNav includes it.
  const banners: HTMLButtonElement[] = [];
  for (const id of ['scr-title', 'scr-pause']) {
    const root = document.getElementById(id);
    if (!root) continue;
    const b = document.createElement('button'); b.className = 'desktop-update'; b.hidden = true;
    b.onclick = () => { void desktop?.openRelease(); };
    (root.querySelector(':scope > .menu') ?? root).append(b); banners.push(b);
  }
  function refresh(): void {
    heading.textContent = t('desktop.help'); help.textContent = t('desktop.help');
    for (const b of menu.querySelectorAll<HTMLElement>('[data-desktop-label]')) b.textContent = t(b.dataset.desktopLabel!);
    info.textContent = `${t('desktop.about', { version: diagnostics.version })} ${t('desktop.privacy')}${restartRequired ? ' ' + t('desktop.restart') : ''}`;
    updateToggle.textContent = `${t('desktop.updates')}: ${t(settings.autoUpdate ? 'desktop.on' : 'desktop.off')}`;
    updateToggle.hidden = !desktop;
    update.hidden = !updateRelease;
    for (const b of [update, updateToggle]) { if (b.hidden) b.removeAttribute('data-nav'); else b.dataset.nav = ''; }
    for (const b of banners) {
      b.hidden = !updateRelease; b.textContent = t('desktop.download');
      if (updateRelease) b.dataset.nav = ''; else b.removeAttribute('data-nav');
    }
    // Refresh after an asynchronous check without stealing selection or pausing play.
    const nav = screens.current !== 'none' ? screens.nav(screens.current) : null;
    nav?.refresh(nav.focus);
  }
  window.addEventListener('desktop-state', refresh);
  onLanguageChange(refresh);
  if (desktop) {
    const bar = document.createElement('div'); bar.className = 'desktop-titlebar';
    const title = document.createElement('span'); title.textContent = 'InfiniShoot'; bar.append(title);
    for (const [action, key] of [['minimize', 'desktop.minimize'], ['maximize', 'desktop.maximize'], ['close', 'desktop.close']] as const) {
      const b = document.createElement('button'); b.textContent = action === 'minimize' ? '−' : action === 'maximize' ? '□' : '×'; b.setAttribute('aria-label', t(key));
      b.onclick = () => { void desktop?.windowAction(action); }; bar.append(b);
    }
    document.body.append(bar);
    const sync = () => { bar.hidden = settings.windowMode !== 'windowed'; };
    desktop.onWindowMode(mode => { settings.windowMode = mode; saveSettings(); screens.settingsScreen.sync(); sync(); });
    window.addEventListener('desktop-state', sync); sync();
  }
  const style = document.createElement('style'); style.textContent = `
.desktop-help { max-width:min(720px,90vw); max-height:74vh; overflow:auto; box-sizing:border-box; }
.desktop-help p { margin:calc(3 * var(--p)); font-size:22px; color:var(--cyan); }
.desktop-help button { white-space:normal; flex-shrink:0; min-height:44px; }
.desktop-help [hidden], .desktop-update[hidden], .desktop-titlebar[hidden] { display:none !important; }
.desktop-update { --bg:var(--blue); --hi:var(--cyan); color:var(--yellow); font-size:18px; white-space:normal; }
.desktop-titlebar { position:fixed; inset:0 0 auto; height:calc(10 * var(--p)); z-index:10000; display:flex; align-items:center; background:var(--navy); color:var(--white); -webkit-app-region:drag; font:16px var(--font); }
.desktop-titlebar span { flex:1; padding-inline:calc(4 * var(--p)); }
.desktop-titlebar button { -webkit-app-region:no-drag; font:18px var(--font); padding:0 calc(4 * var(--p)); box-shadow:none; border:0; border-radius:0; background:var(--navy); color:var(--white); }
body:has(.desktop-titlebar:not([hidden])) .screen { top:calc(10 * var(--p)); }
body:has(.desktop-titlebar:not([hidden])) #ingame > :is(#xpbar,#hp,#runinfo,#goals,#timer,#pausebtn,#bossbar) { margin-top:calc(10 * var(--p)); }
`;
  document.head.append(style); refresh();
}
