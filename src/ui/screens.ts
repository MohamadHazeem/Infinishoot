import type { Input } from '../core/input';
import { ACHIEVEMENTS } from '../data/meta';
import { tagChips, type Tag } from '../data/tags';
import { WEAPONS } from '../data/weapons';
import { SPECIALS } from '../data/specials';
import { loadoutOptions, validLoadout, type LoadoutSlot } from '../data/loadout';
import { modDesc, modMaxLevel, type ModDef } from '../game/modTypes';
import type { ScoreEntry } from '../game/highscores';
import { exportFile, importFile, loadoutUnlockBy, resetSave, save, unlockedLoadout } from '../game/save';
import { settings, saveSettings } from '../game/settings';
import { sfx } from '../audio/sfx';
import { music, TRACKS, type TrackId } from '../audio/music';
import { RARITY, type Rarity } from '../data/rarity';
import { SLOT_LABEL, decoys, fmtScore, reduceMotion, reelAt, reelSteps, slotPicto, type LoadoutItem, type Slot } from './hud';
import { MenuNav } from './menu';
import { iconHtml } from './pixelIcons';
import { SKINS } from '../data/skins';
import { PETS } from '../data/pets';
import { DIFFICULTIES, MODE_BY_ID, MODES, today, type ModeId } from '../data/modes';
import { dailyBest } from '../game/highscores';
import { HEROES } from '../data/heroes';
import { ACTIONS, binds, keyLabel, rebind, resetBinds, type Action } from '../core/keybinds';
import { ENEMIES } from '../data/enemies';
import { ENEMY_TIPS } from '../data/bestiary';

/** Full-screen menus. Plain DOM; every navigable element has `data-nav`. */
export type ScreenName = 'none' | 'title' | 'pause' | 'settings' | 'levelup' | 'shop' | 'gameover' | 'unlocks' | 'savedata' | 'online' | 'wait' | 'loadout' | 'extras' | 'jukebox' | 'wardrobe' | 'modes' | 'controls' | 'history' | 'bestiary';

export interface ScreenActions {
  start(): void;
  resume(): void;
  quit(): void;
  retry(): void;
  title(): void;
  pick(index: number): void;
  reroll(): void;
  skip(): void;
  buy(index: number): void;
  sell(index: number): void;
  moveMod(index: number, dir: -1 | 1): void;
  upgradeMod(index: number): void;
  shopReroll(): void;
  shopHeal(): void;
  shopDone(): void;
  online(): void;
  mpHost(name: string): void;
  mpJoin(name: string, code: string): void;
  mpStart(): void;
  mpLeave(): void;
  /** Host: set the co-op difficulty. */
  mpDifficulty(id: string): void;
  /** Host: co-op or PvP. */
  mpKind(kind: 'coop' | 'pvp'): void;
  /** The loadout changed (online: tell the host). */
  loadoutChanged(): void;
  /** The local skin setting changed. */
  skinChanged(): void;
  takeCurse(): void;
  buyRelic(): void;
}

export interface LobbyView {
  code: string;
  players: { name: string; color: string; kit?: string }[];
  isHost: boolean;
  status: string;
  /** Difficulty the host picked (shown to everyone in the lobby). */
  difficulty?: string;
  /** Co-op or PvP, picked by the host. */
  kind?: 'coop' | 'pvp';
}

export type ShopFx = 'open' | 'buy' | 'sell' | 'reroll' | 'heal' | 'deny' | 'upgrade';

export interface ShopView {
  gold: number;
  interest: number;
  interestCap: number;
  interestPer: number;
  offers: ({ def: ModDef; price: number; hint: string } | null)[];
  owned: { def: ModDef; sell: number; readout: string; level: number; maxLevel: number; upCost: number }[];
  slots: number;
  rerollCost: number;
  healCost: number;
  healed: boolean;
  loadout: LoadoutItem[];
  stage: number;
  /** Starting shop before stage 1: free gold that isn't kept, no interest. */
  pre?: boolean;
  /** The rare secret merchant (rare/cursed Mods at a discount, a relic for sale). */
  secret: boolean;
  relic: { id: string; name: string; desc: string; icon: string; color: string; price: number; rarity?: Rarity } | null;
  /** Optional curse deal (one per shop visit). */
  curse: { id: string; name: string; desc: string; icon: string; color: string; gold: number; score: number } | null;
}

export interface Offer {
  kind: 'weapon' | 'passive' | 'special' | 'gold' | 'heal' | 'track' | 'evo' | 'overdrive' | 'evolve';
  /** Icon id. */
  id: string;
  /** Loadout upgrades: what the pick does, "<item>|t|<track>", "<item>|e|<evo>" or "<item>|od". */
  pick?: string;
  /** Loadout upgrades: which item it upgrades, shown at the card's foot. */
  label?: string;
  /** What it upgrades or adds: the coloured ribbon at the card's foot. */
  slot?: Slot;
  name: string;
  icon: string;
  color: string;
  tag: string; // "NEW!" / "LV 3" / "BONUS"
  text: string;
  tags?: readonly Tag[];
  rarity?: Rarity;
  /** Level owned now (0 = new) and the item's max, for the upgrade pips. */
  level?: number;
  maxLevel?: number;
  /** Owned weapon this pick removes, e.g. "Plasma Orb LV 3" (arm-slot swaps). */
  replaces?: string;
}

export interface RunSummary {
  score: number;
  stage: number;
  kills: number;
  time: number;
  level: number;
  maxCombo: number;
  loadout: LoadoutItem[];
  mods: string[];
  damage: { name: string; color: string; dmg: number }[];
  achievements: string[];
}

/** Settings switched by ON/OFF buttons. */
type ToggleKey = 'autoFire' | 'showFps' | 'crt' | 'rumble' | 'colorblind' | 'reduceFlash';

/** A skin is wearable once its achievement is done. */
export function skinUnlocked(id: string): boolean {
  const s = SKINS.find((x) => x.id === id);
  return !!s && (!s.unlock || save.achievements.includes(s.unlock));
}

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Title letters as separate spans so a hop can ripple across them. */
function logoWord(word: string, start: number): string {
  return `<span>${[...word].map((ch, k) => `<i style="--i:${start + k}">${ch}</i>`).join('')}</span>`;
}

/** A level-up card is a new item, an upgrade of one you own, an evolution or a bonus. */
function cardMode(o: Offer): 'new' | 'upgrade' | 'evo' | 'bonus' {
  return o.tag === 'NEW!' ? 'new' : o.tag === 'EVOLVE!' ? 'evo' : o.kind === 'gold' || o.kind === 'heal' ? 'bonus' : 'upgrade';
}

/** Upgrades show owned levels as filled pips and this pick as a flashing one. */
function levelPips(o: Offer): string {
  if (!o.maxLevel || !o.level) return '';
  const pips = Array.from({ length: o.maxLevel }, (_, k) => `<i class="${k < o.level! ? 'on' : k === o.level ? 'next' : ''}"></i>`).join('');
  const next = o.level + 1 === o.maxLevel && o.tag === 'EVOLVE!' ? 'EVOLVE' : `LV ${o.level + 1}`;
  return `<div class="lvl">LV ${o.level} ▸ ${next}</div><div class="pips">${pips}</div>`;
}

/** Warning strip on cards that swap out an owned weapon. "Plasma Orb LV 3" reads "REPLACES PLASMA ORB (LV 3)". */
function replaceStrip(what: string): string {
  const name = what.replace(/\s+(LV\s*\d+)$/i, ' ($1)').toUpperCase();
  return `<div class="replaces"><i>!</i><span>REPLACES ${name}<b>OLD WEAPON AND ITS UPGRADES ARE REMOVED</b></span></div>`;
}

/** Hover card: name, rarity and what it does. */
/** Hover card: name, rarity (none for loadout items, where it means nothing) and what it does. */
function tip(name: string, rarity: Rarity | undefined, desc: string, extra = ''): string {
  const label = rarity ? `${RARITY[rarity].label}${extra}` : extra.replace(/^ · /, '');
  return `<span class="tip"><b>${name}</b><em class="r-text-${rarity ?? 'common'}">${label}</em><span>${desc}</span></span>`;
}

function badge(i: LoadoutItem): string {
  const level = (i.slot ? ` · ${SLOT_LABEL[i.slot]}` : '') + (i.evo ? ' · EVOLVED' : i.max ? ' · MAX' : ` · LV ${i.level}`);
  return `<span class="badge${i.evo ? ' evo' : ''} r-${i.rarity ?? 'common'} ${i.slot ? 's-' + i.slot : ''}" style="--c:${i.color}" tabindex="0">${iconHtml(i.id, i.color, i.icon)}<i>${i.evo ? 'E' : i.max ? 'M' : i.level}</i>${tip(i.name, i.rarity, i.desc ?? '', level)}</span>`;
}

