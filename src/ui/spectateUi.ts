import { t, localizeHtml } from '../i18n';
import { iconHtml } from './pixelIcons';
import { prompt } from './prompts';
import { portraitCanvas, type Expression } from './portraitArt';
import { STYLE_RANKS } from '../game/style';
import type { EmoteDef } from '../game/coop2';
import type { Hero } from '../game/hero';
import type { PortraitLook } from './portraitArt';

/**
 * Spectate lane HUD (src/game/systems/spectate.ts drives it):
 * - for a spectator: the follow card (portrait, name, life, style rank, weapons)
 *   at the bottom, the camera chips (FOLLOW / AUTO / FREE CAM), the controls and
 *   JOIN line, and the BROADCAST OVERLAY: every player's card down the left
 *   side, a LIVE strip, and the personal HUD (life, gold, Mods, meters) hidden
 *   for a clean look on stream;
 * - for everyone in an online run: the "2 WATCHING" badge and the spectators'
 *   emote feed.
 * Plain DOM, styles injected once; it rebuilds markup only when what it shows
 * changes (checked at 6 Hz), so it costs nothing per frame.
 */
const CSS = `
#sp-root { position: absolute; inset: 0; pointer-events: none; z-index: 6; }
#sp-root .spf, #sp-root .sp-help, #sp-root .sp-card, #sp-root .sp-chip, #sp-root .sp-feed > div, #sp-root .sp-badge, #sp-root .sp-over {
  --bg: var(--night);
  --hi: var(--slate);
  --lo: var(--ink);
  --ring: transparent;
  background-color: var(--bg);
  box-shadow:
    inset var(--p) var(--p) 0 0 var(--hi),
    inset calc(-1 * var(--p)) calc(-1 * var(--p)) 0 0 var(--lo),
    0 calc(-1 * var(--p)) 0 0 var(--ink),
    0 var(--p) 0 0 var(--ink),
    calc(-1 * var(--p)) 0 0 0 var(--ink),
    var(--p) 0 0 0 var(--ink),
    0 calc(-2 * var(--p)) 0 0 var(--ring),
    0 calc(2 * var(--p)) 0 0 var(--ring),
    calc(-2 * var(--p)) 0 0 0 var(--ring),
    calc(2 * var(--p)) 0 0 0 var(--ring),
    calc(2 * var(--p)) calc(3 * var(--p)) 0 0 rgba(26, 28, 44, 0.55);
  color: var(--white);
  text-shadow: var(--outline);
}
#sp-root [hidden] { display: none !important; }
#sp-root canvas { image-rendering: pixelated; display: block; }
/* The players' side: who's watching and their emotes. */
/* Above the loadout (the goals stack on the left can grow long); the feed grows upward. */
#sp-root .sp-watch { position: absolute; left: 20px; bottom: 150px; zoom: var(--ui, 1); display: flex; flex-direction: column-reverse; gap: calc(3 * var(--p)); align-items: flex-start; }
/* A spectator: beside the broadcast cards, or above the controls box. */
body.spectating.sp-cast #sp-root .sp-watch { left: calc(18px + 104 * var(--p)); top: calc(9 * var(--p)); bottom: auto; flex-direction: column; }

#sp-root .sp-badge { font: 10px var(--label); letter-spacing: 1px; padding: calc(1.5 * var(--p)) calc(3 * var(--p)); display: flex; align-items: center; gap: calc(2 * var(--p)); --bg: var(--plum); --hi: #8a3f8a; }
#sp-root .eye, .sp-lobby .eye { width: calc(5 * var(--p)); height: calc(3 * var(--p)); background: var(--white); box-shadow: inset 0 0 0 var(--p) var(--ink); position: relative; }
#sp-root .eye::after, .sp-lobby .eye::after { content: ''; position: absolute; left: calc(2 * var(--p)); top: var(--p); width: var(--p); height: var(--p); background: var(--ink); }
#sp-root .sp-feed { display: flex; flex-direction: column; gap: calc(3 * var(--p)); }
#sp-root .sp-feed > div { font: 15px var(--font); padding: var(--p) calc(3 * var(--p)) var(--p) calc(2 * var(--p)); display: flex; align-items: center; gap: calc(2 * var(--p)); animation: sp-pop 0.24s steps(3) both; --ring: var(--ec); }
#sp-root .sp-feed b { font: 10px var(--label); color: var(--mist); letter-spacing: 1px; font-weight: normal; }
#sp-root .sp-feed span { color: var(--ec); }
#sp-root .sp-feed svg { width: calc(8 * var(--p)); height: calc(8 * var(--p)); }
@keyframes sp-pop { from { transform: translateX(calc(-10 * var(--p))); opacity: 0; } to { transform: none; opacity: 1; } }
/* Lobby: spectators under the players. */
.sp-lobby { display: flex; flex-wrap: wrap; justify-content: center; gap: calc(3 * var(--p)); margin: calc(3 * var(--p)) 0; }
.sp-lobby .sp-watcher { --bg: var(--plum); --hi: var(--red); color: var(--mist); display: flex; align-items: center; gap: calc(2 * var(--p)); font-size: 17px; padding: 2px 12px; }
.sp-lobby .sp-watcher small { font: 10px var(--label); letter-spacing: 1px; color: var(--yellow); }
.sp-lobby .eye { flex: none; display: inline-block; position: relative; }
body.sp-lobbywatch #scr-online .lob-readybtn { display: none !important; }
/* The spectator's own view. */
#sp-root .sp-live { position: absolute; top: calc(8 * var(--p)); left: 50%; transform: translateX(calc(-50% - 90px)); display: none; }
#sp-root .sp-follow { position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%); zoom: var(--ui, 1); display: flex; flex-direction: column; align-items: center; gap: calc(3 * var(--p)); }
#sp-root .sp-chips { display: flex; gap: calc(3 * var(--p)); align-items: center; }
#sp-root .sp-chip { font: 10px var(--label); letter-spacing: 1px; padding: var(--p) calc(2.5 * var(--p)); color: var(--mist); --drop: transparent; }
#sp-root .sp-chip.on { --bg: var(--blue); --hi: var(--sky); --lo: var(--navy); color: var(--white); }
#sp-root .sp-chip.live { --bg: var(--red); --hi: var(--orange); --lo: var(--plum); color: var(--white); }
#sp-root .sp-chip.live i { display: inline-block; width: calc(2 * var(--p)); height: calc(2 * var(--p)); background: var(--white); margin-right: calc(1.5 * var(--p)); vertical-align: middle; animation: sp-blink 1s steps(1) infinite; }
@keyframes sp-blink { 50% { opacity: 0; } }
#sp-root .spf { display: flex; align-items: center; gap: calc(3 * var(--p)); padding: calc(2 * var(--p)) calc(3 * var(--p)); --ring: var(--hc); min-width: calc(110 * var(--p)); }
#sp-root .spf canvas { width: calc(16 * var(--p)); height: calc(16 * var(--p)); box-shadow: 0 0 0 var(--p) var(--ink); background: var(--hc); }
#sp-root .spf .body { flex: 1; display: flex; flex-direction: column; gap: var(--p); }
#sp-root .nm { font: 20px var(--display); letter-spacing: 1px; color: var(--hc); line-height: 1; display: flex; align-items: baseline; gap: calc(2 * var(--p)); }
#sp-root .nm small { font: 10px var(--label); color: var(--mist); letter-spacing: 1px; }
#sp-root .nm .rk { margin-left: auto; font: 20px var(--display); color: var(--yellow); }
#sp-root .nm .rk.r0 { color: var(--slate); }
#sp-root .hpb { height: calc(3 * var(--p)); background: var(--ink); box-shadow: 0 0 0 calc(0.5 * var(--p)) var(--ink); position: relative; }
#sp-root .hpb > i { position: absolute; left: 0; top: 0; bottom: 0; background: var(--lime); box-shadow: inset 0 calc(-1 * var(--p)) 0 0 var(--green); }
#sp-root .hpb.low > i { background: var(--orange); box-shadow: inset 0 calc(-1 * var(--p)) 0 0 var(--red); }
#sp-root .ws { display: flex; gap: var(--p); }
#sp-root .ws .w { position: relative; }
#sp-root .ws .w i { position: absolute; right: calc(-0.5 * var(--p)); bottom: calc(-0.5 * var(--p)); font: 9px var(--label); font-style: normal; color: var(--white); text-shadow: var(--outline); }
#sp-root .ws .px-icon { width: 24px; height: 24px; }
#sp-root .tag { font: 10px var(--label); letter-spacing: 1px; color: var(--red); }
#sp-root .tag.ult { color: var(--yellow); }
#sp-root .sp-help { position: absolute; left: 20px; bottom: 20px; zoom: var(--ui, 1); font: 14px var(--font); color: var(--white); display: flex; flex-direction: column; gap: calc(1.5 * var(--p)); max-width: min(30vw, 400px); padding: calc(2 * var(--p)) calc(3 * var(--p)); }
#sp-root .sp-help .row { display: flex; flex-wrap: wrap; gap: calc(1.5 * var(--p)) calc(4 * var(--p)); align-items: center; }
#sp-root .sp-help .join { color: var(--lime); }
#sp-root .sp-help .emo { color: var(--mist); }
#sp-root .sp-help .emo b { color: var(--yellow); font-weight: normal; }
#sp-root .sp-status { position: absolute; left: 50%; top: 34%; transform: translateX(-50%); font: 24px var(--display); letter-spacing: 2px; color: var(--yellow); text-shadow: var(--outline); white-space: nowrap; }
#sp-root .sp-over { position: absolute; left: 50%; top: 40%; transform: translate(-50%, -50%); padding: calc(4 * var(--p)) calc(8 * var(--p)); text-align: center; --bg: var(--navy); --hi: var(--blue); --ring: var(--yellow); }
#sp-root .sp-over b { display: block; font: 40px var(--display); letter-spacing: 3px; color: var(--yellow); font-weight: normal; }
#sp-root .sp-over span { font: 10px var(--label); letter-spacing: 1px; color: var(--white); }
/* BROADCAST OVERLAY: one card per player down the left side. */
#sp-root .sp-cast { position: absolute; left: 18px; top: calc(9 * var(--p)); zoom: var(--ui, 1); display: flex; flex-direction: column; gap: calc(4 * var(--p)); }
#sp-root .sp-card { display: flex; gap: calc(2.5 * var(--p)); padding: calc(2 * var(--p)) calc(3 * var(--p)) calc(2 * var(--p)) calc(2 * var(--p)); width: calc(96 * var(--p)); --ring: transparent; }
#sp-root .sp-card.focus { --ring: var(--hc); --bg: var(--navy); --hi: var(--blue); }
#sp-root .sp-card.down { --bg: var(--plum); --hi: var(--red); }
#sp-root .sp-card canvas { width: calc(14 * var(--p)); height: calc(14 * var(--p)); background: var(--hc); box-shadow: 0 0 0 var(--p) var(--ink); flex: none; }
#sp-root .sp-card.down canvas { filter: grayscale(1); }
#sp-root .sp-card .body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: var(--p); }
#sp-root .sp-card .nm { font-size: 17px; }
#sp-root .sp-card .nm .rk { font-size: 17px; }
#sp-root .sp-card .ws .px-icon { width: 24px; height: 24px; }
#sp-root .sp-head { font: 10px var(--label); letter-spacing: 1px; color: var(--white); text-shadow: var(--outline); display: flex; gap: calc(3 * var(--p)); align-items: center; }
/* Spectating: nothing personal on screen (we have no hero). */
body.spectating #hp, body.spectating #runinfo, body.spectating #meters, body.spectating #mods, body.spectating #loadout,
body.spectating #downed, body.spectating #co2-buy, body.spectating #reticle, body.spectating #touch, body.spectating #navhint,
body.spectating #hudface, body.spectating #xpbar .lv, body.spectating #petpanel, body.spectating #teammeter, body.spectating #gp-cash,
body.spectating #ha-candy, body.spectating #ping-wheel, body.spectating #ob-tip { display: none !important; }
body.spectating.sp-cast #goals, body.spectating.sp-cast #team, body.spectating.sp-cast #stylemeter, body.spectating.sp-cast .sp-help .ctl { display: none !important; }
`;

