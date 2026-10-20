/**
 * Arena editor runs (editor lane): playing a custom arena solo or hosting it
 * online. Like the trials lane, this owns its lifecycle by wrapping Game
 * methods at install time; outside a custom run every wrapper delegates
 * unchanged.
 *
 * - The arena comes from data (src/editor/build.ts) through one hook in
 *   loadArena (`editorArena`), on the host and on every client: the host puts
 *   the packed arena (a ~100-1000 byte base64url string) in the `start`
 *   message (`arena`), clients rebuild the same arena from it.
 * - Rules: the biome (biomeForce), night/rain/wind (look, weather and wind
 *   overrides, set on every machine), the stage time (director.lengthMul), the
 *   enemy mix (director.pool), the boss (spawnBoss), heat handicaps (meta.heat,
 *   synced by the meta snapshot), events and swarm rings on/off.
 * - Markers: heroes start on the hero spawns, the boss lands on its marker,
 *   enemies also pour in through gates and chests appear on chest spots.
 * - Scores go to the arena's own local best (src/editor/store.ts), not the
 *   normal high-score table or the online boards; achievements are not granted
 *   in custom arenas (they're a sandbox: you pick the difficulty and the boss).
 */
import type { Game } from '../game';
import { playerName } from '../game';
import { randomSeed } from '../../core/rng';
import { biomeByKey, biomeForce } from '../../data/biomes';
import { ENEMIES, type EnemyDef } from '../../data/enemies';
import { DIFF_BY_ID, type DifficultyId } from '../../data/modes';
import { directorTuning } from '../director';
import { lookOverrides } from './look';
import { weatherForce } from '../ambience';
import { windForce } from '../wind';
import { worldEventTuning } from '../worldEvents';
import { selectSeason } from './halloween';
import { spawnTitan } from './bossLane';
import { trialActive } from './trials';
import { settings } from '../settings';
import { save, saveLock } from '../save';
import { chestTuning } from '../game';
import { WAVE_PRESETS, rosterFoes, type CustomArena } from '../../editor/arenaData';
import { buildCustomArena } from '../../editor/build';
import { b64url, packArena, unb64url, unpackArena } from '../../editor/codec';
import { bestFor, recordArenaRun, type ArenaBest } from '../../editor/store';
import { EditorScreen } from '../../ui/editorScreen';
import type { Arena } from '../../world/fieldArena';
import type { RunSummary } from '../../ui/screens';
import type { ScoreEntry } from '../highscores';
import { t } from '../../i18n';

interface Overrides {
  biome: string | null;
  night: boolean | null;
  weather: 'rain' | 'clear' | null;
  wind: boolean;
  events: boolean;
}

export interface EditorState {
  /** The arena of the run in progress (host, solo and clients), or null. */
  active: CustomArena | null;
  /** Packed body of `active` for start messages. */
  activeNet: string;
  /** Host's pick in the online lobby (kept for retries). */
  lobbyPick: { id: string; arena: CustomArena } | null;
  /** Editor PLAY: waits on the LOADOUT screen for START. */
  soloPick: CustomArena | null;
  /** Consumed by the next startRun (solo). */
  nextSolo: CustomArena | null;
  saved: Overrides | null;
  /** spawnBoss is placing the boss: ringPoint answers with the boss marker. */
  bossSpawning: boolean;
  /** director.pool() result for the active rules (cached). */
  pool: EnemyDef[] | null;
  /** New best this run (game over banner). */
  newBest: boolean;
  screen: EditorScreen;
}

const states = new WeakMap<Game, EditorState>();

export function editorState(g: Game): EditorState {
  return states.get(g)!;
}

export function customArenaActive(g: Game): boolean {
  return !!states.get(g)?.active;
}

// ------------------------------------------------------------------ activation

