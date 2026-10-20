/**
 * EXTRAS > ARENA EDITOR (editor lane): the saved-arena list and the editor.
 *
 * The editor is a pixel map (src/editor/mapView.ts) with a palette on the left
 * and a panel on the right (BUILD / RULES / SHARE tabs and the actions). It has
 * two input modes so one screen works with mouse, keyboard and gamepad:
 * - MAP: a cursor on the map. Arrows/WASD/D-pad/stick move it, Enter/A/left
 *   click place, X/Delete/right click erase, R/Y/wheel rotate, Q/E/LB/RB pick
 *   the piece, Z/Y/LT/RT undo/redo, G grid snap. Tab/Esc/Start/B -> PANEL.
 * - PANEL: plain MenuNav over every button (palette, tabs, rules, actions).
 *   Esc/B or EDIT MAP (or a click on the map) -> MAP.
 * PLAY and HOST need a valid arena (src/editor/arenaData.ts validateArena);
 * both save first. Codes: SHARE tab (copy / import).
 */
import type { Game } from '../game/game';
import { MenuNav } from './menu';
import type { Input } from '../core/input';
import { t, localize, onLanguageChange } from '../i18n';
import { sfx } from '../audio/sfx';
import { promptState, padGlyph, type PadFamily } from './prompts';
import { allBiomeKeys, biomeByKey } from '../data/biomes';
import { ENEMIES } from '../data/enemies';
import { HEAT } from '../data/heat';
import { DIFF_BY_ID, type DifficultyId } from '../data/modes';
import { save } from '../game/save';
import {
  FOES_MAX, SIZES, SIZE_HALF, TIME_MAX, TIME_MIN, TIME_STEP, WAVE_IDS, bossChoices, cleanName, countOf, difficultyChoices, newArena, normalizeArena, pieceAt, rosterFoes, validateArena,
  type ArenaRules, type CustomArena, type Validity,
} from '../editor/arenaData';
import { PIECES, PIECE_BY_ID, type PieceId } from '../editor/pieces';
import { EditHistory, cloneArena } from '../editor/history';
import { erasePiece, placePiece, resizeArena, rotatePieceAt, snapPos, type PlaceResult } from '../editor/ops';
import { MapView, pieceIcon } from '../editor/mapView';
import { ArenaCodeError, arenaCodeSmall, readArenaCode, readArenaCodeSync } from '../editor/codec';
import { MAX_SAVED, bestFor, deleteArena, newArenaId, saveArena, savedArenas } from '../editor/store';
import { SAMPLE_IDS, sampleArena, type SampleId } from '../editor/samples';
import { editorState, hostArena, pickLobbyArena, playArenaSolo } from '../game/systems/editor';

