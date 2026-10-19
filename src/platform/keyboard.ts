import type { Screens, ScreenName } from '../ui/screens';
import { promptState } from '../ui/prompts';
import { t, onLanguageChange } from '../i18n';

/** Controller text entry for lobby names/codes and other DOM fields, including web/Deck. */
export function installControllerKeyboard(screens: Screens): void {
  let target: HTMLInputElement | HTMLTextAreaElement | null = null;
  let returning: ScreenName = 'title';
  let value = '';
  let upper = true;
  const el = document.createElement('div'); el.id = 'scr-desktopKeyboard'; el.className = 'screen dim';
  const title = document.createElement('h1');
  const preview = document.createElement('p'); preview.className = 'desktop-keyboard-value'; preview.dir = 'auto';
  const keys = document.createElement('div'); keys.className = 'menu desktop-keys';
  const actions = document.createElement('div'); actions.className = 'menu row desktop-keyboard-actions';
  const leave = (commit: boolean) => {
    if (target && commit) { target.value = value; target.dispatchEvent(new Event('input', { bubbles: true })); target.dispatchEvent(new Event('change', { bubbles: true })); }
    const field = target; target = null; screens.show(returning);
    if (field) {
      const root = field.closest('.screen');
      const index = root ? Array.from(root.querySelectorAll('[data-nav]')).indexOf(field) : -1;
      if (index >= 0 && returning !== 'none') screens.nav(returning).refresh(index);
    }
  };
  const draw = () => { preview.textContent = value || '▏'; };
  const append = (text: string) => { if (target) { value = (value + text).slice(0, target.maxLength > 0 ? target.maxLength : 200); draw(); } };
  const add = (root: HTMLElement, label: string, action: () => void) => {
    const b = document.createElement('button'); b.dataset.nav = ''; b.textContent = label; b.onclick = action; root.append(b); return b;
  };
  const alphabet = '1234567890QWERTYUIOPASDFGHJKL-ZXCVBNM._@';
  for (const char of alphabet) add(keys, char, () => append(upper ? char : char.toLowerCase()));
  const shift = add(actions, '', () => { upper = !upper; for (const b of keys.querySelectorAll('button')) b.textContent = upper ? b.textContent!.toUpperCase() : b.textContent!.toLowerCase(); });
  const space = add(actions, '', () => append(' '));
  const erase = add(actions, '', () => { value = Array.from(value).slice(0, -1).join(''); draw(); });
  const cancel = add(actions, '', () => leave(false));
  const done = add(actions, '', () => leave(true));
  const localize = () => {
    title.textContent = t('desktop.keyboard'); shift.textContent = t('desktop.case'); space.textContent = t('desktop.space'); erase.textContent = t('desktop.erase'); cancel.textContent = t('desktop.cancel'); done.textContent = t('desktop.done');
  };
  localize(); onLanguageChange(localize);
  el.append(title, preview, keys, actions);
  screens.addScreen('desktopKeyboard', el, { columns: 10, onBack: () => leave(false) });
  document.addEventListener('click', event => {
    if (promptState.mode === 'kbm' || promptState.mode === 'touch') return;
    const field = event.target;
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return;
    if (field instanceof HTMLInputElement && !['text', 'search', 'url', 'email', 'tel', 'password'].includes(field.type)) return;
    if (field.disabled || field.readOnly || screens.current === 'desktopKeyboard') return;
    // Password entry remains the browser/OS's responsibility; never expose it in a preview.
    if (field instanceof HTMLInputElement && field.type === 'password') return;
    target = field; returning = screens.current; value = field.value; draw();
    event.preventDefault(); event.stopPropagation(); screens.show('desktopKeyboard');
  }, true);
  const css = document.createElement('style'); css.textContent = `
#scr-desktopKeyboard { gap:calc(4 * var(--p)); }
#scr-desktopKeyboard h1 { margin:0; }
.desktop-keyboard-value { width:min(800px,90vw); min-height:2em; overflow-wrap:anywhere; text-align:center; color:var(--cyan); font:26px var(--font); max-height:15vh; overflow:auto; }
#scr-desktopKeyboard .desktop-keys { display:grid; grid-template-columns:repeat(10,minmax(0,1fr)); gap:calc(3 * var(--p)); width:min(800px,90vw); }
#scr-desktopKeyboard .desktop-keys button { min-width:0; min-height:44px; padding:calc(2 * var(--p)); }
#scr-desktopKeyboard .desktop-keyboard-actions { flex-wrap:wrap; max-width:90vw; }
#scr-desktopKeyboard .desktop-keyboard-actions button { min-height:44px; font-size:20px; }
`; document.head.append(css);
}