function activate(s: EditorState, a: CustomArena): void {
  if (!s.saved) s.saved = { biome: biomeForce.key, night: lookOverrides.night, weather: weatherForce.mode, wind: windForce.on, events: worldEventTuning.enabled };
  s.active = a;
  s.activeNet = b64url(packArena(a));
  s.pool = null;
  s.newBest = false;
  biomeForce.key = a.rules.biome;
  lookOverrides.night = a.rules.night ? true : s.saved.night;
  weatherForce.mode = a.rules.rain ? 'rain' : 'clear';
  windForce.on = a.rules.wind;
  worldEventTuning.enabled = a.rules.events && s.saved.events;
}

function deactivate(s: EditorState): void {
  s.active = null;
  s.activeNet = '';
  s.pool = null;
  const o = s.saved;
  if (!o) return;
  s.saved = null;
  biomeForce.key = o.biome;
  lookOverrides.night = o.night;
  weatherForce.mode = o.weather;
  windForce.on = o.wind;
  worldEventTuning.enabled = o.events;
}

/** The difficulty a custom arena may use on this save (locked ones fall back to Medium). */
function arenaDifficulty(a: CustomArena): DifficultyId {
  const d = DIFF_BY_ID[a.rules.difficulty as DifficultyId];
  if (!d || d.coopOnly || (d.unlock && !save.achievements.includes(d.unlock))) return 'normal';
  return d.id;
}

// ------------------------------------------------------------------ hooks for shared files

/** runFlow.loadArena: the custom arena for this run, or null for the usual generator. */
export function editorArena(g: Game, seed: number): Arena | null {
  const a = states.get(g)?.active;
  return a ? buildCustomArena(a, seed) : null;
}

/** `start` message field: the packed arena of this run, or null. */
export function editorNet(g: Game): string | null {
  return states.get(g)?.activeNet || null;
}

/** Client: a `start` message with (or without) a custom arena. Bad data is ignored (normal run). */
export function acceptEditorStart(g: Game, raw: unknown): void {
  const s = states.get(g);
  if (!s) return;
  if (typeof raw !== 'string' || !raw || raw.length > 6000) {
    deactivate(s);
    return;
  }
  try {
    activate(s, unpackArena(unb64url(raw)));
  } catch {
    deactivate(s);
  }
}

/**
 * runFlow.bankAndShow: bank this run on the arena's own table. Returns the
 * game-over table (best first) and this run's rank in it, or null outside a
 * custom run.
 */
export function editorScores(g: Game, sum: RunSummary): { rank: number; list: ScoreEntry[] } | null {
  const s = states.get(g);
  const a = s?.active;
  if (!s || !a) return null;
  const run: ArenaBest = { score: Math.floor(sum.score), stage: sum.stage, kills: sum.kills, date: new Date().toISOString().slice(0, 10) };
  const old = bestFor(a);
  s.newBest = !saveLock.on && recordArenaRun(a, run);
  if (s.newBest) g.hud.toast(t('editor.newBest'), 4);
  const best = s.newBest ? run : old;
  const label = `${t('editor.arena')}: ${a.name}`;
  const list: ScoreEntry[] = [];
  if (best) list.push({ score: best.score, stage: best.stage, kills: best.kills, date: best.date, label });
  if (!s.newBest) list.push({ score: run.score, stage: run.stage, kills: run.kills, date: run.date, label: t('editor.thisRun') });
  list.sort((x, y) => y.score - x.score);
  return { rank: s.newBest ? 0 : -1, list };
}

// ------------------------------------------------------------------ starting runs

/** EXTRAS > ARENA EDITOR > PLAY: pick a kit on the LOADOUT screen, START plays the arena. */
export function playArenaSolo(g: Game, a: CustomArena, viaLoadout = true): void {
  const s = editorState(g);
  s.soloPick = a;
  if (viaLoadout) g.screens.showLoadout('solo');
  else g.startSolo();
}

