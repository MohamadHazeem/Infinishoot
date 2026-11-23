import { enemyGeometry } from '../game/enemies';
import { ENEMIES, type EnemyDef, type Behavior } from '../data/enemies';
import { escapeHtml, localize, t } from '../i18n';
import { hazards, mapHeight, mapWidth, recapHits, type DeathPacket, type Hit, type MapFrame } from '../game/damageLog';
import { bossLook, portraitCanvas } from './portraitArt';
import { prompt } from './prompts';
import type { Screens } from './screens';

const familyTips = {
  chase: 'space', ghost: 'space', golden: 'space', lunge: 'lunge', shooter: 'shot', charger: 'line',
  exploder: 'fuse', spawner: 'spawn', shielder: 'guard', leaper: 'zone', medic: 'medic', mortar: 'zone',
  boss: 'king', rex: 'rex', queen: 'queen', omega: 'omega', reaper: 'reaper', titan: 'titan', titanpart: 'titan',
  burrower: 'zone', mirror: 'mirror', swarmqueen: 'wall', egg: 'egg', swarmwall: 'wall', diver: 'line',
  shark: 'zone', roller: 'roller', slug: 'fire', marcher: 'line', kite: 'kite', glitch: 'grid', boxer: 'line',
  gale: 'gale', cake: 'cake', kraken: 'kraken', jellyfish: 'shot', pumpking: 'pumpking',
} satisfies Record<Behavior, string>;

export function tipFor(hit: Pick<Hit, 'source' | 'attack'>): string {
  if (hit.attack === 'volatile') return 'fuse';
  if (hit.attack === 'shockwave') return 'wave';
  if (hit.source.startsWith('architect')) return 'architect';
  if (hit.source.startsWith('hydra')) return 'hydra';
  const d = ENEMIES[hit.source];
  if (!d) return hazards[hit.source]?.[2] ?? 'space';
  switch (d.shoot?.pattern) {
    case 'sniper': return 'beam';
    case 'burst': return 'burst';
    case 'spiral': return 'spiral';
  }
  return familyTips[d.behavior];
}

export function hitName(hit: Hit): string {
  const name = localize(ENEMIES[hit.source]?.name ?? hazards[hit.source]?.[0] ?? hazards.unknown[0]);
  if (hit.attack === 'bullet' && ENEMIES[hit.source]) return t('death.shotName', { name });
  if (hit.attack === 'shockwave') return t('death.waveName', { name });
  if (hit.attack === 'volatile') return t('death.volatileName', { name });
  return name;
}

/** Thumbnail of the same mesh seen in the arena; a small 2D projection needs no second WebGL context. */
function enemyIcon(def: EnemyDef): HTMLCanvasElement {
  const face = document.createElement('canvas');
  face.width = face.height = 48;
  const ctx = face.getContext('2d');
  if (!ctx) return face;
  if (def.boss || def.miniboss) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(portraitCanvas(bossLook(def), 'determined'), 0, 0, 48, 48);
    return face;
  }
  const mesh = enemyGeometry(def), pos = mesh.getAttribute('position'), colors = mesh.getAttribute('color');
  const normal = mesh.getAttribute('normal'), index = mesh.index!;
  const points = Array.from({ length: pos.count }, (_, i) => {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const depth = 0.8 * x + 0.6 * z;
    return { x: 0.6 * x - 0.8 * z, y: -0.92 * y + 0.4 * depth, depth: 0.4 * y + 0.92 * depth };
  });
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const left = Math.min(...xs), top = Math.min(...ys), w = Math.max(...xs) - left, h = Math.max(...ys) - top;
  const scale = 42 / Math.max(w, h);
  const triangles = Array.from({ length: index.count / 3 }, (_, n) => {
    const a = index.getX(n * 3), b = index.getX(n * 3 + 1), c = index.getX(n * 3 + 2);
    return { a, b, c, depth: points[a].depth + points[b].depth + points[c].depth };
  }).sort((a, b) => a.depth - b.depth);
  for (const { a, b, c } of triangles) {
    const light = 0.72 + 0.28 * Math.max(0, normal.getY(a) * 0.8 + normal.getZ(a) * 0.6);
    const color = (channel: number) => Math.round(255 * channel * light);
    ctx.fillStyle = `rgb(${color(colors.getX(a))},${color(colors.getY(a))},${color(colors.getZ(a))})`;
    ctx.beginPath();
    for (const i of [a, b, c]) {
      const p = points[i], x = 24 + (p.x - left - w / 2) * scale, y = 24 + (p.y - top - h / 2) * scale;
      if (i === a) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.fill(); ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 0.5; ctx.stroke();
  }
  return face;
}

