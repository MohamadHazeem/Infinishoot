import { markClip } from './clips';
/**
 * Finisher lane: boss finishers and character portraits.
 * Game methods (`this` is the Game), installed on the class as fields.
 *
 * Finishers: the killing blow on a stage boss is caught on the host
 * (`finisherCatch`, called first thing in killEnemy), which starts the comic
 * finisher on every machine through a team-wide effects event and holds the
 * simulation (`finisherHold`) until it ends; then the kill runs as usual
 * (explosion chain, kill-cam, stage clear or victory). Pressing anything
 * skips it (the host's skip ends the hold early).
 *
 * Portraits: the local hero's face on the HUD reacts to what's happening, and
 * the announcer, bosses (entrance, phase changes, gloating) and co-op pings
 * pop in with a line. All of it is presentation worked out locally from
 * synced state, except pings, which the host sends as 'P' effects events.
 */
import type { Game } from '../game';
import type { Enemy } from '../enemies';
import type { Hero } from '../hero';
import { ENEMIES } from '../../data/enemies';
import { HERO_BY_ID } from '../../data/heroes';
import { skinOf } from '../../data/skins';
import { customSkin } from '../heroLooks';
import { ANNOUNCER_LOOK, bossLook, heroLook, type Expression, type PortraitLook } from '../../ui/portraitArt';
import { blinkAt, hudExpression, portraits, type HudMood, type Speaker } from '../../ui/portraits';
import { reduceMotion } from '../../ui/hud';
import { FinisherView, finisherLength, finisherTuning } from '../finisher';
import { access, settings } from '../settings';
import { samples } from '../../audio/samples';
import { sfx } from '../../audio/sfx';
import { announcer } from '../../audio/announcer';
import { bossTrack } from '../../audio/music';

/** Dev / test-link switches (src/dev/testLinks.ts): pin the finisher at a time, force the HUD face. */
export const charDebug = { holdAt: -1, face: '' as Expression | '' };

/** What bosses say when they pop in. */
export const BOSS_LINES: Record<string, { intro: string; phase: string[]; gloat: string }> = {
  architect: { intro: 'Omega was only my first draft.', phase: ['I remember every battle.', 'Break the pattern. Build your own future.'], gloat: 'Back to the drawing board.' },
  cake: { intro: 'TIME FOR DESSERT!', phase: ['LESS CAKE, MORE FURY!', 'BLOW OUT THE CANDLES!'], gloat: 'A PIECE OF CAKE!' },
  kraken: { intro: 'THE DEEP REMEMBERS!', phase: ['LIGHTS OUT!', 'ALL TIDES LEAD TO ME!'], gloat: 'BACK TO THE SHALLOWS!' },
  king: { intro: 'BOW BEFORE THE BOUNCE!', phase: ['ROYAL GUARD, SLAM!', 'OFF WITH YOUR HEAD!'], gloat: 'LONG LIVE THE KING!' },
  rex: { intro: 'NO WALL CAN STOP ME!', phase: ['RAMPAGE TIME!', 'FEEL THE FIRE!'], gloat: 'FLATTENED!' },
  queen: { intro: 'MY SWARM HUNGERS...', phase: ['HATCH, MY DARLINGS!', 'THERE IS NO GAP!'], gloat: 'BACK TO THE HIVE!' },
  dj: { intro: 'DROP THE BEAT!', phase: ['TURN IT UP!', 'REMIX TIME!'], gloat: 'YOU MISSED THE BEAT!' },
  jack: { intro: 'SURPRISE!', phase: ['ONE-TWO!', 'THE BOX IS OPEN!'], gloat: 'POP GOES THE HERO!' },
  airship: { intro: 'ALL HANDS, FIRE!', phase: ['FULL SAIL!', 'THE STORM IS MINE!'], gloat: 'OVERBOARD WITH YOU!' },
  omega: { intro: 'I AM THE FINAL PROGRAM.', phase: ['OVERDRIVE ENGAGED.', 'LAST PROTOCOL: DELETE.'], gloat: 'PROCESS TERMINATED.' },
};

