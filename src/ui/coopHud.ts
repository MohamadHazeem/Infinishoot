import { localizeHtml } from '../i18n';
import { ROLES, ROLE_ORDER, bonusText, roleOf, type CoopRole, type RoleBonus } from '../data/coopRoles';
import { prompt } from './prompts';
import { poolTuning, type EmoteDef } from '../game/coop2';
import { settings, saveSettings } from '../game/settings';
import type { Game } from '../game/game';

/**
 * Co-op HUD for the coop2 lane: the team panel (JOINABLE code, party roles and
 * their bonus, the shared revive pool), the downed player's BUY BACK prompt,
 * emote / autopilot / ghost bubbles over heroes, the TEAM ULTIMATE burst, and
 * the lobby section (roles, REVIVE POOL and JOIN ANYTIME switches). Plain DOM,
 * styles injected once, only touches the DOM when what it shows changes.
 */
const CSS = `
#co2-panel, #co2-buy, .co2-bub {
  --bg: var(--night);
  --hi: var(--slate);
  --lo: var(--ink);
  background-color: var(--bg);
  box-shadow:
    inset var(--p) var(--p) 0 0 var(--hi),
    inset calc(-1 * var(--p)) calc(-1 * var(--p)) 0 0 var(--lo),
    0 calc(-1 * var(--p)) 0 0 var(--ink),
    0 var(--p) 0 0 var(--ink),
    calc(-1 * var(--p)) 0 0 0 var(--ink),
    var(--p) 0 0 0 var(--ink),
    0 calc(2 * var(--p)) 0 0 var(--ink);
  pointer-events: none;
  text-shadow: var(--outline);
}
#co2-panel {
  position: absolute;
  right: 20px;
  /* Just above the minimap (bottom 100px, 50 UI pixels tall), under the style meter. */
  bottom: calc(100px + 52 * var(--p) + 14px);
  width: calc(64 * var(--p));
  padding: calc(2 * var(--p)) calc(3 * var(--p));
  zoom: var(--ui, 1);
  font: 10px var(--label);
  letter-spacing: 1px;
  color: var(--white);
}
#co2-panel[hidden], #co2-buy[hidden] { display: none; }
#co2-panel .row { display: flex; align-items: center; gap: calc(1.5 * var(--p)); flex-wrap: wrap; }
#co2-panel .row + .row { margin-top: calc(2 * var(--p)); }
#co2-panel .join { color: var(--lime); }
#co2-panel .join b { font: 16px var(--display); color: var(--white); letter-spacing: 2px; font-weight: normal; }
#co2-panel .role { display: inline-flex; align-items: center; gap: var(--p); color: var(--rc); }
#co2-panel .role i { width: calc(2 * var(--p)); height: calc(2 * var(--p)); background: var(--hc); box-shadow: 0 0 0 calc(0.5 * var(--p)) var(--ink); }
#co2-panel .bonus { font: 13px var(--font); letter-spacing: 0; color: var(--yellow); line-height: 1.1; }
#co2-panel .bonus.none { color: var(--mist); }
#co2-panel .pool { color: var(--orange); }
#co2-panel .hearts { display: inline-flex; gap: var(--p); }
#co2-panel .hearts i { width: calc(3 * var(--p)); height: calc(3 * var(--p)); background: var(--red); box-shadow: inset calc(-1 * var(--p)) calc(-1 * var(--p)) 0 0 var(--plum), 0 0 0 calc(0.5 * var(--p)) var(--ink); }
#co2-panel .hearts i.off { background: var(--ink); box-shadow: 0 0 0 calc(0.5 * var(--p)) var(--slate); }
#co2-buy {
  position: absolute;
  left: calc(50% + 172px);
  top: 60%;
  max-width: calc(50% - 192px);
  padding: calc(2 * var(--p)) calc(4 * var(--p));
  text-align: center;
  zoom: var(--ui, 1);
  --bg: var(--plum);
  --hi: var(--red);
}
#co2-buy .t { font: 20px var(--font); color: var(--white); }
#co2-buy .s { font: 10px var(--label); letter-spacing: 1px; color: var(--yellow); margin-top: 2px; }
#co2-buy .bar { display: flex; gap: var(--p); margin-top: calc(2 * var(--p)); height: calc(2 * var(--p)); }
#co2-buy .bar i { flex: 1; background: var(--ink); }
#co2-buy .bar i.on { background: var(--yellow); }
#co2-buy.ok { --bg: var(--teal); --hi: var(--lime); animation: hop 0.6s steps(2) infinite; }
.reduce-flash #co2-buy.ok { animation: none; }
#co2-bubs { position: absolute; left: 0; top: 0; width: 0; height: 0; pointer-events: none; z-index: 5; }
.co2-bub {
  position: absolute;
  left: 0;
  top: 0;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: calc(1.5 * var(--p));
  padding: var(--p) calc(2 * var(--p));
  font: 16px var(--font);
  color: var(--white);
  --hi: var(--bc);
}
.co2-bub img { width: calc(8 * var(--p)); height: calc(8 * var(--p)); image-rendering: pixelated; }
.co2-bub::after {
  content: '';
  position: absolute;
  left: calc(50% - var(--p));
  bottom: calc(-3 * var(--p));
  width: calc(2 * var(--p));
  height: calc(2 * var(--p));
  background: var(--bg);
  box-shadow: 0 var(--p) 0 0 var(--ink), calc(-1 * var(--p)) 0 0 0 var(--ink), var(--p) 0 0 0 var(--ink);
}
.co2-bub.pop { animation: co2pop 0.3s steps(3); }
@keyframes co2pop { 0% { scale: 0.4; } 60% { scale: 1.15; } 100% { scale: 1; } }
.co2-bub.quiet { font: 10px var(--label); letter-spacing: 1px; color: var(--bc); --hi: var(--slate); }
#co2-ult {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 4;
  box-shadow: inset 0 0 0 calc(4 * var(--p)) var(--yellow), inset 0 0 0 calc(8 * var(--p)) var(--orange), inset 0 0 0 calc(10 * var(--p)) var(--ink);
  opacity: 0;
}
#co2-ult.on { animation: co2ult 1.4s steps(7) forwards; }
@keyframes co2ult { 0% { opacity: 1; } 40% { opacity: 0.8; } 100% { opacity: 0; } }
.reduce-flash #co2-ult.on { animation-duration: 0.01s; }
.co2-lobby { margin-top: calc(3 * var(--p)); }
.co2-lobby .roles { display: flex; flex-wrap: wrap; justify-content: center; gap: calc(2 * var(--p)); font: 10px var(--label); letter-spacing: 1px; }
.co2-lobby .roles span { color: var(--rc); }
.co2-lobby .bonus { font: 15px var(--font); color: var(--yellow); text-align: center; margin-top: var(--p); }
`;

