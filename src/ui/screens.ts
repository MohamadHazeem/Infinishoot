import { ModsScreen } from './modsScreen';
import { gauntletOption, renderGauntletOptions } from '../game/systems/gauntlet';
import { SettingsScreen } from './settingsScreen';
import { localize, t, localizeHtml, relocalizeDom } from '../i18n';
import { META_SCREENS, metaScreenHtml, renderMeta, metaAction, applyMetaTheme, type MetaScreen } from './metaScreens';
import { weeklyChallenge } from '../data/weekly';
import type { Input } from '../core/input';
import { ACHIEVEMENTS } from '../data/meta';
import { tagChips, type Tag } from '../data/tags';
import { WEAPONS } from '../data/weapons';
import { PASSIVES } from '../data/passives';
import { RELIC_BY_ID, type RelicDef } from '../data/relics';
import { SPECIALS } from '../data/specials';
import { loadoutOptions, validLoadout, type LoadoutSlot } from '../data/loadout';
import { modDesc, modMaxLevel, type ModDef } from '../game/modTypes';
import type { ScoreEntry } from '../game/highscores';
import { exportFile, importFile, loadoutUnlockBy, resetSave, save, unlockedLoadout } from '../game/save';
import { settings, saveSettings } from '../game/settings';
import { sfx } from '../audio/sfx';
import { music, TRACKS, trackUnlocked, type TrackId } from '../audio/music';
import { RARITY, type Rarity } from '../data/rarity';
import { SLOT_LABEL, decoys, fmtScore, reduceMotion, reelAt, reelSteps, slotPicto, type LoadoutItem, type Slot } from './hud';
import { MenuNav, TitleMenu, polishMenuScreen, menuItemAvailable } from './menu';
import { iconHtml } from './pixelIcons';
import { fuseStrip, fusionGuide } from './fusionUi';
import { SKINS } from '../data/skins';
import { PETS } from '../data/pets';
import { DIFFICULTIES, MODE_BY_ID, MODES, today, type ModeId } from '../data/modes';
import { dailyBest } from '../game/highscores';
import { HEROES } from '../data/heroes';
import { ACTIONS, binds, keyLabel, rebind, resetBinds, type Action } from '../core/keybinds';
import { prompt, promptHtml } from './prompts';
import { ENEMIES } from '../data/enemies';
import { ENEMY_TIPS, enemyHome } from '../data/bestiary';
import { BIOMES } from '../data/biomes';
import type { CardNum } from '../game/cardNumbers';
import { canBanish } from '../game/banish';
import type { PreviewRow, ShopPreview } from '../game/shopPreview';
import { buyDamageNums, ensureShopCss, numsHtml, previewPanelHtml, type PreviewFocus } from './shopUi';
import { mountRelayField, showRelayField } from './relayField';
import { RouteMapView, type RouteView } from './routeMap';

/** Full-screen menus. Plain DOM; every navigable element has `data-nav`. */
export type ScreenName = 'none' | 'title' | 'pause' | 'settings' | 'levelup' | 'shop' | 'gameover' | 'unlocks' | 'savedata' | 'online' | 'wait' | 'loadout' | 'extras' | 'jukebox' | 'wardrobe' | 'modes' | 'controls' | 'history' | 'bestiary' | 'relic' | MetaScreen | 'route' | ExtraScreen;
/** Screens built by other modules and registered with `Screens.addScreen` (src/ui/onboarding.ts). */
export type ExtraScreen = 'settings' | 'arsenal' | 'training' | 'customise' | 'ghosts' | 'ghostrace' | 'localcoop' | 'mpbrowse' | 'teamboard' | 'halloween' | 'party' | 'friends' | 'gauntlet' | 'mvp' | 'play' | 'profile' | 'achievements' | 'story' | 'desktopKeyboard' | 'desktopHelp' | 'contentmods' | 'touchlayout';
/** Online lobby game types (the host picks; MP lane added Versus and Weekly co-op). */
export type LobbyKind = 'coop' | 'pvp' | 'versus' | 'weekly';

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
  mpKind(kind: LobbyKind): void;
  /** The loadout changed (online: tell the host). */
  loadoutChanged(): void;
  /** The local skin setting changed. */
  skinChanged(): void;
  takeCurse(): void;
  buyRelic(i: number): void;
  /** Lock / unlock shop offer i (kept through rerolls and into the next shop). */
  lockOffer(index: number): void;
}

export interface LobbyView {
  code: string;
  players: { name: string; color: string; kit?: string; pf?: { lv: number; title: string; banner: string } | null }[];
  isHost: boolean;
  status: string;
  /** Difficulty the host picked (shown to everyone in the lobby). */
  difficulty?: string;
  /** Co-op or PvP, picked by the host. */
  kind?: LobbyKind;
  /** Extra lobby fields for other modules' rows (src/game/systems/mp.ts, via `onLobby`). */
  extra?: unknown;
}

export type ShopFx = 'open' | 'buy' | 'sell' | 'reroll' | 'heal' | 'deny' | 'upgrade';

export interface ShopView {
  gold: number;
  interest: number;
  interestCap: number;
  interestPer: number;
  /** `locked`: kept through rerolls; `nums`: non-damage effects on this build (shop lane). */
  offers: ({ def: ModDef; price: number; hint: string; locked?: boolean; nums?: CardNum[] } | null)[];
  owned: { def: ModDef; sell: number; readout: string; level: number; maxLevel: number; upCost: number }[];
  slots: number;
  /** Mod order preview (src/game/shopPreview.ts). */
  preview?: ShopPreview;
  rerollCost: number;
  healCost: number;
  healed: boolean;
  loadout: LoadoutItem[];
  stage: number;
  /** Starting shop before stage 1: free gold that isn't kept, no interest. */
  pre?: boolean;
  /** The rare secret merchant (rare/cursed Mods at a discount, a free relic). */
  secret: boolean;
  /** The secret merchant's relics: pick one, free, on the RELIC screen before the shop. */
  relicOffers: RelicDef[];
  /** Relic ids this hero owns (shown in the shop's RELICS section, apart from the Mods). */
  relics: string[];
  /** Optional curse deal (one per shop visit). */
  curse: { id: string; name: string; desc: string; icon: string; color: string; gold: number; score: number } | null;
}

export interface Offer {
  kind: 'weapon' | 'passive' | 'special' | 'gold' | 'heal' | 'track' | 'evo' | 'overdrive' | 'evolve' | 'fusion';
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
  /** Auto-weapon partner evolution this card leads to: weapon id, partner item id, and what you already have. */
  partner?: { weapon: string; passive: string; haveWeapon: boolean; haveItem: boolean };
  /** Key numbers before -> after for this hero (src/game/cardNumbers.ts). */
  nums?: CardNum[];
  /** Fusion cards: the two weapon ids that fuse (src/data/fusions.ts), shown as A + B. */
  fuses?: [string, string];
}

export interface RunSummary {
  mvp?: import('../game/systems/mvp').MvpReport;
  /** meta2: the host's profile counters for this hero (src/game/systems/meta2.ts). */
  m2?: Record<string, number>;
  heat?: number;
  bolts?: number;
  clears?: number;
  bosses?: number;
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
  /** Best style rank this run (D..SS). */
  style?: string;
}

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
  return o.tag === 'NEW!' ? 'new' : o.tag === 'EVOLVE!' || o.kind === 'fusion' ? 'evo' : o.kind === 'gold' || o.kind === 'heal' ? 'bonus' : 'upgrade';
}

/** Upgrades show owned levels as filled pips and this pick as a flashing one. */
function levelPips(o: Offer): string {
  if (!o.maxLevel || !o.level) return '';
  const pips = Array.from({ length: o.maxLevel }, (_, k) => `<i class="${k < o.level! ? 'on' : k === o.level ? 'next' : ''}"></i>`).join('');
  const next = o.level + 1 === o.maxLevel && o.tag === 'EVOLVE!' ? 'EVOLVE' : `LV ${o.level + 1}`;
  return `<div class="lvl">LV ${o.level} ▸ ${next}</div><div class="pips">${pips}</div>`;
}

/** Evolution strip: the weapon and its partner item, ticked when owned, and what they become. */
function partnerStrip(o: NonNullable<Offer['partner']>): string {
  const w = WEAPONS[o.weapon];
  const it = PASSIVES[o.passive];
  if (!w?.evolution || !it) return '';
  const part = (id: string, name: string, color: string, icon: string, have: boolean) =>
    `<span class="pt${have ? ' have' : ''}">${iconHtml(id, color, icon)}${have ? '<em>✓</em>' : ''}<span class="nm">${name.toUpperCase()}</span></span>`;
  return `<div class="partner"><div class="pair">${part(w.id, 'MAX ' + w.name, w.color, w.icon, o.haveWeapon)}<i>+</i>${part(it.id, it.name, it.color, it.icon, o.haveItem)}</div><b>EVOLVES INTO ${w.evolution.name.toUpperCase()}</b></div>`;
}

