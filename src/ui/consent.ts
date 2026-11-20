import type { Game } from '../game/game';
import { t } from '../i18n';
import { consent, choose, deleteData, flush } from '../net/telemetryClient';
import { loadJson } from '../core/storage';

// More than one Game can share a page (co-op harnesses and embedded sessions).
// Prompt once per page launch. An unanswered prompt continues to mean no collection.
const prompted = new WeakSet<Document>();
export function installConsent(g: Game, root: HTMLElement, discard: () => void): void {
  const panel = document.createElement('div');
  panel.id = 'scr-consent'; panel.className = 'screen dim playtest-screen';
  panel.innerHTML = `<div class="playtest-card"><h1>${t('playtest.share')}</h1><p>${t('playtest.explain')}</p><div class="menu row"><button data-nav data-no>${t('playtest.no')}</button><button data-nav data-yes>${t('playtest.yes')}</button></div></div>`;
  let fromSettings = false;
  const finish = (yes: boolean) => {
    choose(yes ? 'yes' : 'no');
    if (!yes) discard(); else void flush();
    refresh(); g.screens.show(fromSettings ? 'settings' : 'title');
  };
  g.screens.addScreen('consent', panel, { horizontal: true, onBack: () => finish(false) });
  panel.querySelector('button[data-no]')!.addEventListener('click', () => finish(false));
  panel.querySelector('button[data-yes]')!.addEventListener('click', () => finish(true));
  const settingsPanel = root.querySelector('[data-setting=language]')!.parentElement!;
  const share = document.createElement('button'), del = document.createElement('button');
  const refresh = () => { share.textContent = t('playtest.share') + ' · ' + t(consent() === 'yes' ? 'playtest.on' : 'playtest.off'); };
  refresh(); del.textContent = t('playtest.delete');
  settingsPanel.prepend(share, del);
  share.onclick = () => { fromSettings = true; g.screens.show('consent'); };
  del.onclick = async () => {
    del.disabled = true; discard();
    const ok = await deleteData(); refresh(); del.disabled = false;
    g.hud.toast(t(ok ? 'playtest.deleted' : 'playtest.deleteFail'), 5);
    const status = root.querySelector('.settings-description');
    if (status) status.textContent = t(ok ? 'playtest.deleted' : 'playtest.deleteFail');
  };
  const q = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
  if (!prompted.has(root.ownerDocument) && consent() === null && !q.has('test') && !q.has('ci2') && !loadJson('replay.watch', null)) {
    prompted.add(root.ownerDocument);
    g.screens.show('consent');
  }
}
