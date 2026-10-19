import type { Input } from '../core/input';
import { settings, SETTINGS_DEFAULTS, saveSettings, type Settings } from '../game/settings';
import { MenuNav } from './menu';
import type { Screens } from './screens';
import { promptHtml, promptState } from './prompts';

export const SETTINGS_TABS = ['VIDEO', 'AUDIO', 'CONTROLS', 'GAMEPLAY', 'ACCESSIBILITY', 'CO-OP'] as const;
export type SettingsTab = typeof SETTINGS_TABS[number];
export interface SettingRow {
  key: keyof Settings; label: string; desc: string; tab: SettingsTab;
  range?: readonly [number, number, number]; options?: readonly string[]; labels?: readonly string[];
}
const rows: SettingRow[] = [];
function row(tab: SettingsTab, key: keyof Settings, label: string, desc: string, range?: SettingRow['range'], options?: readonly string[], labels?: readonly string[]): void {
  rows.push({ tab, key, label, desc, range, options, labels });
}
row('VIDEO', 'graphics', 'QUALITY', 'AUTO adjusts visual detail to keep the game running smoothly. POTATO is the lightest, for very old PCs.', [0, 4, 1], undefined, ['LOW', 'MEDIUM', 'HIGH', 'AUTO', 'POTATO']);
row('VIDEO', 'retro', 'RETRO LOOK', 'Pixel-era colour depth, dithering and vertex wobble.', [0, 1, 0.1]);
row('VIDEO', 'glow', 'GLOW', 'Brightness of the soft glow around lights and effects.', [0, 1, 0.1]);
row('VIDEO', 'crt', 'CRT FILTER', 'Adds scanlines and darkens the screen edges.');
row('VIDEO', 'distortion', 'SHOCKWAVES', 'Heat shimmer and screen distortion. Reduce screen effects overrides this.');
row('VIDEO', 'nightStages', 'NIGHT STAGES', 'Allows night lighting on eligible stages.');
row('VIDEO', 'weather', 'WEATHER', 'Rain, snow and other weather particles.');
row('VIDEO', 'animeLook', 'ANIME LOOK', 'Ink outlines, cel shading, speed lines and impact frames.');
row('VIDEO', 'uiScale', 'UI SCALE', 'Scales entire HUD panels and menus; capped to fit your window.', [75, 150, 25]);
row('VIDEO', 'showFps', 'SHOW FPS', 'Shows the frame-rate counter.');
for (const [key, label, desc] of [
  ['volume', 'MASTER VOLUME', 'Volume of all game audio.'], ['musicVolume', 'MUSIC', 'Music bus volume.'],
  ['sfxVolume', 'EFFECTS', 'Weapons, enemies and gameplay effects.'], ['ambienceVolume', 'AMBIENCE', 'Environmental background audio.'],
  ['voiceVolume', 'VOICE', 'Hero voice volume.'], ['uiVolume', 'MENU SOUNDS', 'Menu navigation and selection sounds.'],
] as const) row('AUDIO', key, label, desc, [0, 1, 0.1]);
for (const [key, label, desc] of [
  ['interactiveMusic', 'WEAPON MUSIC LAYERS', 'Adds musical layers for your equipped weapons.'],
  ['adaptiveSilence', 'DRAMATIC MUSIC DIPS', 'Lowers music during dramatic moments.'],
  ['lowHealthAudio', 'LOW HEALTH AUDIO', 'Audio feedback when your life is low.'],
  ['headphones3d', 'HEADPHONES 3D AUDIO', 'Spatial audio intended for headphones.'],
  ['announcer', 'ANNOUNCER', 'Announcer calls during the run.'], ['heroVoices', 'HERO VOICES', 'Hero barks and voice lines.'],
  ['crowd', 'CROWD', 'Arena cheers, gasps and boos.'], ['radioDj', 'RADIO DJ', 'Radio host chatter between stages.'],
  ['petSounds', 'PET SOUNDS', 'Companion zap sounds.'],
] as const) row('AUDIO', key, label, desc);
row('CONTROLS', 'rumble', 'CONTROLLER RUMBLE', 'Controller vibration for hits and actions.');
row('CONTROLS', 'chargeMode', 'CHARGE MODE', 'HOLD: hold to charge, release to fire. TOGGLE: press to start, press again to release.', undefined, ['hold', 'toggle']);
row('CONTROLS', 'dashRunMode', 'DASH-RUN MODE', 'HOLD: keep holding to dash whenever ready. TOGGLE: press to repeat dashes, press again to stop. Menus cancel it.', undefined, ['hold', 'toggle']);
row('CONTROLS', 'rewindMode', 'REWIND MODE', 'HOLD: hold for 0.35 seconds to confirm. TOGGLE: one press activates or agrees to team rewind.', undefined, ['hold', 'toggle']);
row('CONTROLS', 'teamMoveMode', 'TEAM MOVE MODE', 'HOLD: hold for 0.35 seconds to confirm. TOGGLE: one press activates the team move or buys a revive.', undefined, ['hold', 'toggle']);
row('CONTROLS', 'aimAssist', 'AIM ASSIST', 'Gamepad and touch: gently turns aim toward the nearest visible enemy within 12 metres and 25 degrees.');
row('CONTROLS', 'mouseAimAssist', 'MOUSE AIM ASSIST', 'Optional soft aim correction for mouse. Off by default; independent of gamepad and touch.');
row('GAMEPLAY', 'autoFire', 'AUTO-FIRE', 'Automatically fires the primary weapon with keyboard and mouse.');
row('GAMEPLAY', 'tips', 'FIRST-TIME TIPS', 'Shows help when you encounter a mechanic for the first time.');
row('GAMEPLAY', 'damageNumbers', 'DAMAGE NUMBERS', 'AUTO: thins out in crowded fights. ALL: every hit. MINE: your hits only. OFF: hides hit numbers; important labels remain.', undefined, ['auto', 'all', 'mine', 'off']);
row('GAMEPLAY', 'dynamicCamera', 'DYNAMIC CAMERA', 'Automatic swarm zoom and cinematic camera moves.');
row('GAMEPLAY', 'bossIntros', 'BOSS INTROS', 'Boss entrance camera pans and title cards.');
row('GAMEPLAY', 'slowMo', 'SKILL SLOW-MO', 'Solo slow motion on perfect dashes and special moments.');
row('GAMEPLAY', 'deathReplay', 'DEATH REPLAY', 'Replays the final moments before the game-over screen.');
row('GAMEPLAY', 'cinematics', 'CINEMATICS', 'Choose full, shorter or no cinematic sequences.', undefined, ['full', 'short', 'off']);
row('GAMEPLAY', 'finishers', 'BOSS FINISHERS', 'Comic panels on a stage boss finishing blow.');
row('GAMEPLAY', 'portraitPops', 'CHARACTER POP-INS', 'Portraits for announcer calls, bosses and pings.');
row('ACCESSIBILITY', 'colorblindMode', 'COLOUR VISION', 'Local colour assistance for the whole scene and UI: bullets, danger zones, rarity, team colours and elite glows.', undefined, ['off', 'protanopia', 'deuteranopia', 'tritanopia']);
row('ACCESSIBILITY', 'colorblind', 'ALT BULLET PALETTE', 'Legacy high-contrast enemy bullet colours. Kept separately so your saved preference is preserved.');
row('ACCESSIBILITY', 'textScale', 'TEXT SIZE', 'Enlarges text independently of panel and icon scale. Menus scroll when needed.', [100, 150, 25]);
row('ACCESSIBILITY', 'reduceScreenEffects', 'REDUCE SCREEN EFFECTS', 'Together: disables shake, distortion and speed streaks, and reduces flashes and UI motion. Keeps your individual preferences.');
row('ACCESSIBILITY', 'reduceFlash', 'REDUCE FLASHING', 'Softens flashes, lightning, impact frames and UI animation.');
row('ACCESSIBILITY', 'shake', 'SCREEN SHAKE', 'Camera shake strength. Reduce screen effects overrides this.', [0, 1.5, 0.25]);
row('ACCESSIBILITY', 'captions', 'CAPTIONS', 'Text captions for announcer and voice lines.');
row('ACCESSIBILITY', 'soundArrows', 'SOUND ARROWS', 'Screen-edge arrows point toward off-screen threat sounds.');
row('CO-OP', 'coopPool', 'SHARED REVIVE POOL', 'Host rule for the next run: the team shares a limited pool of lives.');
row('CO-OP', 'coopJoinable', 'JOIN IN PROGRESS', 'Host rule: friends may join or reconnect after a run starts.');
row('CO-OP', 'lobbyPublic', 'PUBLIC LOBBY', 'Lists hosted games in Browse Games when the online service is enabled.');
row('CO-OP', 'helpGhosts', 'HELP GHOSTS', 'Allows friends’ recorded help ghosts to appear in your runs.');
export const SETTINGS_ROWS: readonly SettingRow[] = rows;