/** Announcer line ids -> bubble text and face. */
export const ANNOUNCER_LINES: Record<string, [string, Expression]> = {
  go: ['GO GO GO!', 'determined'],
  boss: ['WARNING! BOSS INCOMING!', 'shocked'],
  elite: ['ELITE ON THE FIELD!', 'determined'],
  stage_clear: ['STAGE CLEAR!', 'victorious'],
  game_over: ['GAME OVER...', 'hurt'],
  evolution: ['EVOLUTION!', 'grinning'],
  legendary: ['LEGENDARY!', 'shocked'],
  ultimate: ['ULTIMATE!', 'grinning'],
  overdrive: ['OVERDRIVE!', 'grinning'],
  rank_s: ['S RANK! STYLISH!', 'victorious'],
  rank_a: ['A RANK!', 'grinning'],
  parry: ['PARRY!', 'grinning'],
  perfect: ['PERFECT!', 'grinning'],
  unstoppable: ['UNSTOPPABLE!', 'shocked'],
  awesome: ['AWESOME!', 'grinning'],
  great: ['GREAT!', 'grinning'],
  combo: ['COMBO!', 'grinning'],
  level_up: ['LEVEL UP!', 'grinning'],
};

export const ANNOUNCER_NAME = 'MC TUBE';

interface CharState {
  view: FinisherView | null;
  /** Host: the boss whose death waits for the finisher. */
  pending: { e: Enemy; source: string; by: Hero | null } | null;
  holdT: number;
  releasing: boolean;
  clock: number;
  hurtAt: number;
  lastHp: number;
  lastFace: PortraitLook | null;
  faceHero: string;
  faceSkin: string;
  faceArmor: string;
  bossId: string;
  bossPhase: number;
  entrance: string;
  wasDead: boolean;
  wired: boolean;
}

const states = new WeakMap<Game, CharState>();
function state(g: Game): CharState {
  let s = states.get(g);
  if (!s) {
    s = { view: null, pending: null, holdT: 0, releasing: false, clock: 0, hurtAt: -9, lastHp: -1, lastFace: null, faceHero: '', faceSkin: '', faceArmor: '', bossId: '', bossPhase: 1, entrance: '', wasDead: false, wired: false };
    states.set(g, s);
  }
  return s;
}

/** A hero's portrait look (co-op armour keeps the player colour, like the 3D model). */
export function heroPortrait(g: Game, h: Hero): PortraitLook {
  const skin = customSkin(h.skin, h.player.look); // CUSTOMISE colours (graphics lane)
  return heroLook(h.heroDef.id, skin, g.heroes.length > 1 ? h.color : skin.armor);
}

/** 'announcer', 'boss:<enemy id>', 'hero:<player index>' or 'hero:<hero id>' -> who to draw. */
export function resolveSpeaker(this: Game, who: string): Speaker | null {
  if (who === 'announcer') return { look: ANNOUNCER_LOOK, name: ANNOUNCER_NAME, color: '#73eff7', side: 'left' };
  const [kind, id] = who.split(':');
  if (kind === 'boss') {
    const def = ENEMIES[id];
    return def ? { look: bossLook(def), name: def.name, color: def.accentColor, side: 'right' } : null;
  }
  if (kind === 'hero') {
    const h = /^\d+$/.test(id) ? this.heroes[Number(id)] : null;
    if (h) return { look: heroPortrait(this, h), name: h.name || h.heroDef.name, color: h.color, side: 'left' };
    const def = HERO_BY_ID[id];
    if (def) {
      const skin = skinOf(settings.skin);
      return { look: heroLook(def.id, skin), name: def.name, color: skin.armor, side: 'left' };
    }
  }
  return null;
}

// ---------------------------------------------------------------- finisher (host)

/** killEnemy hook: catch a stage boss's killing blow and play the finisher first. True = hold the kill. */
export function finisherCatch(this: Game, e: Enemy, source: string, by: Hero | null): boolean {
  const st = state(this);
  if (st.releasing) return false;
  if (st.pending) return st.pending.e === e; // the held boss can't die twice
  if (!e.def.boss || e.def.miniboss || !e.active || !this.authority || this.pvp || this.mode !== 'fight' || settings.finishers === false) return false;
  const killer = by && !by.left ? by : (this.aliveHeroes[0] ?? this.hero);
  e.hp = 0;
  st.pending = { e, source, by };
  st.holdT = finisherLength(reduceMotion());
  this.vfx.finisher(e.def.id, killer.index, e.x, e.z);
  return true;
}