const CSS = `
#hud #scr-gameover[data-death-view=recap] {justify-content:safe center}
#hud #scr-gameover[data-death-view=recap] :is(.go-body,.ft-next) {display:none}
#hud #scr-gameover[data-death-view=stats] .death-panel {display:none}
#hud #scr-gameover .death-panel {width:min(calc(300 * var(--p)),92vw); box-sizing:border-box; text-align:start;
  --bg:var(--night);--hi:var(--mist);--lo:var(--ink);--ring:var(--navy); padding:calc(5 * var(--p)); flex:none}
.death-grid {display:grid; grid-template-columns:1.2fr 1fr; gap:calc(5 * var(--p))}
.death-blow {display:flex; gap:calc(4 * var(--p)); align-items:center}
.death-portrait {background:var(--ink); color:var(--orange); flex:none; width:calc(20 * var(--p)); height:calc(20 * var(--p));
  display:grid; place-items:center; font:calc(15 * var(--p)) var(--display)}
.death-portrait canvas {width:100%; image-rendering:pixelated}
.death-panel h2,.death-panel h3,.death-panel p {margin:0; text-shadow:none}
.death-panel h2,.death-panel h3 {font:calc(4 * var(--p)) var(--label); color:var(--yellow)}
.death-panel h3 {color:var(--cyan)}
.death-panel strong {display:block; font:calc(11 * var(--p))/1.05 var(--display); color:var(--white);overflow-wrap:anywhere}
.death-panel .death-break strong {font-size:calc(9 * var(--p))}
.death-panel .death-detail,.death-axis {color:var(--mist);font-size:calc(6 * var(--p))}
.death-health {color:var(--white);font-size:calc(7 * var(--p))}
.death-track {position:relative; height:calc(10 * var(--p)); background:var(--ink); border-bottom:var(--p) solid var(--mist); margin-top:var(--p)}
.death-track i {position:absolute; bottom:0; width:calc(2 * var(--p)); background:var(--mist)}
.death-track i.breaking {background:var(--cyan)} .death-track i.fatal {background:var(--orange)}
.death-axis {direction:ltr;display:flex;justify-content:space-between}
.death-lesson {border-inline-start:var(--p) solid var(--orange); padding-inline-start:calc(3 * var(--p)); font-size:calc(8 * var(--p));color:var(--white)}
.death-panel footer {display:flex;gap:calc(4 * var(--p));align-items:center; flex-wrap:wrap}
#hud .death-panel button,#hud #death-film button {min-height:0;font-size:calc(7 * var(--p))}
.death-panel>*+* {margin-block-start:calc(4 * var(--p))}
#death-film {background:var(--ink); gap:calc(4 * var(--p))}
#death-film canvas {width:min(calc(240 * var(--p)),85vw,105vh);height:auto;image-rendering:pixelated;box-shadow:0 0 0 var(--p) var(--mist)}
#death-film .df-status {color:var(--cyan);font-size:calc(8 * var(--p))}
[lang=ar] .death-panel :is(h2,h3){font-size:calc(5 * var(--p));letter-spacing:0}
[lang=ar] .death-panel strong {line-height:1.4;font-size:calc(9 * var(--p))}
@media(max-width:640px){.death-grid{grid-template-columns:1fr}.death-panel{max-width:94vw}}
`;