/** Only the active tab's keys; never loadouts, identity, bindings or other tabs. */
export function resetSettingsTab(tab: SettingsTab, target: Settings = settings): void {
  for (const r of SETTINGS_ROWS) if (r.tab === tab) (target as unknown as Record<string, unknown>)[r.key] = SETTINGS_DEFAULTS[r.key];
}

export class SettingsScreen {
  readonly el = document.createElement('div');
  readonly nav: MenuNav;
  private tabIndex = 0;
  private description: HTMLElement;
  private panel: HTMLElement;
  private panels: HTMLElement[];
  get selectedTab(): number { return this.tabIndex; }
  private hint: HTMLElement;
  private lastFocus: Element | null = null;
  private hintMode: string | null = null;
  constructor(screens: Pick<Screens, 'addScreen'>, back: () => void, controls: () => void) {
    injectSettingsCss();
    this.el.id = 'scr-settings';
    this.el.className = 'screen dim';
    this.el.setAttribute('aria-label', 'Settings');
    this.el.innerHTML = `<h1>SETTINGS</h1><div class="settings-shell"><div class="settings-tabs" role="tablist" aria-label="Settings categories">${SETTINGS_TABS.map((tab, i) => `<button data-nav data-tab="${i}" role="tab" id="settings-tab-${i}" aria-controls="settings-panel-${i}">${tab}</button>`).join('')}</div>${SETTINGS_TABS.map((_, i) => `<div id="settings-panel-${i}" class="menu settings" role="tabpanel" aria-labelledby="settings-tab-${i}"></div>`).join('')}<p id="settings-description" class="settings-description" aria-live="polite"></p><div class="settings-footer"><button data-nav data-reset>RESET TAB</button><button data-nav data-settings-back>BACK</button></div><p class="settings-hint"></p></div>`;
    this.panels = Array.from(this.el.querySelectorAll<HTMLElement>('[role=tabpanel]'));
    this.panel = this.panels[0];
    this.panels.forEach((panel, i) => {
      panel.innerHTML = SETTINGS_ROWS.filter((r) => r.tab === SETTINGS_TABS[i]).map((r) => r.range
        ? `<label><span>${r.label} <b data-value="${r.key}"></b></span><input data-setting="${r.key}" aria-label="${r.label}" aria-describedby="settings-description" type="range" min="${r.range[0]}" max="${r.range[1]}" step="${r.range[2]}"></label>`
        : `<button data-setting="${r.key}" ${r.key === 'tips' ? 'data-act="ob-tips"' : ''} aria-describedby="settings-description">${r.label} <b data-value="${r.key}"></b></button>`).join('')
        + (SETTINGS_TABS[i] === 'CONTROLS' ? '<button data-rebind aria-label="Rebind keyboard controls">REBIND KEYS…</button>' : '')
        + (SETTINGS_TABS[i] === 'GAMEPLAY' ? '<button data-act="ob-tips-reset" aria-label="Reset first-time tips">RESET TIPS</button>' : '');
    });
    this.description = this.el.querySelector('.settings-description')!;
    this.hint = this.el.querySelector('.settings-hint')!;
    this.nav = new MenuNav(this.el, { onBack: back });
    screens.addScreen('settings', this.el, this.nav);
    this.el.querySelector('[data-settings-back]')!.addEventListener('click', back);
    this.el.querySelector('[data-reset]')!.addEventListener('click', () => { resetSettingsTab(SETTINGS_TABS[this.tabIndex]); saveSettings(); this.sync(); this.description.textContent = `${SETTINGS_TABS[this.tabIndex]} defaults restored.`; });
    this.el.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.addEventListener('click', () => this.selectTab(Number(b.dataset.tab))));
    this.el.addEventListener('focusin', (e) => this.describe(e.target as HTMLElement));
    this.el.addEventListener('keydown', (e) => {
      // MenuNav owns activation and arrows. Prevent native controls from applying a second step.
      if (['Enter', ' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) e.preventDefault();
      if (e.key === 'Tab') {
        e.preventDefault();
        const items = Array.from(this.el.querySelectorAll<HTMLElement>('[data-nav]'));
        const next = (Math.max(0, items.indexOf(document.activeElement as HTMLElement)) + (e.shiftKey ? -1 : 1) + items.length) % items.length;
        this.nav.refresh(next); items[next].focus({ preventScroll: true }); items[next].scrollIntoView({ block: 'nearest' });
      }
    });
    this.el.addEventListener('mouseover', (e) => this.describe((e.target as HTMLElement).closest('[data-setting]') as HTMLElement));
    this.el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-setting]');
      if (!b) return;
      const r = SETTINGS_ROWS.find((x) => x.key === b.dataset.setting)!;
      if (r.key === 'tips') e.stopPropagation(); // The legacy onboarding delegate shares this action name.
      const values = settings as unknown as Record<string, unknown>;
      values[r.key] = r.options ? r.options[(r.options.indexOf(String(values[r.key])) + 1) % r.options.length] : !values[r.key];
      saveSettings(); this.sync();
    });
    this.el.addEventListener('input', (e) => {
      const inp = e.target as HTMLInputElement;
      if (!inp.dataset.setting) return;
      (settings as unknown as Record<string, unknown>)[inp.dataset.setting] = Number(inp.value);
      saveSettings(); this.sync();
    });
    this.el.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('[data-rebind]')) controls(); });
    this.selectTab(0);
  }
  selectTab(index: number): void {
    this.tabIndex = (index + SETTINGS_TABS.length) % SETTINGS_TABS.length;
    const tab = SETTINGS_TABS[this.tabIndex];
    this.el.querySelectorAll<HTMLElement>('[data-tab]').forEach((b, i) => { b.setAttribute('aria-selected', String(i === this.tabIndex)); b.classList.toggle('on', i === this.tabIndex); });
    this.panels.forEach((panel, i) => {
      panel.hidden = i !== this.tabIndex;
      panel.querySelectorAll<HTMLElement>('button, input').forEach((el) => {
        if (i === this.tabIndex) el.setAttribute('data-nav', '');
        else { el.removeAttribute('data-nav'); el.classList.remove('focused'); }
      });
    });
    this.panel = this.panels[this.tabIndex];
    this.panel.scrollTop = 0;
    this.description.textContent = `${tab} · Changes save automatically on this device.`;
    this.lastFocus = null;
    this.sync(); this.nav.refresh(this.tabIndex);
    if (!this.el.hidden) this.focusTab();
  }
  private focusTab(): void {
    this.el.querySelector<HTMLElement>(`[data-tab="${this.tabIndex}"]`)?.focus({ preventScroll: true });
  }
  open(): void { this.sync(); this.focusTab(); }
  sync(): void {
    this.el.querySelectorAll<HTMLElement>('[data-setting]').forEach((el) => {
      const r = SETTINGS_ROWS.find((x) => x.key === el.dataset.setting)!;
      const v = settings[r.key];
      const value = r.labels ? r.labels[Number(v)] : typeof v === 'boolean' ? (v ? 'ON' : 'OFF') : r.range ? `${Number(v).toFixed(r.range[2] < 1 ? 2 : 0)}${r.key === 'textScale' || r.key === 'uiScale' ? '%' : ''}` : String(v).toUpperCase();
      this.el.querySelector(`[data-value="${r.key}"]`)!.textContent = value;
      el.setAttribute('aria-label', `${r.label}: ${value}`);
      if (el instanceof HTMLInputElement) { el.value = String(v); el.setAttribute('aria-valuetext', value); }
      else if (typeof v === 'boolean') el.setAttribute('aria-pressed', String(v));
    });
  }
  private describe(el: HTMLElement | null): void {
    if (!el) return;
    const r = SETTINGS_ROWS.find((x) => x.key === el.dataset.setting);
    if (r) this.description.textContent = r.desc;
    else if (el.hasAttribute('data-reset')) this.description.textContent = 'Restore defaults for this tab only. Key bindings have their own reset on REBIND KEYS.';
    else if (el.hasAttribute('data-rebind')) this.description.textContent = 'Choose the keyboard keys for each action. Gamepad and touch layouts remain fixed.';
    else if (el.hasAttribute('data-settings-back')) this.description.textContent = 'Return to the previous menu. Your changes are already saved.';
    else if (el.dataset.act === 'ob-tips-reset') this.description.textContent = 'Show first-time tips again as you encounter each mechanic.';
    else if (el.dataset.tab !== undefined) this.description.textContent = `${SETTINGS_TABS[Number(el.dataset.tab)]} · Changes save automatically on this device.`;
  }
  update(input: Input, dt: number): void {
    const tabFocused = this.el.querySelector('.focused')?.getAttribute('role') === 'tab';
    if (input.keyPressed('KeyQ') || input.padButtonPressed(4) || (tabFocused && input.keyPressed('ArrowLeft'))) this.selectTab(this.tabIndex - 1);
    else if (input.keyPressed('KeyE') || input.padButtonPressed(5) || (tabFocused && input.keyPressed('ArrowRight'))) this.selectTab(this.tabIndex + 1);
    else this.nav.update(input, dt);
    const focused = this.el.querySelector('.focused');
    if (focused !== this.lastFocus) {
      this.lastFocus = focused; this.describe(focused as HTMLElement);
      if (focused && (input.device === 'pad' || input.keyPressed('ArrowDown') || input.keyPressed('ArrowUp') || input.keyPressed('KeyW') || input.keyPressed('KeyS') || input.keyPressed('KeyQ') || input.keyPressed('KeyE'))) (focused as HTMLElement).focus({ preventScroll: true });
    }
    if (this.hintMode !== promptState.mode) {
      this.hintMode = promptState.mode;
      this.hint.innerHTML = promptState.mode === 'kbm' ? 'Q / E · SWITCH TAB' : promptState.mode === 'touch' ? 'TAP TABS · SWIPE TO SCROLL' : `${promptHtml('dash')} / ${promptHtml('bomb')} · SWITCH TAB`;
    }
  }
}

