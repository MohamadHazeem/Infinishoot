import type { Game } from './game';
import type { Weapon } from './weapons/base';
import type { Hero } from './hero';
import { Team } from './bullets';
import { settings } from './settings';
import { saveLock } from './save';
import { onBeat } from './modes/rhythm';
import { heroParryLag } from './netFeel';
import { biomeForStage } from '../data/biomes';
import { TRACK_BY_ID, bossTrack, type TrackId } from '../audio/music/composition';
import { music } from '../audio/music';
import { encounterTrack } from './systems/audio3';
import { BeatAccuracyHud } from '../ui/beatAccuracyHud';
import { MaestroScore } from './bossesMaestro';
import { maestroTempos } from './bossesMaestroTheme';

export const beatCombatTuning = { window: 0.045, damage: 0.08, dashSeconds: 0.22, parrySeconds: 0.45, castSeconds: 0.12 };
export const inCombatWindow = (beat: number, bpm: number): boolean =>
  onBeat(beat, bpm, beatCombatTuning.window, beatCombatTuning.window);

export class BeatCombat {
  beat = 0;
  bpm = 120;
  forceMaestro = false;
  readonly score = new MaestroScore();
  private stage = -1;
  private bossId = '';
  private encounter = '';
  private track: TrackId = 'meadow';
  private netBeat = 0;
  private hud?: BeatAccuracyHud;
  private sentPref: boolean | null = null;
  private retryPreferenceAt = 0;

  reset(): void {
    this.stage = -1;
    this.beat = this.netBeat = 0;
    this.bossId = '';
    this.sentPref = null;
    this.retryPreferenceAt = 0;
  }

  tick(g: Game, dt: number): void {
    if (g.mode !== 'fight') return;
    const boss = g.boss?.active ? g.boss : null;
    const id = boss?.def.id ?? '';
    const mode = g.pvp?.phase === 'duel' ? 'pvp' : g.runMode;
    if (this.stage !== g.stage || this.bossId !== id || this.encounter !== mode) {
      if (this.stage !== g.stage || id === 'maestro') {
        this.beat = 0;
        for (const hero of g.heroes) hero.beatAccent = -1;
      }
      this.stage = g.stage;
      this.bossId = id;
      this.encounter = mode;
      const biome = biomeForStage(g.arenaStage);
      this.track = id === 'maestro' || id === 'architect' ? id :
        encounterTrack(boss ? bossTrack(g.stage) : biome.music, g.runMode, !!boss, biome.variant === 'haunted', mode === 'pvp') ?? biome.music;
    }
    this.bpm = id === 'maestro' ? maestroTempos[(boss?.phase ?? 1) - 1] : TRACK_BY_ID[this.track].style.bpm;
    this.beat += dt * this.bpm / 60;
    if (g.modes.rhythm) {
      // The legacy enemy/kill clock and the click clock share a grid on a rhythm road.
      if (id !== 'maestro' && g.modes.clock.bpm === this.bpm) this.beat = g.modes.beat;
      else {
        g.modes.clock.bpm = this.bpm;
        g.modes.clock.t0 = g.modes.rt;
        g.modes.clock.b0 = g.modes.beat = this.beat;
      }
    }
  }

  accurate(g: Game, h: Hero): boolean {
    return g.authority && !saveLock.on && g.mode === 'fight' && this.stage === g.stage && (h.peerId ? h.beatEnabled : settings.beatCombat) &&
      inCombatWindow(this.beat - heroParryLag(g, h) * this.bpm / 60, this.bpm);
  }

  private bonus(h: Hero, base: number): number {
    const extra = base * beatCombatTuning.damage;
    h.beatAccent = Math.round(this.beat);
    h.beatBonusBase += extra;
    return base + extra;
  }

  release(g: Game, h: Hero, w: Weapon, first: number): void {
    if (w.def.id !== 'sentry' && first < g.bullets.count) this.volley(g, h, first);
    else if (w.muzzleT > w.feelMuzzle && w.def.id !== 'laser' && w.def.id !== 'rail' && w.def.id !== 'medbeam') {
      // A deployable or lingering field earns its reward on release. Its later ticks are autonomous.
      this.refund(g, h, beatCombatTuning.castSeconds);
    }
  }

  // Only freshly emitted projectiles. A piercing shot carries that damage for its entire flight.
  volley(g: Game, h: Hero, first: number): void {
    if (first >= g.bullets.count || !this.accurate(g, h)) return;
    const b = g.bullets;
    for (let i = first; i < b.count; i++) {
      if (b.team[i] === Team.Player && b.owner[i] === h.index) b.damage[i] = this.bonus(h, b.damage[i]);
    }
  }

  hitscan(g: Game, h: Hero, base: number, source: string): number {
    if ((source === 'rail' || source === 'laser' || source === 'medbeam') && h.ctx.soundSource?.def.id === source && this.accurate(g, h))
      return this.bonus(h, base);
    return base;
  }

  refund(g: Game, h: Hero, seconds: number): void {
    if (!this.accurate(g, h) || h.player.dashStock >= h.player.dashMax) return;
    h.player.dashCd = Math.max(0, h.player.dashCd - seconds);
    h.beatAccent = Math.round(this.beat);
  }

  snapshot(h: Hero): number[] {
    return [Math.round(this.beat * 256), this.bpm, h.beatAccent, Number(this.bossId === 'maestro') | (Number(h.beatEnabled) << 1)];
  }

  mirror(g: Game, raw: unknown): void {
    if (!Array.isArray(raw) || !Number.isFinite(raw[0]) || !Number.isFinite(raw[1]) || raw[1] <= 0) return;
    this.netBeat = this.beat = raw[0] / 256;
    this.bpm = raw[1];
    this.bossId = (raw[3] & 1) ? 'maestro' : '';
    g.hero.beatAccent = raw[2];
    const enabled = settings.beatCombat;
    if (g.client && (!!(raw[3] & 2) !== enabled || (this.sentPref !== null && this.sentPref !== enabled))) {
      const now = performance.now();
      if (this.sentPref !== enabled || now >= this.retryPreferenceAt) {
        g.client.send({ t: 'beatPref', enabled });
        this.retryPreferenceAt = now + 1000;
      }
    }
    this.sentPref = enabled;
  }

  clientTick(dt: number): void {
    this.beat = Math.min(this.beat + dt * this.bpm / 60, this.netBeat + 0.12 * this.bpm / 60);
  }

  present(g: Game): void {
    const active = g.mode === 'fight';
    const maestro = active && this.bossId === 'maestro';
    music.conductorBpm = this.bossId === 'maestro' && (active || g.mode === 'levelup') ? this.bpm : 0;
    if (active && !g.paused && !music.jukebox && music.playing) {
      const roadTrack = g.modes.rhythm && (g.boss || g.netBoss ? bossTrack(g.stage) : biomeForStage(g.arenaStage).music);
      // Rhythm Road already aligns its ordinary score. Alternate encounter arrangements use this clock.
      if (maestro ? music.playing === 'maestro' : music.playing !== roadTrack)
        music.alignBeat?.(this.beat % 1, 0.004, maestro ? this.beat : undefined);
    }
    this.hud ??= new BeatAccuracyHud(g.reticle);
    this.hud.draw(active && settings.beatCombat && !g.hero.player.dead, this.beat, this.bpm, g.hero.beatAccent);
  }
}
