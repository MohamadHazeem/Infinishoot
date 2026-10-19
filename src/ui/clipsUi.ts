import type { Game } from '../game/game';
import type { ScreenName } from './screens';
import { clipsFor } from '../game/systems/clips';
import { type Highlight, type HighlightRecorder } from '../platform/clips';
import { t } from '../i18n';
import { prompt } from './prompts';

const CSS = `
.clips-panel { min-width:0; max-width:100%; width:min(860px,94%); box-sizing:border-box; padding:calc(3 * var(--p)); background:var(--night); color:var(--white); }
.clips-panel { --bg:var(--night); --hi:var(--blue); --lo:var(--ink); --ring:var(--ink);
 box-shadow:inset var(--p) var(--p) 0 var(--hi), inset calc(-1 * var(--p)) calc(-1 * var(--p)) 0 var(--lo),
 0 calc(-1 * var(--p)) 0 var(--ink), 0 var(--p) 0 var(--ink), calc(-1 * var(--p)) 0 0 var(--ink), var(--p) 0 0 var(--ink),
 0 calc(-2 * var(--p)) 0 var(--ring), 0 calc(2 * var(--p)) 0 var(--ring), calc(-2 * var(--p)) 0 0 var(--ring), calc(2 * var(--p)) 0 0 var(--ring); }
.clips-panel h2 { color:var(--yellow); font:calc(9 * var(--p)) var(--display); margin:0; }
.clips-panel p { color:var(--mist); font-size:calc(6 * var(--p)); margin:calc(2 * var(--p)) 0; }
.clips-reel { display:flex; gap:calc(4 * var(--p)); overflow:auto; padding:calc(2 * var(--p)); max-width:100%; }
.clips-card { flex:0 0 160px; display:flex; flex-direction:column; gap:calc(2 * var(--p)); text-align:start; }
.clips-card img { width:160px; height:90px; object-fit:contain; image-rendering:pixelated; background:var(--ink); }
.clips-card strong { font-size:calc(7 * var(--p)); font-weight:normal; color:var(--cyan); }
.clips-card small { font-size:calc(6 * var(--p)); color:var(--mist); }
.clips-card button { font-size:calc(6 * var(--p)); padding:calc(2 * var(--p)); min-height:36px; }
#scr-clips { background:var(--ink); }
#scr-clips .clips-reel { flex-wrap:wrap; justify-content:center; }
#scr-clips .clips-panel { max-height:80vh; overflow:auto; }
#scr-mvp .clips-panel { width:100%; }
#scr-mvp .mvp-shell { grid-template-columns:minmax(0,1fr); }
.clips-status { min-height:1.3em; }
`;
/** Registers the gallery; small result-screen rails are rebuilt only when shown/changed. */
export function installClipsUi(g: Game): void {
  const s = clipsFor(g), screens = g.screens;
  const style = document.createElement('style'); style.textContent = CSS; document.head.append(style);
  const gallery = document.createElement('section'); gallery.id = 'scr-clips'; gallery.className = 'screen';
  let back: ScreenName = 'gameover';
  screens.addScreen('clips', gallery, { onBack: () => screens.show(back) });
  const urls: string[] = [];
  let status = '';
  const clearUrls = () => { for (const u of urls) URL.revokeObjectURL(u); urls.length = 0; };
  const draw = () => {
    const name = screens.current;
    if (name !== 'mvp' && name !== 'gameover' && name !== 'clips') return;
    clearUrls();
    document.querySelectorAll('[data-clips-panel]').forEach(el => el.remove());
    const panel = document.createElement('section'); panel.className = 'clips-panel'; panel.dataset.clipsPanel = '';
    const title = document.createElement('h2'); title.textContent = t('clips.title');
    const hint = document.createElement('p'); hint.innerHTML = `${t('clips.hint')} ${prompt('clip')}`;
    panel.append(title, hint);
    const reel = document.createElement('div'); reel.className = 'clips-reel';
    for (const h of s.highlights) reel.append(card(h, s, urls, (message) => { status = message; draw(); }));
    if (!s.highlights.length) { const empty = document.createElement('p'); empty.textContent = t(s.supported ? 'clips.empty' : 'clips.unsupported'); reel.append(empty); }
    panel.append(reel);
    const message = document.createElement('p'); message.className = 'clips-status'; message.setAttribute('role', 'status');
    message.textContent = s.exporting ? t('clips.encoding') : status || t('clips.lifetime'); panel.append(message);
    if (name === 'clips') {
      const btn = document.createElement('button'); btn.dataset.nav = ''; btn.textContent = t('clips.back'); btn.onclick = () => screens.show(back); panel.append(btn);
      gallery.replaceChildren(panel);
    } else {
      const all = document.createElement('button'); all.dataset.nav = ''; all.textContent = t('clips.gallery'); all.onclick = () => screens.show('clips'); panel.append(all);
      const root = document.getElementById(`scr-${name}`)!;
      const parent = name === 'mvp' ? root.querySelector('.mvp-shell')! : root;
      // Preserve Continue/Retry as the first navigation action on result screens.
      const next = name === 'mvp' ? null : parent.querySelector('.hiscores');
      parent.insertBefore(panel, next);
    }
    screens.nav(name).refresh();
  };
  const old = screens.onShow;
  screens.onShow = name => {
    old?.(name);
    if (name === 'mvp' || name === 'gameover') { back = name; s.flush(); }
    if (name !== 'mvp' && name !== 'gameover' && name !== 'clips') clearUrls();
    draw();
  };
  s.onChange = draw;
  window.addEventListener('pagehide', () => { s.reset(); clearUrls(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) s.stop(true); });
}
function card(h: Highlight, s: HighlightRecorder, urls: string[], changed: (message: string) => void): HTMLElement {
  const el = document.createElement('article'); el.className = 'clips-card';
  const img = document.createElement('img'); img.alt = t('clips.' + h.kind);
  const f = h.frames[Math.max(0, h.frames.length - 1)];
  if (f) { img.src = URL.createObjectURL(f.blob); urls.push(img.src); }
  const title = document.createElement('strong'); title.textContent = t('clips.' + h.kind);
  const meta = document.createElement('small'); meta.textContent = t('clips.meta', { stage: h.stage, seconds: Math.round((h.frames.at(-1)?.time ?? 0) - (h.frames[0]?.time ?? 0)) });
  const save = document.createElement('button'); save.dataset.nav = ''; save.textContent = t(h.ready ? 'clips.save' : 'clips.finishing'); save.disabled = !h.ready || s.exporting;
  save.onclick = () => { void s.save(h).then(() => changed(t('clips.download'))).catch(() => changed(t('clips.error'))); };
  el.append(img, title, meta, save); return el;
}