function injectSettingsCss(): void {
  if (document.getElementById('settings-css')) return;
  const css = document.createElement('style'); css.id = 'settings-css';
  css.textContent = `
#scr-settings { padding:calc(6 * var(--p)); gap:calc(3 * var(--p)); justify-content:center; }
#scr-settings h1 { margin:0; font-size:42px; }
.settings-shell { width:min(880px, 100%); min-height:0; display:flex; flex-direction:column; gap:calc(4 * var(--p)); }
.settings-tabs { display:flex; flex-wrap:wrap; gap:calc(3 * var(--p)); justify-content:center; }
#scr-settings .settings-tabs button { font:12px var(--label); padding:calc(3 * var(--p)); flex:1 1 auto; min-width:0; min-height:44px; }
#scr-settings .settings-tabs button.on { --bg:var(--blue); --hi:var(--cyan); color:var(--white); }
#scr-settings .settings[hidden] { display:none; }
#scr-settings .settings { width:100%; min-width:0; max-height:46vh; min-height:110px; overflow-y:auto; padding:calc(4 * var(--p)); box-sizing:border-box; gap:calc(3 * var(--p)); align-items:stretch; }
#scr-settings .settings > button, #scr-settings .settings > label { width:100%; box-sizing:border-box; flex:0 0 auto; height:auto; min-height:44px; white-space:normal; font-size:21px; }
#scr-settings .settings label { display:flex; justify-content:space-between; flex-wrap:wrap; gap:8px; }
#scr-settings .settings button { display:flex; align-items:center; justify-content:space-between; gap:12px; text-align:left; }
#scr-settings .settings b { color:var(--yellow); margin-left:8px; }
#scr-settings .settings input { width:min(250px, 45%); min-width:100px; }
.settings-description { color:var(--cyan); font:20px/1.15 var(--font); margin:0; min-height:3.5em; padding:0 calc(4 * var(--p)); }
.settings-footer { display:flex; justify-content:space-between; gap:20px; padding:0 calc(4 * var(--p)); }
.settings-footer button { font-size:20px; min-height:44px; }
.settings-hint { text-align:center; margin:0; color:var(--mist); font:10px var(--label); }
#scr-settings [data-nav]:focus-visible { outline:calc(2 * var(--p)) solid var(--cyan); outline-offset:var(--p); }
@media(max-width:600px) { #scr-settings { padding:12px; } #scr-settings h1 { font-size:30px; } #scr-settings .settings-tabs button { font-size:9px; padding:8px; } .settings-shell { gap:10px; } .settings-description { font-size:18px; } }
@media(max-height:550px) { #scr-settings { justify-content:flex-start; overflow:auto; } #scr-settings .settings { max-height:38vh; } }
`;
  document.head.append(css);
}