export interface CoopHudView {
  show: boolean;
  join: [string, number] | null;
  roles: { role: CoopRole; color: string; name: string }[];
  bonus: RoleBonus;
  pool: [number, number] | null;
  buy: { wait01: number; ok: boolean; cost: number; lives: number } | null;
  tags: { key: string; x: number; y: number; text: string; color: string; glyph: EmoteDef | null; fade: number }[];
}

const glyphCache = new Map<string, string>();

/** An emote's 8x8 glyph as a data URL (drawn once). */
function glyphUrl(e: EmoteDef): string {
  let url = glyphCache.get(e.id);
  if (url) return url;
  const c = document.createElement('canvas');
  c.width = c.height = 8;
  const x = c.getContext('2d');
  if (x) {
    e.glyph.forEach((row, j) => {
      for (let i = 0; i < 8; i++) {
        const ch = row[i];
        if (ch !== 'o' && ch !== '#') continue;
        x.fillStyle = ch === '#' ? '#1a1c2c' : e.color;
        x.fillRect(i, j, 1, 1);
      }
    });
  }
  url = c.toDataURL?.() ?? '';
  glyphCache.set(e.id, url);
  return url;
}

export class CoopHud {
  private panel: HTMLElement;
  private buy: HTMLElement;
  private bubs: HTMLElement;
  private ult: HTMLElement;
  private bubEls = new Map<string, HTMLElement>();
  private keys = { panel: '', buy: '' };

