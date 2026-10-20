import { t, onLanguageChange } from '../i18n';
import { checkOnlineServer, onlineServer, type OnlineStatus } from '../net/onlineServer';

/** A health check only when HELP opens, with no frame work or background polling. */
export function onlineStatusLine(): { el: HTMLParagraphElement; refresh: () => void } {
  const el = document.createElement('p');
  el.dataset.onlineStatus = '';
  el.setAttribute('role', 'status');
  let state: OnlineStatus = onlineServer ? 'checking' : 'off';
  let pending = false;
  const render = () => { el.textContent = t(`deploykit.${state}`); };
  const refresh = () => {
    if (pending || !onlineServer) { render(); return; }
    pending = true; state = 'checking'; render();
    void checkOnlineServer().then(value => { state = value; pending = false; render(); });
  };
  onLanguageChange(render); render();
  return { el, refresh };
}