function modChip({ def: m, level }: { def: ModDef; level: number }): string {
  const extra = m.cursed ? ' · CURSED' : modMaxLevel(m) > 1 ? ` · MOD LV ${level}` : ' · MOD';
  return `<span class="mod-chip ${m.cursed ? 'cursed' : ''} r-${m.rarity}" style="--c:${m.color}" tabindex="0">${iconHtml(m.id, m.color, m.icon)}${m.name}${tip(m.name, m.rarity, modDesc(m, level), extra)}</span>`;
}

/** Next level's text with the words that change highlighted. */
function nextLevelHtml(def: ModDef, level: number): string {
  const now = modDesc(def, level).split(' ');
  const next = modDesc(def, level + 1).split(' ');
  if (now.length !== next.length) return next.join(' ');
  return next.map((w, i) => (w === now[i] ? w : `<b>${w}</b>`)).join(' ');
}

type Named = Exclude<ScreenName, 'none'>;

/** Level-up pick lock: seconds after the cards appear (or a reroll) before any pick or skip counts. */
export const pickTuning = { lock: 0.6 };

export class Screens {
  current: ScreenName = 'none';
  private els = {} as Record<Named, HTMLElement>;
  private navs = {} as Record<Named, MenuNav>;
  private settingsReturn: ScreenName = 'title';
  private wipeArmed = false;
  /** Gold last shown in the shop, for the +/- popups. */
  private shopGold = -1;
  /** Level-up card reels still spinning, and the time since they started. */
  private reels: { card: HTMLElement; strip: HTMLElement; steps: number[]; passed: number; rarity?: Rarity }[] = [];
  private reelT = 0;
  /** Level-up pick lock: no pick or skip before this time (ms), so a held click or key can't choose by accident. */
  private lockUntil = 0;
  /** Cards still showing the locked look. */
  private lockCards: HTMLElement[] = [];

  private root: HTMLElement;