function style(): void {
  if (document.getElementById('death-recap-style')) return;
  const el = document.createElement('style'); el.id = 'death-recap-style'; el.textContent = CSS; document.head.append(el);
}

const films = new WeakMap<Screens, HTMLElement>();
const playbackIds = new WeakMap<Screens, number>();
function replay(screens: Screens, packet: DeathPacket): void {
  let view = films.get(screens);
  const back = () => screens.show('gameover');
  if (!view) {
    view = document.createElement('div');
    view.id = 'death-film'; view.className = 'screen dim';
    screens.addScreen('death-film', view, { onBack: back });
    films.set(screens, view);
  }
  view.innerHTML = `<h1>${t('death.film')}</h1><canvas width="${mapWidth}" height="${mapHeight}"></canvas>
    <div>${t('death.legend')}</div><div class="df-status"></div><button data-nav>${prompt('confirm')} ${t('death.skip')}</button>`;
  view.querySelector('button')!.onclick = back;
  screens.show('death-film');
  const ctx = view.querySelector('canvas')!.getContext('2d');
  const status = view.querySelector('.df-status')!;
  const frames = packet.frames;
  const playbackId = (playbackIds.get(screens) ?? 0) + 1;
  playbackIds.set(screens, playbackId);
  let index = -1;
  const start = performance.now(), end = frames.at(-1)!.ms;
  function paint(f: MapFrame): void {
    if (!ctx) return;
    ctx.fillStyle = '#1a1c2c'; ctx.fillRect(0, 0, mapWidth, mapHeight);
    ctx.fillStyle = '#333c57';
    for (let x = ((mapWidth / 2 - f.x) % 16 + 16) % 16; x < mapWidth; x += 16) ctx.fillRect(x, 0, 1, mapHeight);
    for (let z = ((mapHeight / 2 - f.z) % 16 + 16) % 16; z < mapHeight; z += 16) ctx.fillRect(0, z, mapWidth, 1);
    const dots = atob(f.dots);
    for (let i = 0; i + 2 < dots.length; i += 3) {
      const x = dots.charCodeAt(i), z = dots.charCodeAt(i + 1), v = dots.charCodeAt(i + 2), r = v & 31;
      if (v >> 5 === 2) {
        ctx.beginPath(); ctx.strokeStyle = '#ffcd75'; ctx.arc(x, z, r, 0, Math.PI * 2); ctx.stroke();
      } else {
        ctx.fillStyle = v >> 5 ? '#ffcd75' : '#ef7d57';
        ctx.fillRect(x - r, z - r, 2 * r + 1, 2 * r + 1);
      }
    }
    ctx.fillStyle = f.hp > 0 ? '#73eff7' : '#b13e53';
    const x = mapWidth / 2, y = mapHeight / 2;
    for (let i = -3; i <= 3; i++) ctx.fillRect(x - 3 + Math.abs(i), y + i, 7 - 2 * Math.abs(i), 1);
  }
  function tick(): void {
    if (view!.hidden || screens.current !== 'death-film' || playbackIds.get(screens) !== playbackId) return;
    const elapsed = performance.now() - start;
    let next = index;
    while (next + 1 < frames.length && frames[next + 1].ms <= elapsed) next++;
    if (next !== index) {
      index = next;
      const f = frames[index];
      paint(f);
      const beforeEnd = (end - f.ms) / 1000;
      const at = packet.hits.at(-1)!.at - beforeEnd;
      const hit = packet.hits.find(h => h.at <= at + 0.001 && h.at > at - 0.45);
      status.textContent = t('death.ago', { n: beforeEnd.toFixed(1) }) + ' · ' + t('death.hp', { n: f.hp })
        + (hit ? ' · ' + hitName(hit) + ' ' + t('death.lost', { n: Math.ceil(hit.before - hit.after) }) : '');
    }
    if (elapsed < end + 350) requestAnimationFrame(tick); else back();
  }
  tick();
}