let injected = false;
function injectCss(doc: Document): void {
  if (injected) return;
  injected = true;
  const s = doc.createElement('style');
  s.id = 'spectate-css';
  s.textContent = CSS;
  doc.head.appendChild(s);
}

export interface CastWeapon {
  id: string;
  color: string;
  icon: string;
  level: number;
  slot: string;
}

export interface CastCard {
  i: number;
  name: string;
  color: string;
  hp01: number;
  hp: number;
  down: boolean;
  left: boolean;
  rank: number;
  ult: boolean;
  weapons: CastWeapon[];
  look: PortraitLook;
  hero?: Hero;
}

export interface SpectateView {
  watching: boolean;
  badge: number;
  cast: CastCard[] | null;
  follow: CastCard | null;
  /** Hero index the camera follows (-1 = free). */
  focus: number;
  cam: 'follow' | 'auto' | 'free';
  emoteSel: number;
  emotes: readonly EmoteDef[];
  join: string;
  status: string;
  over: string;
  stage: number;
  level: number;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

export function glyphSvg(e: Pick<EmoteDef, 'glyph' | 'color'>): string {
  let r = '';
  e.glyph.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.') continue;
      r += `<rect x="${x}" y="${y}" width="1" height="1" fill="${ch === '#' ? '#1a1c2c' : e.color}"/>`;
    }
  });
  return `<svg viewBox="0 0 8 8" shape-rendering="crispEdges" aria-hidden="true">${r}</svg>`;
}