  constructor(root: HTMLElement, private readonly actions: ScreenActions) {
    this.root = root;
    root.insertAdjacentHTML(
      'beforeend',
      `
<div id="scr-title" class="screen" hidden>
  <div class="logo">${logoWord('INFINI', 0)}${logoWord('SHOOT', 6)}</div>
  <div class="tagline">TWIN-STICK ARCADE ROGUELIKE</div>
  <div class="menu">
    <button data-nav data-act="modes">PLAY SOLO</button>
    <button data-nav data-act="online">PLAY ONLINE</button>
    <button data-nav data-act="unlocks">UNLOCKS</button>
    <button data-nav data-act="extras">EXTRAS</button>
    <button data-nav data-act="settings">SETTINGS</button>
  </div>
  <div class="wallet"></div>
  <div class="hiscores"></div>
  <div class="hiscores global" hidden></div>
  <div class="controls">WASD / L-stick move &middot; Mouse / R-stick aim &amp; shoot &middot; Hold right click / X right-click weapon &middot; Space / LB dash &middot; Q / RB special &middot; G ping &middot; Esc / Start pause</div>
  <div class="credits">Icons: game-icons.net by Lorc, Delapouite &amp; contributors (CC BY 3.0) &middot; Fonts: Jersey, Silkscreen (OFL) &middot; Palette: Sweetie 16 by GrafxKid</div>
  <div class="version">v${__APP_VERSION__}</div>
</div>
<div id="scr-pause" class="screen dim" hidden>
  <h1>PAUSED</h1>
  <div class="menu">
    <button data-nav data-act="resume">RESUME</button>
    <button data-nav data-act="settings">SETTINGS</button>
    <button data-nav data-act="quit">QUIT RUN</button>
  </div>
  <div class="build"></div>
</div>
<div id="scr-settings" class="screen dim" hidden>
  <h1>SETTINGS</h1>
  <div class="menu settings">
    <label>VOLUME <input data-nav type="range" min="0" max="1" step="0.1" data-set="volume"></label>
    <label>MUSIC <input data-nav type="range" min="0" max="1" step="0.1" data-set="musicVolume"></label>
    <label>EFFECTS <input data-nav type="range" min="0" max="1" step="0.1" data-set="sfxVolume"></label>
    <label>MENU SOUNDS <input data-nav type="range" min="0" max="1" step="0.1" data-set="uiVolume"></label>
    <label>RETRO LOOK <input data-nav type="range" min="0" max="1" step="0.1" data-set="retro"></label>
    <label>SCREEN SHAKE <input data-nav type="range" min="0" max="1.5" step="0.25" data-set="shake"></label>
    <label>GLOW <input data-nav type="range" min="0" max="1" step="0.1" data-set="glow"></label>
    <label>QUALITY <input data-nav type="range" min="0" max="2" step="1" data-set="quality"></label>
    <button data-nav data-toggle="crt">CRT FILTER <b></b></button>
    <button data-nav data-toggle="rumble">CONTROLLER RUMBLE <b></b></button>
    <button data-nav data-toggle="colorblind">COLOUR-BLIND BULLETS <b></b></button>
    <button data-nav data-toggle="reduceFlash">REDUCE FLASHING <b></b></button>
    <button data-nav data-act="controls">CONTROLS...</button>
    <button data-nav data-toggle="autoFire">AUTO-FIRE <b></b></button>
    <button data-nav data-toggle="showFps">SHOW FPS <b></b></button>
    <button data-nav data-act="back">BACK</button>
  </div>
</div>
<div id="scr-controls" class="screen dim" hidden>
  <h1>CONTROLS</h1>
  <p class="note">Click a key slot, then press the new key (Esc cancels). Mouse: left fire, right charge, middle bomb. Gamepad layout is fixed.</p>
  <div class="bind-list"></div>
  <div class="menu row">
    <button data-nav data-act="binds-reset">RESET DEFAULTS</button>
    <button data-nav data-act="binds-back">BACK</button>
  </div>
</div>
<div id="scr-levelup" class="screen dim" hidden>
  <h1></h1>
  <div class="cards"></div>
  <div class="reroll-row"></div>
  <div class="build"></div>
</div>
<div id="scr-online" class="screen dim" hidden>
  <h1>PLAY ONLINE</h1>
  <p class="note">Co-op for up to 4 players. One player hosts and shares a code; friends join with it.</p>
  <label class="field">YOUR NAME <input id="mp-name" type="text" maxlength="12" spellcheck="false" autocomplete="off"></label>
  <div class="menu row mp-choice">
    <button data-nav data-act="mp-host">HOST GAME</button>
  </div>
  <div class="join-row">
    <input id="mp-code" type="text" maxlength="5" placeholder="CODE" spellcheck="false" autocomplete="off">
    <button data-nav data-act="mp-join">JOIN</button>
  </div>
  <div class="lobby" hidden>
    <div class="code-label">GAME CODE</div>
    <div class="code-big"></div>
    <div class="players"></div>
    <div class="section">GAME</div>
    <div class="menu row diff-row mp-kind-row"></div>
    <div class="note mp-kind-note"></div>
    <div class="section">DIFFICULTY</div>
    <div class="menu row diff-row mp-diff-row"></div>
    <div class="note mp-diff-note"></div>
  </div>
  <div class="msg mp-status"></div>
  <div class="menu row">
    <button data-nav data-act="lo-online">LOADOUT</button>
    <button data-nav data-act="mp-start" hidden>START GAME</button>
    <button data-nav data-act="mp-leave">BACK</button>
  </div>
</div>
<div id="scr-loadout" class="screen dim" hidden>
  <h1>LOADOUT</h1>
  <p class="note">Pick your left click, right click and special. You keep them all run; level-ups upgrade them.</p>
  <div class="lo-rows"></div>
  <div class="menu row">
    <button data-nav data-act="lo-start" class="continue">START &#9654;</button>
    <button data-nav data-act="lo-back">BACK</button>
  </div>
</div>
<div id="scr-wait" class="screen dim" hidden>
  <h1>WAITING</h1>
  <p class="note">Your teammates are still choosing:</p>
  <div class="who"></div>
</div>
<div id="scr-shop" class="screen dim" hidden>
  <h1>SHOP</h1>
  <div class="shop-top"></div>
  <div class="shop-offers"></div>
  <div class="menu row shop-extras"></div>
  <div class="section owned-title"></div>
  <div class="owned-mods"></div>
</div>
<div id="scr-unlocks" class="screen dim" hidden>
  <h1>UNLOCKS</h1>
  <p class="note">Achievements carry over between runs. Some add new weapons to your level-up cards.</p>
  <div class="scroll">
    <div class="ach-list"></div>
  </div>
  <div class="menu row">
    <button data-nav data-act="savedata">SAVE DATA</button>
    <button data-nav data-act="ul-back">BACK</button>
  </div>
</div>
<div id="scr-savedata" class="screen dim" hidden>
  <h1>SAVE DATA</h1>
  <p class="note">Your progress saves by itself. To back it up or move it to another PC, save it to a file, then load that file on the other PC.</p>
  <input id="save-file" type="file" accept=".json,.txt,application/json" hidden />
  <div class="msg"></div>
  <div class="menu row wrap">
    <button data-nav data-act="export">SAVE TO FILE</button>
    <button data-nav data-act="import">LOAD FROM FILE</button>
    <button data-nav data-act="wipe">RESET SAVE</button>
    <button data-nav data-act="sd-back">BACK</button>
  </div>
</div>
<div id="scr-modes" class="screen dim" hidden>
  <h1>PLAY SOLO</h1>
  <div class="section">HERO</div>
  <div class="menu row hero-row"></div>
  <div class="note hero-note"></div>
  <div class="section">MODE</div>
  <div class="mode-grid"></div>
  <div class="section">DIFFICULTY</div>
  <div class="menu row diff-row"></div>
  <div class="note mode-note"></div>
  <div class="menu row">
    <button data-nav data-act="play" class="continue">NEXT: LOADOUT &#9654;</button>
    <button data-nav data-act="md-back">BACK</button>
  </div>
</div>
<div id="scr-extras" class="screen dim" hidden>
  <h1>EXTRAS</h1>
  <div class="menu">
    <button data-nav data-act="wardrobe">WARDROBE</button>
    <button data-nav data-act="history">RUN HISTORY</button>
    <button data-nav data-act="bestiary">ENEMY GUIDE</button>
    <button data-nav data-act="jukebox">JUKEBOX</button>
    <button data-nav data-act="ex-back">BACK</button>
  </div>
</div>
<div id="scr-history" class="screen dim" hidden>
  <h1>RUN HISTORY</h1>
  <div class="scroll"><table class="history"></table></div>
  <div class="menu row"><button data-nav data-act="ex-sub-back">BACK</button></div>
</div>
<div id="scr-bestiary" class="screen dim" hidden>
  <h1>ENEMY GUIDE</h1>
  <p class="note bst-count"></p>
  <div class="scroll"><div class="bestiary"></div></div>
  <div class="menu row"><button data-nav data-act="ex-sub-back">BACK</button></div>
</div>
<div id="scr-jukebox" class="screen dim" hidden>
  <h1>JUKEBOX</h1>
  <p class="note">Every tune is composed on the fly. Reach new areas to unlock their themes.</p>
  <div class="now-playing"></div>
  <div class="menu tracks"></div>
  <div class="menu row">
    <button data-nav data-act="jb-stop">STOP</button>
    <button data-nav data-act="jb-back">BACK</button>
  </div>
</div>
<div id="scr-wardrobe" class="screen" hidden>
  <h1>WARDROBE</h1>
  <p class="note">Skins unlock with achievements. In co-op your armour keeps your player colour.</p>
  <div class="skin-grid"></div>
  <div class="section">PETS</div>
  <div class="skin-grid pet-grid"></div>
  <div class="menu row">
    <button data-nav data-act="wd-back">BACK</button>
  </div>
</div>
<div id="scr-gameover" class="screen dim" hidden>
  <h1 class="ko">K.O.!</h1>
  <div class="newbest" hidden>NEW HIGH SCORE!</div>
  <div class="go-cols">
    <div class="summary"></div>
    <div class="dmg-table"></div>
  </div>
  <div class="build"></div>
  <div class="unlocked"></div>
  <div class="menu row">
    <button data-nav data-act="retry">RETRY</button>
    <button data-nav data-act="title">TITLE</button>
  </div>
  <div class="hiscores"></div>
  <div class="hiscores global" hidden></div>
</div>`,
    );
    const names: Named[] = ['title', 'pause', 'settings', 'levelup', 'shop', 'unlocks', 'savedata', 'gameover', 'online', 'wait', 'loadout', 'extras', 'jukebox', 'wardrobe', 'modes', 'controls', 'history', 'bestiary'];
    for (const n of names) this.els[n] = root.querySelector<HTMLElement>(`#scr-${n}`)!;
    this.navs = {
      title: new MenuNav(this.els.title),
      pause: new MenuNav(this.els.pause, { onBack: () => actions.resume() }),
      settings: new MenuNav(this.els.settings, { onBack: () => this.show(this.settingsReturn) }),
      levelup: new MenuNav(this.els.levelup, { horizontal: true }),
      shop: new MenuNav(this.els.shop, { columns: 4 }),
      unlocks: new MenuNav(this.els.unlocks, { horizontal: true, onBack: () => actions.title() }),
      savedata: new MenuNav(this.els.savedata, { horizontal: true, onBack: () => this.show('unlocks') }),
      gameover: new MenuNav(this.els.gameover, { horizontal: true }),
      online: new MenuNav(this.els.online, { onBack: () => actions.mpLeave() }),
      wait: new MenuNav(this.els.wait),
      loadout: new MenuNav(this.els.loadout, { columns: 5, onBack: () => this.loadoutBack() }),
      extras: new MenuNav(this.els.extras, { onBack: () => actions.title() }),
      jukebox: new MenuNav(this.els.jukebox, { onBack: () => this.show('extras') }),
      wardrobe: new MenuNav(this.els.wardrobe, { columns: 3, onBack: () => this.show('extras') }),
      modes: new MenuNav(this.els.modes, { columns: 4, onBack: () => actions.title() }),
      controls: new MenuNav(this.els.controls, { columns: 2, onBack: () => this.show('settings') }),
      history: new MenuNav(this.els.history, { onBack: () => this.show('extras') }),
      bestiary: new MenuNav(this.els.bestiary, { onBack: () => this.show('extras') }),
    };

    // Keep buttons from taking DOM focus on click, so Enter/Space don't fire twice.
    root.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('button')) e.preventDefault();
    });

    root.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!btn) return;
      switch (btn.dataset.act) {
        case 'start':
          return actions.start();
        case 'play':
          return this.showLoadout('solo');
        case 'lo-online':
          return this.showLoadout('online');
        case 'lo-pick':
          return this.pickLoadout(btn.dataset.slot as LoadoutSlot, btn.dataset.id!);
        case 'lo-locked':
          sfx.deny();
          return;
        case 'lo-start':
          if (this.loadoutFor === 'solo') return actions.start();
          this.actions.loadoutChanged();
          return this.show('online');
        case 'lo-back':
          return this.loadoutBack();
        case 'online':
          return actions.online();
        case 'mp-host':
          return actions.mpHost(this.nameField.value);
        case 'mp-join':
          return actions.mpJoin(this.nameField.value, this.els.online.querySelector<HTMLInputElement>('#mp-code')!.value);
        case 'mp-start':
          return actions.mpStart();
        case 'mp-leave':
          return actions.mpLeave();
        case 'resume':
          return actions.resume();
        case 'quit':
          return actions.quit();
        case 'retry':
          return actions.retry();
        case 'title':
        case 'ul-back':
          return actions.title();
        case 'pick':
          return this.canPick(Number(btn.dataset.index)) ? actions.pick(Number(btn.dataset.index)) : undefined;
        case 'reroll':
          return actions.reroll();
        case 'skip':
          return this.pickOpen() ? actions.skip() : undefined;
        case 'buy':
          return actions.buy(Number(btn.dataset.index));
        case 'sell':
          return actions.sell(Number(btn.dataset.index));
        case 'mod-up':
          return actions.upgradeMod(Number(btn.dataset.index));
        case 'mod-left':
          return actions.moveMod(Number(btn.dataset.index), -1);
        case 'mod-right':
          return actions.moveMod(Number(btn.dataset.index), 1);
        case 'shop-reroll':
          return actions.shopReroll();
        case 'shop-heal':
          return actions.shopHeal();
        case 'take-curse':
          return actions.takeCurse();
        case 'buy-relic':
          return actions.buyRelic();
        case 'shop-done':
          return actions.shopDone();
        case 'settings':
          this.settingsReturn = this.current;
          return this.show('settings');
        case 'back':
          return this.show(this.settingsReturn);
        case 'unlocks':
          return this.show('unlocks');
        case 'savedata':
          return this.show('savedata');
        case 'sd-back':
          return this.show('unlocks');
        case 'export':
          return this.doExport();
        case 'import':
          return this.doImport();
        case 'wipe':
          return this.doWipe(btn);
        case 'wardrobe':
          return this.show('wardrobe');
        case 'skin': {
          const id = btn.dataset.skin!;
          if (!skinUnlocked(id)) return;
          settings.skin = id;
          saveSettings();
          actions.skinChanged();
          return this.renderWardrobe();
        }
        case 'modes':
          return this.show('modes');
        case 'controls':
          return this.show('controls');
        case 'history':
          return this.show('history');
        case 'bestiary':
          return this.show('bestiary');
        case 'ex-sub-back':
          return this.show('extras');
        case 'binds-back':
          return this.show('settings');
        case 'binds-reset':
          resetBinds();
          return this.renderControls();
        case 'bind': {
          this.capture = { a: btn.dataset.action as Action, slot: Number(btn.dataset.slot) as 0 | 1 };
          btn.textContent = 'PRESS A KEY';
          btn.classList.add('wait');
          return;
        }
        case 'md-back':
          return actions.title();
        case 'mode':
          settings.mode = btn.dataset.mode!;
          saveSettings();
          return this.renderModes();
        case 'hero': {
          const hd = HEROES.find((x) => x.id === btn.dataset.hero);
          if (!hd || (hd.unlock && !save.achievements.includes(hd.unlock))) return;
          settings.hero = hd.id;
          saveSettings();
          actions.skinChanged();
          return this.renderModes();
        }
        case 'mp-kind':
          return actions.mpKind(btn.dataset.kind === 'pvp' ? 'pvp' : 'coop');
        case 'mp-diff': {
          const d = DIFFICULTIES.find((x) => x.id === btn.dataset.diff);
          if (!d || (d.unlock && !save.achievements.includes(d.unlock))) return;
          return actions.mpDifficulty(d.id);
        }
        case 'diff': {
          const d = DIFFICULTIES.find((x) => x.id === btn.dataset.diff);
          if (!d || (d.unlock && !save.achievements.includes(d.unlock))) return;
          settings.difficulty = d.id;
          saveSettings();
          return this.renderModes();
        }
        case 'pet': {
          const id = btn.dataset.pet!;
          const def = PETS.find((x) => x.id === id);
          if (!def || (def.unlock && !save.achievements.includes(def.unlock))) return;
          settings.pet = id;
          saveSettings();
          actions.skinChanged();
          return this.renderWardrobe();
        }
        case 'extras':
        case 'jb-back':
        case 'wd-back':
          return this.show('extras');
        case 'ex-back':
          return actions.title();
        case 'jukebox':
          return this.show('jukebox');
        case 'jb-play':
          music.jukebox = btn.dataset.track as TrackId;
          return this.renderJukebox();
        case 'jb-stop':
          music.stop();
          return this.renderJukebox();
      }
    });

    // Key capture for the controls screen (runs before the game sees the key).
    window.addEventListener(
      'keydown',
      (e) => {
        if (!this.capture || this.current !== 'controls') return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.code !== 'Escape') rebind(this.capture.a, this.capture.slot, e.code);
        this.renderControls();
      },
      true,
    );

    // Settings controls
    const setEl = this.els.settings;
    setEl.querySelectorAll<HTMLInputElement>('input[data-set]').forEach((inp) => {
      inp.addEventListener('input', () => {
        (settings as unknown as Record<string, number>)[inp.dataset.set!] = Number(inp.value);
        saveSettings();
      });
    });
    setEl.querySelectorAll<HTMLElement>('[data-toggle]').forEach((b) => {
      b.addEventListener('click', () => {
        const key = b.dataset.toggle as ToggleKey;
        settings[key] = !settings[key];
        saveSettings();
        this.syncSettings();
      });
    });
  }

  show(name: ScreenName, focus?: number): void {
    this.current = name;
    for (const [k, el] of Object.entries(this.els)) el.hidden = k !== name;
    // Hide in-game banners and toasts behind menus.
    this.root.classList.toggle('menu-open', name !== 'none');
    if (name === 'settings') this.syncSettings();
    if (name === 'title') this.renderProgress();
    if (name === 'unlocks') this.renderUnlocks();
    if (name === 'jukebox') this.renderJukebox();
    if (name === 'wardrobe') this.renderWardrobe();
    if (name === 'modes') this.renderModes();
    if (name === 'controls') this.renderControls();
    if (name === 'history') this.renderHistory();
    if (name === 'bestiary') this.renderBestiary();
    else if (music.jukebox) music.jukebox = null;
    if (name === 'savedata') {
      this.wipeArmed = false;
      this.msg('');
      this.els.savedata.querySelector<HTMLElement>('[data-act=wipe]')!.textContent = 'RESET SAVE';
    }
    if (name !== 'none') this.navs[name].refresh(focus ?? (name === 'levelup' ? 1 : 0));
  }

  update(input: Input, dt: number): void {
    if (this.current !== 'none') this.navs[this.current].update(input, dt);
    this.tickReels(dt);
    this.tickLock();
  }

  // ---------------------------------------------------------------- loadout

  /** Where the loadout screen goes back to: the title (solo) or the online lobby. */
  private loadoutFor: 'solo' | 'online' = 'solo';

  showLoadout(forWhat: 'solo' | 'online'): void {
    this.loadoutFor = forWhat;
    const el = this.els.loadout;
    el.querySelector<HTMLElement>('[data-act=lo-start]')!.innerHTML = forWhat === 'solo' ? 'START &#9654;' : 'DONE';
    el.querySelector<HTMLElement>('[data-act=lo-back]')!.hidden = forWhat === 'online';
    this.renderLoadout();
    this.show('loadout');
  }

  private loadoutBack(): void {
    if (this.loadoutFor === 'online') {
      this.actions.loadoutChanged();
      this.show('online');
    } else this.show('modes');
  }

  private pickLoadout(slot: LoadoutSlot, id: string): void {
    if (!loadoutOptions(slot).includes(id) || !unlockedLoadout().includes(id)) return;
    settings.loadout = { ...settings.loadout, [slot]: id };
    saveSettings();
    sfx.menuSelect();
    const focus = this.navs.loadout.focus;
    this.renderLoadout();
    this.navs.loadout.refresh(focus);
  }

  private renderLoadout(): void {
    const open = unlockedLoadout();
    // A saved pick that's locked (a reset save) falls back to the default.
    const valid = validLoadout(settings.loadout, open);
    if (JSON.stringify(valid) !== JSON.stringify(settings.loadout)) {
      settings.loadout = valid;
      saveSettings();
    }
    const rows: [LoadoutSlot, string][] = [
      ['primary', 'LEFT CLICK'],
      ['secondary', 'RIGHT CLICK'],
      ['special', 'SPECIAL (Q/E)'],
    ];
    this.els.loadout.querySelector('.lo-rows')!.innerHTML = rows
      .map(([slot, label]) => {
        const cards = loadoutOptions(slot)
          .map((id) => {
            const d = slot === 'special' ? SPECIALS[id] : WEAPONS[id];
            const on = settings.loadout[slot] === id;
            const icon = slot === 'special' ? 'sp_' + id : id;
            if (!open.includes(id)) {
              const a = loadoutUnlockBy(id);
              return `<button class="lo-card locked" data-nav data-act="lo-locked">
              <div class="icon">${iconHtml(icon, '#566c86', d.icon)}</div>
              <div class="name">${d.name}</div>
              <div class="desc">LOCKED${a ? `: ${a.desc}` : ''}</div>
            </button>`;
            }
            return `<button class="lo-card ${on ? 'on' : ''}" data-nav data-act="lo-pick" data-slot="${slot}" data-id="${id}" style="--c:${d.color}">
              <div class="icon">${iconHtml(icon, d.color, d.icon)}</div>
              <div class="name">${d.name}</div>
              <div class="desc">${d.desc.replace(/^(LEFT|RIGHT) CLICK: /, '')}</div>
            </button>`;
          })
          .join('');
        return `<div class="lo-row"><div class="lo-label">${label}</div><div class="lo-cards">${cards}</div></div>`;
      })
      .join('');
  }

  // ---------------------------------------------------------------- online

  private get nameField(): HTMLInputElement {
    return this.els.online.querySelector<HTMLInputElement>('#mp-name')!;
  }

  showOnline(name: string): void {
    this.nameField.value = name;
    this.setLobby({ code: '', players: [], isHost: false, status: '' });
    this.show('online');
  }

  /** Lobby state: before connecting (code empty) or waiting for the host to start. */
  setLobby(v: LobbyView): void {
    const el = this.els.online;
    const inLobby = v.code !== '' || v.players.length > 0;
    el.querySelector<HTMLElement>('.lobby')!.hidden = !inLobby;
    el.querySelector<HTMLElement>('.mp-choice')!.hidden = inLobby;
    el.querySelector<HTMLElement>('.join-row')!.hidden = inLobby;
    el.querySelector<HTMLElement>('.field')!.hidden = inLobby;
    el.querySelector('.code-big')!.textContent = v.code;
    el.querySelector('.players')!.innerHTML = v.players
      .map((p, i) => `<div class="lobby-player" style="--c:${p.color}"><span class="dot"></span>${p.name}${i === 0 ? ' <small>HOST</small>' : ''}${p.kit ? ` <small class="kit">${p.kit}</small>` : ''}</div>`)
      .join('');
    el.querySelector<HTMLElement>('[data-act=mp-start]')!.hidden = !(v.isHost && v.code);
    // Difficulty: the host picks it; everyone else sees the choice.
    const pick = DIFFICULTIES.find((d) => d.id === v.difficulty) ?? DIFFICULTIES[1];
    el.querySelector('.mp-diff-row')!.innerHTML = DIFFICULTIES.map((d) => {
      const open = !d.unlock || save.achievements.includes(d.unlock);
      const lock = v.isHost && !open;
      return `<button ${v.isHost ? 'data-nav' : ''} data-act="mp-diff" data-diff="${d.id}" class="diff ${d.id === pick.id ? 'on' : ''} ${lock ? 'locked' : ''}" ${v.isHost ? '' : 'disabled'}>${lock ? '🔒 ' : ''}${d.name.toUpperCase()}</button>`;
    }).join('');
    el.querySelector('.mp-diff-note')!.textContent = `${pick.desc}${v.isHost ? '' : ' The host picks the difficulty.'}`;
    // Game type: co-op, or PvP (everyone plays the same stage alone, then a last-one-standing duel).
    const kind = v.kind ?? 'coop';
    el.querySelector('.mp-kind-row')!.innerHTML = (['coop', 'pvp'] as const)
      .map((k) => `<button ${v.isHost ? 'data-nav' : ''} data-act="mp-kind" data-kind="${k}" class="diff ${k === kind ? 'on' : ''}" ${v.isHost ? '' : 'disabled'}>${k === 'coop' ? 'CO-OP' : 'PVP'}</button>`)
      .join('');
    el.querySelector('.mp-kind-note')!.textContent =
      kind === 'pvp'
        ? 'Everyone plays the same stage alone and builds up, then all of you fight in one arena. Last one standing wins.'
        : 'Play the run together. Team XP, your own gold, shop and Mods.';
    el.querySelector('.mp-status')!.textContent = v.status;
    if (this.current !== 'online') this.show('online');
    else this.navs.online.refresh(this.navs.online.focus);
  }

  showWait(who: string[], note = 'Your teammates are still choosing:'): void {
    this.els.wait.querySelector('.note')!.textContent = note;
    this.els.wait.querySelector('.who')!.innerHTML = who.map((n) => `<div class="lobby-player"><span class="dot"></span>${n}</div>`).join('');
    this.show('wait');
  }

  // ---------------------------------------------------------------- settings

  private syncSettings(): void {
    const el = this.els.settings;
    el.querySelectorAll<HTMLInputElement>('input[data-set]').forEach((inp) => {
      inp.value = String((settings as unknown as Record<string, number>)[inp.dataset.set!]);
    });
    el.querySelectorAll<HTMLElement>('[data-toggle]').forEach((b) => {
      const on = settings[b.dataset.toggle as ToggleKey];
      b.querySelector('b')!.textContent = on ? 'ON' : 'OFF';
    });
  }

  // ---------------------------------------------------------------- title / scores

  /** Title screen: how many achievements are done. */
  private renderProgress(): void {
    const done = ACHIEVEMENTS.filter((a) => save.achievements.includes(a.id)).length;
    this.els.title.querySelector('.wallet')!.textContent = `★ ${done} / ${ACHIEVEMENTS.length} UNLOCKED`;
  }

  /** Online top 10 for one board (hidden when offline). */
  setGlobalScores(title: string, list: { name: string; score: number; stage: number }[] | null, highlight = -1): void {
    for (const el of [this.els.title, this.els.gameover]) {
      const box = el.querySelector<HTMLElement>('.hiscores.global')!;
      box.hidden = !list;
      if (!list) continue;
      const rows = list.length
        ? list
            .slice(0, 10)
            .map((e, i) => `<tr class="${i === highlight ? 'me' : ''}"><td>${i + 1}</td><td>${e.name}</td><td>${fmtScore(e.score)}</td><td>STAGE ${e.stage}</td></tr>`)
            .join('')
        : '<tr><td colspan="4">No scores yet. Be the first!</td></tr>';
      box.innerHTML = `<div class="hs-title">GLOBAL · ${title}</div><table>${rows}</table>`;
    }
  }

  setHighScores(list: ScoreEntry[], highlight = -1): void {
    const rows = list.length
      ? list
          .slice(0, 5)
          .map((e, i) => `<tr class="${i === highlight ? 'me' : ''}"><td>${i + 1}</td><td>${fmtScore(e.score)}</td><td>STAGE ${e.stage}${e.label ? `<small> ${e.label}</small>` : ''}</td></tr>`)
          .join('')
      : '<tr><td colspan="3">No scores yet. Go set one!</td></tr>';
    const html = `<div class="hs-title">HIGH SCORES</div><table>${rows}</table>`;
    for (const el of [this.els.title, this.els.gameover]) el.querySelector('.hiscores')!.innerHTML = html;
  }

  // ---------------------------------------------------------------- level-up

  showLevelUp(offers: Offer[], title: string, rerolls: number, loadout: LoadoutItem[], skipGold = 0): void {
    const el = this.els.levelup;
    el.querySelector('h1')!.textContent = title;
    // Each icon rolls like a slot reel; cards land left to right, a legendary spins longer and slows right down.
    const still = reduceMotion();
    const steps = offers.map((o, i) => {
      if (still) return [];
      const legend = o.rarity === 'legendary';
      return reelSteps(0.45 + 0.25 * i + (legend ? 1.5 : 0), legend ? [0.06, 0.08, 0.1, 0.13, 0.17, 0.22, 0.3, 0.4] : [0.07, 0.1]);
    });
    el.querySelector('.cards')!.innerHTML = offers
      .map(
        (o, i) => `<button class="card rolling ${o.kind} ${o.rarity ? 'r-' + o.rarity : ''} ${cardMode(o)}" data-nav data-act="pick" data-index="${i}">
          <i class="fx"></i>
          <div class="tag ${cardMode(o)}">${cardMode(o) === 'upgrade' ? '▲ UPGRADE' : o.tag}</div>
          ${cardMode(o) === 'new' ? '<div class="ribbon">NEW</div>' : ''}
          <div class="icon" style="--c:${o.color}"><div class="reel"><div class="strip">${iconHtml(o.id, o.color, o.icon)}${decoys(steps[i].length, o.id)
            .map((d) => iconHtml(d.id, d.color, d.icon))
            .join('')}</div></div></div>
          <div class="name">${o.name}</div>
          ${levelPips(o)}
          <div class="desc">${o.text}</div>
          ${o.tags ? `<div class="chips">${tagChips(o.tags)}</div>` : ''}
          ${o.replaces ? replaceStrip(o.replaces) : ''}
          <div class="kind"><span class="r-text-${o.rarity ?? 'common'}">${o.rarity ? RARITY[o.rarity].label : ''}</span>${o.label ? ` · ${o.label}` : ''}</div>
          ${o.slot ? `<div class="slot-ribbon s-${o.slot}">${slotPicto(o.slot)}${SLOT_LABEL[o.slot]}</div>` : ''}
          <div class="key">${i + 1}</div>
          <i class="lock"></i>
        </button>`,
      )
      .join('');
    el.querySelector('.reroll-row')!.innerHTML =
      (rerolls > 0 ? `<button data-nav data-act="reroll">REROLL ⚙ ${rerolls} [R]</button>` : '') +
      (skipGold > 0 ? `<button data-nav data-act="skip" class="skip">SKIP +${skipGold}<span class="gold-dot"></span></button>` : '');
    el.querySelector('.build')!.innerHTML = loadout.map(badge).join('');
    this.show('levelup');
    const cards = el.querySelectorAll<HTMLElement>('.card');
    // Each card's lock bar fills until it can be picked: the shared lock or its own reel landing, whichever is later.
    this.lockUntil = performance.now() + pickTuning.lock * 1000;
    this.lockCards = [...cards];
    el.classList.add('locked');
    cards.forEach((c, i) => {
      c.classList.add('locked');
      c.style.setProperty('--lock', `${Math.max(pickTuning.lock, steps[i].reduce((a, b) => a + b, 0))}s`);
    });
    this.reels = offers.map((o, i) => ({ card: cards[i], strip: cards[i].querySelector<HTMLElement>('.strip')!, steps: steps[i], passed: 0, rarity: o.rarity }));
    this.reelT = 0;
    this.tickReels(0);
  }

  private pickOpen(): boolean {
    return this.current === 'levelup' && performance.now() >= this.lockUntil;
  }

  /** Whether level-up card i can be picked yet (lock passed and its reel landed). Gate every pick path with it. */
  canPick(i: number): boolean {
    const card = this.els.levelup.querySelectorAll('.card')[i];
    return this.pickOpen() && !!card && !card.classList.contains('rolling');
  }

  /** Unlock the level-up screen and each card once it's pickable, with a small "ready" pop. */
  private tickLock(): void {
    if (!this.pickOpen()) return;
    const el = this.els.levelup;
    if (el.classList.contains('locked')) el.classList.remove('locked');
    if (!this.lockCards.length) return;
    this.lockCards = this.lockCards.filter((c) => {
      if (c.classList.contains('rolling')) return true;
      c.classList.replace('locked', 'ready');
      return false;
    });
  }

  /** Advance the level-up reels: a click per item passing, then each card's landing. */
  private tickReels(dt: number): void {
    if (!this.reels.length) return;
    if (this.current !== 'levelup') {
      this.reels = [];
      return;
    }
    this.reelT += dt;
    let tick = false;
    this.reels = this.reels.filter((r) => {
      const { pos, passed } = reelAt(r.steps, this.reelT);
      r.strip.style.setProperty('--k', String(pos));
      if (passed > r.passed && passed < r.steps.length) tick = true;
      r.passed = passed;
      if (passed < r.steps.length) return true;
      this.landCard(r.card, r.rarity);
      return false;
    });
    if (tick) sfx.reelTick();
  }

  /** A reel stops: reveal the card and play its tier's landing (legendary gets the fanfare and gold flash). */
  private landCard(card: HTMLElement, rarity: Rarity = 'common'): void {
    card.classList.remove('rolling');
    card.classList.add('land');
    sfx.reelLand(rarity);
    const icon = card.querySelector<HTMLElement>('.icon')!;
    if (rarity === 'uncommon') burstAt(icon, ['var(--lime)', 'var(--white)'], 8);
    if (rarity === 'legendary') {
      sfx.legendary();
      replay(this.els.levelup, 'legend-flash');
      burstAt(card, ['var(--yellow)', 'var(--orange)', 'var(--white)'], 26);
    }
  }

  /** The pause screen shows the current build. */
  setPauseBuild(
    loadout: LoadoutItem[],
    mods: { def: ModDef; level: number }[] = [],
    extras: { id: string; name: string; desc: string; icon: string; color: string; curse?: boolean }[] = [],
    info: { recipes: { weapon: string; evo: string; passive: string; have: boolean; done: boolean }[]; damage: { name: string; color: string; dmg: number }[] } = { recipes: [], damage: [] },
  ): void {
    const chip = (x: (typeof extras)[number]) =>
      `<span class="mod-chip ${x.curse ? 'cursed' : ''}" style="--c:${x.color}" title="${x.desc}">${iconHtml(x.id, x.color, x.icon)}${x.name}</span>`;
    this.els.pause.querySelector('.build')!.innerHTML =
      loadout.map(badge).join('') +
      (mods.length ? `<div class="mod-strip">${mods.map(modChip).join('')}</div>` : '') +
      (extras.length ? `<div class="mod-strip">${extras.map(chip).join('')}</div>` : '');
    const recipes = info.recipes
      .map((r) => `<div class="rcp ${r.done ? 'done' : r.have ? 'ready' : ''}">${r.done ? '★' : r.have ? '✓' : '·'} ${r.weapon} + ${r.passive} → <b>${r.evo}</b></div>`)
      .join('');
    const top = info.damage.slice(0, 6);
    const max = Math.max(1, ...top.map((d) => d.dmg));
    const bars = top
      .map((d) => `<div class="dbar"><span>${d.name}</span><i style="--w:${Math.round((d.dmg / max) * 100)}%;--c:${d.color}"></i><b>${Math.round(d.dmg).toLocaleString('en-US')}</b></div>`)
      .join('');
    const el = this.els.pause.querySelector('.pause-info') ?? this.els.pause.appendChild(Object.assign(document.createElement('div'), { className: 'pause-info' }));
    el.innerHTML =
      (recipes ? `<div class="pi-col"><div class="pi-t">EVOLUTIONS</div>${recipes}</div>` : '') +
      (bars ? `<div class="pi-col"><div class="pi-t">DAMAGE THIS RUN</div>${bars}</div>` : '');
  }

  // ---------------------------------------------------------------- shop

  showShop(v: ShopView, focus?: number): void {
    const el = this.els.shop;
    const wasOpen = this.current === 'shop';
    el.querySelector('h1')!.textContent = v.pre ? 'STARTING SHOP' : v.secret ? 'SECRET SHOP' : `STAGE ${v.stage} SHOP`;
    el.classList.toggle('secret', v.secret);
    el.querySelector('.shop-top')!.innerHTML =
      `<span class="gold-big"><span class="gold-dot"></span> ${v.gold} GOLD</span>` +
      (v.pre
        ? `<span class="interest pre">FREE 15 GOLD: SPEND IT NOW, IT ISN'T KEPT</span>`
        : `<span class="interest">Interest next clear: +${v.interest} (1 per ${v.interestPer} held, max ${v.interestCap})</span>`);
    el.querySelector('.shop-offers')!.innerHTML = v.offers
      .map((o, i) => {
        if (!o) return `<div class="mod-card sold">SOLD</div>`;
        const m = o.def;
        const cant = o.price > v.gold || v.owned.length >= v.slots;
        return `<button class="mod-card ${m.rarity} r-${m.rarity} ${m.cursed ? 'cursed' : ''} ${cant ? 'cant' : ''}" data-nav data-act="buy" data-index="${i}">
          <div class="rarity">${m.cursed ? 'CURSED' : m.rarity.toUpperCase()}</div>
          <div class="icon" style="--c:${m.color}">${iconHtml(m.id, m.color, m.icon)}</div>
          <div class="name">${m.name}</div>
          <div class="desc">${modDesc(m)}</div>
          ${modMaxLevel(m) > 1 ? `<div class="mod-ups">UPGRADES IN SHOP TO LV ${modMaxLevel(m)}</div>` : ''}
          ${m.synergy ? `<div class="chips">${tagChips(m.synergy)}</div>` : ''}
          ${o.hint ? `<div class="hint">${o.hint}</div>` : ''}
          <div class="price"><span class="gold-dot"></span> ${o.price}</div>
        </button>`;
      })
      .join('');
    const c = v.curse;
    const curseCard = c
      ? `<button class="mod-card curse-deal cursed" data-nav data-act="take-curse">
          <div class="rarity">CURSE DEAL</div>
          <div class="icon" style="--c:${c.color}">${iconHtml(c.id, c.color, c.icon)}</div>
          <div class="name">${c.name}</div>
          <div class="desc">${c.desc}</div>
          <div class="hint">For the rest of the run. Score +${Math.round(c.score * 100)}%</div>
          <div class="price">TAKE +<span class="gold-dot"></span> ${c.gold}</div>
        </button>`
      : '';
    const r = v.relic;
    const relicCard = r
      ? `<button class="mod-card ${r.rarity ?? 'rare'} r-${r.rarity ?? 'rare'} relic-deal ${r.price > v.gold ? 'cant' : ''}" data-nav data-act="buy-relic">
          <div class="rarity">${RARITY[r.rarity ?? 'rare'].label} RELIC</div>
          <div class="icon" style="--c:${r.color}">${iconHtml(r.id, r.color, r.icon)}</div>
          <div class="name">${r.name}</div>
          <div class="desc">${r.desc}</div>
          <div class="price"><span class="gold-dot"></span> ${r.price}</div>
        </button>`
      : '';
    el.querySelector('.shop-offers')!.insertAdjacentHTML('beforeend', relicCard + curseCard);
    el.querySelector('.shop-extras')!.innerHTML =
      `<button data-nav data-act="shop-reroll" class="${v.rerollCost > v.gold ? 'cant' : ''}">REROLL ${v.rerollCost ? `<span class="gold-dot"></span> ${v.rerollCost}` : 'FREE'}</button>` +
      `<button data-nav data-act="shop-heal" class="${v.healed || v.healCost > v.gold ? 'cant' : ''}">HEAL 40% <span class="gold-dot"></span> ${v.healCost}</button>` +
      `<button data-nav data-act="shop-done" class="continue">CONTINUE &#9654;</button>`;
    el.querySelector('.owned-title')!.textContent = `YOUR MODS ${v.owned.length}/${v.slots} — damage flows left to right`;
    const empty = Math.max(0, v.slots - v.owned.length);
    el.querySelector('.owned-mods')!.innerHTML =
      v.owned
        .map(
          (o, i) => `<div class="owned-mod ${o.def.cursed ? 'cursed' : ''}" title="${modDesc(o.def, o.level)}">
          <div class="slot-no">${i + 1}</div>
          <div class="icon" style="--c:${o.def.color}">${iconHtml(o.def.id, o.def.color, o.def.icon)}</div>
          <div class="name">${o.def.name}${o.maxLevel > 1 ? ` <span class="mod-lv">LV ${o.level}/${o.maxLevel}</span>` : ''}</div>
          <div class="desc">${modDesc(o.def, o.level)}</div>
          ${o.readout ? `<div class="readout">${o.readout}</div>` : ''}
          ${o.upCost >= 0 ? `<div class="mod-next"><i>NEXT LV ${o.level + 1}:</i> ${nextLevelHtml(o.def, o.level)}</div>` : ''}
          ${o.upCost >= 0 ? `<button data-nav data-act="mod-up" data-index="${i}" class="mod-up ${o.upCost > v.gold ? 'cant' : ''}">UPGRADE <span class="gold-dot"></span> ${o.upCost}</button>` : o.maxLevel > 1 ? '<div class="mod-max">MAX LEVEL</div>' : ''}
          <div class="ctrl">
            <button data-nav data-act="mod-left" data-index="${i}" ${i === 0 ? 'disabled' : ''}>&#9664;</button>
            <button data-nav data-act="mod-right" data-index="${i}" ${i === v.owned.length - 1 ? 'disabled' : ''}>&#9654;</button>
            <button data-nav data-act="sell" data-index="${i}" class="sell">SELL +${o.sell}</button>
          </div>
        </div>`,
        )
        .join('') + '<div class="owned-mod empty"></div>'.repeat(empty);
    this.show('shop', focus);
    // Gold changes pop a +/- number over the counter.
    const delta = wasOpen && this.shopGold >= 0 ? v.gold - this.shopGold : 0;
    this.shopGold = v.gold;
    if (delta) {
      const gold = el.querySelector<HTMLElement>('.gold-big')!;
      replay(gold, 'bump');
      floatText(gold, `${delta > 0 ? '+' : ''}${delta}`, delta > 0 ? 'var(--yellow)' : 'var(--orange)');
    }
  }

  /** Shop juice: a sound plus pixel particles for each shop action. */
  shopFx(kind: ShopFx, i = 0): void {
    const el = this.els.shop;
    const gold = el.querySelector<HTMLElement>('.gold-big');
    switch (kind) {
      case 'open': {
        sfx.shopOpen();
        replay(el.querySelector('h1')!, 'slam-in');
        // Coin shower across the top of the screen.
        for (let k = 0; k < 28; k++) {
          const x = Math.random() * innerWidth;
          bit(x, -20, x + (Math.random() - 0.5) * 60, innerHeight * (0.35 + Math.random() * 0.4), true, Math.random() * 0.5, 0.9);
        }
        break;
      }
      case 'buy': {
        sfx.buy();
        const card = el.querySelector('.shop-offers')!.children[i] as HTMLElement | undefined;
        if (card && gold) coinsBetween(gold, card, 14);
        if (card) burstAt(card, ['var(--white)', 'var(--yellow)', 'var(--cyan)'], 18);
        const owned = el.querySelectorAll<HTMLElement>('.owned-mod:not(.empty)');
        const fresh = owned[owned.length - 1];
        if (fresh) replay(fresh, 'fresh');
        break;
      }
      case 'upgrade': {
        sfx.buy();
        sfx.powerUp();
        const card = el.querySelectorAll<HTMLElement>('.owned-mod:not(.empty)')[i];
        if (card) {
          if (gold) coinsBetween(gold, card, 10);
          burstAt(card, ['var(--yellow)', 'var(--cyan)', 'var(--white)'], 22);
          replay(card, 'fresh');
        }
        break;
      }
      case 'sell':
        sfx.sell();
        if (gold) burstAt(gold, ['var(--yellow)', 'var(--orange)'], 16, true);
        break;
      case 'reroll':
        sfx.reroll();
        el.querySelectorAll<HTMLElement>('.shop-offers > *').forEach((c, k) => {
          c.style.animationDelay = `${k * 0.06}s`;
          replay(c, 'reroll-in');
        });
        break;
      case 'heal': {
        sfx.heal();
        const btn = el.querySelector<HTMLElement>('[data-act="shop-heal"]');
        if (btn) burstAt(btn, ['var(--green)', 'var(--lime)', 'var(--white)'], 20);
        replay(el, 'heal-flash');
        break;
      }
      case 'deny': {
        sfx.deny();
        const f = el.querySelector<HTMLElement>('.focused');
        if (f) replay(f, 'deny');
        if (gold) replay(gold, 'deny');
        break;
      }
    }
  }

  // ---------------------------------------------------------------- unlocks

  private renderHistory(): void {
    const rows = save.history.map(
      (r) => `<tr>
        <td>${r.date}</td>
        <td>${r.label}<br><small>${r.hero.toUpperCase()}</small></td>
        <td>STAGE ${r.stage}<br><small>LV ${r.level} · ${fmtTime(r.time)}</small></td>
        <td class="sc">${fmtScore(r.score)}<br><small>${r.kills.toLocaleString('en-US')} KILLS</small></td>
        <td class="ws">${r.weapons.map((w) => `<span class="badge${w.evo ? ' evo' : ''}" style="--c:${WEAPONS[w.id]?.color ?? '#fff'}">${iconHtml(w.id, WEAPONS[w.id]?.color ?? '#fff', WEAPONS[w.id]?.icon ?? '?')}<i>${w.evo ? 'E' : w.level}</i></span>`).join('')}</td>
        <td class="cause">☠ ${r.cause}</td>
      </tr>`,
    );
    this.els.history.querySelector('.history')!.innerHTML = rows.length ? rows.join('') : '<tr><td>No runs yet. Go play one!</td></tr>';
  }

  private renderBestiary(): void {
    const all = Object.values(ENEMIES);
    const seen = all.filter((d) => save.seen.includes(d.id));
    this.els.bestiary.querySelector('.bst-count')!.textContent = `${seen.length} / ${all.length} MET`;
    this.els.bestiary.querySelector('.bestiary')!.innerHTML = all
      .map((d) => {
        if (!save.seen.includes(d.id)) return `<div class="bst unseen"><b>???</b><small>Not met yet.</small></div>`;
        const kind = d.boss ? 'BOSS' : `FROM MINUTE ${Math.max(0, d.minMinute)}`;
        return `<div class="bst" style="--c:${d.bodyColor}"><i class="sw" style="background:${d.bodyColor}"></i><b>${d.name.toUpperCase()}</b>
          <span class="st">LIFE ${d.hp} · SPEED ${d.speed} · HIT ${d.contactDamage} · ${kind}</span>
          <small>${ENEMY_TIPS[d.id] ?? ''}</small></div>`;
      })
      .join('');
  }

  /** Waiting for a key to bind. */
  private capture: { a: Action; slot: 0 | 1 } | null = null;

  private renderControls(): void {
    this.capture = null;
    const el = this.els.controls;
    el.querySelector('.bind-list')!.innerHTML = ACTIONS.map(
      (a) => `<div class="bind-row"><span>${a.name.toUpperCase()}</span>${[0, 1]
        .map((slot) => `<button data-nav data-act="bind" data-action="${a.id}" data-slot="${slot}">${keyLabel(binds[a.id][slot])}</button>`)
        .join('')}</div>`,
    ).join('');
    this.navs.controls.refresh(this.navs.controls.focus);
  }

  private renderModes(): void {
    const el = this.els.modes;
    const mode = MODE_BY_ID[settings.mode as ModeId] ?? MODES[0];
    el.querySelector('.hero-row')!.innerHTML = HEROES.map((hd) => {
      const open = !hd.unlock || save.achievements.includes(hd.unlock);
      const ach = hd.unlock ? ACHIEVEMENTS.find((a) => a.id === hd.unlock) : null;
      return `<button data-nav data-act="hero" data-hero="${hd.id}" class="diff ${settings.hero === hd.id ? 'on' : ''} ${open ? '' : 'locked'}" title="${open ? hd.desc : `Unlock: ${ach?.name ?? ''}`}">${open ? hd.name.toUpperCase() : '🔒 ' + hd.name.toUpperCase()}</button>`;
    }).join('');
    const hero = HEROES.find((x) => x.id === settings.hero) ?? HEROES[0];
    const heroOpen = !hero.unlock || save.achievements.includes(hero.unlock);
    el.querySelector('.hero-note')!.textContent = heroOpen ? hero.desc.toUpperCase() : `LOCKED: ${ACHIEVEMENTS.find((a) => a.id === hero.unlock)?.desc.toUpperCase() ?? ''}`;
    el.querySelector('.mode-grid')!.innerHTML = MODES.map(
      (m) => `<button data-nav data-act="mode" data-mode="${m.id}" class="mode ${m.id === mode.id ? 'on' : ''}"><b>${m.name.toUpperCase()}</b><small>${m.desc}</small></button>`,
    ).join('');
    const daily = mode.id === 'daily';
    el.querySelector('.diff-row')!.innerHTML = DIFFICULTIES.map((d) => {
      const open = !d.unlock || save.achievements.includes(d.unlock);
      const ach = d.unlock ? ACHIEVEMENTS.find((a) => a.id === d.unlock) : null;
      const on = daily ? d.id === 'normal' : settings.difficulty === d.id;
      return `<button data-nav data-act="diff" data-diff="${d.id}" class="diff ${on ? 'on' : ''} ${open ? '' : 'locked'}" ${daily ? 'disabled' : ''} title="${open ? d.desc : `Unlock: ${ach?.name ?? ''}`}">${open ? d.name.toUpperCase() : '🔒 ' + d.name.toUpperCase()}</button>`;
    }).join('');
    const diff = DIFFICULTIES.find((d) => d.id === settings.difficulty) ?? DIFFICULTIES[1];
    const best = dailyBest(today());
    el.querySelector('.mode-note')!.textContent = daily
      ? `TODAY'S SEED (${today()}). ${best ? `YOUR BEST TODAY: ${fmtScore(best)}` : 'NO RUN YET TODAY'}`
      : diff.desc.toUpperCase();
    this.navs.modes.refresh(this.navs.modes.focus);
  }

  private renderWardrobe(): void {
    const el = this.els.wardrobe;
    el.querySelector('.skin-grid')!.innerHTML = SKINS.map((s) => {
      const open = skinUnlocked(s.id);
      const ach = s.unlock ? ACHIEVEMENTS.find((a) => a.id === s.unlock) : null;
      const sw = (c: string) => `<i style="background:${c}"></i>`;
      return `<button data-nav data-act="skin" data-skin="${s.id}" class="skin ${settings.skin === s.id ? 'on' : ''} ${open ? '' : 'locked'}">
        <span class="swatches">${open ? sw(s.armor) + sw(s.accent) + sw(s.suit) + sw(s.hair) : sw('#333c57') + sw('#333c57') + sw('#333c57') + sw('#333c57')}</span>
        <b>${open ? s.name.toUpperCase() : '???'}</b>
        <small>${open ? (settings.skin === s.id ? 'WEARING' : 'WEAR') : ach ? ach.name.toUpperCase() : ''}</small>
      </button>`;
    }).join('');
    el.querySelector('.pet-grid')!.innerHTML = PETS.map((p) => {
      const open = !p.unlock || save.achievements.includes(p.unlock);
      const ach = p.unlock ? ACHIEVEMENTS.find((a) => a.id === p.unlock) : null;
      return `<button data-nav data-act="pet" data-pet="${p.id}" class="skin ${settings.pet === p.id ? 'on' : ''} ${open ? '' : 'locked'}" title="${p.desc}">
        <span class="swatches"><i style="background:${open ? p.color : '#333c57'}"></i></span>
        <b>${open ? p.name.toUpperCase() : '???'}</b>
        <small>${open ? p.desc : ach ? ach.name.toUpperCase() : ''}</small>
      </button>`;
    }).join('');
    this.navs.wardrobe.refresh(this.navs.wardrobe.focus);
  }

  /** Tracks unlock as you reach their area (or hear them). */
  private renderJukebox(): void {
    const L = save.lifetime;
    const unlocked = (id: TrackId, i: number) =>
      music.heard.has(id) || id === 'title' || (id === 'boss' ? L.bosses > 0 : L.bestStage >= i);
    const el = this.els.jukebox;
    el.querySelector('.tracks')!.innerHTML = TRACKS.map((t, i) =>
      unlocked(t.id, i)
        ? `<button data-nav data-act="jb-play" data-track="${t.id}" class="${music.jukebox === t.id ? 'on' : ''}">${music.jukebox === t.id ? '♪ ' : ''}${t.name.toUpperCase()}</button>`
        : `<button data-nav class="locked" disabled>???</button>`,
    ).join('');
    const now = TRACKS.find((t) => t.id === music.jukebox);
    el.querySelector('.now-playing')!.textContent = now ? `NOW PLAYING: ${now.name.toUpperCase()}` : 'PICK A TRACK';
    this.navs.jukebox.refresh(this.navs.jukebox.focus);
  }

  private renderUnlocks(): void {
    this.els.unlocks.querySelector('.ach-list')!.innerHTML = ACHIEVEMENTS.map((a) => {
      const done = save.achievements.includes(a.id);
      const item = a.unlockLoadout ? (WEAPONS[a.unlockLoadout] ?? SPECIALS[a.unlockLoadout]) : null;
      const reward = a.unlockWeapon ? `Unlocks ${WEAPONS[a.unlockWeapon].name}` : item ? `Loadout: ${item.name}` : '';
      return `<div class="ach ${done ? 'done' : ''}"><span class="check">${done ? '★' : '☆'}</span><span class="name">${a.name}</span><span class="desc">${a.desc}</span><span class="reward">${reward}</span></div>`;
    }).join('');
  }

  // ---------------------------------------------------------------- save data

  private msg(text: string, ok = true): void {
    const m = this.els.savedata.querySelector<HTMLElement>('.msg')!;
    m.textContent = text;
    m.classList.toggle('err', !ok);
  }

  private doExport(): void {
    const url = URL.createObjectURL(new Blob([exportFile()], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'InfiniShoot-save.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.msg('Saved! Keep InfiniShoot-save.json somewhere safe.');
  }

  private doImport(): void {
    const input = this.els.savedata.querySelector<HTMLInputElement>('#save-file')!;
    input.value = '';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      file.text().then((text) => {
        try {
          importFile(text);
          this.msg('Save loaded!');
          sfx.powerUp();
        } catch (err) {
          this.msg((err as Error).message, false);
        }
      });
    };
    input.click();
  }

  private doWipe(btn: HTMLElement): void {
    if (!this.wipeArmed) {
      this.wipeArmed = true;
      btn.textContent = 'REALLY? PRESS AGAIN';
      this.msg('This deletes your achievements, unlocked weapons and lifetime stats on this device.', false);
      return;
    }
    resetSave();
    this.wipeArmed = false;
    btn.textContent = 'RESET SAVE';
    this.msg('Save reset.');
  }

  // ---------------------------------------------------------------- game over

  showGameOver(sum: RunSummary, rank: number, list: ScoreEntry[], waitingForHost = false): void {
    const el = this.els.gameover;
    el.querySelector<HTMLElement>('[data-act=retry]')!.textContent = waitingForHost ? 'HOST RESTARTS' : 'RETRY';
    el.querySelector<HTMLElement>('.newbest')!.hidden = rank !== 0;
    el.querySelector('.summary')!.innerHTML = `
      <div class="big">${fmtScore(sum.score)}</div>
      <div class="grid">
        <span>STAGE</span><b>${sum.stage}</b>
        <span>LEVEL</span><b>${sum.level}</b>
        <span>KILLS</span><b>${sum.kills.toLocaleString('en-US')}</b>
        <span>BEST COMBO</span><b>${sum.maxCombo}</b>
        <span>TIME</span><b>${fmtTime(sum.time)}</b>
      </div>`;
    const top = sum.damage.slice(0, 6);
    const max = top[0]?.dmg || 1;
    el.querySelector('.dmg-table')!.innerHTML =
      `<div class="hs-title">DAMAGE DEALT</div>` +
      top
        .map(
          (d) =>
            `<div class="dmg-row"><span>${d.name}</span><div class="bar"><div style="width:${(d.dmg / max) * 100}%;background:${d.color}"></div></div><b>${fmtScore(d.dmg)}</b></div>`,
        )
        .join('');
    el.querySelector('.build')!.innerHTML =
      sum.loadout.map(badge).join('') + (sum.mods.length ? `<div class="mod-strip">MODS: ${sum.mods.join(' · ')}</div>` : '');
    el.querySelector('.unlocked')!.innerHTML = sum.achievements.length ? `★ NEW: ${sum.achievements.join(' · ')}` : '';
    this.setHighScores(list, rank);
    this.show('gameover');
  }
}

