import type { Game } from '../game/game';
import type { ReplayFile } from '../dev/replay';
import { t } from '../i18n';
import { telemetryServer, byteSize, categories, installId, post, REPORT_BYTES } from '../net/telemetryClient';
import { packageReport } from '../net/telemetryReport';

const waiting = new WeakMap<Game, () => void>();
export function reportRendered(game: Game): void {
  const copy = waiting.get(game);
  if (copy) { waiting.delete(game); queueMicrotask(copy); }
}

async function capture(game: Game): Promise<Blob> {
  const source = document.querySelector<HTMLCanvasElement>('canvas#game');
  if (!source?.width || !source.height) throw Error('canvas');
  // Copy in the game's next animation frame, while the WebGL drawing buffer is live.
  const c = document.createElement('canvas');
  const scale = Math.min(1, 800 / source.width, 600 / source.height);
  c.width = Math.max(1, Math.round(source.width * scale)); c.height = Math.max(1, Math.round(source.height * scale));
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { waiting.delete(game); reject(Error('capture')); }, 4000);
    waiting.set(game, () => {
      clearTimeout(timeout);
      try { c.getContext('2d')!.drawImage(source, 0, 0, c.width, c.height); resolve(); } catch (e) { reject(e); }
    });
  });
  for (const quality of [0.78, 0.55, 0.32]) {
    const blob = await new Promise<Blob | null>(resolve => c.toBlob(resolve, 'image/jpeg', quality));
    if (blob && blob.size <= 300 * 1024) return blob;
  }
  throw Error('capture');
}

function download(value: unknown): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value)], { type: 'application/json' }));
  const a = document.createElement('a'); a.download = 'InfiniShoot-report.json'; a.href = url; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function installReport(g: Game, root: HTMLElement): void {
  if (!document.getElementById('playtest-css')) {
    const style = document.createElement('style'); style.id = 'playtest-css';
    style.textContent = `
    .playtest-screen .playtest-card { box-sizing:border-box; width:min(calc(210 * var(--p)),92vw); max-height:93%; overflow:auto; padding:calc(7 * var(--p)); background:var(--navy); color:var(--white); border:var(--p) solid var(--slate); text-align:start }
    .playtest-card h1 { font-size:calc(13 * var(--p)); text-align:start; margin:0 }
    .playtest-card p,.playtest-card label { font:calc(6 * var(--p))/1.2 var(--font); margin:calc(3 * var(--p)) 0 }
    .playtest-card .menu { margin:calc(3 * var(--p)) 0; align-items:stretch; gap:calc(2 * var(--p)) }
    .playtest-card .menu button { min-width:0; font-size:calc(6 * var(--p)); padding:calc(2 * var(--p)) calc(4 * var(--p)) }
    .playtest-card textarea { box-sizing:border-box; width:100%; resize:vertical; color:var(--white); background:var(--ink); font:inherit }
    .playtest-card .focused { outline:var(--p) solid var(--yellow) }
    .playtest-card [role=status]:empty { display:none }`;
    document.head.append(style);
  }
  let back: 'pause' | 'gameover' = 'pause', category = 0, busy = false;
  const form = document.createElement('div'); form.className = 'screen dim playtest-screen'; form.id = 'scr-report';
  form.innerHTML = `<div class="playtest-card"><h1>${t('playtest.report')}</h1><p>${t(telemetryServer ? 'playtest.sends' : 'playtest.offline')}</p><div class="menu">
    <button data-nav data-category></button><label>${t('playtest.note')}<textarea rows="2" maxlength="500" data-nav></textarea></label>
    <label><input type="checkbox" data-nav data-replay checked> ${t('playtest.replay')}</label>
    <label><input type="checkbox" data-nav data-shot> ${t('playtest.shot')}</label>
    <button data-nav data-submit></button><button data-nav data-file hidden>${t('playtest.file')}</button>
    <button data-nav data-back>${t('playtest.back')}</button></div><p role="status" aria-live="polite"></p></div>`;
  const button = (s: string) => form.querySelector<HTMLButtonElement>(s)!;
  const replay = form.querySelector<HTMLInputElement>('[data-replay]')!, shot = form.querySelector<HTMLInputElement>('[data-shot]')!;
  const note = form.querySelector('textarea')!, status = form.querySelector('[role=status]')!;
  let cached: Awaited<ReturnType<typeof packageReport>> | undefined;
  const redraw = () => { button('[data-category]').textContent = t('playtest.category') + ' · ' + t('playtest.' + categories[category]); };
  const reset = () => { cached = undefined; button('[data-file]').hidden = true; status.textContent = ''; };
  redraw(); button('[data-submit]').textContent = t(telemetryServer ? 'playtest.send' : 'playtest.file');
  button('[data-category]').onclick = () => { category = (category + 1) % categories.length; redraw(); reset(); };
  form.oninput = reset;
  note.onclick = () => note.focus();
  form.addEventListener('keydown', event => {
    if ((event.code === 'Space' || event.code === 'Enter') && (event.target as HTMLElement).matches('input[type=checkbox]')) event.preventDefault();
  });
  const close = () => { if (!busy) g.screens.show(back); };
  g.screens.addScreen('report', form, { onBack: close });
  button('[data-back]').onclick = close;
  button('[data-file]').onclick = () => { if (cached) { download(cached); status.textContent = t('playtest.saved'); } };
  button('[data-submit]').onclick = async () => {
    if (busy) return;
    busy = true; status.textContent = t('playtest.working');
    const controls = form.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLTextAreaElement>('button,textarea,input');
    const disabled = Array.from(controls, el => el.disabled);
    controls.forEach(el => { el.disabled = true; });
    try {
      if (!cached) {
        const tape = replay.checked ? (window as Window & { replay?: { export(): ReplayFile } }).replay?.export() : undefined;
        if (replay.checked && (!tape?.header || tape.header.seed !== g.seed)) throw Error('replay');
        cached = await packageReport(categories[category], note.value, tape, shot.checked ? await capture(g) : undefined);
      }
      if (telemetryServer) {
        const install = installId();
        const body = { install, report: cached };
        if (byteSize(body) > REPORT_BYTES) { status.textContent = t('playtest.large'); button('[data-file]').hidden = false; return; }
        if (!install || await post('report', body) !== 200) { status.textContent = t('playtest.failed'); button('[data-file]').hidden = false; return; }
        status.textContent = t('playtest.sent');
      } else { download(cached); status.textContent = t('playtest.saved'); }
    } catch { status.textContent = t('playtest.attachFail'); }
    finally { busy = false; controls.forEach((el, i) => { el.disabled = disabled[i]; }); g.screens.refreshNav(); }
  };
  for (const screen of ['pause', 'gameover'] as const) {
    const b = document.createElement('button'); b.dataset.nav = ''; b.textContent = t('playtest.report');
    root.querySelector('#scr-' + screen + ' .menu')!.append(b);
    b.onclick = () => {
      back = screen; category = 0; note.value = ''; shot.checked = false; reset(); redraw();
      replay.disabled = g.role === 'client'; replay.checked = !replay.disabled;
      if (replay.disabled) status.textContent = t('playtest.hostOnly');
      g.screens.show('report');
    };
  }
}
