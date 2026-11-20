import type { Game } from '../game/game';
import { lobbyCap } from '../game/eightp';
import { BIOME_BY_ID, biomeForStage } from '../data/biomes';
import { localize, t } from '../i18n';
import { promptState } from '../ui/prompts';

interface SteamBridge {
  unlock(ids: readonly string[]): Promise<void>;
  presence(status: string, code: string | null): Promise<void>;
  onJoin(callback: (code: string) => void): void;
}
declare global { interface Window { steamGame?: SteamBridge; steamDeck?: boolean } }

export function steamUnlock(ids: readonly string[]): void {
  if (typeof window !== 'undefined' && ids.length) void window.steamGame?.unlock(ids);
}

export function presenceText(stage: number, biome: string, hero: string): string {
  return t('steam.stage', { stage, biome: localize(biome), hero: localize(hero) });
}

export function installSteam(game: Game, playerName: () => string, joinable: (g: Game) => boolean): void {
  if (typeof window === 'undefined') return;
  if (window.steamDeck || (window.screen?.width === 1280 && window.screen.height === 800)) {
    promptState.mode = 'xbox';
    // Chromium hides the pad until the first press. Resume normal device detection on input.
    promptState.force = 'xbox';
    const controller = new AbortController();
    const release = (event: Event) => {
      if (event.type === 'gamepadconnected') game.input.device = 'pad';
      if (promptState.force === 'xbox') promptState.force = null;
      controller.abort();
    };
    for (const event of ['keydown', 'mousedown', 'mousemove', 'touchstart', 'gamepadconnected'])
      window.addEventListener(event, release, { signal: controller.signal });
  }
  const bridge = window.steamGame;
  if (!bridge) return;
  const { presence } = bridge;
  bridge.onJoin(code => {
    if (!/^[A-HJ-NP-Z2-9]{5}$/.test(code) || game.client?.code === code || game.host?.code === code) return;
    void game.joinGame(playerName(), code);
  });
  let lastStatus = '', lastCode: string | null = null;
  let observedHost: Game['host'] = null, hostReady = false;
  function update() {
    if (observedHost !== game.host) {
      const host = observedHost = game.host;
      hostReady = false;
      host?.ready.then(() => { if (game.host === host) hostReady = true; }, () => {});
    }
    const lobby = game.mode === 'title';
    const host = game.role === 'host' && hostReady;
    const room = host && (lobby || joinable(game)) && (lobby ? game.lobby.length : game.heroes.filter(h => !h.left).length) < lobbyCap(game.lobbyKind);
    const code = room ? game.host!.code : null;
    const biome = game.runMode === 'raid' ? BIOME_BY_ID.factory : biomeForStage(game.arenaStage);
    const status = lobby ? (game.online ? localize('LOBBY') : t('steam.menu')) : presenceText(game.stage, biome.name, game.hero.heroDef.name);
    if (status === lastStatus && code === lastCode) return;
    lastStatus = status;
    lastCode = code;
    void presence(status, code);
  }
  update();
  const timer = window.setInterval(update, 1000);
  window.addEventListener('pagehide', () => window.clearInterval(timer), { once: true });
}