function expressionOf(c: CastCard): Expression {
  if (c.down) return 'shocked';
  if (c.ult) return 'determined';
  if (c.hp01 < 0.35) return 'hurt';
  if (c.rank >= 3) return 'grinning';
  return 'neutral';
}

function drawPortrait(cv: HTMLCanvasElement | null, c: CastCard): void {
  if (!cv) return;
  const key = `${c.name}|${c.color}|${expressionOf(c)}`;
  if (cv.dataset.k === key) return;
  cv.dataset.k = key;
  const src = portraitCanvas(c.look, expressionOf(c));
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.drawImage(src, 0, 0, cv.width, cv.height);
}

function weaponsHtml(ws: CastWeapon[]): string {
  return ws.map((w) => `<span class="w">${iconHtml(w.id, w.color, w.icon)}<i>${w.level}</i></span>`).join('');
}

function cardBody(c: CastCard, big: boolean): string {
  const rank = STYLE_RANKS[Math.max(0, Math.min(STYLE_RANKS.length - 1, c.rank))];
  const tag = c.left ? `<span class="tag">${t('spec.left')}</span>` : c.down ? `<span class="tag">${t('spec.down')}</span>` : c.ult ? '<span class="tag ult">ULT!</span>' : '';
  return `<div class="body">
    <div class="nm"><bdi>${esc(c.name.toUpperCase())}</bdi>${big ? `<small>${c.hp} HP</small>` : ''}${tag}<span class="rk r${c.rank}">${rank}</span></div>
    <div class="hpb ${c.hp01 < 0.35 ? 'low' : ''}"><i style="width:${Math.round(c.hp01 * 100)}%"></i></div>
    <div class="ws">${weaponsHtml(c.weapons)}</div>
  </div>`;
}