const scaledRules = new WeakSet<CSSStyleDeclaration>();
let textObserver: MutationObserver | undefined;
/** Scale declared font sizes, not boxes or icons. Runs on stylesheet insertion, never per frame. */
export function applyTextScale(percent: number): void {
  if (typeof document === 'undefined') return;
  const value = Number.isFinite(percent) ? Math.max(100, Math.min(150, percent)) : 100;
  document.documentElement.style.setProperty('--text-scale', String(value / 100));
  const visit = (rules: CSSRuleList): void => {
    for (const rule of Array.from(rules)) {
      const style = (rule as CSSStyleRule).style;
      if (style && !scaledRules.has(style)) {
        const size = style.getPropertyValue('font-size');
        if (size && /(?:px|rem)$/.test(size)) { style.setProperty('font-size', `calc(${size} * var(--text-scale, 1))`, style.getPropertyPriority('font-size')); scaledRules.add(style); }
      }
      if ('cssRules' in rule) visit((rule as CSSGroupingRule).cssRules);
    }
  };
  for (const sheet of Array.from(document.styleSheets)) { try { visit(sheet.cssRules); } catch { /* cross-origin sheets cannot be inspected */ } }
  if (!textObserver && typeof MutationObserver !== 'undefined') {
    textObserver = new MutationObserver(() => applyTextScale(Number(document.documentElement.style.getPropertyValue('--text-scale')) * 100));
    textObserver.observe(document.head, { childList: true, subtree: true });
  }
}
