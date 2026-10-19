import type { Screens } from './screens';
import type { MvpPlayer, MvpReport } from '../game/systems/mvp';
import { portraitCanvas } from './portraitArt';
import { localize, t } from '../i18n';
import { reduceMotion } from './hud';
import { announcer } from '../audio/announcer';

const CSS = `
#scr-mvp { background: var(--ink); gap: calc(3 * var(--p)); }
.mvp-shell { width: min(1060px, 96%); display: grid; gap: calc(4 * var(--p)); padding: calc(3 * var(--p)); }
.mvp-head { display:flex; align-items:center; justify-content:space-between; gap:calc(3 * var(--p)); }
#scr-mvp h1 { color:var(--yellow); font-size:calc(16 * var(--p)); line-height:1; }
#scr-mvp h2 { color:var(--cyan); font:calc(7 * var(--p)) var(--display); margin:0 0 calc(2 * var(--p)); }
.mvp-head p, .mvp-note { margin:0; color:var(--mist); font-size:calc(7 * var(--p)); }
.mvp-awards { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:calc(3 * var(--p)); }
.mvp-award, .mvp-panel { --bg:var(--night); --hi:var(--blue); --lo:var(--ink); --ring:var(--ink); background:var(--bg);
 box-shadow:inset var(--p) var(--p) 0 var(--hi), inset calc(-1 * var(--p)) calc(-1 * var(--p)) 0 var(--lo),
 0 calc(-1 * var(--p)) 0 var(--ink), 0 var(--p) 0 var(--ink), calc(-1 * var(--p)) 0 0 var(--ink), var(--p) 0 0 var(--ink),
 0 calc(-2 * var(--p)) 0 var(--ring), 0 calc(2 * var(--p)) 0 var(--ring), calc(-2 * var(--p)) 0 0 var(--ring), calc(2 * var(--p)) 0 0 var(--ring);
 padding:calc(3 * var(--p)); }
.mvp-award, .mvp-stats, .mvp-bottom { text-shadow:none; }
.mvp-award { display:grid; grid-template-columns:48px minmax(0,1fr); gap:calc(2 * var(--p)); align-items:center; }
.mvp-award canvas { width:48px; height:48px; image-rendering:pixelated; }
.mvp-award strong { display:block; color:var(--yellow); font-weight:normal; font-size:calc(7 * var(--p)); line-height:1; }
.mvp-award bdi { display:block; overflow-wrap:anywhere; color:var(--white); font-size:calc(7 * var(--p)); }
.mvp-award small { display:block; color:var(--mist); font-size:calc(6 * var(--p)); }
.mvp-stats { overflow-x:auto; }
.mvp-stats table { width:100%; border-collapse:collapse; font-size:calc(7 * var(--p)); text-align:end; }
.mvp-stats th { color:var(--cyan); font-weight:normal; font-size:calc(6 * var(--p)); }
.mvp-stats th, .mvp-stats td { padding:var(--p); white-space:nowrap; }
.mvp-stats th:first-child, .mvp-stats td:first-child { text-align:start; max-width:220px; overflow:hidden; text-overflow:ellipsis; }
.mvp-stats tbody tr:nth-child(odd) { background:var(--navy); }
.mvp-bottom { display:grid; grid-template-columns:1.2fr 1fr; gap:calc(4 * var(--p)); }
.mvp-moments { margin:0; padding:0; list-style:none; max-height:calc(48 * var(--p)); overflow:auto; }
.mvp-moments li { display:flex; gap:calc(3 * var(--p)); font-size:calc(7 * var(--p)); margin-block:var(--p); }
.mvp-moments time { color:var(--yellow); direction:ltr; }
.mvp-band { display:grid; gap:var(--p); font-size:calc(7 * var(--p)); }
.mvp-band bdi { color:var(--yellow); }
.mvp-footer { display:flex; justify-content:flex-end; }
.mvp-confetti { position:absolute; inset:0; overflow:hidden; pointer-events:none; }
.mvp-confetti i { position:absolute; width:calc(2 * var(--p)); height:calc(3 * var(--p)); animation:mvp-fall 2.8s steps(16) both; }
@keyframes mvp-fall { from { transform:translateY(-20px) rotate(0deg); } to { transform:translateY(100vh) rotate(240deg); } }
.reduce-flash .mvp-confetti { display:none; }
@media(prefers-reduced-motion:reduce) { .mvp-confetti { display:none; } }
@media(max-width:800px) { .mvp-awards { grid-template-columns:repeat(2,minmax(0,1fr)); } .mvp-bottom { grid-template-columns:1fr; } #scr-mvp h1 { font-size:calc(12 * var(--p)); } }
`;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.append(document.createTextNode(text));
  if (cls) node.className = cls;
  return node;
}
const number = (n: number) => Math.max(0, Math.floor(n)).toLocaleString();
export const mvpTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
function playerName(p: MvpPlayer): HTMLElement {
  const node = el('bdi', p.name);
  node.setAttribute('translate', 'no');
  return node;
}
export class MvpScreen {
  readonly element = el('section', undefined, 'screen');
  constructor(private readonly screens: Screens) {
    this.element.id = 'scr-mvp';
    if (!document.getElementById('mvp-css')) {
      const style = el('style', CSS); style.id = 'mvp-css'; document.head.appendChild(style);
    }
    screens.addScreen('mvp', this.element, { onBack: () => screens.show('gameover') });
  }
  show(report: MvpReport): void {
    this.element.replaceChildren();
    const shell = el('div', undefined, 'mvp-shell');
    const head = el('header', undefined, 'mvp-head');
    const heading = el('div');
    heading.append(el('h1', t(report.players.length > 1 ? 'mvp.title' : 'mvp.solo')), el('p', t('mvp.subtitle')));
    head.append(heading, el('span', mvpTime(report.time)));
    shell.append(head);
    const awards = el('div', undefined, 'mvp-awards');
    for (const award of report.awards) {
      const p = report.players.find(p => p.index === award.player);
      if (!p) continue;
      const card = el('article', undefined, 'mvp-award');
      const art = portraitCanvas(p.look, 'victorious');
      const canvas = el('canvas'); canvas.width = canvas.height = 32;
      canvas.getContext('2d')?.drawImage(art, 0, 0);
      canvas.setAttribute('aria-hidden', 'true');
      const text = el('div');
      text.append(el('strong', t('mvp.award.' + award.id)), playerName(p), el('small', t('mvp.reason.' + award.id, { n: number(award.value) })));
      card.append(canvas, text); awards.append(card);
    }
    if (!report.awards.length) awards.append(el('p', t('mvp.empty')));
    shell.append(awards);
    const stats = el('div', undefined, 'mvp-panel mvp-stats');
    const table = el('table');
    const thead = el('thead'), tr = el('tr');
    const columns = ['player', 'damage', 'kills', 'revives', 'saves', 'taken', 'combo', 'shared'];
    for (const key of columns) { const th = el('th', t('mvp.stat.' + key)); th.scope = 'col'; tr.append(th); }
    thead.append(tr); table.append(thead);
    const tbody = el('tbody');
    for (const p of report.players) {
      const line = el('tr'); const name = el('th'); name.scope = 'row'; name.append(playerName(p)); line.append(name);
      for (const n of [p.damage, p.kills, p.revives, p.saves, p.taken, p.bestCombo, p.shared]) line.append(el('td', number(n)));
      tbody.append(line);
    }
    table.append(tbody); stats.append(table, el('p', t('mvp.statsNote'), 'mvp-note')); shell.append(stats);
    const bottom = el('div', undefined, 'mvp-bottom');
    const highlights = el('section', undefined, 'mvp-panel'); highlights.append(el('h2', t('mvp.highlights')));
    const list = el('ol', undefined, 'mvp-moments');
    for (const moment of report.moments) {
      const p = report.players.find(p => p.index === moment.player);
      if (!p) continue;
      const li = el('li'); li.append(el('time', mvpTime(moment.time)));
      const text = el('span'); text.append(playerName(p), document.createTextNode(' · ' + t('mvp.moment.' + moment.kind) + (moment.detail ? ' · ' : '')));
      if (moment.detail) {
        const detail = el('bdi', moment.kind === 'revive' ? moment.detail : localize(moment.detail));
        if (moment.kind === 'revive') detail.setAttribute('translate', 'no');
        text.append(detail);
      }
      li.append(text); list.append(li);
    }
    if (!report.moments.length) list.append(el('li', t('mvp.noMoments')));
    highlights.append(list);
    const band = el('section', undefined, 'mvp-panel'); band.append(el('h2', t('mvp.band')));
    const lineup = el('div', undefined, 'mvp-band');
    for (const p of report.players) {
      const line = el('div'); line.append(playerName(p), document.createTextNode(' · ' + (p.instruments.map(i => t('mvp.instrument.' + i)).join(' / ') || t('mvp.instrument.rest')))); lineup.append(line);
    }
    band.append(lineup); bottom.append(highlights, band); shell.append(bottom);
    const footer = el('div', undefined, 'mvp-footer'), next = el('button', t('mvp.continue'));
    next.dataset.nav = ''; next.onclick = () => this.screens.show('gameover'); footer.append(next); shell.append(footer);
    this.element.append(shell);
    if (!reduceMotion()) {
      const confetti = el('div', undefined, 'mvp-confetti'); confetti.setAttribute('aria-hidden', 'true');
      for (let i = 0; i < 32; i++) {
        const bit = el('i'); bit.style.left = `${(i * 37) % 100}%`; bit.style.background = ['var(--yellow)', 'var(--cyan)', 'var(--orange)', 'var(--green)'][i % 4]; bit.style.animationDelay = `${i % 7 * 0.08}s`;
        confetti.append(bit);
      }
      confetti.addEventListener('animationend', e => (e.target as HTMLElement).remove()); this.element.append(confetti);
    }
    this.screens.show('mvp');
    announcer.say('vo_mvp');
  }
}