const cardKey = (c: CastCard) => `${c.i}|${c.name}|${Math.round(c.hp01 * 40)}|${c.hp}|${c.down}|${c.left}|${c.rank}|${c.ult}|${c.weapons.map((w) => w.id + w.level).join(',')}`;

export class SpectateUi {
  readonly root: HTMLElement;
  private watch: HTMLElement;
  private badge: HTMLElement;
  private feed: HTMLElement;
  private follow: HTMLElement;
  private chips: HTMLElement;
  private card: HTMLElement;
  private help: HTMLElement;
  private status: HTMLElement;
  private over: HTMLElement;
  private cast: HTMLElement;
  private keys = new Map<HTMLElement, string>();
  private t = 0;

  constructor(hudRoot: HTMLElement) {
    injectCss(hudRoot.ownerDocument);
    const el = (this.root = hudRoot.ownerDocument.createElement('div'));
    el.id = 'sp-root';
    el.innerHTML = `<div class="sp-watch"><div class="sp-badge" hidden></div><div class="sp-feed"></div></div>
      <div class="sp-cast" hidden></div>
      <div class="sp-follow" hidden><div class="sp-chips"></div><div class="spf"></div></div>
      <div class="sp-help" hidden></div>
      <div class="sp-status" hidden></div>
      <div class="sp-over" hidden></div>`;
    hudRoot.appendChild(el);
    const q = (s: string) => el.querySelector<HTMLElement>(s)!;
    this.watch = q('.sp-watch');
    this.badge = q('.sp-badge');
    this.feed = q('.sp-feed');
    this.cast = q('.sp-cast');
    this.follow = q('.sp-follow');
    this.chips = q('.sp-chips');
    this.card = q('.spf');
    this.help = q('.sp-help');
    this.status = q('.sp-status');
    this.over = q('.sp-over');
  }

  /** True when it's time to refresh (6 Hz): the caller builds the view only then. */
  due(dt: number): boolean {
    this.t -= dt;
    if (this.t > 0) return false;
    this.t = 1 / 6;
    return true;
  }