/** Host step hook: true while the world holds still for the finisher; releases the kill at the end. */
export function finisherHold(this: Game, dt: number): boolean {
  const st = states.get(this);
  const p = st?.pending;
  if (!st || !p) return false;
  if (!p.e.active || this.mode !== 'fight') {
    st.pending = null;
    return false;
  }
  if (charDebug.holdAt < 0) st.holdT -= dt;
  if (st.holdT > 0) return true;
  st.pending = null;
  st.releasing = true;
  try {
    this.killEnemy(p.e, p.source, p.by);
  } finally {
    st.releasing = false;
  }
  return false;
}

/** Effects-bus target (every machine): the finisher starts here. */
export function onFinisher(this: Game, bossId: string, heroIndex: number, x: number, z: number): void {
  markClip(this, 'boss');
  const def = ENEMIES[bossId];
  if (!def || settings.finishers === false) return;
  const st = state(this);
  if (!st.view) {
    const root = document.getElementById('ingame')?.parentElement;
    if (!root) return;
    st.view = new FinisherView(root);
    st.view.onSkip = () => {
      if (st.pending) st.holdT = Math.min(st.holdT, finisherTuning.out);
    };
    st.view.onCue = (cue) => {
      const id = cue === 'whoosh' ? 'finisher_whoosh' : 'finisher_hit';
      const played = samples.play(id, { bus: 'sfx', gain: cue === 'hit' ? 1 : 0.85, priority: 12, variation: 0, limit: 1 });
      if (!played) {
        if (cue === 'whoosh') sfx.whoosh(0);
        else sfx.bomb();
      }
      if (cue === 'hit') this.input.rumble(0.9, 0.6, 260);
    };
  }
  const h = this.heroes[heroIndex] ?? this.hero;
  // Where the boss is on screen, for the freeze-frame focus lines.
  const v = this.tmp.set(x, 1.5, z).project(this.cam.camera);
  const calm = reduceMotion();
  st.view.start({
    hero: heroPortrait(this, h),
    heroName: h.name && this.heroes.length > 1 ? h.name : h.heroDef.name,
    heroColor: this.heroes.length > 1 ? h.color : h.skin.armor,
    boss: bossLook(def),
    bossName: def.name,
    bossColor: def.bodyColor,
    bossAccent: def.accentColor,
    omega: def.id === 'omega' || bossTrack(this.stage) === 'omega',
    focus: Number.isFinite(v.x) ? { x: (v.x + 1) / 2, y: (1 - v.y) / 2 } : null,
    calm,
    flashes: !access.reduceFlash,
    shake: settings.shake,
  });
  sfx.duck(finisherLength(calm), 0.4);
  portraits.clear();
}

// ---------------------------------------------------------------- render (every machine)

const mood: HudMood = { dead: false, hp01: 1, sinceHurt: Infinity, won: false, hype: false, tense: false };