/** Warning strip on cards that swap out an owned weapon. "Plasma Orb LV 3" reads "REPLACES PLASMA ORB (LV 3)". */
function replaceStrip(what: string): string {
  const name = what.replace(/\s+(LV\s*\d+)$/i, ' ($1)').toUpperCase();
  return `<div class="replaces"><i>!</i><span>REPLACES ${name}<b>${t("text.old_weapon_and_its_upgrades_are_removed_0d5617")}</b></span></div>`;
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

function relicChip(r: RelicDef): string {
  return `<span class="mod-chip relic r-${r.rarity}" style="--c:${r.color}" tabindex="0">${iconHtml(r.id, r.color, r.icon)}${r.name}${tip(r.name, r.rarity, r.desc, ' · RELIC')}</span>`;
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

type Named = Exclude<ScreenName, 'none' | ExtraScreen>;

/** Level-up pick lock: seconds after the cards appear (or a reroll) before any pick or skip counts. */
export const pickTuning = { lock: 0.6 };

export class Screens {
  current: ScreenName = 'none';
  private els = {} as Record<Named, HTMLElement>;
  private navs = {} as Record<Named, MenuNav>;
  private settingsReturn: ScreenName = 'title';
  readonly settingsScreen: SettingsScreen;
  readonly modsScreen: ModsScreen;
  private readonly titleMenu: TitleMenu;
  private wipeArmed = false;
  /** Gold last shown in the shop, for the +/- popups. */
  private shopGold = -1;
  /** Level-up card reels still spinning, and the time since they started. */
  private reels: { card: HTMLElement; strip: HTMLElement; steps: number[]; passed: number; rarity?: Rarity }[] = [];
  private reelT = 0;
  /** Level-up pick lock: no pick or skip before this time (ms), so a held click or key can't choose by accident. */
  private lockUntil = 0;
  private pickGhost: HTMLElement | null = null;
  /** Cards still showing the locked look. */
  private lockCards: HTMLElement[] = [];

  private root: HTMLElement;
  /** Screens other modules add (addScreen): shown and navigated like the built-in ones. */
  private extra: Partial<Record<ExtraScreen, { el: HTMLElement; nav: MenuNav }>> = {};
  /** Called on every show(), before the menu's focus is set (other modules fill or extend screens here). */
  onShow: ((name: ScreenName) => void) | null = null;
  /** After the lobby view is drawn (MP lane rows: Overlord pick, weekly team, PUBLIC). */
  onLobby: ((el: HTMLElement, v: LobbyView) => void) | null = null;

  // Shop lane: banish, card numbers and the Mod order preview.
  /** The next level-up pick banishes the card instead (BANISH button; numbers keys too). */
  banishArmed = false;
  /** Offers on screen, so a banish redraw only spins the new card. */
  private shownOffers: string[] = [];
  private shopShown: ShopView | null = null;
  /** Focused shop control the preview panel describes. */
  private pvKey = '';
  /** After moving a Mod: focus follows it, and the panel compares the old order. */
  private shopFollow: { act: string; index: number } | null = null;
  private movedFrom: PreviewRow[] | null = null;

  constructor(root: HTMLElement, private readonly actions: ScreenActions) {
    this.root = root;
    ensureShopCss();
    root.insertAdjacentHTML(
      'beforeend',
      localizeHtml(`
<div id="scr-title" class="screen" hidden>
  <div class="logo">${logoWord('INFINI', 0)}${logoWord('SHOOT', 6)}</div>
  <div class="tagline">${t("text.twin_stick_arcade_roguelike_40bd5d")}</div>
  <div class="menu">
    <button data-nav data-act="modes">${t("text.play_solo_de1316")}</button>
    <button data-nav data-act="online">${t("text.play_online_e3b77f")}</button>
    <button data-nav data-act="unlocks">${t("text.unlocks_88da64")}</button>
    <button data-nav data-act="extras">${t("text.extras_60d4e6")}</button>
    <button data-nav data-act="settings">${t("text.settings_ed6f7a")}</button>
  </div>
  <div class="wallet"></div>
  <div class="hiscores"></div>
  <div class="hiscores global" hidden></div>
  <div class="controls" data-prompt="controls">${promptHtml('controls')}</div>
  <div class="credits">${t("text.icons_game_icons_net_by_lorc_delapouite_amp_cont_801479")}</div>
  <div class="version">v${__APP_VERSION__}</div>
</div>
<div id="scr-pause" class="screen dim" hidden>
  <h1>${t("text.paused_99b243")}</h1>
  <div class="menu">
    <button data-nav data-act="resume">${t("text.resume_bac2ae")}</button>
    <button data-nav data-act="photo">${t("text.photo_mode_799b28")}</button>
    <button data-nav data-act="settings">${t("text.settings_ed6f7a")}</button>
    <button data-nav data-act="quit">${t("text.quit_run_e6abc8")}</button>
  </div>
  <div class="build"></div>
</div>
<div id="scr-controls" class="screen dim" hidden>
  <h1>${t("text.controls_e56516")}</h1>
  <p class="note">${t("text.click_a_key_slot_then_press_the_new_key_esc_canc_7f55da")}</p>
  <div class="pad-legend" data-prompt="padlegend"></div>
  <div class="bind-list"></div>
  <div class="menu row">
    <button data-nav data-act="binds-reset">${t("text.reset_defaults_cb53b2")}</button>
    <button data-nav data-act="binds-back">${t("text.back_1dd26f")}</button>
  </div>
</div>
<div id="scr-levelup" class="screen dim" hidden>
  <i class="level-burst" aria-hidden="true"></i>
  <h1></h1>
  <div class="cards"></div>
  <div class="reroll-row"></div>
  <div class="build"></div>
</div>
<div id="scr-online" class="screen dim" hidden>
  <h1>${t("text.play_online_e3b77f")}</h1>
  <p class="note">${t("text.co_op_for_up_to_4_players_one_player_hosts_and_s_f0eb31")}</p>
  <label class="field">${t("text.your_name_7801bf")} <input id="mp-name" type="text" maxlength="12" spellcheck="false" autocomplete="off"></label>
  <div class="menu row mp-choice">
    <button data-nav data-act="mp-host">${t("text.host_game_ee1e1b")}</button>
  </div>
  <div class="join-row">
    <input id="mp-code" type="text" maxlength="5" placeholder="CODE" spellcheck="false" autocomplete="off">
    <button data-nav data-act="mp-join">${t("text.join_a6fa1c")}</button>
  </div>
  <div class="lobby" hidden>
    <div class="code-label">${t("text.game_code_63f201")}</div>
    <div class="code-big" translate="no" dir="ltr"></div>
    <div class="players"></div>
    <div class="section">${t("text.game_4504e1")}</div>
    <div class="menu row diff-row mp-kind-row"></div>
    <div class="note mp-kind-note"></div>
    <div class="section">${t("text.difficulty_5753f4")}</div>
    <div class="menu row diff-row mp-diff-row"></div>
    <div class="note mp-diff-note"></div>
  </div>
  <div class="msg mp-status"></div>
  <div class="menu row">
    <button data-nav data-act="lo-online">${t("text.loadout_dad6c1")}</button>
    <button data-nav data-act="heat" class="mp-heat" hidden>${t("text.host_heat_eba834")}</button>
    <button data-nav data-act="mp-start" hidden>${t("text.start_game_d7700f")}</button>
    <button data-nav data-act="mp-leave">${t("text.back_1dd26f")}</button>
  </div>
</div>
<div id="scr-loadout" class="screen dim" hidden>
  <h1>${t("text.loadout_dad6c1")}</h1>
  <p class="note">${t("text.pick_your_left_click_right_click_and_special_you_2606ce")}</p>
  <div class="lo-rows"></div>
  <div class="menu row">
    <button data-nav data-act="lo-start" class="continue">START &#9654;</button>
    <button data-nav data-act="lo-back">${t("text.back_1dd26f")}</button>
  </div>
</div>
<div id="scr-relic" class="screen dim" hidden>
  <h1>${t("text.pick_a_relic_754306")}</h1>
  <p class="note">${t("text.the_secret_merchant_gives_you_one_for_free_relic_1cdf8d")}</p>
  <div class="relic-offers"></div>
  <div class="section relic-owned-title"></div>
  <div class="relic-owned mod-strip"></div>
</div>
<div id="scr-wait" class="screen dim" hidden>
  <h1>${t("text.waiting_1869d5")}</h1>
  <p class="note">${t("text.your_teammates_are_still_choosing_c955ce")}</p>
  <div class="who"></div>
</div>
<div id="scr-shop" class="screen dim" hidden>
  <h1>${t("text.shop_7e0e61")}</h1>
  <div class="shop-top"></div>
  <div class="shop-offers"></div>
  <div class="menu row shop-extras"></div>
  <div class="section owned-title"></div>
  <div class="owned-mods"></div>
  <div class="section relic-title"></div>
  <div class="shop-relics"></div>
</div>
<div id="scr-unlocks" class="screen dim" hidden>
  <h1>${t("text.unlocks_88da64")}</h1>
  <p class="note">${t("text.achievements_carry_over_between_runs_some_add_ne_1611a2")}</p>
  <div class="scroll">
    <div class="ach-list"></div>
  </div>
  <div class="menu row">
    <button data-nav data-act="savedata">${t("text.save_data_ac3268")}</button>
    <button data-nav data-act="ul-back">${t("text.back_1dd26f")}</button>
  </div>
</div>
<div id="scr-savedata" class="screen dim" hidden>
  <h1>${t("text.save_data_ac3268")}</h1>
  <p class="note">${t("text.your_progress_saves_by_itself_to_back_it_up_or_m_dbc518")}</p>
  <input id="save-file" type="file" accept=".json,.txt,application/json" hidden />
  <div class="msg"></div>
  <div class="menu row wrap">
    <button data-nav data-act="export">${t("text.save_to_file_12f46f")}</button>
    <button data-nav data-act="import">${t("text.load_from_file_56e00a")}</button>
    <button data-nav data-act="wipe">${t("text.reset_save_0c87fa")}</button>
    <button data-nav data-act="sd-back">${t("text.back_1dd26f")}</button>
  </div>
</div>
<div id="scr-modes" class="screen dim" hidden>
  <h1>${t("text.play_solo_de1316")}</h1>
  <div class="section">${t("text.hero_94d8cb")}</div>
  <div class="menu row hero-row"></div>
  <div class="note hero-note"></div>
  <div class="section">${t("text.mode_b742db")}</div>
  <div class="mode-grid"></div>
  <div class="section">${t("text.difficulty_5753f4")}</div>
  <div class="menu row diff-row"></div>
  <div class="note mode-note"></div>
  <div class="menu row">
    <button data-nav data-act="heat">${t("text.heat_0e188d")}</button>
    <button data-nav data-act="weekly">${t("text.weekly_rules_9b0001")}</button>
    <button data-nav data-act="play" class="continue">NEXT: LOADOUT &#9654;</button>
    <button data-nav data-act="md-back">${t("text.back_1dd26f")}</button>
  </div>
</div>
<div id="scr-extras" class="screen dim" hidden>
  <h1>${t("text.extras_60d4e6")}</h1>
  <div class="menu">
    <button data-nav data-act="wardrobe">${t("text.wardrobe_b81c76")}</button>
    <button data-nav data-act="rewards">${t("text.souvenirs_fd09f5")}</button>
    <button data-nav data-act="history">${t("text.run_history_f7cf1b")}</button>
    <button data-nav data-act="bestiary">${t("text.enemy_guide_089bd7")}</button>
    <button data-nav data-act="jukebox">${t("text.jukebox_fe41c7")}</button>
    <button data-nav data-act="ex-back">${t("text.back_1dd26f")}</button>
  </div>
</div>
<div id="scr-history" class="screen dim" hidden>
  <h1>${t("text.run_history_f7cf1b")}</h1>
  <div class="scroll"><table class="history"></table></div>
  <div class="menu row"><button data-nav data-act="ex-sub-back">${t("text.back_1dd26f")}</button></div>
</div>
<div id="scr-bestiary" class="screen dim" hidden>
  <h1>${t("text.enemy_guide_089bd7")}</h1>
  <div class="menu row"><button data-nav data-act="codex">${t("text.codex_lore_bef466")}</button></div>
  <p class="note bst-count"></p>
  <div class="scroll"><div class="bestiary"></div></div>
  <div class="menu row"><button data-nav data-act="ex-sub-back">${t("text.back_1dd26f")}</button></div>
</div>
<div id="scr-jukebox" class="screen dim" hidden>
  <h1>${t("text.jukebox_fe41c7")}</h1>
  <p class="note">${t("text.every_tune_is_composed_on_the_fly_reach_new_area_e6de71")}</p>
  <div class="now-playing"></div>
  <div class="menu tracks"></div>
  <div class="menu row">
    <button data-nav data-act="jb-stop">${t("text.stop_615a46")}</button>
    <button data-nav data-act="jb-back">${t("text.back_1dd26f")}</button>
  </div>
</div>
<div id="scr-wardrobe" class="screen" hidden>
  <h1>${t("text.wardrobe_b81c76")}</h1>
  <p class="note">${t("text.skins_unlock_with_achievements_in_co_op_your_arm_c1a857")}</p>
  <div class="skin-grid"></div>
  <div class="section">${t("text.pets_22e23a")}</div>
  <div class="skin-grid pet-grid"></div>
  <div class="menu row">
    <button data-nav data-act="wd-back">${t("text.back_1dd26f")}</button>
  </div>
</div>
<div id="scr-gameover" class="screen dim" hidden>
  <h1 class="ko">K.O.!</h1>
  <div class="newbest" hidden>${t("text.new_high_score_3f07c6")}</div>
  <div class="go-cols">
    <div class="summary"></div>
    <div class="dmg-table"></div>
  </div>
  <div class="build"></div>
  <div class="unlocked"></div>
  <div class="menu row">
    <button data-nav data-act="retry">${t("text.retry_c0cc02")}</button>
    <button data-nav data-act="title">${t("text.title_6f9dcc")}</button>
  </div>
  <div class="hiscores"></div>
  <div class="hiscores global" hidden></div>
</div>
<div id="scr-route" class="screen dim" hidden></div>`),
    );
    root.insertAdjacentHTML('beforeend', localizeHtml(metaScreenHtml));
    applyMetaTheme();
    const names: Named[] = ['title', 'pause', 'levelup', 'shop', 'unlocks', 'savedata', 'gameover', 'online', 'wait', 'loadout', 'extras', 'jukebox', 'wardrobe', 'modes', 'controls', 'history', 'bestiary', 'relic', ...META_SCREENS, 'route'];
    for (const n of names) this.els[n] = root.querySelector<HTMLElement>(`#scr-${n}`)!;
    this.navs = {
      title: new MenuNav(this.els.title),
      pause: new MenuNav(this.els.pause, { onBack: () => actions.resume() }),
      levelup: new MenuNav(this.els.levelup, { horizontal: true }),
      shop: new MenuNav(this.els.shop, { columns: 4 }),
      relic: new MenuNav(this.els.relic, { horizontal: true }),
      unlocks: new MenuNav(this.els.unlocks, { horizontal: true, onBack: () => actions.title() }),
      savedata: new MenuNav(this.els.savedata, { horizontal: true, onBack: () => this.show('unlocks') }),
      gameover: new MenuNav(this.els.gameover, { horizontal: true, onBack: () => actions.title() }),
      online: new MenuNav(this.els.online, { onBack: () => actions.mpLeave() }),
      wait: new MenuNav(this.els.wait),
      loadout: new MenuNav(this.els.loadout, { columns: 5, onBack: () => this.loadoutBack() }),
      extras: new MenuNav(this.els.extras, { columns: 3, onBack: () => actions.title() }),
      jukebox: new MenuNav(this.els.jukebox, { columns: 2, onBack: () => this.show('extras') }),
      wardrobe: new MenuNav(this.els.wardrobe, { columns: 3, onBack: () => this.show('extras') }),
      modes: new MenuNav(this.els.modes, { columns: 4, onBack: () => actions.title() }),
      controls: new MenuNav(this.els.controls, { columns: 2, onBack: () => this.show('settings') }),
      history: new MenuNav(this.els.history, { onBack: () => this.show('extras') }),
      heat: new MenuNav(this.els.heat, { columns: 3, onBack: () => this.show(this.metaReturn) }),
      weekly: new MenuNav(this.els.weekly, { onBack: () => this.show('modes') }),
      codex: new MenuNav(this.els.codex, { columns: 3, onBack: () => this.show('bestiary') }),
      rewards: new MenuNav(this.els.rewards, { columns: 3, onBack: () => this.show('extras') }),
      bestiary: new MenuNav(this.els.bestiary, { onBack: () => this.show('extras') }),
      route: new MenuNav(this.els.route, { horizontal: true }),
    };
    this.route = new RouteMapView(this.els.route, (i) => this.onRoutePick?.(i));

    // Keep buttons from taking DOM focus on click, so Enter/Space don't fire twice.
    root.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('button')) e.preventDefault();
    });

    root.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!btn) return;
      if (metaAction(btn.dataset.act ?? '', btn.dataset.id ?? '')) {
        if (btn.dataset.act === 'meta-reward') { actions.skinChanged(); actions.loadoutChanged(); }
        renderMeta(this.els[this.current as MetaScreen], this.current as MetaScreen);
        this.navs[this.current as MetaScreen].refresh(this.navs[this.current as MetaScreen].focus);
        return;
      }
      switch (btn.dataset.act) {
        case 'heat': this.metaReturn = this.current; return this.show('heat');
        case 'weekly': return this.show('weekly');
        case 'codex': return this.show('codex');
        case 'rewards': return this.show('rewards');
        case 'meta-back': return this.show(this.current === 'heat' ? this.metaReturn : this.current === 'weekly' ? 'modes' : this.current === 'codex' ? 'bestiary' : 'extras');
        case 'meta-weekly': settings.mode = 'weekly'; saveSettings(); return actions.start();
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
          if (this.banishArmed && btn.classList.contains('ban-no')) return sfx.deny();
          return this.canPick(Number(btn.dataset.index)) ? actions.pick(Number(btn.dataset.index)) : undefined;
        case 'banish':
          return this.toggleBanish(btn);
        case 'lock':
          return actions.lockOffer(Number(btn.dataset.index));
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
        case 'mod-right': {
          const i = Number(btn.dataset.index);
          const d = btn.dataset.act === 'mod-left' ? -1 : 1;
          // Focus follows the Mod, and the preview compares against the order before the move.
          this.shopFollow = { act: btn.dataset.act, index: i + d };
          this.movedFrom = this.shopShown?.preview?.now ?? null;
          return actions.moveMod(i, d);
        }
        case 'shop-reroll':
          return actions.shopReroll();
        case 'shop-heal':
          return actions.shopHeal();
        case 'take-curse':
          return actions.takeCurse();
        case 'buy-relic':
          return actions.buyRelic(Number(btn.dataset.index));
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
          btn.textContent = localize('PRESS A KEY');
          btn.classList.add('wait');
          return;
        }
        case 'md-back':
          return actions.title();
        case 'g-up': case 'g-down': case 'g-ng': case 'g-title': case 'g-records':
          gauntletOption(btn.dataset.act!, this);
          if (this.current === 'modes') this.renderModes();
          return;
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
          return actions.mpKind((['pvp', 'versus', 'weekly'] as const).find((k) => k === btn.dataset.kind) ?? 'coop');
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

    this.settingsScreen = new SettingsScreen(this, () => this.show(this.settingsReturn), () => this.show('controls'));
    this.modsScreen = new ModsScreen(this);
    this.titleMenu = new TitleMenu(root, this);
  }

  /** Register a screen built elsewhere (its element is added to the menu root). */
  addScreen(name: ExtraScreen, el: HTMLElement, opts: ConstructorParameters<typeof MenuNav>[1] | MenuNav = {}): void {
    el.hidden = true;
    this.root.appendChild(el);
    this.extra[name] = { el, nav: opts instanceof MenuNav ? opts : new MenuNav(el, opts) };
  }

  nav(name: Exclude<ScreenName, 'none'>): MenuNav {
    return this.extra[name as ExtraScreen]?.nav ?? this.navs[name as Named];
  }

  private metaReturn: ScreenName = 'modes';
  private readonly menuFocus = new Map<ScreenName, number>();

  show(name: ScreenName, focus?: number): void {
    name = this.titleMenu.destination(name, this.current);
    const previous = this.current;
    // A text field on the screen we hide must not keep swallowing menu keys.
    if (previous !== name && this.root.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    if (previous !== 'none' && previous !== name) this.menuFocus.set(previous, this.nav(previous).focus);
    this.current = name;
    for (const [k, el] of Object.entries(this.els)) el.hidden = k !== name;
    for (const [k, x] of Object.entries(this.extra)) x.el.hidden = k !== name;
    // Hide in-game banners and toasts behind menus.
    this.root.classList.toggle('menu-open', name !== 'none');
    if (META_SCREENS.includes(name as MetaScreen)) renderMeta(this.els[name as MetaScreen], name as MetaScreen);
    if (name === 'settings') this.settingsScreen.open();
    if (name === 'contentmods') this.modsScreen.open();
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
      this.els.savedata.querySelector<HTMLElement>('[data-act=wipe]')!.textContent = localize('RESET SAVE');
    }
    if (name !== 'none') {
      const el = this.extra[name as ExtraScreen]?.el ?? this.els[name as Named];
      el.setAttribute('role', 'region');
      el.setAttribute('aria-label', el.querySelector('h1')?.textContent?.trim() || name);
    }
    this.onShow?.(name);
    this.titleMenu.show(name);
    if (name !== 'none') polishMenuScreen(this.extra[name as ExtraScreen]?.el ?? this.els[name as Named]);
    if (name !== 'none') relocalizeDom(this.extra[name as ExtraScreen]?.el ?? this.els[name as Named], 'en');
    if (name !== 'none') this.nav(name).refresh(focus ?? (name === 'settings' ? this.settingsScreen.selectedTab : name === 'levelup' ? 1 : this.menuFocus.get(name) ?? 0));
  }

  /** Route map between stages (src/ui/routeMap.ts); `statusOnly` just refreshes the countdown. */
  route!: RouteMapView;
  onRoutePick: ((i: number) => void) | null = null;
  showRoute(v: RouteView, statusOnly = false): void {
    if (statusOnly && this.current === 'route') return this.route.setStatus(v);
    const focus = this.current === 'route' ? this.navs.route.focus : 0;
    this.route.render(v);
    this.show('route', focus);
  }

  update(input: Input, dt: number): void {
    if (this.current === 'settings') this.settingsScreen.update(input, dt);
    else if (this.current !== 'none') this.nav(this.current).update(input, dt);
    this.tickReels(dt);
    this.tickLock();
    if (this.current === 'shop' && this.shopKey() !== this.pvKey) {
      this.movedFrom = null;
      this.renderShopPreview();
    }
  }

  // ---------------------------------------------------------------- loadout

  /** Where the loadout screen goes back to: the title (solo) or the online lobby. */
  private loadoutFor: 'solo' | 'online' = 'solo';

  showLoadout(forWhat: 'solo' | 'online'): void {
    this.loadoutFor = forWhat;
    const el = this.els.loadout;
    el.querySelector<HTMLElement>('[data-act=lo-start]')!.innerHTML = localizeHtml(forWhat === 'solo' ? 'START &#9654;' : 'DONE');
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
    this.els.loadout.querySelector('.lo-rows')!.innerHTML = localizeHtml(rows
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
              <div class="desc">${localize(d.desc).replace(/^(LEFT|RIGHT) CLICK: |^الزر (الأيسر|الأيمن): /, '')}</div>
            </button>`;
          })
          .join('');
        // Hero kits (Ronin, Tinker) replace a click: say so on its row (src/data/heroWeapons.ts).
        const hk = HEROES.find((x) => x.id === settings.hero)?.clicks?.[slot as 'primary' | 'secondary'];
        const kitNote = hk ? ` · ${(HEROES.find((x) => x.id === settings.hero)?.name ?? '').toUpperCase()} USES ${WEAPONS[hk]?.name.toUpperCase()}` : '';
        return `<div class="lo-row"><div class="lo-label">${label}${kitNote}</div><div class="lo-cards">${cards}</div></div>`;
      })
      .join(''));
  }

  // ---------------------------------------------------------------- online

  private get nameField(): HTMLInputElement {
    return this.els.online.querySelector<HTMLInputElement>('#mp-name')!;
  }

  showOnline(name: string): void {
    this.nameField.value = name;
    mountRelayField(this.els.online); // CUSTOM RELAY (TURN), src/ui/relayField.ts
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
    showRelayField(el, !inLobby);
    el.querySelector('.code-big')!.textContent = v.code;
    el.querySelector('.players')!.innerHTML = localizeHtml(v.players
      .map((p, i) => `<div class="lobby-player" style="--c:${p.color}"><span class="dot"></span><bdi>${p.name}</bdi>${p.pf ? ` <small class="pf" style="--pf:${p.pf.banner}">LV ${p.pf.lv} ${p.pf.title.toUpperCase()}</small>` : ''}${i === 0 ? ' <small>HOST</small>' : ''}${p.kit ? ` <small class="kit">${p.kit}</small>` : ''}</div>`)
      .join(''));
    el.querySelector<HTMLElement>('.mp-heat')!.hidden = !(v.isHost && v.code && (v.kind ?? 'coop') === 'coop');
    el.querySelector<HTMLElement>('[data-act=mp-start]')!.hidden = !(v.isHost && v.code);
    // Difficulty: the host picks it; everyone else sees the choice.
    const pick = DIFFICULTIES.find((d) => d.id === v.difficulty) ?? DIFFICULTIES[1];
    el.querySelector('.mp-diff-row')!.innerHTML = localizeHtml(DIFFICULTIES.map((d) => {
      const open = !d.unlock || save.achievements.includes(d.unlock);
      const lock = v.isHost && !open;
      return `<button ${v.isHost ? 'data-nav' : ''} data-act="mp-diff" data-diff="${d.id}" class="diff ${d.id === pick.id ? 'on' : ''} ${lock ? 'locked' : ''}" ${v.isHost ? '' : 'disabled'}>${lock ? '🔒 ' : ''}${d.name.toUpperCase()}</button>`;
    }).join(''));
    el.querySelector('.mp-diff-note')!.textContent = localize(`${pick.desc}${v.isHost ? '' : ' The host picks the difficulty.'}`);
    // Game type: co-op, or PvP (everyone plays the same stage alone, then a last-one-standing duel).
    const kind = v.kind ?? 'coop';
    const kindName = { coop: 'CO-OP', pvp: 'PVP', versus: 'VERSUS', weekly: 'WEEKLY' };
    el.querySelector('.mp-kind-row')!.innerHTML = localizeHtml((['coop', 'pvp', 'versus', 'weekly'] as const)
      .map((k) => `<button ${v.isHost ? 'data-nav' : ''} data-act="mp-kind" data-kind="${k}" class="diff ${k === kind ? 'on' : ''}" ${v.isHost ? '' : 'disabled'}>${kindName[k]}</button>`)
      .join(''));
    el.querySelector('.mp-kind-note')!.textContent =
      localize(kind === 'pvp'
        ? 'Everyone plays the same stage alone and builds up, then all of you fight in one arena. Last one standing wins.'
        : kind === 'versus'
          ? 'Versus Swarm: one player is the Overlord and sends the waves from above; the rest survive the timer and beat the boss.'
          : kind === 'weekly'
            ? "Weekly co-op: this week's seed and rules for every team, a Rookie kit each, and a team board."
            : 'Play the run together. Team XP, your own gold, shop and Mods.');
    el.querySelector('.mp-status')!.textContent = localize(v.status);
    this.onLobby?.(el, v);
    relocalizeDom(el, 'en');
    if (this.current !== 'online') this.show('online');
    else this.navs.online.refresh(this.navs.online.focus);
  }

  showWait(who: string[], note = 'Your teammates are still choosing:'): void {
    this.els.wait.querySelector('.note')!.textContent = localize(note);
    this.els.wait.querySelector('.who')!.innerHTML = localizeHtml(who.map((n) => `<div class="lobby-player"><span class="dot"></span><bdi>${n}</bdi></div>`).join(''));
    this.show('wait');
  }

  // ---------------------------------------------------------------- title / scores

  /** Title screen: how many achievements are done. */
  private renderProgress(): void {
    const done = ACHIEVEMENTS.filter((a) => save.achievements.includes(a.id)).length;
    this.els.title.querySelector('.wallet')!.textContent = localize(`★ ${done} / ${ACHIEVEMENTS.length} UNLOCKED`);
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
            .map((e, i) => `<tr class="${i === highlight ? 'me' : ''}"><td>${i + 1}</td><td><bdi>${e.name}</bdi></td><td>${fmtScore(e.score)}</td><td>STAGE ${e.stage}</td></tr>`)
            .join('')
        : '<tr><td colspan="4">No scores yet. Be the first!</td></tr>';
      box.innerHTML = localizeHtml(`<div class="hs-title">GLOBAL · ${title}</div><table>${rows}</table>`);
    }
  }

  setHighScores(list: ScoreEntry[], highlight = -1): void {
    const rows = list.length
      ? list
          .slice(0, 5)
          .map((e, i) => `<tr class="${i === highlight ? 'me' : ''}"><td>${i + 1}</td><td>${fmtScore(e.score)}</td><td>STAGE ${e.stage}${e.label ? `<small> ${e.label}</small>` : ''}</td></tr>`)
          .join('')
      : '<tr><td colspan="3">No scores yet. Go set one!</td></tr>';
    const html = `<div class="hs-title">${t("text.high_scores_aaa66f")}</div><table>${rows}</table>`;
    for (const el of [this.els.title, this.els.gameover]) el.querySelector('.hiscores')!.innerHTML = localizeHtml(html);
  }

  // ---------------------------------------------------------------- level-up

  /** `banish`: banishes left (-1 hides the button). */
  showLevelUp(offers: Offer[], title: string, rerolls: number, loadout: LoadoutItem[], skipGold = 0, banish = -1): void {
    const el = this.els.levelup;
    el.querySelector('h1')!.textContent = localize(title);
    // A banish redraw keeps the other cards still; only new cards spin.
    const ids = offers.map((o) => `${o.kind}|${o.id}|${o.pick ?? ''}|${o.tag}`);
    const redraw = this.current === 'levelup' && this.shownOffers.length === ids.length && ids.some((k, i) => k === this.shownOffers[i]);
    const kept = ids.map((k, i) => redraw && k === this.shownOffers[i]);
    this.shownOffers = ids;
    this.banishArmed = false;
    el.classList.remove('banishing');
    // Each icon rolls like a slot reel; cards land left to right, a legendary spins longer and slows right down.
    const still = reduceMotion();
    const steps = offers.map((o, i) => {
      if (still || kept[i]) return [];
      const legend = o.rarity === 'legendary';
      return reelSteps(0.45 + 0.25 * i + (legend ? 1.5 : 0), legend ? [0.06, 0.08, 0.1, 0.13, 0.17, 0.22, 0.3, 0.4] : [0.07, 0.1]);
    });
    el.querySelector('.cards')!.innerHTML = localizeHtml(offers
      .map(
        (o, i) => `<button class="card rolling ${o.kind} ${o.rarity ? 'r-' + o.rarity : ''} ${cardMode(o)} ${canBanish(o) ? 'ban-ok' : 'ban-no'}" data-nav data-act="pick" data-index="${i}">
          <i class="fx"></i><i class="card-shine" aria-hidden="true"></i>
          <div class="tag ${cardMode(o)}">${cardMode(o) === 'upgrade' ? '▲ UPGRADE' : o.tag}</div>
          ${cardMode(o) === 'new' ? '<div class="ribbon">NEW</div>' : ''}
          <div class="icon" style="--c:${o.color}"><div class="reel"><div class="strip">${iconHtml(o.id, o.color, o.icon)}${decoys(steps[i].length, o.id)
            .map((d) => iconHtml(d.id, d.color, d.icon))
            .join('')}</div></div></div>
          <div class="name">${o.name}</div>
          ${levelPips(o)}
          <div class="desc">${o.text}</div>
          ${numsHtml(o.nums)}
          ${o.tags ? `<div class="chips">${tagChips(o.tags)}</div>` : ''}
          ${o.replaces ? replaceStrip(o.replaces) : ''}
          ${o.partner ? partnerStrip(o.partner) : ''}
          ${o.fuses ? fuseStrip(o.fuses) : ''}
          <div class="kind"><span class="r-text-${o.rarity ?? 'common'}">${o.rarity ? RARITY[o.rarity].label : ''}</span>${o.label ? ` · ${o.label}` : ''}</div>
          ${o.slot ? `<div class="slot-ribbon s-${o.slot}">${slotPicto(o.slot)}${SLOT_LABEL[o.slot]}</div>` : ''}
          <div class="key" data-prompt="pick:${i + 1}">${promptHtml(`pick:${i + 1}`)}</div>
          <i class="lock"></i>
          <i class="ban-stamp">${t("text.banish_33c75f")}</i>
        </button>`,
      )
      .join(''));
    el.querySelector('.reroll-row')!.innerHTML =
      localizeHtml((rerolls > 0 ? `<button data-nav data-act="reroll">REROLL ⚙ ${rerolls} ${prompt('reroll')}</button>` : '') +
      (skipGold > 0 ? `<button data-nav data-act="skip" class="skip">SKIP +${skipGold}<span class="gold-dot"></span></button>` : '') +
      (banish >= 0 ? `<button data-nav data-act="banish" class="banish ${banish > 0 && offers.some(canBanish) ? '' : 'cant'}">BANISH ✕${banish}</button>` : ''));
    el.querySelector('.build')!.innerHTML = localizeHtml(loadout.map(badge).join(''));
    this.show('levelup');
    if (!redraw) {
      el.classList.remove('hud-level-enter');
      void el.offsetWidth;
      el.classList.add('hud-level-enter');
    }
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

  /** BANISH: arm (the next card picked is banished) or disarm. */
  private toggleBanish(btn: HTMLElement): void {
    if (btn.classList.contains('cant') && !this.banishArmed) return sfx.deny();
    this.banishArmed = !this.banishArmed;
    this.els.levelup.classList.toggle('banishing', this.banishArmed);
    btn.classList.toggle('armed', this.banishArmed);
    if (this.banishArmed) sfx.reroll();
  }

  /** A detached visual keeps the pick satisfying without delaying gameplay or network messages. */
  pickFx(i: number): void {
    if (!this.canPick(i) || reduceMotion()) return;
    const card = this.els.levelup.querySelectorAll<HTMLElement>('.card')[i];
    if (!card) return;
    this.pickGhost?.remove();
    const rect = card.getBoundingClientRect();
    const layer = document.createElement('div');
    layer.className = 'screen hud-pick-layer';
    layer.setAttribute('aria-hidden', 'true');
    const ghost = card.cloneNode(true) as HTMLElement;
    ghost.removeAttribute('data-nav');
    ghost.removeAttribute('data-act');
    ghost.setAttribute('tabindex', '-1');
    ghost.classList.add('hud-picked-card');
    ghost.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;margin:0`;
    layer.appendChild(ghost);
    document.body.appendChild(layer);
    this.pickGhost = layer;
    burstAt(card, ['var(--yellow)', 'var(--white)', 'var(--cyan)'], 12);
    // Timer cleanup also works if a motion preference changes mid-animation.
    window.setTimeout(() => {
      layer.remove();
      if (this.pickGhost === layer) this.pickGhost = null;
    }, 420);
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
    relics: RelicDef[] = [],
  ): void {
    const chip = (x: (typeof extras)[number]) =>
      `<span class="mod-chip ${x.curse ? 'cursed' : ''}" style="--c:${x.color}" title="${x.desc}">${iconHtml(x.id, x.color, x.icon)}${x.name}</span>`;
    this.els.pause.querySelector('.build')!.innerHTML =
      localizeHtml(loadout.map(badge).join('') +
      (mods.length ? `<div class="mod-strip">${mods.map(modChip).join('')}</div>` : '') +
      (relics.length ? `<div class="mod-strip relics"><b class="strip-t">${t("text.relics_4258f8")}</b>${relics.map(relicChip).join('')}</div>` : '') +
      (extras.length ? `<div class="mod-strip">${extras.map(chip).join('')}</div>` : ''));
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
      localizeHtml((recipes ? `<div class="pi-col"><div class="pi-t">${t("text.evolutions_f392a9")}</div>${recipes}</div>` : '') +
      (bars ? `<div class="pi-col"><div class="pi-t">${t("text.damage_this_run_7a0587")}</div>${bars}</div>` : ''));
  }

  // ---------------------------------------------------------------- shop

  private showRelicPick(v: ShopView): void {
    const el = this.els.relic;
    el.querySelector('.relic-offers')!.innerHTML = localizeHtml(v.relicOffers
      .map(
        (r, i) => `<button class="mod-card ${r.rarity} r-${r.rarity} relic-deal" data-nav data-act="buy-relic" data-index="${i}">
          <div class="rarity">${RARITY[r.rarity].label} RELIC</div>
          <div class="icon" style="--c:${r.color}">${iconHtml(r.id, r.color, r.icon)}</div>
          <div class="name">${r.name}</div>
          <div class="desc">${r.desc}</div>
          <div class="price">${t("text.take_free_41178a")}</div>
        </button>`,
      )
      .join(''));
    const owned = v.relics.filter((id) => RELIC_BY_ID[id]);
    el.querySelector('.relic-owned-title')!.textContent = localize(owned.length ? `YOUR RELICS ${owned.length}` : '');
    el.querySelector('.relic-owned')!.innerHTML = localizeHtml(owned.map((id) => relicChip(RELIC_BY_ID[id])).join(''));
    if (this.current !== 'relic') sfx.shopOpen();
    this.show('relic', 0);
  }

  showShop(v: ShopView, focus?: number): void {
    // The secret merchant's relic pick comes first, on its own screen, so it can't be missed.
    if (v.relicOffers.length) return this.showRelicPick(v);
    const el = this.els.shop;
    const wasOpen = this.current === 'shop';
    const prevKey = wasOpen ? this.shopKey() : '';
    this.shopShown = v;
    el.querySelector('h1')!.textContent = localize(v.pre ? 'STARTING SHOP' : v.secret ? 'SECRET SHOP' : `STAGE ${v.stage} SHOP`);
    el.classList.toggle('secret', v.secret);
    el.querySelector('.shop-top')!.innerHTML =
      localizeHtml(`<span class="gold-big"><span class="gold-dot"></span> ${v.gold} GOLD</span>` +
      (v.pre
        ? `<span class="interest pre">${t("text.free_15_gold_spend_it_now_it_isn_t_kept_c48dff")}</span>`
        : `<span class="interest">Interest next clear: +${v.interest} (1 per ${v.interestPer} held, max ${v.interestCap})</span>`));
    el.querySelector('.shop-offers')!.innerHTML = localizeHtml(v.offers
      .map((o, i) => {
        if (!o) return `<div class="offer-slot"><div class="mod-card sold">${t("text.sold_8a563f")}</div></div>`;
        const m = o.def;
        const cant = o.price > v.gold || v.owned.length >= v.slots;
        // Shop lane: each offer sits over its LOCK toggle, and shows its effect on this build.
        return `<div class="offer-slot ${o.locked ? 'locked' : ''}"><button class="mod-card ${m.rarity} r-${m.rarity} ${m.cursed ? 'cursed' : ''} ${cant ? 'cant' : ''}" data-nav data-act="buy" data-index="${i}">
          <div class="rarity">${m.cursed ? 'CURSED' : m.rarity.toUpperCase()}</div>
          <div class="icon" style="--c:${m.color}">${iconHtml(m.id, m.color, m.icon)}</div>
          <div class="name">${m.name}</div>
          <div class="desc">${modDesc(m)}</div>
          ${modMaxLevel(m) > 1 ? `<div class="mod-ups">UPGRADES IN SHOP TO LV ${modMaxLevel(m)}</div>` : ''}
          ${m.synergy ? `<div class="chips">${tagChips(m.synergy)}</div>` : ''}
          ${o.hint ? `<div class="hint">${o.hint}</div>` : ''}
          ${numsHtml([...buyDamageNums(v.preview, i), ...(o.nums ?? [])].slice(0, 3))}
          <div class="price"><span class="gold-dot"></span> ${o.price}</div>
        </button><button data-nav data-act="lock" data-index="${i}" class="lock ${o.locked ? 'on' : ''}">${o.locked ? '■ LOCKED' : '□ LOCK'}</button></div>`;
      })
      .join(''));
    const c = v.curse;
    const curseCard = c
      ? `<button class="mod-card curse-deal cursed" data-nav data-act="take-curse">
          <div class="rarity">${t("text.curse_deal_4cb8be")}</div>
          <div class="icon" style="--c:${c.color}">${iconHtml(c.id, c.color, c.icon)}</div>
          <div class="name">${c.name}</div>
          <div class="desc">${c.desc}</div>
          <div class="hint">For the rest of the run. Score +${Math.round(c.score * 100)}%</div>
          <div class="price">${t("text.take_a4babe")}<span class="gold-dot"></span> ${c.gold}</div>
        </button>`
      : '';
    el.querySelector('.shop-offers')!.insertAdjacentHTML('beforeend', localizeHtml(curseCard));
    // Owned relics get their own section: always on, and they don't take a Mod slot.
    const owned = v.relics.filter((id) => RELIC_BY_ID[id]).map((id) => relicChip(RELIC_BY_ID[id])).join('');
    el.querySelector('.relic-title')!.textContent = localize(owned ? `YOUR RELICS ${v.relics.length} — always on, no Mod slot` : '');
    el.querySelector('.shop-relics')!.innerHTML = localizeHtml(owned ? `<div class="mod-strip">${owned}</div>` : '');
    el.querySelector('.shop-extras')!.innerHTML =
      localizeHtml(`<button data-nav data-act="shop-reroll" class="${v.rerollCost > v.gold ? 'cant' : ''}">REROLL ${v.rerollCost ? `<span class="gold-dot"></span> ${v.rerollCost}` : 'FREE'}</button>` +
      `<button data-nav data-act="shop-heal" class="${v.healed || v.healCost > v.gold ? 'cant' : ''}">${t("text.heal_40_da23d4")} <span class="gold-dot"></span> ${v.healCost}</button>` +
      `<button data-nav data-act="shop-done" class="continue">CONTINUE &#9654;</button>`);
    el.querySelector('.owned-title')!.textContent = localize(`YOUR MODS ${v.owned.length}/${v.slots} — damage flows left to right`);
    const empty = Math.max(0, v.slots - v.owned.length);
    el.querySelector('.owned-mods')!.innerHTML =
      localizeHtml(v.owned
        .map(
          (o, i) => `<div class="owned-mod ${o.def.cursed ? 'cursed' : ''}" title="${modDesc(o.def, o.level)}">
          <div class="slot-no">${i + 1}</div>
          <div class="icon" style="--c:${o.def.color}">${iconHtml(o.def.id, o.def.color, o.def.icon)}</div>
          <div class="name">${o.def.name}${o.maxLevel > 1 ? ` <span class="mod-lv">LV ${o.level}/${o.maxLevel}</span>` : ''}</div>
          <div class="desc">${modDesc(o.def, o.level)}</div>
          ${o.readout ? `<div class="readout">${o.readout}</div>` : ''}
          ${o.upCost >= 0 ? `<div class="mod-next"><i>NEXT LV ${o.level + 1}:</i> ${nextLevelHtml(o.def, o.level)}</div>` : ''}
          ${o.upCost >= 0 ? `<button data-nav data-act="mod-up" data-index="${i}" class="mod-up ${o.upCost > v.gold ? 'cant' : ''}">${t("text.upgrade_7f10b7")} <span class="gold-dot"></span> ${o.upCost}</button>` : o.maxLevel > 1 ? '<div class="mod-max">MAX LEVEL</div>' : ''}
          <div class="ctrl">
            <button data-nav data-act="mod-left" data-index="${i}" ${i === 0 ? 'disabled' : ''}>&#9664;</button>
            <button data-nav data-act="mod-right" data-index="${i}" ${i === v.owned.length - 1 ? 'disabled' : ''}>&#9654;</button>
            <button data-nav data-act="sell" data-index="${i}" class="sell">SELL +${o.sell}</button>
          </div>
        </div>`,
        )
        .join('') + '<div class="owned-mod empty"></div>'.repeat(empty));
    // Mod order preview: lives between the YOUR MODS title and the slots.
    let pv = el.querySelector<HTMLElement>('.mod-preview');
    if (!pv) {
      pv = Object.assign(document.createElement('div'), { className: 'mod-preview px' });
      el.querySelector('.owned-mods')!.before(pv);
    }
    pv.hidden = !v.preview;
    this.show('shop', this.shopFocus(prevKey, focus));
    this.shopFollow = null;
    this.pvKey = '';
    this.renderShopPreview();
    // Gold changes pop a +/- number over the counter.
    const delta = wasOpen && this.shopGold >= 0 ? v.gold - this.shopGold : 0;
    this.shopGold = v.gold;
    if (delta) {
      const gold = el.querySelector<HTMLElement>('.gold-big')!;
      replay(gold, 'bump');
      floatText(gold, `${delta > 0 ? '+' : ''}${delta}`, delta > 0 ? 'var(--yellow)' : 'var(--orange)');
    }
  }

  /** Which shop control has focus: "act:index". */
  private shopKey(): string {
    const f = this.navs.shop.element;
    return f ? `${f.dataset.act}:${f.dataset.index ?? ''}` : '';
  }

  /**
   * Nav index to focus after the shop re-renders: the moved Mod's arrow, the
   * same control as before, or (after a buy) the next offer still for sale.
   */
  private shopFocus(prevKey: string, buyIndex?: number): number {
    const items = [...this.els.shop.querySelectorAll<HTMLElement>('[data-nav]')].filter(menuItemAvailable);
    const find = (act: string, i: number) => items.findIndex((b) => b.dataset.act === act && Number(b.dataset.index) === i);
    if (this.shopFollow) {
      const k = find(this.shopFollow.act, this.shopFollow.index);
      if (k >= 0) return k;
      const other = find(this.shopFollow.act === 'mod-left' ? 'mod-right' : 'mod-left', this.shopFollow.index);
      if (other >= 0) return other;
    }
    if (buyIndex !== undefined) {
      const k = items.findIndex((b) => b.dataset.act === 'buy' && Number(b.dataset.index) >= buyIndex);
      return k >= 0 ? k : Math.max(0, items.findIndex((b) => b.dataset.act === 'buy'));
    }
    if (prevKey) {
      const [act, i] = prevKey.split(':');
      const k = items.findIndex((b) => b.dataset.act === act && (b.dataset.index ?? '') === i);
      if (k >= 0) return k;
    }
    return 0;
  }

  /** The order preview for whatever has focus: the current order, or what a buy / move / upgrade / sell would do. */
  private renderShopPreview(): void {
    const el = this.els.shop;
    const box = el.querySelector<HTMLElement>('.mod-preview');
    this.pvKey = this.shopKey();
    const v = this.shopShown;
    const p = v?.preview;
    if (!box || !v || !p) return;
    const [act, si] = this.pvKey.split(':');
    const i = Number(si);
    const owned = v.owned[i];
    let f: PreviewFocus = { title: v.owned.length ? 'YOUR MODS NOW: WHAT A HIT BECOMES' : 'NO MODS YET: HITS DEAL x1.00' };
    let before: PreviewRow[] | undefined;
    if (this.movedFrom) {
      f = { title: 'NEW ORDER', after: p.now };
      before = this.movedFrom;
    } else if ((act === 'buy' || act === 'lock') && v.offers[i]) {
      f = { title: `IF YOU BUY ${v.offers[i]!.def.name.toUpperCase()}`, after: p.buy[i], note: p.buy[i] ? '' : 'MOD SLOTS FULL: SELL ONE FIRST' };
    } else if ((act === 'mod-left' || act === 'mod-right') && owned) {
      const after = (act === 'mod-left' ? p.left : p.right)[i];
      f = { title: `MOVE ${owned.def.name.toUpperCase()} ${act === 'mod-left' ? 'LEFT' : 'RIGHT'}`, after, note: after ? '' : 'CAN\'T MOVE FURTHER' };
    } else if (act === 'mod-up' && owned) {
      f = { title: `UPGRADE ${owned.def.name.toUpperCase()} TO LV ${owned.level + 1}`, after: p.up[i] };
    } else if (act === 'sell' && owned) {
      f = { title: `SELL ${owned.def.name.toUpperCase()}`, after: p.sell[i] };
    }
    box.innerHTML = localizeHtml(previewPanelHtml(p, f, before));
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
        <td>${r.label}<br><small>HEAT ${r.heat ?? 0} · +${r.bolts ?? 0} BOLTS</small><br><small>${r.hero.toUpperCase()}</small></td>
        <td>STAGE ${r.stage}<br><small>LV ${r.level} · ${fmtTime(r.time)}</small></td>
        <td class="sc">${fmtScore(r.score)}<br><small>${r.kills.toLocaleString('en-US')} KILLS</small></td>
        <td class="ws">${r.weapons.map((w) => `<span class="badge${w.evo ? ' evo' : ''}" style="--c:${WEAPONS[w.id]?.color ?? '#fff'}">${iconHtml(w.id, WEAPONS[w.id]?.color ?? '#fff', WEAPONS[w.id]?.icon ?? '?')}<i>${w.evo ? 'E' : w.level}</i></span>`).join('')}</td>
        <td class="cause">☠ ${r.cause}</td>
      </tr>`,
    );
    this.els.history.querySelector('.history')!.innerHTML = localizeHtml(rows.length ? rows.join('') : '<tr><td>No runs yet. Go play one!</td></tr>');
  }

  private renderBestiary(): void {
    const all = Object.values(ENEMIES);
    const seen = all.filter((d) => save.seen.includes(d.id));
    this.els.bestiary.querySelector('.bst-count')!.textContent = localize(`${seen.length} / ${all.length} MET`);
    this.els.bestiary.querySelector('.bestiary')!.innerHTML = localizeHtml(all
      .map((d) => {
        if (!save.seen.includes(d.id)) return `<div class="bst unseen"><b>???</b><small>${t("text.not_met_yet_e207f6")}</small></div>`;
        const kind = d.boss ? 'BOSS' : d.biomes ? enemyHome(d.biomes, (b) => BIOMES.find((x) => x.id === b)?.name) : d.minStage ? `FROM STAGE ${d.minStage}` : `FROM MINUTE ${Math.max(0, d.minMinute)}`;
        return `<div class="bst" style="--c:${d.bodyColor}"><i class="sw" style="background:${d.bodyColor}"></i><b>${d.name.toUpperCase()}</b>
          <span class="st">LIFE ${d.hp} · SPEED ${d.speed} · HIT ${d.contactDamage} · ${kind}</span>
          <small>${ENEMY_TIPS[d.id] ?? ''}</small></div>`;
      })
      .join('') + fusionGuide());
  }

  /** Waiting for a key to bind. */
  private capture: { a: Action; slot: 0 | 1 } | null = null;

  private renderControls(): void {
    this.capture = null;
    const el = this.els.controls;
    el.querySelector('.bind-list')!.innerHTML = localizeHtml(ACTIONS.map(
      (a) => `<div class="bind-row"><span>${a.name.toUpperCase()}</span>${[0, 1]
        .map((slot) => `<button data-nav data-act="bind" data-action="${a.id}" data-slot="${slot}"><bdi>${keyLabel(binds[a.id][slot])}</bdi></button>`)
        .join('')}</div>`,
    ).join(''));
    this.navs.controls.refresh(this.navs.controls.focus);
  }

  private renderModes(): void {
    const el = this.els.modes;
    const mode = MODE_BY_ID[settings.mode as ModeId] ?? MODES[0];
    el.querySelector('.hero-row')!.innerHTML = localizeHtml(HEROES.map((hd) => {
      const open = !hd.unlock || save.achievements.includes(hd.unlock);
      const ach = hd.unlock ? ACHIEVEMENTS.find((a) => a.id === hd.unlock) : null;
      return `<button data-nav data-act="hero" data-hero="${hd.id}" class="diff ${settings.hero === hd.id ? 'on' : ''} ${open ? '' : 'locked'}" title="${open ? hd.desc : `Unlock: ${ach?.name ?? ''}`}">${open ? hd.name.toUpperCase() : '🔒 ' + hd.name.toUpperCase()}</button>`;
    }).join(''));
    const hero = HEROES.find((x) => x.id === settings.hero) ?? HEROES[0];
    const heroOpen = !hero.unlock || save.achievements.includes(hero.unlock);
    el.querySelector('.hero-note')!.textContent = localize(heroOpen ? hero.desc.toUpperCase() : `LOCKED: ${ACHIEVEMENTS.find((a) => a.id === hero.unlock)?.desc.toUpperCase() ?? ''}`);
    el.querySelector('.mode-grid')!.innerHTML = localizeHtml(MODES.map(
      (m) => `<button data-nav data-act="mode" data-mode="${m.id}" class="mode ${m.id === mode.id ? 'on' : ''}"><b>${m.name.toUpperCase()}</b><small>${m.desc}</small></button>`,
    ).join(''));
    const daily = mode.id === 'daily' || mode.id === 'weekly';
    el.querySelector('.diff-row')!.innerHTML = localizeHtml(DIFFICULTIES.map((d) => {
      const open = !d.unlock || save.achievements.includes(d.unlock);
      const ach = d.unlock ? ACHIEVEMENTS.find((a) => a.id === d.unlock) : null;
      const on = daily ? d.id === 'normal' : settings.difficulty === d.id;
      return `<button data-nav data-act="diff" data-diff="${d.id}" class="diff ${on ? 'on' : ''} ${open ? '' : 'locked'}" ${daily ? 'disabled' : ''} title="${open ? d.desc : `Unlock: ${ach?.name ?? ''}`}">${open ? d.name.toUpperCase() : '🔒 ' + d.name.toUpperCase()}</button>`;
    }).join(''));
    const diff = DIFFICULTIES.find((d) => d.id === settings.difficulty) ?? DIFFICULTIES[1];
    const best = dailyBest(today());
    el.querySelector('.mode-note')!.textContent = localize(daily
      ? `TODAY'S SEED (${today()}). ${best ? `YOUR BEST TODAY: ${fmtScore(best)}` : 'NO RUN YET TODAY'}`
      : diff.desc.toUpperCase());
    if (mode.id === 'weekly') el.querySelector('.mode-note')!.textContent = localize(`${weeklyChallenge().week}: ${weeklyChallenge().rules.map(r => r.name).join(' + ')} · FIXED ROOKIE KIT`);
    renderGauntletOptions(el);
    this.navs.modes.refresh(this.navs.modes.focus);
  }

  private renderWardrobe(): void {
    const el = this.els.wardrobe;
    el.querySelector('.skin-grid')!.innerHTML = localizeHtml(SKINS.map((s) => {
      const open = skinUnlocked(s.id);
      const ach = s.unlock ? ACHIEVEMENTS.find((a) => a.id === s.unlock) : null;
      const sw = (c: string) => `<i style="background:${c}"></i>`;
      return `<button data-nav data-act="skin" data-skin="${s.id}" class="skin ${settings.skin === s.id ? 'on' : ''} ${open ? '' : 'locked'}">
        <span class="swatches">${open ? sw(s.armor) + sw(s.accent) + sw(s.suit) + sw(s.hair) : sw('#333c57') + sw('#333c57') + sw('#333c57') + sw('#333c57')}</span>
        <b>${open ? s.name.toUpperCase() : '???'}</b>
        <small>${open ? (settings.skin === s.id ? 'WEARING' : 'WEAR') : ach ? ach.name.toUpperCase() : ''}</small>
      </button>`;
    }).join(''));
    el.querySelector('.pet-grid')!.innerHTML = localizeHtml(PETS.map((p) => {
      const open = !p.unlock || save.achievements.includes(p.unlock);
      const ach = p.unlock ? ACHIEVEMENTS.find((a) => a.id === p.unlock) : null;
      return `<button data-nav data-act="pet" data-pet="${p.id}" class="skin ${settings.pet === p.id ? 'on' : ''} ${open ? '' : 'locked'}" title="${p.desc}">
        <span class="swatches"><i style="background:${open ? p.color : '#333c57'}"></i></span>
        <b>${open ? p.name.toUpperCase() : '???'}</b>
        <small>${open ? p.desc : ach ? ach.name.toUpperCase() : ''}</small>
      </button>`;
    }).join(''));
    this.navs.wardrobe.refresh(this.navs.wardrobe.focus);
  }

  /** Tracks unlock as you reach their area (or hear them). */
  private renderJukebox(): void {
    const L = save.lifetime;
    const unlocked = (id: TrackId) => music.heard.has(id) || trackUnlocked(id, L.bestStage, L.bosses);
    const el = this.els.jukebox;
    el.querySelector('.tracks')!.innerHTML = localizeHtml(TRACKS.map((t) =>
      unlocked(t.id)
        ? `<button data-nav data-act="jb-play" data-track="${t.id}" class="${music.jukebox === t.id ? 'on' : ''}">${music.jukebox === t.id ? '♪ ' : ''}${t.name.toUpperCase()}</button>`
        : `<button data-nav class="locked" disabled>???</button>`,
    ).join(''));
    const now = TRACKS.find((t) => t.id === music.jukebox);
    el.querySelector('.now-playing')!.textContent = localize(now ? `NOW PLAYING: ${now.name.toUpperCase()}` : 'PICK A TRACK');
    this.navs.jukebox.refresh(this.navs.jukebox.focus);
  }

  private renderUnlocks(): void {
    // meta2's measured achievements live on EXTRAS > ACHIEVEMENTS; UNLOCKS keeps the ones that unlock things.
    this.els.unlocks.querySelector('.ach-list')!.innerHTML = localizeHtml(ACHIEVEMENTS.filter((a) => !a.track).map((a) => {
      const done = save.achievements.includes(a.id);
      const item = a.unlockLoadout ? (WEAPONS[a.unlockLoadout] ?? SPECIALS[a.unlockLoadout]) : null;
      const reward = a.unlockWeapon ? `Unlocks ${WEAPONS[a.unlockWeapon].name}` : item ? `Loadout: ${item.name}` : '';
      return `<div class="ach ${done ? 'done' : ''}"><span class="check">${done ? '★' : '☆'}</span><span class="name">${a.name}</span><span class="desc">${a.desc}</span><span class="reward">${reward}</span></div>`;
    }).join(''));
  }

  // ---------------------------------------------------------------- save data

  private msg(text: string, ok = true): void {
    const m = this.els.savedata.querySelector<HTMLElement>('.msg')!;
    m.textContent = localize(text);
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
      btn.textContent = localize('REALLY? PRESS AGAIN');
      this.msg('This deletes your achievements, unlocked weapons and lifetime stats on this device.', false);
      return;
    }
    resetSave();
    this.wipeArmed = false;
    btn.textContent = localize('RESET SAVE');
    this.msg('Save reset.');
  }

  // ---------------------------------------------------------------- game over

  showGameOver(sum: RunSummary, rank: number, list: ScoreEntry[], waitingForHost = false): void {
    const el = this.els.gameover;
    el.querySelector<HTMLElement>('[data-act=retry]')!.textContent = localize(waitingForHost ? 'HOST RESTARTS' : 'RETRY');
    el.querySelector<HTMLElement>('.newbest')!.hidden = rank !== 0;
    el.querySelector('.summary')!.innerHTML = localizeHtml(`
      <div class="big">${fmtScore(sum.score)}</div>
      <div class="grid">
        <span>${t("text.stage_37e72e")}</span><b>${sum.stage}</b>
        <span>${t("text.level_ec46cf")}</span><b>${sum.level}</b>
        <span>${t("text.kills_26daab")}</span><b>${sum.kills.toLocaleString('en-US')}</b>
        <span>${t("text.best_combo_bd920f")}</span><b>${sum.maxCombo}</b>
        ${sum.heat ? `<span>${t("text.heat_0e188d")}</span><b>${sum.heat}</b>` : ''}
        ${sum.bolts !== undefined ? `<span>${t("text.bolts_earned_2ab67d")}</span><b>+${sum.bolts}</b>` : ''}
        ${sum.style ? `<span>${t("text.best_style_50a72b")}</span><b>${sum.style}</b>` : ''}
        <span>${t("text.time_346ff3")}</span><b>${fmtTime(sum.time)}</b>
      </div>`);
    const top = sum.damage.slice(0, 6);
    const max = top[0]?.dmg || 1;
    el.querySelector('.dmg-table')!.innerHTML =
      localizeHtml(`<div class="hs-title">${t("text.damage_dealt_63ef6a")}</div>` +
      top
        .map(
          (d) =>
            `<div class="dmg-row"><span>${d.name}</span><div class="bar"><div style="width:${(d.dmg / max) * 100}%;background:${d.color}"></div></div><b>${fmtScore(d.dmg)}</b></div>`,
        )
        .join(''));
    el.querySelector('.build')!.innerHTML =
      localizeHtml(sum.loadout.map(badge).join('') + (sum.mods.length ? `<div class="mod-strip">MODS: ${sum.mods.join(' · ')}</div>` : ''));
    el.querySelector('.unlocked')!.innerHTML = localizeHtml(sum.achievements.length ? `★ NEW: ${sum.achievements.join(' · ')}` : '');
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
  t.textContent = localize(text);
  t.style.left = `${x}px`;
  t.style.top = `${y}px`;
  t.style.color = color;
  t.addEventListener('animationend', () => t.remove(), { once: true });
  document.body.appendChild(t);
}
