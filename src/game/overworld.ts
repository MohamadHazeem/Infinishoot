import { CAMPAIGN_KEY, loadJson, saveJson, setIslandHunts } from '../core/storage';
import { biomeForce } from '../data/biomes';
import { ISLANDS, legCount, ports, type Dispatch, type Passage } from '../data/islands';
import { en } from '../i18n/en';
import { pickLobbyArena, editorState } from './systems/editor';
import { OverworldUi } from '../ui/overworldUi';
import { personalDeaths } from './damageLog';
import { type Game, playerName } from './game';
import { normalizeHistory } from './nemesis';
import { saveLock } from './save';
import { partyRestart, partyToLobby } from './systems/party';
import { finishTelemetry } from './systems/telemetry';

export interface Chart {
  /** A dispatch for each liberated island, in sailing order. */
  log: Dispatch[];
  hunts: Record<string, ReturnType<typeof normalizeHistory>>;
}

function islandHistory(raw: unknown) {
  const hunt = normalizeHistory(raw);
  // Keep the first outstanding rival at this port until someone defeats it.
  hunt.stories = hunt.stories.filter((s) => !s.ended).slice(0, 1);
  return hunt;
}

export function normalizeChart(raw: unknown): Chart {
  const chart: Chart = { log: [], hunts: {} };
  if (!raw || typeof raw !== 'object') return chart;
  const { log, hunts } = raw as Partial<Chart>;
  if (Array.isArray(log))
    for (const dispatch of log.slice(0, ISLANDS.length)) {
      if (dispatch !== 'fast' && dispatch !== 'shielded') break;
      chart.log.push(dispatch);
    }
  for (const { id } of ISLANDS) {
    const hunt = islandHistory(hunts?.[id]);
    if (hunt.serial || hunt.stories.length) chart.hunts[id] = hunt;
  }
  return chart;
}

const readChart = () => normalizeChart(loadJson(CAMPAIGN_KEY, null));
export interface Voyage {
  index: number;
  passage: Passage;
  won: boolean;
}
export function allowedVoyage(chart: Chart, index: number, passage: Passage): boolean {
  const island = ISLANDS[index];
  return (
    !!island &&
    Number.isInteger(index) &&
    index <= chart.log.length &&
    ports(chart.log.length, island).includes(passage)
  );
}

export function liberate(chart: Chart, index: number, dispatch: Dispatch): void {
  if (index === chart.log.length && index < ISLANDS.length) chart.log.push(dispatch);
  delete chart.hunts[ISLANDS[index].id];
}

