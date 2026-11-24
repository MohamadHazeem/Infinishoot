import { patchNotes } from '../data/patchNotes';
import { localize, onLanguageChange, t } from '../i18n';
import { prompt } from './prompts';
import type { Screens } from './screens';

export function installPatchNotes(screens: Screens): void {
  const el = document.createElement('section');
  el.id = 'scr-patchNotes'; el.className = 'screen dim';
  const button = (action: () => void) => {
    const b = document.createElement('button');
    b.dataset.nav = ''; b.onclick = action;
    return b;
  };
  let page = 0;
  const open = button(() => { page = 0; draw(); screens.show('patchNotes'); });
  document.querySelector('#scr-extras .menu')!.append(open);
  const title = document.createElement('h1');
  const article = document.createElement('article'); article.className = 'px';
  const version = document.createElement('h2');
  const body = document.createElement('div');
  article.setAttribute('aria-live', 'polite');
  article.append(version, body);
  const turn = (n: number) => { page += n; draw(); screens.refreshNav(); };
  const prev = button(() => turn(-1)), next = button(() => turn(1));
  const back = button(() => screens.show('extras'));
  const nav = document.createElement('div'); nav.className = 'menu row'; nav.append(prev, next, back);
  el.append(title, article, nav);
  screens.addScreen('patchNotes', el, { onBack: () => screens.show('extras') });
  function draw() {
    const entry = patchNotes[page];
    open.textContent = title.textContent = t('launch.notes');
    version.textContent = t('preview' in entry ? 'launch.preview' : 'launch.version', { version: entry.version });
    body.replaceChildren();
    for (const [heading, detail] of entry.sections) {
      const h = document.createElement('h3'), p = document.createElement('p');
      h.textContent = t(heading); p.textContent = t(detail); body.append(h, p);
    }
    prev.textContent = t('launch.previous'); next.textContent = t('launch.next');
    back.innerHTML = prompt('back') + ' ' + localize('BACK');
    prev.disabled = page === 0; next.disabled = page === patchNotes.length - 1;
  }
  const style = document.createElement('style');
  style.textContent = `
  #scr-patchNotes {gap:calc(6 * var(--p));overflow:auto}
  #scr-patchNotes h1 {margin:0}
  #scr-patchNotes article {--bg:var(--navy);--hi:var(--blue);--lo:var(--night);--ring:var(--ink);
    background:var(--bg);color:var(--white);text-align:start;width:min(84vw,calc(280 * var(--p)));
    padding:calc(8 * var(--p));font-size:calc(9 * var(--p));line-height:1.2}
  #scr-patchNotes h2 {color:var(--yellow);margin:0}
  #scr-patchNotes h3 {color:var(--cyan);margin:calc(5 * var(--p)) 0 var(--p)}
  #scr-patchNotes p {margin:0}
  `;
  document.head.append(style); draw(); onLanguageChange(draw);
}