  constructor() {
    if (!document.getElementById('co2-css')) {
      const st = document.createElement('style');
      st.id = 'co2-css';
      st.textContent = CSS;
      document.head.appendChild(st);
    }
    const root = document.getElementById('hud') ?? document.body;
    this.panel = this.add(root, 'co2-panel');
    this.buy = this.add(root, 'co2-buy');
    this.bubs = this.add(root, 'co2-bubs');
    this.ult = this.add(root, 'co2-ult');
    this.panel.hidden = this.buy.hidden = true;
  }

  private add(root: HTMLElement, id: string): HTMLElement {
    const el = document.createElement('div');
    el.id = id;
    root.appendChild(el);
    return el;
  }

  render(v: CoopHudView): void {
    // Team panel.
    const pk = v.show ? JSON.stringify([v.join, v.roles, v.pool]) : '';
    if (pk !== this.keys.panel) {
      this.keys.panel = pk;
      this.panel.hidden = !v.show;
      if (v.show) {
        const rows: string[] = [];
        if (v.join) rows.push(`<div class="row join">JOINABLE · <b>${v.join[0]}</b> · ${v.join[1]}/4</div>`);
        rows.push(`<div class="row">${v.roles.map((r) => `<span class="role" style="--rc:${ROLES[r.role].color};--hc:${r.color}"><i></i>${ROLES[r.role].name}</span>`).join('')}</div>`);
        const txt = bonusText(v.bonus);
        rows.push(`<div class="row bonus ${txt ? '' : 'none'}">${txt ? `TEAM x${v.bonus.scale}: ${txt}` : 'MIX ROLES FOR A TEAM BONUS'}</div>`);
        if (v.pool) {
          const max = Math.max(poolTuning.max, v.pool[0]);
          const hearts = Array.from({ length: max }, (_, i) => `<i class="${i < v.pool![0] ? '' : 'off'}"></i>`).join('');
          rows.push(`<div class="row pool">TEAM LIVES <span class="hearts">${hearts}</span></div>`);
        }
        this.panel.innerHTML = localizeHtml(rows.join(''));
      }
    }
    // Downed: buy back.
    const bk = v.buy ? `${Math.round(v.buy.wait01 * 8)}|${v.buy.ok}|${v.buy.cost}|${v.buy.lives}` : '';
    if (bk !== this.keys.buy) {
      this.keys.buy = bk;
      this.buy.hidden = !v.buy;
      if (v.buy) {
        const b = v.buy;
        const pips = Array.from({ length: 8 }, (_, i) => `<i class="${i < Math.round(b.wait01 * 8) ? 'on' : ''}"></i>`).join('');
        const t = b.lives <= 0 ? 'THE POOL IS EMPTY' : b.ok ? `${prompt('team')} BUY BACK IN · ${b.cost}●` : b.wait01 < 1 ? 'BUY BACK SOON...' : `BUY BACK: ${b.cost}● (TEAM CAN'T PAY)`;
        this.buy.className = b.ok ? 'ok' : '';
        this.buy.innerHTML = localizeHtml(`<div class="t">${t}</div><div class="s">SHARED POOL · ${b.lives} ${b.lives === 1 ? 'LIFE' : 'LIVES'} · EVERYONE CHIPS IN</div><div class="bar">${pips}</div>`);
      }
    }
    // Bubbles.
    const seen = new Set<string>();
    for (const t of v.tags) {
      seen.add(t.key);
      const key = `${t.key}|${t.text}`;
      let el = this.bubEls.get(t.key);
      if (!el || el.dataset.k !== key) {
        el?.remove();
        el = document.createElement('div');
        el.className = `co2-bub${t.glyph ? ' pop' : ' quiet'}`;
        el.dataset.k = key;
        el.style.setProperty('--bc', t.color);
        el.innerHTML = localizeHtml(`${t.glyph ? `<img alt="" src="${glyphUrl(t.glyph)}">` : ''}<span>${t.text}</span>`);
        this.bubs.appendChild(el);
        this.bubEls.set(t.key, el);
      }
      el.style.transform = `translate(${Math.round(t.x)}px, ${Math.round(t.y)}px) translate(-50%, -100%)`;
      el.style.opacity = String(t.fade);
    }
    for (const [k, el] of this.bubEls) {
      if (seen.has(k)) continue;
      el.remove();
      this.bubEls.delete(k);
    }
  }