export function showDeathPanel(screens: Screens, el: HTMLElement, packets: DeathPacket[]): void {
  el.querySelector('.death-panel')?.remove();
  el.querySelector('.death-toggle')?.remove();
  delete el.dataset.deathView;
  if (!packets.length) return;
  style();
  const panel = document.createElement('section');
  panel.className = 'death-panel px';
  el.querySelector('.go-body')!.before(panel);
  const toggle = document.createElement('button');
  toggle.className = 'death-toggle'; toggle.dataset.nav = '';
  el.querySelector('.menu.row')!.append(toggle);
  const setView = (recap: boolean) => {
    el.dataset.deathView = recap ? 'recap' : 'stats';
    toggle.textContent = t(recap ? 'death.stats' : 'death.recap');
  };
  toggle.onclick = () => { setView(el.dataset.deathView !== 'recap'); screens.refreshNav(); };
  setView(true);
  const draw = (index: number) => {
    const packet = packets[index], data = recapHits(packet.hits);
    if (!data) return;
    const { fatal, breaking, timeline } = data;
    const loss = (hit: Hit) => Math.ceil(hit.before - hit.after);
    const health = (hit: Hit) => '<bdi>' + Math.ceil(hit.before) + ' → ' + Math.ceil(hit.after) + '</bdi> · ' + t('death.lost', { n: loss(hit) });
    const offset = Math.max(0, fatal.at - breaking.at);
    const max = Math.max(...timeline.map(loss), 1);
    const bars = timeline.map(hit => {
      const pct = Math.max(0, Math.min(100, (10 - fatal.at + hit.at) * 10));
      return `<i class="${hit === fatal ? 'fatal' : hit === breaking ? 'breaking' : ''}" style="left:calc(${pct}% - ${pct / 50} * var(--p));height:${Math.max(10, loss(hit) / max * 100)}%" title="${escapeHtml(hitName(hit))} · ${t('death.lost', { n: loss(hit) })}"></i>`;
    }).join('');
    panel.innerHTML = `<div class="death-grid"><div class="death-blow"><div class="death-portrait" aria-hidden="true"></div><div>
      <h2>${t('death.killed')}</h2><strong>${escapeHtml(hitName(fatal))}</strong>
      <div class="death-health">${health(fatal)}</div></div></div>
      <div class="death-break"><h3>${t('death.broke')}</h3><strong>${escapeHtml(hitName(breaking))}</strong>
      <div class="death-health">${health(breaking)}</div><span class="death-detail">${offset ? t('death.before', { n: offset.toFixed(1) }) : t('death.impact')}</span></div></div>
      <div><h3>${t('death.timeline')}</h3><div class="death-track">${bars}</div><div class="death-axis"><span>${t('death.ago', { n: 10 })}</span><span>${t('death.ago', { n: 5 })}</span><span>${t('death.impact')}</span></div></div>
      <div class="death-lesson">${t('death.' + tipFor(fatal))}</div>
      <footer><span class="death-detail">${t(fatal.warned ? 'death.warned' : 'death.unwarned')} · ${t(fatal.dash ? 'death.dash' : 'death.spent')}</span></footer>`;
    const portrait = panel.querySelector<HTMLElement>('.death-portrait')!;
    const def = ENEMIES[fatal.source] ?? ENEMIES[hazards[fatal.source]?.[3] ?? ''];
    if (def) portrait.append(enemyIcon(def));
    else portrait.textContent = fatal.attack === 'bullet' ? '◆' : '⚠';
    const footer = panel.querySelector('footer')!;
    if (packet.frames.length > 1) {
      const play = document.createElement('button'); play.dataset.nav = '';
      play.innerHTML = prompt('confirm') + ' ' + t('death.replay');
      play.onclick = () => replay(screens, packet); footer.prepend(play);
    }
    if (packets.length > 1) {
      const seat = document.createElement('button'); seat.dataset.nav = '';
      seat.textContent = t('death.seat', { n: packet.seat + 1 }) + ' ›';
      seat.onclick = () => { draw((index + 1) % packets.length); screens.refreshNav(); };
      footer.append(seat);
    }
  };
  draw(0);
}