/** EXTRAS > ARENA EDITOR > HOST ONLINE: open a co-op lobby with this arena picked. */
export function hostArena(g: Game, id: string, a: CustomArena): void {
  const s = editorState(g);
  g.lobbyKind = 'coop';
  void g.hostGame(playerName());
  s.lobbyPick = { id, arena: a };
  g.screens.show('online');
  s.screen.refreshLobby();
}

/** Online lobby: the host picks (or clears) the arena the next run uses. */
export function pickLobbyArena(g: Game, pick: { id: string; arena: CustomArena } | null): void {
  const s = editorState(g);
  s.lobbyPick = pick;
  if (g.role === 'host') g.host?.broadcast({ t: 'arenapick', name: pick?.arena.name ?? '' });
  s.screen.refreshLobby();
}

// ------------------------------------------------------------------ install

export function installEditor(g: Game): void {
  const s: EditorState = { active: null, activeNet: '', lobbyPick: null, soloPick: null, nextSolo: null, saved: null, bossSpawning: false, pool: null, newBest: false, screen: null! };
  states.set(g, s);
  s.screen = new EditorScreen(g);

  const startRun = g.startRun.bind(g);
  g.startRun = (fixed) => {
    const lobby = g.role === 'host' && g.lobbyKind === 'coop' ? s.lobbyPick?.arena ?? null : null;
    const pick = trialActive(g) || g.pvp || g.versus || g.role === 'client' ? null : g.role === 'host' ? lobby : s.nextSolo ?? s.active;
    if (!pick) {
      if (s.active) deactivate(s);
      return startRun(fixed);
    }
    activate(s, pick);
    g.runMode = 'standard';
    startRun({ seed: fixed?.seed ?? randomSeed(), difficulty: arenaDifficulty(pick) });
  };

  const startSolo = g.startSolo.bind(g);
  g.startSolo = () => {
    const pick = s.soloPick;
    s.soloPick = null;
    if (!pick) {
      s.nextSolo = null;
      return startSolo();
    }
    const mode = settings.mode;
    settings.mode = 'standard'; // read once by startSolo; the player's MODE pick stays saved
    s.nextSolo = pick;
    try {
      startSolo();
    } finally {
      settings.mode = mode;
      s.nextSolo = null;
    }
  };

  const goTitle = g.goTitle.bind(g);
  g.goTitle = () => {
    deactivate(s);
    goTitle();
  };
  const leave = g.leaveToTitle.bind(g);
  g.leaveToTitle = () => {
    s.lobbyPick = null;
    leave();
  };

  // Back from the LOADOUT screen of an editor PLAY returns to the editor, not the MODE screen.
  const show = g.screens.show.bind(g.screens);
  g.screens.show = (name, focus) => {
    if (name === 'modes' && s.soloPick) {
      s.soloPick = null;
      return show('arenaedit', focus);
    }
    show(name, focus);
    if (name === 'online') s.screen.refreshLobby();
  };

  const loadStage = g.loadStage.bind(g);
  g.loadStage = (stage) => {
    const a = s.active;
    if (a) selectSeason.call(g, null); // no seasonal dressing or biome swap on a custom field
    loadStage(stage);
    if (!a || !s.active) return;
    g.meta.heat = [...a.rules.heat] as typeof g.meta.heat;
    g.director.lengthMul = a.rules.time / directorTuning.stageSeconds;
    if (!a.rules.events) g.runEvents.suppressEvent();
  };

  const stageSub = g.stageSub.bind(g);
  g.stageSub = (stage) => {
    const a = s.active;
    if (!a) return stageSub(stage);
    return `${a.name}<br>${biomeByKey(a.rules.biome).name.toUpperCase()} · ${t('editor.surviveMin', { n: Math.round(g.director.duration / 60 * 10) / 10 })}`;
  };

  const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(g), 'runLabel');
  if (desc?.get) {
    const get = desc.get;
    Object.defineProperty(g, 'runLabel', {
      configurable: true,
      get: () => {
        const base = get.call(g) as string;
        const a = s.active;
        return a ? [`${t('editor.arena')} ${a.name}`, base].filter(Boolean).join(' · ') : base;
      },
    });
  }

  const spawnSpot = g.spawnSpot.bind(g);
  g.spawnSpot = (i) => {
    const marks = s.active?.pieces.filter((p) => p.k === 'hero');
    if (!marks?.length) return spawnSpot(i);
    const m = marks[i % marks.length];
    const k = Math.floor(i / marks.length);
    if (!k) return { x: m.x, z: m.z };
    // More heroes than spawns: stand around the spawn, wherever there's room.
    for (let a = 0; a < 8; a++) {
      const ang = (k + a) * 2.1;
      const x = m.x + Math.cos(ang) * 1.3;
      const z = m.z + Math.sin(ang) * 1.3;
      if (!g.walls.hitCircle(x, z, 0.5)) return { x, z };
    }
    return { x: m.x, z: m.z };
  };

  const ringPoint = g.ringPoint.bind(g);
  g.ringPoint = (rMin, rMax, r = 0.6) => {
    const a = s.active;
    if (!a) return ringPoint(rMin, rMax, r);
    if (s.bossSpawning) {
      const b = a.pieces.find((p) => p.k === 'boss');
      if (b) return { x: b.x, z: b.z };
    }
    const gates = a.pieces.filter((p) => p.k === 'gate');
    if (gates.length && g.rng.chance(0.5)) {
      const alive = g.aliveHeroes;
      const near = gates.filter((p) => alive.some((h) => Math.hypot(h.player.x - p.x, h.player.z - p.z) < 40));
      if (near.length) {
        const p = near[Math.floor(g.rng.next() * near.length)];
        const x = p.x + g.rng.range(-1, 1);
        const z = p.z + g.rng.range(-1, 1);
        if (!g.walls.hitCircle(x, z, r)) return { x, z };
      }
    }
    const pos = ringPoint(rMin, rMax, r);
    if (pos) return pos;
    // Small arenas: the ring around a hero can fall outside the fence. Any clear spot away from the heroes will do.
    const lim = g.arena.halfSize - 3;
    for (let i = 0; i < 16; i++) {
      const x = g.rng.range(-lim, lim);
      const z = g.rng.range(-lim, lim);
      if (g.walls.hitCircle(x, z, r) || g.aliveHeroes.some((h) => Math.hypot(h.player.x - x, h.player.z - z) < 9)) continue;
      return { x, z };
    }
    return null;
  };

  const spawnBoss = g.spawnBoss.bind(g);
  g.spawnBoss = (def) => {
    const a = s.active;
    if (!a) return spawnBoss(def);
    const pick = a.rules.boss !== 'auto' ? ENEMIES[a.rules.boss] : undefined;
    s.bossSpawning = true;
    try {
      if (!pick?.boss) return spawnBoss(def); // the stage's own boss (rematches and biome bosses as usual)
      // A picked boss skips the stage-boss swaps (they would put the stage's boss back).
      if (pick.behavior === 'titan') return spawnTitan.call(g, pick);
      const p = (g.aliveHeroes[0] ?? g.hero).player;
      const pos = g.ringPoint(13, 16, pick.radius + 0.5) ?? { x: p.x + 12, z: p.z };
      g.boss = g.enemies.spawn(pick, pos.x, pos.z, g.spawnOpts({ hpMul: g.director.bossHpMul }));
      g.startBossIntro(g.boss);
    } finally {
      s.bossSpawning = false;
    }
  };

  const spawnRing = g.spawnRing.bind(g);
  g.spawnRing = (def, count) => {
    if (s.active && !s.active.rules.rings) return;
    spawnRing(def, count);
  };

  const chestSpawns = g.updateChestSpawns.bind(g);
  g.updateChestSpawns = (dt) => {
    const spots = s.active?.pieces.filter((p) => p.k === 'chest');
    if (!spots?.length) return chestSpawns(dt);
    g.chestT += dt * (g.meta.has('chests') ? 0.5 : 1);
    if (g.chestT < chestTuning.every) return;
    g.chestT -= chestTuning.every;
    if (g.chests.closedCount >= chestTuning.maxClosed) return;
    const free = spots.filter((p) => !g.chests.list.some((c) => c.openT < 0 && Math.hypot(c.x - p.x, c.z - p.z) < 1));
    if (!free.length) return;
    const p = free[Math.floor(g.rng.next() * free.length)];
    const facing = (p.r * Math.PI) / 2;
    if (g.jackpotRoll(p.x, p.z, facing)) return;
    g.chests.add(p.x, p.z, facing);
    g.host?.broadcast({ t: 'chestspawn', x: p.x, z: p.z, f: facing });
    g.vfx.ring(p.x, p.z, 1, 6, '#ffcd75', 0.6);
    g.vfx.burst(p.x, 1, p.z, { count: 20, color: '#ffcd75', color2: '#ffffff', speed: [2, 6], size: [0.15, 0.3], life: [0.5, 0.9], up: 8, gravity: 10 });
    g.vfx.toast('A TREASURE CHEST APPEARED!');
    g.vfx.sound('chest', NaN, NaN);
  };

  const achievements = g.checkAchievements.bind(g);
  g.checkAchievements = () => {
    if (!s.active) achievements();
  };

  // Enemy mix: the preset's (or the player's) roster instead of the minute-gated pool.
  const pool = g.director.pool.bind(g.director);
  g.director.pool = () => {
    const a = s.active;
    if (!a || a.rules.waves === 'classic') return pool();
    if (!s.pool) {
      const ids = a.rules.waves === 'custom' ? a.rules.foes : a.rules.waves === 'all' ? rosterFoes().map((d) => d.id) : WAVE_PRESETS.find((w) => w.id === a.rules.waves)?.foes ?? [];
      s.pool = ids.map((id) => ENEMIES[id]).filter((d): d is EnemyDef => !!d && d.weight > 0);
      if (!s.pool.length) s.pool = null;
    }
    return s.pool ?? pool();
  };

  // Client: the start message says whether this run is on a custom arena; the lobby shows the host's pick.
  const onClient = g.onClientMessage.bind(g);
  g.onClientMessage = (m) => {
    if (m.t === 'start') acceptEditorStart(g, m.arena);
    if (m.t === 'arenapick') {
      s.screen.setClientPick(String(m.name ?? ''));
      return;
    }
    onClient(m);
  };
}

