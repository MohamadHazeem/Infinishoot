/** Arabic cold boot, live settings redraws, user names, and network status copy. */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<body><div id="hud"></div></body>', { url: 'http://localhost/?lang=ar' });
for (const key of ['window', 'document', 'localStorage', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'navigator']) {
  Object.defineProperty(globalThis, key, { value: (dom.window as any)[key], configurable: true });
}
(dom.window.HTMLElement.prototype as any).scrollIntoView = () => {};
const { setLanguage, localize, relocalizeDom } = await import('../src/i18n');
await setLanguage('ar');
const { SettingsScreen, SETTINGS_ROWS } = await import('../src/ui/settingsScreen');
const { settings } = await import('../src/game/settings');
const screen = new SettingsScreen({ addScreen: (_name: string, el: HTMLElement) => document.body.append(el) } as any, () => {}, () => {});
for (const language of ['ar', 'en', 'ar'] as const) {
  settings.language = language;
  await setLanguage(language);
  for (let tab = 0; tab < 6; tab++) {
    screen.selectTab(tab);
    for (const control of screen.el.querySelectorAll<HTMLElement>('[data-nav][data-setting]')) {
      const row = SETTINGS_ROWS.find(r => r.key === control.dataset.setting)!;
      control.focus();
      if (row.key !== 'language') assert.equal(screen.el.querySelector('#settings-description')!.textContent, localize(row.desc), `${language}:${row.key}: live focus description`);
      if (['batterySaver', 'touchOpacity', 'touchAutoHide'].includes(row.key)) assert.equal(/[\u0600-\u06ff]/.test(row.desc), language === 'ar', 'mobile descriptions follow switching from an Arabic cold boot');
    }
  }
}
const { NetOverlay } = await import('../src/ui/netOverlay');
const net = new NetOverlay();
const view = { panel: true, rows: [{ name: 'BACK', color: '#ffcd75', rtt: 120, loss: 3, rate: 20, you: false, host: false, rc: 0, level: 'poor' as const }], buffer: { delay: 90, jitter: 12 }, tags: [{ key: 'n1', x: 10, y: 10, level: 'rc' as const, text: 'RECONNECTING... 3S' }], lost: { secs: 3, tries: 2 } };
net.render(view);
assert.equal(document.querySelector('#net-panel bdi')!.textContent, 'BACK', 'names that match catalog labels stay literal');
assert(!/[a-z]{3}/i.test(document.querySelector('#net-lost')!.textContent!), 'reconnect status is Arabic');
const status = document.querySelector('#net-lost')!;
const child = status.firstChild;
net.render(view);
assert.equal(status.firstChild, child, 'unchanged network status reuses its DOM');
view.lost.secs = 2;
net.render(view);
assert(status.textContent!.includes('2') && !/[a-z]{3}/i.test(status.textContent!), 'live countdown stays translated');
const board = document.createElement('p'); board.textContent = 'BACK\n\nPLAY SOLO';
assert(!/[a-z]{3}/i.test(localize('SURVIVAL GAUNTLET · WAVE 7\n3:03.18 × 0 KILLS\n0 POINTS\nNEXT WAVE 27s')), 'every line of the ticking Gauntlet HUD translates');
relocalizeDom(board, 'en');
assert.equal(board.textContent, 'رجوع\n\nلعب فردي');
await setLanguage('en'); relocalizeDom(board, 'ar');
assert.equal(board.textContent, 'BACK\n\nPLAY SOLO', 'record board line breaks survive a language round trip');
console.log('ok   arabic2: Arabic cold boot, live settings descriptions, literal player names, stable DOM, multiline switching');