  private set(el: HTMLElement, html: string): boolean {
    if (this.keys.get(el) === html) return false;
    this.keys.set(el, html);
    el.innerHTML = localizeHtml(html);
    return true;
  }

  private show(el: HTMLElement, on: boolean): void {
    if (el.hidden === !on) return;
    el.hidden = !on;
  }

  update(v: SpectateView): void {
    // Everyone: the watcher badge.
    this.show(this.badge, v.badge > 0);
    if (v.badge > 0) this.set(this.badge, `<span class="eye"></span>${t('spec.badge', { n: v.badge })}`);
    // The spectator's view.
    this.show(this.follow, v.watching && !v.over);
    this.show(this.help, v.watching && !v.over);
    if (v.watching) {
      const chip = (id: SpectateView['cam'], label: string) => `<span class="sp-chip ${v.cam === id ? 'on' : ''}">${label}</span>`;
      this.set(this.chips, `<span class="sp-chip live"><i></i>${t('spec.live')}</span><span class="sp-chip">STAGE ${v.stage} · LV ${v.level}</span>${chip('follow', t('spec.follow'))}${chip('auto', t('spec.auto'))}${chip('free', t('spec.free'))}`);
      const f = v.follow;
      this.show(this.card, !!f);
      if (f) {
        this.card.style.setProperty('--hc', f.color);
        if (this.set(this.card, `<canvas width="32" height="32"></canvas>${cardBody(f, true)}`)) this.card.dataset.k = '';
        drawPortrait(this.card.querySelector('canvas'), f);
      }
      const em = v.emotes.map((e, k) => (k === v.emoteSel ? `<b>${k + 1} ${e.label}</b>` : `${k + 1} ${e.label}`)).join(' · ');
      this.set(
        this.help,
        `${v.join ? `<div class="row join">${prompt('team')} ${esc(v.join)}</div>` : ''}
        <div class="row emo">${t('spec.emote')}: ${em}</div>
        <div class="row ctl"><span>${prompt('switch')} ${t('spec.nextPlayer')}</span><span>${prompt('dash')} ${t('spec.prevPlayer')}</span><span>${prompt('reroll')} ${t('spec.camera')}</span><span>${prompt('move')} ${t('spec.pan')}</span><span>${prompt('bomb')} ${t('spec.overlay')}</span></div>`,
      );
    }
    this.show(this.status, v.watching && !!v.status && !v.over);
    if (v.watching && v.status) this.set(this.status, esc(v.status));
    this.show(this.over, !!v.over);
    if (v.over) this.set(this.over, `<b>${t('spec.over')}</b><span>${esc(v.over)}</span>`);
    // BROADCAST OVERLAY.
    const cast = v.cast;
    this.show(this.cast, !!cast && !v.over);
    if (cast) {
      const sig = cast.map(cardKey).join('/') + `|${v.focus}`;
      if (this.keys.get(this.cast) !== sig) {
        this.keys.set(this.cast, sig);
        this.cast.innerHTML = localizeHtml(
          `<div class="sp-head"><span class="sp-chip live"><i></i>${t('spec.live')}</span></div>` +
            cast.map((c) => `<div class="sp-card ${c.i === v.focus ? 'focus' : ''} ${c.down || c.left ? 'down' : ''}" style="--hc:${c.color}"><canvas width="32" height="32"></canvas>${cardBody(c, false)}</div>`).join(''),
        );
      }
      const cvs = this.cast.querySelectorAll<HTMLCanvasElement>('canvas');
      cast.forEach((c, k) => drawPortrait(cvs[k] ?? null, c));
    }
  }

  /** A spectator's emote in the feed (everyone sees it). */
  emote(name: string, e: EmoteDef): void {
    const line = this.feed.ownerDocument.createElement('div');
    line.style.setProperty('--ec', e.color);
    line.innerHTML = `${glyphSvg(e)}<b><bdi>${esc(name.toUpperCase())}</bdi></b><span>${esc(e.say)}</span>`;
    this.feed.appendChild(line);
    while (this.feed.children.length > 4) this.feed.firstElementChild?.remove();
    setTimeout(() => line.remove(), 4000);
  }

  /** Leaving the run: drop the spectator-only pieces. */
  hideRun(): void {
    for (const el of [this.cast, this.follow, this.help, this.status, this.over]) el.hidden = true;
    this.keys.clear();
  }

  get el(): HTMLElement {
    return this.watch;
  }
}