  /** Nothing to show (plain solo): hide everything once. */
  idle(): void {
    if (this.keys.panel === '' && this.keys.buy === '' && !this.bubEls.size) return;
    this.render({ show: false, join: null, roles: [], bonus: { distinct: 0, scale: 0, armor: 0, regen: 0, damageMul: 0, moveSpeedMul: 0, magnetMul: 0, roles: [] }, pool: null, buy: null, tags: [] });
  }

  /** The TEAM ULTIMATE burst over the screen. */
  teamUlt(): void {
    this.ult.classList.remove('on');
    void this.ult.offsetWidth;
    this.ult.classList.add('on');
  }

  /** The lobby section: roles, the team bonus and (host) the REVIVE POOL / JOIN ANYTIME switches. */
  lobby(g: Game, info: { pool: boolean; join: boolean; roles: string[]; names?: string[] } | null, isHost: boolean): void {
    const host = document.querySelector('#scr-online .lobby');
    if (!host) return;
    let el = host.querySelector<HTMLElement>('.co2-lobby');
    if (!info) {
      el?.remove();
      return;
    }
    if (!el) {
      el = document.createElement('div');
      el.className = 'co2-lobby';
      host.appendChild(el);
      el.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-co2]');
        if (!b || b.hasAttribute('disabled')) return;
        if (b.dataset.co2 === 'pool') settings.coopPool = b.dataset.v === '1';
        if (b.dataset.co2 === 'join') settings.coopJoinable = b.dataset.v === '1';
        saveSettings();
        g.refreshLobby();
      });
    }
    const roles = info.roles.map((r) => (ROLE_ORDER.includes(r as CoopRole) ? (r as CoopRole) : roleOf(r)));
    const distinct = new Set(roles).size;
    const sw = (k: string, on: boolean, a: string, b: string) =>
      [0, 1].map((v) => `<button ${isHost ? 'data-nav' : 'disabled'} data-co2="${k}" data-v="${v}" class="diff ${(v === 1) === on ? 'on' : ''}">${v ? a : b}</button>`).join('');
    const html = `
      <div class="section">ROLES</div>
      <div class="roles">${roles.map((r, i) => `<span style="--rc:${ROLES[r].color}"><bdi>${(info.names?.[i] ?? `P${i + 1}`).replace(/[<>&"]/g, '').toUpperCase()}</bdi> ${ROLES[r].name}</span>`).join('')}</div>
      <div class="bonus">${distinct >= 2 ? `${distinct} ROLES: TEAM BONUS FOR EVERYONE` : 'PICK DIFFERENT HEROES FOR A TEAM BONUS'}</div>
      <div class="section">REVIVE POOL</div>
      <div class="menu row diff-row">${sw('pool', info.pool, 'SHARED LIVES', 'OFF')}</div>
      <div class="note">${info.pool ? `The team shares ${poolTuning.start} lives (+${poolTuning.perStage} per stage). Downed and nobody coming? Buy back in with gold from everyone.` : 'Downed heroes wait for a teammate to revive them.'}</div>
      <div class="section">JOIN ANYTIME</div>
      <div class="menu row diff-row">${sw('join', info.join, 'OPEN', 'CLOSED')}</div>
      <div class="note">${info.join ? 'Friends can join with the code after the run starts, and come back if they drop.' : 'Only players in the lobby can play this run.'}</div>`;
    if (el.innerHTML === html) return;
    el.innerHTML = localizeHtml(html);
    // The host's lobby was laid out before this section: re-scan its menu so the new switches are navigable.
    if (isHost && g.screens.current === 'online') {
      const items = [...document.querySelectorAll('#scr-online [data-nav]')];
      g.screens.show('online', Math.max(0, items.findIndex((x) => x.classList.contains('focused'))));
    }
  }
}