const CSS = `
#scr-arenas .ae-list { display:flex; flex-direction:column; gap:calc(2 * var(--p)); width:min(860px, calc(100vw - 32px)); }
#scr-arenas .ae-row { display:flex; gap:calc(2 * var(--p)); align-items:stretch; }
#scr-arenas .ae-row .ae-main { flex:1; text-align:start; display:flex; flex-direction:column; gap:2px; }
#scr-arenas .ae-row .ae-main small, #scr-arenas .ae-empty { font:11px var(--label); color:var(--mist); letter-spacing:1px; }
#scr-arenas .ae-row button { font:20px var(--font); padding:6px 14px 8px; }
#scr-arenas .menu.row { flex-wrap:wrap; justify-content:center; gap:calc(3 * var(--p)); }
#scr-arenas .menu.row button { font:22px var(--font); padding:8px 18px 10px; }
#scr-arenas textarea, #scr-arenaedit textarea { box-sizing:border-box; width:100%; resize:none; background:var(--ink); color:var(--mist); border:none; outline:none; padding:calc(2 * var(--p)); font:12px var(--label); box-shadow:0 0 0 var(--p) var(--slate); word-break:break-all; }
#scr-arenas textarea { width:min(860px, calc(100vw - 32px)); height:56px; }
.ae-msg { min-height:18px; font:16px var(--font); color:var(--lime); text-align:center; }
.ae-msg.err { color:var(--orange); }
#scr-arenaedit { justify-content:flex-start; gap:calc(2 * var(--p)); padding:10px 12px; overflow:hidden; }
#scr-arenaedit.screen.dim { background-color:var(--ink); background-image:repeating-conic-gradient(var(--night) 0 25%, transparent 0 50%); }
#scr-arenaedit .ae-top { display:flex; align-items:center; gap:calc(4 * var(--p)); width:100%; max-width:1500px; }
#scr-arenaedit .ae-top h1 { font-size:calc(11 * var(--p)); line-height:1; white-space:nowrap; }
#scr-arenaedit .ae-name { flex:0 1 280px; min-width:120px; font:22px var(--font); color:var(--white); background:var(--ink); border:0; outline:none; padding:4px 10px; box-shadow:0 0 0 var(--p) var(--slate); text-transform:uppercase; }
#scr-arenaedit .ae-name.focused, #scr-arenaedit .ae-name:focus { box-shadow:0 0 0 var(--p) var(--yellow); }
#scr-arenaedit .ae-badge { font:18px var(--font); letter-spacing:1px; padding:2px 10px 4px; color:var(--ink); background:var(--lime); white-space:nowrap; text-shadow:none; -webkit-text-stroke:0; }
#scr-arenaedit .ae-badge.bad { background:var(--orange); }
#scr-arenaedit .ae-body { display:flex; gap:calc(3 * var(--p)); width:100%; max-width:1500px; flex:1; min-height:0; align-items:stretch; justify-content:center; }
#scr-arenaedit .ae-palette { width:178px; flex:none; display:flex; flex-direction:column; gap:3px; overflow-y:auto; padding:2px 6px 2px 2px; }
#scr-arenaedit .ae-palette .ae-grp { font:10px var(--label); letter-spacing:1px; color:var(--cyan); margin:4px 0 0; }
#scr-arenaedit .ae-palette button { display:flex; align-items:center; gap:6px; font:16px var(--font); padding:2px 6px 3px 3px; text-align:start; }
#scr-arenaedit .ae-palette button.on { --bg:var(--green); --hi:var(--lime); --lo:var(--teal); }
#scr-arenaedit .ae-palette button.on.focused { --bg:var(--orange); --hi:var(--yellow); --lo:var(--red); }
#scr-arenaedit .ae-palette button .ae-n { margin-inline-start:auto; font:10px var(--label); color:var(--mist); }
#scr-arenaedit .ae-icon { width:24px; height:24px; image-rendering:pixelated; flex:none; box-shadow:0 0 0 1px var(--ink); }
#scr-arenaedit .ae-mapwrap { flex:1 1 auto; min-width:0; display:flex; align-items:center; justify-content:center; position:relative; }
#scr-arenaedit .ae-map { image-rendering:pixelated; cursor:crosshair; box-shadow:0 0 0 var(--p) var(--ink), 0 0 0 calc(2 * var(--p)) var(--slate); background:var(--ink); }
#scr-arenaedit.ae-mapmode .ae-map { box-shadow:0 0 0 var(--p) var(--ink), 0 0 0 calc(2 * var(--p)) var(--yellow); }
#scr-arenaedit.ae-mapmode .ae-palette button.focused:not(.on), #scr-arenaedit.ae-mapmode .ae-panel button.focused { --bg:var(--blue); --hi:var(--sky); --lo:var(--navy); --ring:transparent; }
#scr-arenaedit .ae-coords { position:absolute; inset-block-start:4px; inset-inline-start:8px; font:11px var(--label); color:var(--white); text-shadow:var(--outline); pointer-events:none; direction:ltr; }
#scr-arenaedit .ae-panel { width:300px; flex:none; display:flex; flex-direction:column; gap:calc(2 * var(--p)); min-height:0; }
#scr-arenaedit .ae-tabs { display:flex; gap:calc(2 * var(--p)); }
#scr-arenaedit .ae-tabs button { flex:1; font:16px var(--font); padding:3px 4px 5px; }
#scr-arenaedit .ae-tabs button.on { --bg:var(--plum); --hi:var(--red); --lo:var(--ink); }
#scr-arenaedit .ae-tab { flex:1; min-height:0; overflow-y:auto; background:var(--night); padding:calc(2 * var(--p)) calc(3 * var(--p)); box-shadow:inset var(--p) var(--p) 0 0 var(--slate), inset calc(-1 * var(--p)) calc(-1 * var(--p)) 0 0 var(--ink), 0 0 0 var(--p) var(--ink); display:flex; flex-direction:column; gap:3px; }
#scr-arenaedit .ae-tab p { margin:0; font:15px var(--font); color:var(--white); }
#scr-arenaedit .ae-tab .ae-sub { font:10px var(--label); letter-spacing:1px; color:var(--cyan); margin-top:4px; }
#scr-arenaedit .ae-tab .ae-err { color:var(--orange); }
#scr-arenaedit .ae-tab .ae-warn { color:var(--yellow); }
#scr-arenaedit .ae-tab .ae-ok { color:var(--lime); }
#scr-arenaedit .ae-tab button { font:15px var(--font); padding:2px 8px 4px; text-align:start; display:flex; justify-content:space-between; gap:8px; }
#scr-arenaedit .ae-tab button b { font-weight:normal; color:var(--yellow); }
#scr-arenaedit .ae-chips { display:flex; flex-wrap:wrap; gap:4px; }
#scr-arenaedit .ae-chips button { font:13px var(--font); padding:1px 6px 3px; }
#scr-arenaedit .ae-chips button.on { --bg:var(--green); --hi:var(--lime); --lo:var(--teal); }
#scr-arenaedit .ae-tab textarea { height:110px; }
#scr-arenaedit .ae-actions { display:grid; grid-template-columns:1fr 1fr; gap:calc(2 * var(--p)); }
#scr-arenaedit .ae-actions button { font:16px var(--font); padding:3px 6px 5px; }
#scr-arenaedit .ae-actions .ae-play { grid-column:1 / -1; --bg:var(--green); --hi:var(--lime); --lo:var(--teal); font-size:20px; }
#scr-arenaedit .ae-actions .ae-play.focused { --bg:var(--orange); --hi:var(--yellow); --lo:var(--red); }
#scr-arenaedit .ae-hint { width:100%; max-width:1500px; display:flex; flex-wrap:wrap; gap:4px 14px; justify-content:center; font:13px var(--font); color:var(--mist); min-height:20px; }
#scr-arenaedit .ae-hint .kc { display:inline-block; font:10px var(--label); color:var(--ink); background:var(--white); padding:1px 4px; margin-inline-end:3px; box-shadow:0 0 0 1px var(--ink); }
#scr-arenaedit .ae-hint .pg, #scr-arenaedit .ae-hint .pad-face { vertical-align:middle; margin-inline-end:3px; }
#scr-arenaedit .ae-hint .ae-msg { flex-basis:100%; }
.ae-lobby { display:flex; justify-content:center; margin-top:calc(2 * var(--p)); }
.ae-lobby button { font:20px var(--font) !important; padding:6px 14px 8px !important; }
.ae-lobby .note { font:16px var(--font); color:var(--yellow); }
@media (max-width: 900px) {
  #scr-arenaedit .ae-body { flex-direction:column; overflow-y:auto; }
  #scr-arenaedit .ae-palette { width:auto; flex-direction:row; flex-wrap:wrap; max-height:120px; }
  #scr-arenaedit .ae-panel { width:auto; }
}
`;

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const GROUPS = ['cover', 'hazard', 'toy', 'marker'] as const;
type Tool = PieceId | 'erase';
type Tab = 'build' | 'rules' | 'share';

/** MenuNav that hands the controls to the map while the editor is in MAP mode. */
class EditorNav extends MenuNav {
  constructor(root: HTMLElement, private owner: EditorScreen, onBack: () => void) {
    super(root, { columns: 2, onBack });
  }
  update(input: Input, dt: number): void {
    if (this.owner.mapMode) this.owner.mapUpdate(input, dt);
    else {
      if (input.keyPressed('Tab') && !this.owner.typing()) {
        this.owner.setMapMode(true);
        return;
      }
      super.update(input, dt);
    }
    this.owner.frame(dt);
  }
}

export class EditorScreen {
  readonly list: HTMLElement;
  readonly ed: HTMLElement;
  private nav: EditorNav;
  private map = new MapView();
  arena: CustomArena = newArena();
  id = '';
  private history = new EditHistory();
  tool: Tool = 'wall';
  rot = 0;
  snap = true;
  cx = 0;
  cz = 0;
  mapMode = true;
  private tab: Tab = 'build';
  validity: Validity | null = null;
  private validT = 0;
  private drawDirty = true;
  private time = 0;
  private pick = false;
  private clientPick = '';
  private msgText = '';
  private msgErr = false;
  private paint: { erase: boolean; key: string; before: CustomArena; pushed: boolean } | null = null;
  private repeat = 0;
  private held = '';
  private armed = '';
  private listArmed = '';
  private sampleIx = 0;
  private lastHint = '';
  private iconBiome = '';