// ---------------------------------------------------------------- shop particles

/** Restart a CSS animation class on an element. */
function replay(el: HTMLElement, cls: string): void {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
}

/** One pixel bit (or coin) flying from (x0, y0) to (x1, y1) with a little hop. */
function bit(x0: number, y0: number, x1: number, y1: number, coin: boolean, delay = 0, dur = 0.55, color = 'var(--yellow)'): void {
  if (reduceMotion()) return; // without its animation a bit would never fly off or get removed
  const b = document.createElement('i');
  b.className = coin ? 'px-bit coin' : 'px-bit';
  const s = b.style;
  s.setProperty('--x0', `${x0}px`);
  s.setProperty('--y0', `${y0}px`);
  s.setProperty('--x1', `${x1}px`);
  s.setProperty('--y1', `${y1}px`);
  s.setProperty('--xm', `${(x0 + x1) / 2}px`);
  s.setProperty('--ym', `${Math.min(y0, y1) - 30 - Math.random() * 40}px`);
  s.setProperty('--c', color);
  s.animationDelay = `${delay}s`;
  s.animationDuration = `${dur}s`;
  b.addEventListener('animationend', () => b.remove(), { once: true });
  document.body.appendChild(b);
}

function centre(el: HTMLElement): [number, number] {
  const r = el.getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2];
}

