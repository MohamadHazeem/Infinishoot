import type { Screens } from './screens';
import { MenuNav } from './menu';
import { mods, modSession } from '../mods/manager';
import { t } from '../i18n';

/** Player content is always inserted as text, never interpreted as menu HTML. */
export class ModsScreen {
  readonly el = document.createElement('div');
  private nav: MenuNav;
  private busy = false;
  private notice = '';
  constructor(private screens: Screens) {
    injectCss();
    this.el.id = 'scr-content-mods'; this.el.className = 'screen dim';
    this.nav = new MenuNav(this.el, { onBack: () => screens.show('settings') });
    screens.addScreen('contentmods', this.el, this.nav);
    const button = document.createElement('button');
    button.dataset.nav = ''; button.textContent = t('mods.title');
    button.addEventListener('click', () => screens.show('contentmods'));
    screens.settingsScreen.el.querySelector('.settings-footer')!.prepend(button);
  }
  open(): void { this.render(); }
  private render(focus = 0): void {
    this.el.replaceChildren();
    const title = document.createElement('h1'); title.textContent = t('mods.title'); this.el.append(title);
    const shell = document.createElement('div'); shell.className = 'content-mod-shell'; this.el.append(shell);
    const text = (parent: HTMLElement, content: string, className = '') => {
      const el = document.createElement('p'); el.textContent = content; el.className = className; parent.append(el); return el;
    };
    text(shell, t('mods.intro'));
    text(shell, t('mods.active', { count: modSession.count, hash: modSession.hash.slice(0, 12) }), 'content-mod-hash');
    if (mods.pending) text(shell, t('mods.pending'), 'content-mod-warning');
    if (mods.folder) text(shell, mods.folder, 'content-mod-path');
    const status = text(shell, [this.notice, ...mods.errors].filter(Boolean).join('\n'), 'content-mod-error');
    status.setAttribute('role', 'status');
    const list = document.createElement('div'); list.className = 'content-mod-list'; shell.append(list);
    const button = (parent: HTMLElement, label: string, action: () => void, disabled = false) => {
      const b = document.createElement('button'); b.dataset.nav = ''; b.textContent = label; b.disabled = disabled || this.busy;
      b.addEventListener('click', action); parent.append(b); return b;
    };
    if (!mods.files.length) text(list, t('mods.empty'), 'content-mod-empty');
    mods.plan.results.forEach((result, i) => {
      const { file, mod, errors } = result;
      const row = document.createElement('article'); row.className = 'px content-mod-row'; list.append(row);
      const name = document.createElement('strong'); name.setAttribute('translate', 'no'); name.dir = 'auto'; name.textContent = `${i + 1}. ${mod?.name ?? file.name}${mod ? ' · ' + mod.version : ''}`; row.append(name);
      if (mod?.description) { const description = text(row, mod.description); description.setAttribute('translate', 'no'); description.dir = 'auto'; }
      text(row, file.name, 'content-mod-path').setAttribute('translate', 'no');
      if (errors.length) text(row, errors.join('\n'), 'content-mod-error');
      else if (mod) text(row, Object.entries(mod.content).map(([kind, entries]) => `${t('mods.category.' + kind)}: ${entries.length}`).join(' · '), 'content-mod-counts');
      const controls = document.createElement('div'); controls.className = 'content-mod-actions'; row.append(controls);
      const change = (fn: () => void) => { const current = this.nav.focus; fn(); this.render(Math.max(0, current)); };
      button(controls, file.enabled ? t('mods.enabled') : t('mods.disabled'), () => change(() => mods.toggle(file.key)), (!mod || !!errors.length) && !file.enabled).setAttribute('aria-pressed', String(file.enabled));
      button(controls, t('mods.up'), () => change(() => mods.move(file.key, -1)), i === 0);
      button(controls, t('mods.down'), () => change(() => mods.move(file.key, 1)), i === mods.files.length - 1);
      if (file.key.startsWith('import/')) button(controls, t('mods.remove'), () => change(() => mods.remove(file.key)));
    });
    const footer = document.createElement('div'); footer.className = 'content-mod-actions'; shell.append(footer);
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,.zip,application/json,application/zip'; input.hidden = true;
    input.addEventListener('change', () => { const file = input.files?.[0]; if (file) void this.import(file); }); shell.append(input);
    button(footer, t('mods.import'), () => input.click());
    if (window.infiniMods) button(footer, t('mods.folder'), () => { void window.infiniMods!.openFolder().catch(e => { this.notice = String(e); this.render(); }); });
    button(footer, t('mods.restart'), () => location.reload());
    button(footer, t('mods.back'), () => this.screens.show('settings'));
    this.nav.refresh(focus);
  }
  private async import(file: File): Promise<void> {
    this.busy = true; this.notice = t('mods.loading'); this.render();
    try {
      if (file.size > 4 * 1024 * 1024) throw new Error('Import exceeds 4 MiB');
      await mods.importFile(file.name, new Uint8Array(await file.arrayBuffer())); this.notice = t('mods.imported');
    } catch (e) { this.notice = (e as Error).message; }
    finally { this.busy = false; this.render(); }
  }
}
function injectCss(): void {
  if (document.getElementById('content-mod-css')) return;
  const style = document.createElement('style'); style.id = 'content-mod-css';
  style.textContent = `
#scr-content-mods { justify-content: flex-start; padding: calc(8 * var(--p)); overflow-y: auto; }
#scr-content-mods h1 { margin: 0 0 calc(4 * var(--p)); }
.content-mod-shell { width: min(92vw, calc(350 * var(--p))); max-height: calc(90vh / var(--ui) - 65px); display: flex; flex-direction: column; gap: calc(4 * var(--p)); color: var(--white); font-size: calc(7 * var(--p)); }
.content-mod-shell p { margin: 0; }
.content-mod-list { overflow-y: auto; min-height: calc(36 * var(--p)); padding: calc(3 * var(--p)); }
.content-mod-row { --bg: var(--navy); --hi: var(--blue); --lo: var(--ink); --ring: var(--ink); background: var(--bg); padding: calc(6 * var(--p)); margin-block-end: calc(6 * var(--p)); }
.content-mod-row strong { color: var(--yellow); font-weight: normal; font-size: calc(12 * var(--p)); }
.content-mod-actions { display: flex; flex-wrap: wrap; gap: calc(4 * var(--p)); margin-block-start: calc(4 * var(--p)); }
.content-mod-actions button { font-size: calc(9 * var(--p)); padding: calc(3 * var(--p)) calc(6 * var(--p)); }
.content-mod-hash, .content-mod-counts { color: var(--cyan); }
.content-mod-hash { direction: ltr; }
.content-mod-path { color: var(--mist); font-size: calc(8 * var(--p)); overflow-wrap: anywhere; }
.content-mod-warning { color: var(--yellow); }
.content-mod-error { color: var(--orange); white-space: pre-wrap; overflow-wrap: anywhere; }
@media(max-height: 480px) { #scr-content-mods { gap: calc(2 * var(--p)); padding: calc(4 * var(--p)); } #scr-content-mods h1 { font-size: calc(16 * var(--p)); } .content-mod-shell { max-height: none; } .content-mod-list { overflow: visible; } }
.content-mod-empty { padding: calc(16 * var(--p)); text-align: center; color: var(--mist); }
`;
  document.head.append(style);
}