// ------------------------------------------------------------------ test links

/**
 * Test links (src/dev/testLinks.ts): `&arena=demo|fortress|<code>` plays that arena solo
 * (no loadout screen, no starting shop); `&arenaboss` brings its boss now;
 * `&editor[=demo|<code>]` opens the editor on it; `&editorscreen=list|rules|share|pick`.
 */
export function editorLinks(g: Game, q: URLSearchParams): void {
  const s = states.get(g);
  if (!s) return;
  const sc = s.screen;
  const arenaQ = q.get('arena');
  if (arenaQ) {
    const a = sc.sample(arenaQ);
    if (!a) return;
    playArenaSolo(g, a, false);
    if (g.mode === 'shop') g.closeShop();
    if (q.has('arenaboss')) g.director.time = g.director.duration;
    return;
  }
  if (q.has('editor') || q.has('editorscreen')) {
    g.leaveToTitle();
    const a = sc.sample(q.get('editor') || 'demo');
    const view = q.get('editorscreen') ?? 'edit';
    if (view === 'list' || view === 'pick') sc.openList(view === 'pick');
    else sc.openEditor(a ?? undefined, view === 'rules' ? 'rules' : view === 'share' ? 'share' : 'build');
    const cur = q.get('editorcursor');
    if (cur) {
      const [x, z] = cur.split(',').map(Number);
      sc.setCursor(x || 0, z || 0, q.get('editorpiece') ?? undefined);
    }
  }
}