/** Pixels bursting out of an element. `fountain` arcs them up and lets them fall. */
function burstAt(el: HTMLElement, colors: string[], n: number, fountain = false): void {
  const [x, y] = centre(el);
  for (let k = 0; k < n; k++) {
    const a = Math.random() * Math.PI * 2;
    const d = 40 + Math.random() * 70;
    const tx = x + Math.cos(a) * d;
    const ty = fountain ? y + 30 + Math.random() * 60 : y + Math.sin(a) * d;
    bit(x, y, tx, ty, fountain, Math.random() * 0.08, 0.45 + Math.random() * 0.25, colors[k % colors.length]);
  }
}

/** Coins streaming from one element to another (gold spent on a card). */
function coinsBetween(from: HTMLElement, to: HTMLElement, n: number): void {
  const [x0, y0] = centre(from);
  const [x1, y1] = centre(to);
  for (let k = 0; k < n; k++) bit(x0, y0, x1 + (Math.random() - 0.5) * 60, y1 + (Math.random() - 0.5) * 60, true, k * 0.025, 0.45);
}

/** A number that rises and fades over an element. */
function floatText(el: HTMLElement, text: string, color: string): void {
  const [x, y] = centre(el);
  const t = document.createElement('i');
  t.className = 'px-float';
  t.textContent = text;
  t.style.left = `${x}px`;
  t.style.top = `${y}px`;
  t.style.color = color;
  t.addEventListener('animationend', () => t.remove(), { once: true });
  document.body.appendChild(t);
}