/** Per frame: the finisher overlay, the HUD face, boss and announcer pop-ins. */
export function renderCharacters(this: Game, frameDt: number): void {
  const st = state(this);
  if (!st.wired) {
    st.wired = true;
    portraits.resolve = (who) => this.resolveSpeaker(who);
    announcer.onSay = (id, seconds) => {
      const line = ANNOUNCER_LINES[id];
      if (line && this.mode !== 'title') portraits.popIn('announcer', line[1], line[0], Math.max(1.4, seconds + 0.7));
    };
  }
  portraits.enabled = settings.portraitPops !== false;
  const frozen = this.paused && this.role === 'solo';
  const dt = frozen ? 0 : frameDt;
  st.clock += dt;

  // Finisher overlay
  const view = st.view;
  if (view?.active) {
    if (this.mode === 'title' || this.mode === 'dead') view.stop();
    else if (charDebug.holdAt >= 0) {
      if (view.t < charDebug.holdAt) view.update(Math.min(dt, charDebug.holdAt - view.t));
      else view.update(0);
    } else view.update(dt);
  }

  const h = this.hero;
  const inRun = this.mode !== 'title' && !!h && !h.left;
  if (!inRun) {
    portraits.setHud(null, 'neutral', false, '');
    if (this.mode === 'title') portraits.clear();
    st.bossId = '';
    st.lastHp = -1;
    st.wasDead = false;
    return;
  }

  // HUD face
  const p = h.player;
  if (st.lastHp >= 0 && p.hp < st.lastHp - 0.5) st.hurtAt = st.clock;
  if (p.hurtFlash > 0.1) st.hurtAt = Math.max(st.hurtAt, st.clock - (0.15 - p.hurtFlash));
  st.lastHp = p.hp;
  const boss = currentBoss(this);
  const sinceHurt = st.clock - st.hurtAt;
  mood.dead = p.dead;
  mood.hp01 = p.hp / Math.max(1, p.maxHp);
  mood.sinceHurt = sinceHurt;
  mood.won = this.mode === 'cleared' || this.mode === 'portal' || this.mode === 'shop' || (!!view?.active && view.t > finisherTuning.strike);
  mood.hype = h.skill.style.rank >= 4 || this.combo >= 50 || h.skill.ultT > 0;
  mood.tense = !!boss || h.ctx.charging;
  const expr = charDebug.face || hudExpression(mood);
  const armor = this.heroes.length > 1 ? h.color : h.skin.armor;
  if (h.heroDef.id !== st.faceHero || h.skin.id + h.player.look !== st.faceSkin || armor !== st.faceArmor) {
    st.faceHero = h.heroDef.id;
    st.faceSkin = h.skin.id + h.player.look;
    st.faceArmor = armor;
    st.lastFace = heroPortrait(this, h);
  }
  const cls = mood.dead ? 'down' : mood.won ? 'won' : sinceHurt < 0.25 ? (mood.hp01 <= 0.3 ? 'low hit' : 'hit') : mood.hp01 <= 0.3 ? 'low' : '';
  portraits.setHud(st.lastFace, expr, blinkAt(st.clock), cls);

  // Boss pop-ins: entrance (after its intro card), phase changes, gloating when you go down.
  const id = boss ? boss.def.id : '';
  if (id !== st.bossId) {
    st.bossId = id;
    st.bossPhase = boss ? boss.phase : 1;
    st.entrance = id;
  }
  const lines = boss ? (BOSS_LINES[boss.def.id] ?? BOSS_LINES[boss.def.model]) : undefined;
  if (boss && st.entrance && !this.bossIntro.active) {
    st.entrance = '';
    if (lines) portraits.popIn(`boss:${id}`, 'grinning', lines.intro, 3);
  }
  if (boss && boss.phase !== st.bossPhase) {
    if (boss.phase > st.bossPhase && lines) {
      const last = boss.phase > (boss.def.phases?.length ?? 0);
      portraits.popIn(`boss:${id}`, last ? 'grinning' : 'determined', lines.phase[Math.min(lines.phase.length - 1, boss.phase - 2)] ?? '', 2.8);
    }
    st.bossPhase = boss.phase;
  }
  if (p.dead && !st.wasDead && boss && lines) portraits.popIn(`boss:${id}`, 'victorious', lines.gloat, 2.6);
  st.wasDead = p.dead;

  portraits.update(dt);
}

/** The stage boss on this machine (host: the real one; client: the mirrored enemy). */
function currentBoss(g: Game): Enemy | null {
  if (g.role !== 'client') return g.boss && g.boss.active && g.boss.def.boss ? g.boss : null;
  for (const e of g.enemies.list) if (e.active && e.def.boss && !e.def.miniboss) return e;
  return null;
}

/** A teammate's ping pops their portrait in for everyone (host; replayed on clients by the effects bus). */
export function pingPortrait(this: Game, h: Hero, label: string): void {
  this.vfx.portrait(`hero:${h.index}`, 'determined', label, 1.8);
}