export function installOverworld(g: Game, root: HTMLElement): void {
  let chart = readChart();
  let voyage: Voyage | null = null;
  let ownsChart = true;
  let previousBiome: string | null = null;
  let wire = '';
  let firstElite = false;
  let receivedSeed = -1;

  const ui = new OverworldUi(
    g,
    root,
    () => chart,
    () => voyage,
    launch,
    back,
  );
  const persist = () => {
    if (voyage && ownsChart && g.authority && !saveLock.on) {
      // Another tab may have freed a later port. Merge just this island's log.
      const saved = readChart(),
        id = ISLANDS[voyage.index].id;
      saved.log.push(...chart.log.slice(saved.log.length));
      if (chart.hunts[id]) saved.hunts[id] = chart.hunts[id];
      else delete saved.hunts[id];
      chart = saved;
      saveJson(CAMPAIGN_KEY, chart);
    }
    wire = JSON.stringify([voyage, chart]);
  };
  function bind(v: Voyage) {
    if (!voyage) previousBiome = biomeForce.key;
    voyage = v;
    const id = ISLANDS[v.index].id;
    biomeForce.key = id;
    setIslandHunts({
      read: () => chart.hunts[id],
      write(value) {
        if (!g.authority) return;
        chart.hunts[id] = islandHistory(value);
        persist();
      },
    });
  }
  function reset() {
    if (voyage) {
      biomeForce.key = previousBiome;
      setIslandHunts(null);
    }
    voyage = null;
    receivedSeed = -1;
    wire = '';
    ownsChart = true;
  }
  function back() {
    if (g.role === 'host' && voyage) partyToLobby(g);
    else if (g.role === 'host') g.refreshLobby();
    else {
      if (voyage) g.leaveToTitle();
      g.screens.show('play');
    }
  }
  function launch(index: number, passage: Passage) {
    if (!g.authority || !allowedVoyage(chart, index, passage)) return;
    if (g.role === 'host' && (g.lobbyKind !== 'coop' || !g.host)) return;
    if (g.role === 'solo' && !voyage) {
      g.leaveToTitle();
      g.hero.name = playerName();
      g.applyLocalSkin();
    }
    if (g.role === 'host' && editorState(g).lobbyPick) pickLobbyArena(g, null);
    bind({ index, passage, won: false });
    wire = JSON.stringify([voyage, chart]);
    g.runMode = 'standard';
    if (g.role !== 'host') g.startRun();
    else if (g.mode === 'title') g.hostStart();
    else partyRestart(g);
  }
  function showChart() {
    if (!voyage) chart = readChart();
    const frontier = Math.min(chart.log.length, ISLANDS.length - 1);
    ui.select(frontier);
    g.screens.show('overworld');
    g.screens.refreshNav(frontier);
  }
  ui.onOpen = showChart;
  const title = g.goTitle.bind(g);
  g.goTitle = () => {
    reset();
    title();
  };

  function packet() {
    return { t: 'islandChart', seed: g.seed, chart: wire };
  }
  function receive(raw: unknown, seed: number) {
    if (g.role !== 'client' || typeof raw !== 'string' || raw.length > 8192 || !raw) return;
    if (raw !== wire || seed !== receivedSeed) {
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        return;
      }
      if (!Array.isArray(payload) || !payload[0]) return;
      const [v, data] = payload;
      const next = normalizeChart(data);
      if (!allowedVoyage(next, v.index, v.passage)) return;
      ownsChart = false;
      chart = next;
      bind({ index: v.index, passage: v.passage, won: v.won === true });
      wire = raw;
      receivedSeed = seed;
    }
    if (voyage?.won && g.mode === 'shop' && g.screens.current !== 'overworld') showChart();
  }
  // Reliable setup precedes arena construction, including the hello of a late joiner.
  const hostMessage = g.onHostMessage.bind(g);
  g.onHostMessage = (from, m) => {
    if (voyage && m.t === 'hello') g.host?.send(from, packet());
    hostMessage(from, m);
  };
  const clientMessage = g.onClientMessage.bind(g);
  g.onClientMessage = (m) => {
    if (m.t === 'islandChart') {
      receive(m.chart, Number(m.seed));
      return;
    }
    if (m.t === 'start' && receivedSeed !== Number(m.seed)) reset();
    clientMessage(m);
  };
  const pack = g.gameplayNet.bind(g);
  g.gameplayNet = (h) => {
    const snapshot = pack(h);
    if (voyage) snapshot.chart = wire;
    return snapshot;
  };
  const apply = g.applyGameplayNet.bind(g);
  g.applyGameplayNet = (raw) => {
    receive((raw as { chart?: string } | null)?.chart, g.seed);
    apply(raw);
  };

  const load = g.loadStage.bind(g);
  g.loadStage = (stage) => {
    if (voyage) {
      g.route.on = false;
      firstElite = true;
      if (g.role === 'host') g.host?.broadcast(packet());
    }
    load(stage);
  };
  const elite = g.rollEliteMod.bind(g);
  g.rollEliteMod = (def) => {
    const rolled = elite(def);
    if (!voyage || !firstElite) return rolled;
    firstElite = false;
    return chart.log[voyage.index - 1] ?? rolled;
  };
  // On a long crossing the first director timer opens the harbour. Only the final
  // leg requests a boss. A harbour grants no boss kill, chest or stage-clear heal.
  const spawnBoss = g.spawnBoss.bind(g);
  g.spawnBoss = (def) => {
    if (!voyage || g.stage >= legCount(ISLANDS[voyage.index], voyage.passage))
      return spawnBoss(def);
  };
  const clear = g.stageClear.bind(g);
  g.stageClear = () => {
    if (voyage?.won) return;
    if (voyage && g.authority && g.stage < legCount(ISLANDS[voyage.index], voyage.passage)) {
      g.mode = 'cleared';
      g.modeT = 0;
      for (const e of g.enemies.list) if (e.active) g.enemies.kill(e);
      g.bullets.clear();
      g.pickups.vacuum = g.pickups.vacuumChests = true;
      g.vfx.banner(en['chart.harbour'], en[`chart.via.${voyage.passage}`], 2.2);
      return;
    }
    clear();
    if (!voyage || !g.authority || g.mode !== 'cleared') return;
    const crew = g.heroes.filter((h) => !h.left);
    const dashes = crew.reduce((n, h) => n + h.dashes, 0);
    liberate(chart, voyage.index, dashes >= 8 * crew.length * g.stage ? 'fast' : 'shielded');
    voyage.won = true;
    persist();
    finishTelemetry(g, 'victory');
    g.mode = 'shop';
    for (const h of g.heroes) h.shopDone = true;
    showChart();
  };
  const shop = g.openShop.bind(g);
  g.openShop = () => {
    if (!voyage || g.preShop || voyage.passage === 'market') return shop();
    if (voyage.passage === 'rest') {
      for (const h of g.heroes) if (!h.left && !h.player.dead) h.player.heal(h.player.maxHp * 0.2);
      g.vfx.sound('heal', NaN, NaN);
    }
    g.openPortal();
  };
  // Campaign scores do not enter the Standard boards. Keep the regular hit recap and replay.
  const bank = g.bankAndShow.bind(g);
  g.bankAndShow = (sum, quit) => {
    if (!voyage) return bank(sum, quit);
    finishTelemetry(g, quit ? 'quit' : 'death');
    if (quit) {
      g.leaveToTitle();
      return;
    }
    g.screens.showGameOver(
      sum,
      -1,
      [],
      g.role === 'client',
      personalDeaths(g, sum.downed ?? false),
    );
  };
  const retry = g.retry.bind(g);
  g.retry = () => {
    if (voyage && g.authority) showChart();
    else retry();
  };
}