  constructor(private g: Game) {
    if (!document.getElementById('editor-css')) {
      const st = document.createElement('style');
      st.id = 'editor-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    this.list = document.createElement('div');
    this.list.id = 'scr-arenas';
    this.list.className = 'screen dim';
    g.screens.addScreen('arenas', this.list, { columns: 4, onBack: () => this.listBack() });
    this.ed = document.createElement('div');
    this.ed.id = 'scr-arenaedit';
    this.ed.className = 'screen dim';
    this.nav = new EditorNav(this.ed, this, () => this.setMapMode(true));
    g.screens.addScreen('arenaedit', this.ed, this.nav);
    this.buildEditorDom();

    // EXTRAS > ARENA EDITOR (just before BACK, so other lanes' entries keep their places).
    const back = document.querySelector('#scr-extras [data-act=ex-back]');
    if (back && !document.querySelector('#scr-extras [data-act=ae-open]')) {
      back.insertAdjacentHTML('beforebegin', `<button data-nav data-act="ae-open">${esc(t('editor.title'))}</button>`);
      document.querySelector('#scr-extras [data-act=ae-open]')?.addEventListener('click', () => this.openList(false));
    }
    // Online lobby: the host's arena pick (clients see what the host picked).
    const note = document.querySelector('#scr-online .lobby .mp-diff-note');
    if (note && !document.querySelector('#scr-online .ae-lobby')) {
      const row = document.createElement('div');
      row.className = 'ae-lobby';
      note.after(row);
      row.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('[data-ae-lobby]')) this.openList(true);
      });
    }
    const setLobby = g.screens.setLobby.bind(g.screens);
    g.screens.setLobby = (v) => {
      setLobby(v);
      if (!v.code) this.clientPick = '';
      this.refreshLobby();
    };

    // The editor covers the whole screen: skip drawing the 3D world behind it (saves the GPU while building).
    const render = g.render.bind(g);
    g.render = ((...args: Parameters<Game['render']>) => {
      const open = g.screens.current === 'arenaedit';
      g.scene.visible = !open; // the renderer then draws an empty scene
      if (!open) render(...args);
    }) as Game['render'];

    this.list.addEventListener('click', (e) => this.listClick(e));
    onLanguageChange(() => {
      const b = document.querySelector('#scr-extras [data-act=ae-open]');
      if (b) b.textContent = t('editor.title');
      if (g.screens.current === 'arenas') this.renderList();
      if (g.screens.current === 'arenaedit') this.renderAll();
      this.refreshLobby();
    });
  }

  // ---------------------------------------------------------------- samples / entry points

  /** A sample id ('demo', 'fortress', 'pit') or a share code (plain codes only: sync). */
  sample(key: string): CustomArena | null {
    if ((SAMPLE_IDS as readonly string[]).includes(key)) return sampleArena(key as SampleId);
    try {
      return readArenaCodeSync(key);
    } catch {
      return null;
    }
  }

  openList(pick: boolean): void {
    this.pick = pick;
    this.listArmed = '';
    this.renderList();
    this.g.screens.show('arenas');
  }

  openEditor(a?: CustomArena, tab: Tab = 'build', id = ''): void {
    this.arena = a ? cloneArena(a) : newArena(t('editor.defaultName'));
    this.id = id || newArenaId();
    this.history.clear();
    this.tab = tab;
    this.armed = '';
    this.cx = 0;
    this.cz = 0;
    this.msgText = '';
    this.validity = validateArena(this.arena);
    this.mapMode = tab === 'build';
    this.renderAll();
    this.g.screens.show('arenaedit');
    this.ed.classList.toggle('ae-mapmode', this.mapMode);
  }

  setCursor(x: number, z: number, piece?: string): void {
    if (piece && (piece === 'erase' || PIECE_BY_ID[piece as PieceId])) this.tool = piece as Tool;
    this.cx = x;
    this.cz = z;
    this.renderPalette();
    this.drawDirty = true;
    this.frame(0);
  }

  // ---------------------------------------------------------------- list screen

  private listBack(): void {
    if (this.pick) this.g.screens.show('online');
    else this.g.screens.show('extras');
  }

  renderList(): void {
    const all = savedArenas();
    const rows = all
      .map((e) => {
        const a = e.arena;
        const best = bestFor(a);
        const sub = `${biomeByKey(a.rules.biome).name.toUpperCase()} · ${t(`editor.size.${a.size}`)} · ${t('editor.pieces', { n: a.pieces.length })}${best ? ` · ${t('editor.best', { n: best.score.toLocaleString('en-US') })}` : ''}`;
        const main = `<button data-nav class="ae-main" data-${this.pick ? 'pick' : 'open'}="${e.id}"><span><bdi>${esc(a.name)}</bdi></span><small>${esc(sub)}</small></button>`;
        if (this.pick) return `<div class="ae-row">${main}</div>`;
        const del = this.listArmed === e.id ? t('editor.deleteSure') : t('editor.delete');
        return `<div class="ae-row">${main}<button data-nav data-play="${e.id}">${t('editor.play')}</button><button data-nav data-host="${e.id}">${t('editor.host')}</button><button data-nav data-del="${e.id}">${del}</button></div>`;
      })
      .join('');
    const sample = sampleArena(SAMPLE_IDS[this.sampleIx % SAMPLE_IDS.length]);
    const actions = this.pick
      ? `<button data-nav data-pick="">${t('editor.standardFields')}</button><button data-nav data-back>${t('editor.back')}</button>`
      : `<button data-nav data-new>${t('editor.new')}</button><button data-nav data-sample>${esc(t('editor.sample', { name: sample.name }))}</button><button data-nav data-import>${t('editor.importCode')}</button><button data-nav data-back>${t('editor.back')}</button>`;
    this.list.innerHTML = `<h1>${t(this.pick ? 'editor.pickTitle' : 'editor.title')}</h1>
      <p class="note">${esc(this.pick ? t('editor.pickNote') : t('editor.listNote', { n: all.length, max: MAX_SAVED }))}</p>
      <div class="ae-list">${rows || `<div class="ae-empty">${t('editor.empty')}</div>`}</div>
      ${this.pick ? '' : `<textarea class="ae-import" spellcheck="false" placeholder="${esc(t('editor.pastePlaceholder'))}"></textarea>`}
      <div class="ae-msg ${this.msgErr ? 'err' : ''}">${esc(this.msgText)}</div>
      <div class="menu row">${actions}</div>`;
    if (this.g.screens.current === 'arenas') this.g.screens.refreshNav();
  }

  private listMsg(text: string, ok = true): void {
    this.msgText = text;
    this.msgErr = !ok;
    const m = this.list.querySelector<HTMLElement>('.ae-msg');
    if (m) {
      m.textContent = text;
      m.classList.toggle('err', !ok);
    }
    if (!ok) sfx.deny();
  }

  private listClick(e: Event): void {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b) return;
    const d = b.dataset;
    const find = (id: string) => savedArenas().find((x) => x.id === id);
    if (d.back !== undefined) return this.listBack();
    if (d.pick !== undefined) {
      const entry = d.pick ? find(d.pick) : null;
      if (entry && !validateArena(entry.arena).ok) return this.listMsg(t('editor.notPlayable'), false);
      pickLobbyArena(this.g, entry ? { id: entry.id, arena: entry.arena } : null);
      this.msgText = '';
      return this.g.screens.show('online');
    }
    if (d.new !== undefined) return this.openEditor();
    if (d.sample !== undefined) {
      const s = sampleArena(SAMPLE_IDS[this.sampleIx++ % SAMPLE_IDS.length]);
      this.msgText = '';
      return this.openEditor(s);
    }
    if (d.import !== undefined) return void this.importFrom(this.list.querySelector<HTMLTextAreaElement>('.ae-import')?.value ?? '', true);
    if (d.open) {
      const entry = find(d.open);
      if (entry) {
        this.msgText = '';
        this.openEditor(entry.arena, 'build', entry.id);
      }
      return;
    }
    if (d.play || d.host) {
      const entry = find(d.play || d.host || '');
      if (!entry) return;
      if (!validateArena(entry.arena).ok) {
        this.openEditor(entry.arena, 'build', entry.id);
        return this.msg(t('editor.fixFirst'), false);
      }
      this.msgText = '';
      if (d.play) playArenaSolo(this.g, entry.arena);
      else hostArena(this.g, entry.id, entry.arena);
      return;
    }
    if (d.del) {
      if (this.listArmed !== d.del) {
        this.listArmed = d.del;
        return this.renderList();
      }
      deleteArena(d.del);
      this.listArmed = '';
      this.listMsg(t('editor.deleted'));
      this.renderList();
    }
  }

  private async importFrom(text: string, fromList: boolean): Promise<void> {
    const say = (m: string, ok = true) => (fromList ? this.listMsg(m, ok) : this.msg(m, !ok));
    if (!text.trim()) return say(t('editor.pasteFirst'), false);
    try {
      const a = await readArenaCode(text);
      this.msgText = '';
      this.openEditor(a);
      this.msg(t('editor.imported', { name: a.name }));
      sfx.powerUp();
    } catch (err) {
      const reason = err instanceof ArenaCodeError ? err.reason : 'format';
      say(t(`editor.bad.${reason}`), false);
    }
  }

  // ---------------------------------------------------------------- lobby

  /** Host: the lobby's arena button; client: the host's pick. */
  refreshLobby(): void {
    const row = document.querySelector<HTMLElement>('#scr-online .ae-lobby');
    if (!row) return;
    const g = this.g;
    const s = editorState(g);
    const coop = (g.lobbyKind ?? 'coop') === 'coop';
    if (g.role === 'host' && g.host && coop) {
      const pick = s.lobbyPick?.arena;
      const diff = pick ? DIFF_BY_ID[pick.rules.difficulty as DifficultyId]?.name.toUpperCase() ?? '' : '';
      const label = pick ? t('editor.lobbyArena', { name: pick.name, diff }) : t('editor.lobbyNone');
      const html = `<button data-nav data-ae-lobby><bdi>${esc(label)}</bdi></button>`;
      if (row.innerHTML !== html) row.innerHTML = html;
    } else if (g.role === 'client' && this.clientPick) {
      row.innerHTML = `<span class="note"><bdi>${esc(t('editor.lobbyHostPick', { name: this.clientPick }))}</bdi></span>`;
    } else row.innerHTML = '';
  }

  setClientPick(name: string): void {
    this.clientPick = name ? cleanName(name) : '';
    this.refreshLobby();
  }

  // ---------------------------------------------------------------- editor dom

  private buildEditorDom(): void {
    this.ed.innerHTML = `<div class="ae-top"><h1></h1><input class="ae-name" data-nav type="text" maxlength="24" spellcheck="false" autocomplete="off"><span class="ae-badge"></span></div>
      <div class="ae-body"><div class="ae-palette"></div><div class="ae-mapwrap"><span class="ae-coords"></span></div><div class="ae-panel"><div class="ae-tabs"></div><div class="ae-tab"></div><div class="ae-actions"></div></div></div>
      <div class="ae-hint"></div>`;
    this.ed.querySelector('.ae-mapwrap')!.prepend(this.map.canvas);
    const name = this.ed.querySelector<HTMLInputElement>('.ae-name')!;
    name.addEventListener('change', () => this.setName(name.value));
    name.addEventListener('blur', () => this.setName(name.value));
    name.addEventListener('keydown', (e) => {
      if (e.code === 'Enter') name.blur();
    });
    this.ed.addEventListener('click', (e) => this.edClick(e));
    this.ed.addEventListener('contextmenu', (e) => {
      if ((e.target as HTMLElement).closest('.ae-map, [data-rule]')) e.preventDefault();
    });
    // Right click on a rule steps it backwards.
    this.ed.addEventListener('mousedown', (e) => {
      const r = (e.target as HTMLElement).closest<HTMLElement>('[data-rule]');
      if (r && e.button === 2) this.stepRule(r.dataset.rule!, -1);
    });
    const c = this.map.canvas;
    c.addEventListener('mousemove', (e) => this.mouseAt(e.clientX, e.clientY));
    c.addEventListener('mousedown', (e) => {
      e.preventDefault();
      this.setMapMode(true);
      this.mouseAt(e.clientX, e.clientY);
      this.beginPaint(e.button === 2 || this.tool === 'erase');
    });
    window.addEventListener('mouseup', () => (this.paint = null));
    c.addEventListener('mouseleave', () => (this.paint = null));
    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.rotate(e.deltaY > 0 ? 1 : -1);
      },
      { passive: false },
    );
  }

  typing(): boolean {
    const a = document.activeElement;
    return !!a && this.ed.contains(a) && (a.matches('input[type=text], textarea'));
  }

  private setName(v: string): void {
    const n = cleanName(v);
    if (n !== this.arena.name) {
      this.history.push(this.arena);
      this.arena.name = n;
    }
    const el = this.ed.querySelector<HTMLInputElement>('.ae-name');
    if (el && document.activeElement !== el) el.value = this.arena.name;
  }

  setMapMode(on: boolean): void {
    if (this.mapMode === on) return;
    this.mapMode = on;
    this.paint = null;
    this.ed.classList.toggle('ae-mapmode', on);
    if (on && this.typing()) (document.activeElement as HTMLElement).blur();
    this.renderHint();
    sfx.menuMove();
  }

  renderAll(): void {
    this.ed.querySelector('.ae-top h1')!.textContent = t('editor.title');
    const name = this.ed.querySelector<HTMLInputElement>('.ae-name')!;
    name.value = this.arena.name;
    name.placeholder = t('editor.namePlaceholder');
    name.setAttribute('aria-label', t('editor.nameLabel'));
    this.renderPalette();
    this.renderTabs();
    this.renderActions();
    this.renderBadge();
    this.renderHint();
    this.fitMap();
    this.drawDirty = true;
    if (this.g.screens.current === 'arenaedit') this.g.screens.refreshNav();
  }

  private fitMap(): void {
    const wrap = this.ed.querySelector<HTMLElement>('.ae-mapwrap');
    const W = wrap?.clientWidth || 560;
    const H = wrap?.clientHeight || 560;
    const side = Math.max(240, Math.min(W, H) - 12);
    this.map.fit(this.arena, side);
    const c = this.map.canvas;
    // Whole-pixel CSS scale of the internal canvas, so pixels stay square.
    const k = Math.max(1, Math.floor(side / c.width)) || 1;
    const css = c.width * k <= side ? c.width * k : side;
    c.style.width = c.style.height = `${css}px`;
  }

  private renderPalette(): void {
    const pal = this.ed.querySelector<HTMLElement>('.ae-palette');
    if (!pal) return;
    const biome = this.arena.rules.biome;
    const rebuild = this.iconBiome !== biome || !pal.childElementCount;
    if (rebuild) {
      this.iconBiome = biome;
      pal.innerHTML = '';
      for (const grp of GROUPS) {
        const h = document.createElement('div');
        h.className = 'ae-grp';
        h.textContent = t(`editor.group.${grp}`);
        pal.append(h);
        for (const p of PIECES.filter((x) => x.group === grp)) {
          const b = document.createElement('button');
          b.dataset.nav = '';
          b.dataset.piece = p.id;
          b.append(pieceIcon(p.id, biome, 48));
          const s = document.createElement('span');
          s.textContent = t(`editor.piece.${p.id}`);
          const n = document.createElement('span');
          n.className = 'ae-n';
          b.append(s, n);
          pal.append(b);
        }
      }
      const er = document.createElement('button');
      er.dataset.nav = '';
      er.dataset.piece = 'erase';
      er.innerHTML = `<span class="ae-icon" style="background:var(--red)"></span><span>${t('editor.erase')}</span>`;
      pal.append(er);
    }
    pal.querySelectorAll<HTMLElement>('[data-piece]').forEach((b) => {
      const id = b.dataset.piece as Tool;
      b.classList.toggle('on', id === this.tool);
      const n = b.querySelector('.ae-n');
      if (n && id !== 'erase') {
        const def = PIECE_BY_ID[id as PieceId];
        const c = countOf(this.arena, id as PieceId);
        n.textContent = c ? (def.max <= 8 ? `${c}/${def.max}` : String(c)) : '';
      }
    });
  }

  private renderTabs(): void {
    const tabs = this.ed.querySelector<HTMLElement>('.ae-tabs')!;
    tabs.innerHTML = (['build', 'rules', 'share'] as Tab[]).map((k) => `<button data-nav data-tab="${k}" class="${k === this.tab ? 'on' : ''}">${t(`editor.tab.${k}`)}</button>`).join('');
    const body = this.ed.querySelector<HTMLElement>('.ae-tab')!;
    if (this.tab === 'build') body.innerHTML = this.buildTab();
    else if (this.tab === 'rules') body.innerHTML = this.rulesTab();
    else body.innerHTML = this.shareTab();
  }

  private buildTab(): string {
    const v = this.validity;
    const tool = this.tool;
    const def = tool === 'erase' ? null : PIECE_BY_ID[tool];
    let h = `<div class="ae-sub">${t('editor.selected')}</div><p>${tool === 'erase' ? t('editor.erase') : t(`editor.piece.${tool}`)}</p>`;
    h += `<p>${esc(tool === 'erase' ? t('editor.eraseDesc') : t(`editor.desc.${tool}`))}</p>`;
    if (def) h += `<p class="ae-warn">${esc(t('editor.count', { n: countOf(this.arena, def.id), max: def.max }))}${def.round ? ` · ${esc(t('editor.radius', { n: [2, 3, 4, 5][this.rot] }))}` : ''}</p>`;
    h += `<div class="ae-sub">${t('editor.check')}</div>`;
    if (v) {
      if (v.ok) h += `<p class="ae-ok">${t('editor.valid', { n: v.area })}</p>`;
      for (const e of v.errors) h += `<p class="ae-err">✖ ${esc(t(`editor.issue.${e.id}`))}</p>`;
      for (const w of v.warnings) h += `<p class="ae-warn">! ${esc(t(`editor.issue.${w.id}`))}</p>`;
    }
    h += `<div class="ae-sub">${t('editor.tips')}</div><p>${esc(t('editor.tipText'))}</p>`;
    return h;
  }

  private ruleLabel(key: string): string {
    const r = this.arena.rules;
    const onOff = (b: boolean) => (b ? t('editor.on') : t('editor.off'));
    switch (key) {
      case 'biome':
        return biomeByKey(r.biome).name.toUpperCase();
      case 'waves':
        return t(`editor.waves.${r.waves}`);
      case 'time':
        return `${Math.floor(r.time / 60)}:${String(r.time % 60).padStart(2, '0')}`;
      case 'boss':
        return r.boss === 'auto' ? t('editor.bossAuto') : (ENEMIES[r.boss]?.name ?? r.boss).toUpperCase();
      case 'difficulty': {
        const d = DIFF_BY_ID[r.difficulty as DifficultyId];
        const locked = d?.unlock && !save.achievements.includes(d.unlock);
        return `${d?.name.toUpperCase() ?? r.difficulty}${locked ? ` 🔒` : ''}`;
      }
      default:
        return onOff(!!r[key as 'night' | 'rain' | 'wind' | 'events' | 'rings']);
    }
  }

  private rulesTab(): string {
    const r = this.arena.rules;
    const row = (key: string) => `<button data-nav data-rule="${key}"><span>${t(`editor.rule.${key}`)}</span><b><bdi>${esc(this.ruleLabel(key))}</bdi></b></button>`;
    let h = `<p>${esc(t('editor.rulesNote'))}</p>`;
    h += ['biome', 'waves'].map(row).join('');
    if (r.waves === 'custom') {
      h += `<div class="ae-sub">${esc(t('editor.foesNote', { n: r.foes.length, max: FOES_MAX }))}</div><div class="ae-chips">${rosterFoes()
        .map((d) => `<button data-nav data-foe="${d.id}" class="${r.foes.includes(d.id) ? 'on' : ''}">${esc(localize(d.name).toUpperCase())}</button>`)
        .join('')}</div>`;
    }
    h += ['time', 'boss', 'difficulty', 'night', 'rain', 'wind', 'events', 'rings'].map(row).join('');
    h += `<div class="ae-sub">${t('editor.heat')}</div><div class="ae-chips">${HEAT.map((x) => `<button data-nav data-heat="${x.id}" class="${r.heat.includes(x.id) ? 'on' : ''}" title="${esc(localize(x.desc))}">${esc(localize(x.name).toUpperCase())}</button>`).join('')}</div>`;
    return h;
  }

  private shareTab(): string {
    return `<p>${esc(t('editor.shareNote'))}</p>
      <textarea class="ae-code" spellcheck="false" placeholder="${esc(t('editor.pastePlaceholder'))}"></textarea>
      <button data-nav data-share="copy"><span>${t('editor.copyCode')}</span></button>
      <button data-nav data-share="make"><span>${t('editor.makeCode')}</span></button>
      <button data-nav data-share="import"><span>${t('editor.importCode')}</span></button>`;
  }

  private renderActions(): void {
    const act = this.ed.querySelector<HTMLElement>('.ae-actions')!;
    const a = this.arena;
    const b = (k: string, label: string, cls = '') => `<button data-nav data-a="${k}" class="${cls}">${label}</button>`;
    act.innerHTML =
      b('play', `${t('editor.play')} &#9654;`, 'ae-play') +
      b('host', t('editor.host')) +
      b('save', t('editor.save')) +
      b('undo', t('editor.undo'), this.history.canUndo ? '' : 'cant') +
      b('redo', t('editor.redo'), this.history.canRedo ? '' : 'cant') +
      b('size', t('editor.sizeBtn', { size: t(`editor.size.${a.size}`) })) +
      b('grid', t('editor.gridBtn', { v: this.snap ? t('editor.on') : t('editor.off') })) +
      b('clear', this.armed === 'clear' ? t('editor.clearSure') : t('editor.clear')) +
      b('map', t('editor.editMap')) +
      b('back', t('editor.back'));
  }

  private renderBadge(): void {
    const el = this.ed.querySelector<HTMLElement>('.ae-badge')!;
    const v = this.validity;
    el.textContent = v?.ok ? t('editor.badgeOk', { n: this.arena.pieces.length }) : t('editor.badgeBad', { n: v?.errors.length ?? 0 });
    el.classList.toggle('bad', !v?.ok);
  }

  /** Controls line in the current prompt style (keyboard caps or the pad's glyphs). */
  private renderHint(): void {
    const mode = promptState.mode;
    const pad = mode === 'xbox' || mode === 'ps';
    const fam: PadFamily = mode === 'ps' ? 'ps' : 'xbox';
    const k = (s: string) => `<span class="kc">${s}</span>`;
    const p = (b: Parameters<typeof padGlyph>[1]) => padGlyph(fam, b);
    const items: [string, string][] = this.mapMode
      ? pad
        ? [[p('ls') + p(12), 'move'], [p(0), 'place'], [p(2), 'erase'], [p(3), 'rotate'], [p(4) + p(5), 'piece'], [p(6) + p(7), 'undo'], [p(9), 'menu']]
        : [[k('WASD') + k('↑↓←→'), 'move'], [k('ENTER') + k('LMB'), 'place'], [k('X') + k('RMB'), 'erase'], [k('R') + k('WHEEL'), 'rotate'], [k('Q') + k('E'), 'piece'], [k('Z') + k('Y'), 'undo'], [k('G'), 'grid'], [k('TAB'), 'menu']]
      : pad
        ? [[p(0), 'select'], [p(1), 'map']]
        : [[k('ENTER'), 'select'], [k('TAB') + k('ESC'), 'map']];
    const html = items.map(([key, id]) => `<span>${key}${t(`editor.hint.${id}`)}</span>`).join('') + `<span class="ae-msg ${this.msgErr ? 'err' : ''}">${esc(this.msgText)}</span>`;
    if (html === this.lastHint) return;
    this.lastHint = html;
    this.ed.querySelector('.ae-hint')!.innerHTML = html;
  }

  msg(text: string, err = false): void {
    this.msgText = text;
    this.msgErr = err;
    if (err) sfx.deny();
    this.renderHint();
  }

  // ---------------------------------------------------------------- editing

  private changed(): void {
    this.validT = 0.15;
    this.drawDirty = true;
    this.renderPalette();
    this.renderActions();
    if (this.tab === 'build') this.renderTabs();
  }

  private revalidate(): void {
    this.validity = validateArena(this.arena);
    this.renderBadge();
    if (this.tab === 'build') this.renderTabs();
    this.drawDirty = true;
  }

  private ghostRot(): number {
    return this.tool === 'erase' ? 0 : this.rot;
  }

  private cursorOk(): boolean {
    if (this.tool === 'erase') return pieceAt(this.arena, this.cx, this.cz) >= 0;
    const test = cloneArena(this.arena);
    const r = placePiece(test, { k: this.tool, x: this.cx, z: this.cz, r: this.ghostRot() });
    return r === 'ok' || r === 'moved';
  }

  private place(record = true): PlaceResult | 'erased' | 'none' {
    if (this.tool === 'erase') return this.erase(record) ? 'erased' : 'none';
    const before = cloneArena(this.arena);
    const r = placePiece(this.arena, { k: this.tool, x: this.cx, z: this.cz, r: this.ghostRot() });
    if (r === 'ok' || r === 'moved') {
      if (record) this.history.push(before);
      sfx.ui('tick', 0.6);
      this.msg('');
      this.changed();
    } else if (record) this.msg(t(`editor.fail.${r}`, { max: PIECE_BY_ID[this.tool].max }), true);
    return r;
  }

  private erase(record = true): boolean {
    const before = cloneArena(this.arena);
    const p = erasePiece(this.arena, this.cx, this.cz);
    if (!p) return false;
    if (record) this.history.push(before);
    sfx.ui('tick', 0.2);
    this.changed();
    return true;
  }

  /** Mouse drag: one undo step for the whole stroke, recorded on its first change. */
  private beginPaint(erase: boolean): void {
    this.paint = { erase, key: `${this.cx},${this.cz}`, before: cloneArena(this.arena), pushed: false };
    const r = this.paintStep();
    if (r !== 'ok' && r !== 'moved' && r !== 'erased' && !erase) this.msg(t(`editor.fail.${r}`, { max: PIECE_BY_ID[this.tool as PieceId]?.max ?? 0 }), true);
  }

  private paintStep(): ReturnType<EditorScreen['place']> {
    const p = this.paint;
    if (!p) return 'none';
    const saved = this.tool;
    if (p.erase) this.tool = 'erase';
    const r = this.place(false);
    this.tool = saved;
    if ((r === 'ok' || r === 'moved' || r === 'erased') && !p.pushed) {
      this.history.push(p.before);
      p.pushed = true;
      this.renderActions();
    }
    return r;
  }

  private mouseAt(clientX: number, clientY: number): void {
    const w = this.map.toWorld(clientX, clientY);
    const x = snapPos(w.x, this.snap);
    const z = snapPos(w.z, this.snap);
    if (x === this.cx && z === this.cz) return;
    this.cx = x;
    this.cz = z;
    this.drawDirty = true;
    if (this.paint) {
      const key = `${x},${z}`;
      if (key !== this.paint.key) {
        this.paint.key = key;
        this.paintStep();
      }
    }
  }

  private rotate(dir: number): void {
    if (this.tool === 'erase' || (pieceAt(this.arena, this.cx, this.cz) >= 0 && this.turnUnderCursor)) {
      const before = cloneArena(this.arena);
      if (rotatePieceAt(this.arena, this.cx, this.cz, dir)) {
        this.history.push(before);
        this.changed();
      }
      return;
    }
    this.rot = (this.rot + dir + 4) % 4;
    sfx.menuMove();
    this.drawDirty = true;
    if (this.tab === 'build') this.renderTabs();
  }
  private turnUnderCursor = false;

  private cycleTool(dir: number): void {
    const ids: Tool[] = [...PIECES.map((p) => p.id), 'erase'];
    const i = ids.indexOf(this.tool);
    this.tool = ids[(i + dir + ids.length) % ids.length];
    sfx.menuMove();
    this.renderPalette();
    if (this.tab === 'build') this.renderTabs();
    this.drawDirty = true;
    this.ed.querySelector(`[data-piece="${this.tool}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  private undo(): void {
    const prev = this.history.undo(this.arena);
    if (!prev) return sfx.deny();
    this.arena = prev;
    this.afterRestore();
  }

  private redo(): void {
    const next = this.history.redo(this.arena);
    if (!next) return sfx.deny();
    this.arena = next;
    this.afterRestore();
  }

  private afterRestore(): void {
    sfx.menuBack();
    this.fitMap();
    this.validity = validateArena(this.arena);
    this.renderAll();
  }

  private stepRule(key: string, dir: number): void {
    const r: ArenaRules = { ...this.arena.rules };
    const cyc = <T>(list: T[], cur: T): T => list[(Math.max(0, list.indexOf(cur)) + dir + list.length) % list.length];
    switch (key) {
      case 'biome':
        r.biome = cyc(allBiomeKeys(), r.biome);
        break;
      case 'waves':
        r.waves = cyc(WAVE_IDS, r.waves);
        if (r.waves === 'custom' && !r.foes.length) r.foes = ['swarmer', 'bopper'];
        break;
      case 'time':
        r.time = r.time + dir * TIME_STEP > TIME_MAX ? TIME_MIN : r.time + dir * TIME_STEP < TIME_MIN ? TIME_MAX : r.time + dir * TIME_STEP;
        break;
      case 'boss':
        r.boss = cyc(bossChoices(), r.boss);
        break;
      case 'difficulty':
        r.difficulty = cyc(difficultyChoices(), r.difficulty);
        break;
      case 'night':
      case 'rain':
      case 'wind':
      case 'events':
      case 'rings':
        r[key] = !r[key];
        break;
      default:
        return;
    }
    this.history.push(this.arena);
    this.arena.rules = r;
    sfx.ui('toggle', 1);
    if (key === 'biome') {
      this.renderPalette();
      this.drawDirty = true;
    }
    this.renderTabs();
    this.renderActions();
    this.g.screens.refreshNav();
  }

  private toggleChip(kind: 'foe' | 'heat', id: string): void {
    const r = this.arena.rules;
    const list = kind === 'foe' ? r.foes : r.heat;
    const i = list.indexOf(id);
    if (i < 0 && kind === 'foe' && list.length >= FOES_MAX) return this.msg(t('editor.foesFull', { max: FOES_MAX }), true);
    if (i >= 0 && kind === 'foe' && list.length <= 1) return this.msg(t('editor.foesOne'), true);
    this.history.push(this.arena);
    if (i >= 0) list.splice(i, 1);
    else list.push(id);
    this.arena.rules = normalizeArena(this.arena).rules;
    sfx.ui('toggle', i >= 0 ? 0 : 1);
    this.renderTabs();
    this.g.screens.refreshNav();
  }

  /** Save to the arena's slot; false (with a message) when the list is full. */
  private trySave(): boolean {
    this.setName(this.ed.querySelector<HTMLInputElement>('.ae-name')?.value ?? this.arena.name);
    if (!saveArena(this.id, this.arena)) {
      this.msg(t('editor.full', { max: MAX_SAVED }), true);
      return false;
    }
    return true;
  }

  private needValid(): boolean {
    this.revalidate();
    const v = this.validity!;
    if (v.ok) return true;
    this.tab = 'build';
    this.renderTabs();
    this.msg(`${t('editor.notPlayable')} ${t(`editor.issue.${v.errors[0].id}`)}`, true);
    if (v.errors[0].id !== 'noHero') {
      this.cx = v.errors[0].x;
      this.cz = v.errors[0].z;
    }
    this.drawDirty = true;
    return false;
  }

  private action(a: string): void {
    switch (a) {
      case 'play':
        if (!this.needValid() || !this.trySave()) return;
        playArenaSolo(this.g, cloneArena(this.arena));
        return;
      case 'host':
        if (!this.needValid() || !this.trySave()) return;
        hostArena(this.g, this.id, cloneArena(this.arena));
        return;
      case 'save':
        if (this.trySave()) {
          this.msg(t('editor.saved'));
          sfx.powerUp();
        }
        return;
      case 'undo':
        return this.undo();
      case 'redo':
        return this.redo();
      case 'size': {
        const i = SIZES.findIndex((s) => s.id === this.arena.size);
        const next = SIZES[(i + 1) % SIZES.length].id;
        this.history.push(this.arena);
        const lost = resizeArena(this.arena, next);
        this.cx = Math.max(-SIZE_HALF[next] + 2, Math.min(SIZE_HALF[next] - 2, this.cx));
        this.cz = Math.max(-SIZE_HALF[next] + 2, Math.min(SIZE_HALF[next] - 2, this.cz));
        this.fitMap();
        this.msg(lost ? t('editor.lost', { n: lost }) : t('editor.resized', { size: t(`editor.size.${next}`) }), lost > 0);
        this.changed();
        this.revalidate();
        return;
      }
      case 'grid':
        this.snap = !this.snap;
        this.map.grid = this.snap;
        this.cx = snapPos(this.cx, this.snap);
        this.cz = snapPos(this.cz, this.snap);
        this.drawDirty = true;
        this.renderActions();
        return;
      case 'clear':
        if (this.armed !== 'clear') {
          this.armed = 'clear';
          this.renderActions();
          return;
        }
        this.armed = '';
        this.history.push(this.arena);
        this.arena.pieces = [];
        this.changed();
        this.revalidate();
        return;
      case 'map':
        return this.setMapMode(true);
      case 'back':
        this.trySave();
        this.msgText = '';
        return this.openList(false);
    }
  }

  private async share(kind: string): Promise<void> {
    const ta = this.ed.querySelector<HTMLTextAreaElement>('.ae-code');
    if (kind === 'import') return this.importFrom(ta?.value ?? '', false);
    this.setName(this.ed.querySelector<HTMLInputElement>('.ae-name')?.value ?? this.arena.name);
    const code = await arenaCodeSmall(this.arena);
    if (ta) ta.value = code;
    if (kind === 'copy') {
      try {
        await navigator.clipboard.writeText(code);
        return this.msg(t('editor.copied', { n: code.length }));
      } catch {
        ta?.select();
        return this.msg(t('editor.selectCopy'));
      }
    }
    this.msg(t('editor.codeReady', { n: code.length }));
  }

  private edClick(e: Event): void {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button, .ae-name');
    if (!b) return;
    const d = b.dataset;
    if (b.classList.contains('ae-name')) {
      this.setMapMode(false);
      (b as HTMLInputElement).focus();
      return;
    }
    if (d.a !== 'clear' && this.armed) {
      this.armed = '';
      this.renderActions();
    }
    if (d.piece) {
      this.tool = d.piece as Tool;
      if (this.tool !== 'erase' && !PIECE_BY_ID[this.tool].round && !PIECE_BY_ID[this.tool].directed && this.rot % 2 && PIECE_BY_ID[this.tool].w === PIECE_BY_ID[this.tool].d) this.rot = 0;
      this.renderPalette();
      if (this.tab === 'build') this.renderTabs();
      this.drawDirty = true;
      // Picking a piece with a pad or the keyboard goes straight back to the map.
      if ((e as MouseEvent).detail === 0) this.setMapMode(true);
      return;
    }
    if (d.tab) {
      this.tab = d.tab as Tab;
      this.renderTabs();
      this.g.screens.refreshNav();
      return;
    }
    if (d.rule) return this.stepRule(d.rule, 1);
    if (d.foe) return this.toggleChip('foe', d.foe);
    if (d.heat) return this.toggleChip('heat', d.heat);
    if (d.share) return void this.share(d.share);
    if (d.a) return this.action(d.a);
  }

  // ---------------------------------------------------------------- map mode input

  mapUpdate(input: Input, dt: number): void {
    if (this.typing()) return;
    const kp = (c: string) => input.keyPressed(c);
    const pad = (b: number) => input.padButtonPressed(b);
    const ctrl = input.key('ControlLeft') || input.key('ControlRight') || input.key('MetaLeft') || input.key('MetaRight');
    if (kp('Tab') || kp('Escape') || pad(9) || pad(1)) {
      this.setMapMode(false);
      return;
    }
    // Cursor: a press moves one step, holding repeats.
    const step = this.snap ? 2 : 1;
    let dx = 0;
    let dz = 0;
    const dirs: [string[], number, number, number][] = [
      [['ArrowLeft', 'KeyA'], -1, 0, 14],
      [['ArrowRight', 'KeyD'], 1, 0, 15],
      [['ArrowUp', 'KeyW'], 0, -1, 12],
      [['ArrowDown', 'KeyS'], 0, 1, 13],
    ];
    let heldNow = '';
    for (const [keys, x, z, b] of dirs) {
      if (keys.some(kp) || pad(b)) {
        dx += x;
        dz += z;
        this.repeat = 0.32;
      }
      if (keys.some((c) => input.key(c)) || input.padButton(b)) heldNow += `${x},${z};`;
    }
    const stick = input.device === 'pad' ? input.move : { x: 0, y: 0 };
    if (Math.hypot(stick.x, stick.y) > 0.5) heldNow += 'stick';
    if (heldNow && heldNow === this.held && !dx && !dz) {
      this.repeat -= dt;
      if (this.repeat <= 0) {
        this.repeat = 0.07;
        for (const [keys, x, z, b] of dirs) if (keys.some((c) => input.key(c)) || input.padButton(b)) (dx += x), (dz += z);
        if (Math.abs(stick.x) > 0.5) dx += Math.sign(stick.x);
        if (Math.abs(stick.y) > 0.5) dz += Math.sign(stick.y);
      }
    } else if (heldNow.includes('stick') && heldNow !== this.held) {
      if (Math.abs(stick.x) > 0.5) dx += Math.sign(stick.x);
      if (Math.abs(stick.y) > 0.5) dz += Math.sign(stick.y);
      this.repeat = 0.25;
    }
    this.held = heldNow;
    if (dx || dz) {
      const lim = SIZE_HALF[this.arena.size] - 1;
      this.cx = Math.max(-lim, Math.min(lim, snapPos(this.cx + dx * step, this.snap)));
      this.cz = Math.max(-lim, Math.min(lim, snapPos(this.cz + dz * step, this.snap)));
      this.drawDirty = true;
    }
    if (ctrl && kp('KeyZ')) return input.key('ShiftLeft') || input.key('ShiftRight') ? this.redo() : this.undo();
    if (kp('KeyZ') || pad(6)) return this.undo();
    if (kp('KeyY') || pad(7)) return this.redo();
    if (kp('KeyG')) return this.action('grid');
    if (kp('KeyQ') || pad(4)) this.cycleTool(-1);
    if (kp('KeyE') || pad(5)) this.cycleTool(1);
    if (kp('KeyR') || pad(3)) {
      this.turnUnderCursor = input.key('ShiftLeft') || input.key('ShiftRight');
      this.rotate(1);
      this.turnUnderCursor = false;
    }
    if (kp('Enter') || kp('Space') || pad(0)) this.place();
    if (kp('KeyX') || kp('Delete') || kp('Backspace') || pad(2)) {
      if (!this.erase()) sfx.deny();
    }
  }

  /** Per step while the editor is shown: deferred validation and drawing. */
  frame(dt: number): void {
    this.time += dt;
    if (this.validT > 0) {
      this.validT -= dt;
      if (this.validT <= 0) this.revalidate();
    }
    const blink = !!this.validity?.errors.length && Math.floor(this.time * 4) !== Math.floor((this.time - dt) * 4);
    if (!this.drawDirty && !blink) return;
    this.drawDirty = false;
    const tool = this.tool;
    this.map.draw(this.arena, this.validity, { x: this.cx, z: this.cz, piece: tool === 'erase' ? null : tool, r: this.ghostRot(), ok: this.cursorOk(), erase: tool === 'erase' }, this.time);
    const co = this.ed.querySelector<HTMLElement>('.ae-coords');
    if (co) co.textContent = `${this.cx}, ${this.cz} · ${t(`editor.size.${this.arena.size}`)} · ${this.arena.pieces.length}`;
    this.renderHint();
  }
}
