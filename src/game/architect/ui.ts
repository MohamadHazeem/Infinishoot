import type { Game } from '../game';
import type { ArchitectState } from './model';
import { t, getLanguage, escapeHtml as esc } from '../../i18n';
import { prompt } from '../../ui/prompts';
import { StoryNarrator } from '../story/narrator';
import { settings } from '../settings';
import { portraitCanvas, bossLook } from '../../ui/portraitArt';
import { ENEMIES } from '../../data/enemies';

const CSS = `
#architect-hud { position:absolute; inset-block-end:calc(42 * var(--p)); inset-inline-start:50%; transform:translateX(-50%); width:min(88vw,560px); text-align:center; pointer-events:none; color:var(--white); font-size:calc(5 * var(--p)); }
#architect-hud strong { display:block; color:var(--cyan); font:calc(7 * var(--p)) var(--display); }
#architect-hud .ar-pips { color:var(--yellow); letter-spacing:calc(3 * var(--p)); }
#architect-hud[hidden], #scr-architect-ending[hidden] { display:none; }
#scr-architect-ending { background:var(--ink); overflow:auto; padding:calc(8 * var(--p)); }
.ar-ending { width:min(860px,94vw); margin:auto; text-align:center; }
.ar-ending h1 { color:var(--yellow); margin:0; font:calc(14 * var(--p)) var(--display); }
.ar-ending h2 { color:var(--cyan); font:calc(8 * var(--p)) var(--display); margin:calc(3 * var(--p)); }
.ar-ending canvas { width:100%; max-height:40vh; object-fit:contain; image-rendering:pixelated; background:var(--navy); }
.ar-ending p { font-size:calc(6 * var(--p)); line-height:1.3; text-align:start; }
.ar-ending .ar-reward { color:var(--yellow); font-size:calc(4 * var(--p)); text-align:center; }
.ar-ending button { margin:calc(3 * var(--p)); }
:lang(ar) #architect-hud { line-height:1.7; } :lang(ar) .ar-ending p { line-height:1.65; font-size:calc(5 * var(--p)); }
`;
export class ArchitectUi {
  readonly hud: HTMLElement;
  readonly screen: HTMLElement;
  private key = -1;
  private frame = 0;
  private language = getLanguage();
  private clock = 0;
  private narrator = new StoryNarrator();
  dismissed = false;
  private active = false;
  constructor(private g: Game) {
    if (!document.getElementById('architect-css')) { const style = document.createElement('style'); style.id = 'architect-css'; style.textContent = CSS; document.head.append(style); }
    this.hud = document.createElement('div'); this.hud.id = 'architect-hud'; this.hud.hidden = true;
    document.getElementById('ingame')?.append(this.hud);
    this.screen = document.createElement('div'); this.screen.className = 'screen'; this.screen.id = 'scr-architect-ending';
    g.screens.addScreen('architect-ending', this.screen, { onBack: () => this.close() });
    this.screen.addEventListener('click', e => {
      if (!(e.target as HTMLElement).closest('[data-architect-next]')) return;
      if (this.frame < 2) { this.frame++; this.clock = 0; this.page(); }
      else this.close();
    });
  }
  hudDraw(s: ArchitectState, visible: boolean): void {
    this.hud.hidden = !visible;
    if (!visible) return;
    const pulse = s.desperate && !s.desperationDone;
    const key = s.phase + s.core * 4 + (pulse ? 32 : 0) + (getLanguage() === 'ar' ? 64 : 0);
    if (key === this.key) return;
    this.key = key;
    const title = t(pulse ? 'architect.pulse' : s.phase === 1 ? 'architect.p1' : s.phase === 2 ? 'architect.p2' : 'architect.p3');
    const line = t(s.phase === 1 ? 'architect.floor' : s.phase === 2 ? 'architect.echo' : s.core < 3 ? 'architect.cores' : 'architect.heart', { core: Math.min(3, s.core + 1) });
    this.hud.innerHTML = `<strong>${esc(title)}</strong><span>${esc(line)}</span>${s.phase === 3 ? `<div class="ar-pips">${[0, 1, 2].map(i => i < s.core ? '×' : i === s.core ? '◆' : '◇').join(' ')}</div>` : ''}${pulse ? `<div>${prompt('dash')} / ${prompt('parry')}</div>` : ''}`;
  }
  start(): void { this.active = true; this.frame = settings.cinematics === 'off' ? 2 : 0; this.clock = 0; this.page(); this.g.screens.show('architect-ending'); }
  tick(dt: number): boolean {
    if (!this.active) return false;
    if (this.g.screens.current !== 'architect-ending') { this.stop(); return false; }
    if (this.language !== getLanguage()) this.page();
    this.clock += dt;
    this.narrator.tick();
    this.g.screens.update(this.g.input, dt);
    if (this.clock > Math.max(settings.cinematics === 'short' ? 5 : 10, this.narrator.duration + 0.4) && this.frame < 2) { this.frame++; this.clock = 0; this.page(); }
    return this.active;
  }
  private page(): void {
    this.language = getLanguage();
    const frame = this.frame + 1;
    this.screen.innerHTML = `<section class="ar-ending"><h1>${esc(t('architect.ending'))}</h1><h2>${esc(t(`architect.frame${frame}`))}</h2><canvas width="320" height="132"></canvas><p>${esc(t(`architect.text${frame}`))}</p><p class="ar-reward">${esc(t('architect.reward'))}</p>${frame === 3 ? `<small>${esc(t('architect.credits'))}</small><br>` : ''}<button data-nav data-architect-next>${esc(t(frame === 3 ? 'architect.results' : 'architect.next'))}</button></section>`;
    this.art(this.screen.querySelector('canvas')!);
    if (settings.cinematics !== 'off') this.narrator.cue(frame === 1 ? 'story_ending' : frame === 3 ? 'story_credits' : '');
    this.g.screens.refreshNav();
  }
  private art(canvas: HTMLCanvasElement): void {
    const c = canvas.getContext('2d'); if (!c) return;
    c.imageSmoothingEnabled = false;
    const rect = (x: number, y: number, w: number, h: number, color: string) => { c.fillStyle = color; c.fillRect(x, y, w, h); };
    rect(0, 0, 320, 132, this.frame ? '#29366f' : '#1a1c2c');
    for (let i = 0; i < 25; i++) rect((i * 53) % 320, (i * 17) % 80, 1, 1, '#73eff7');
    for (let i = 0; i < 7; i++) {
      const x = i * 48 - 5, y = 90 + (i % 2) * 12;
      rect(x + 4, y, 39, 6, '#a7f070'); rect(x + 8, y + 6, 32, 8, '#38b764'); rect(x + 15, y + 14, 18, 10, '#566c86');
      if (this.frame) { rect(x + 24, y - 18, 2, 18, '#94b0c2'); rect(x + 21, y - 22, 8, 7, '#ffcd75'); }
    }
    if (this.frame === 0) {
      c.drawImage(portraitCanvas(bossLook(ENEMIES.architect), 'shocked'), 124, 17, 72, 72);
      for (let i = 0; i < 12; i++) rect(104 + (i * 31) % 110, 12 + (i * 19) % 75, 3, 3, '#73eff7');
    } else if (this.frame === 1) {
      for (let i = 0; i < 3; i++) c.drawImage(portraitCanvas(bossLook(ENEMIES[['king', 'rex', 'queen'][i]]), 'grinning'), 65 + i * 70, 24, 48, 48);
    } else {
      rect(116, 12, 88, 75, '#f4f4f4'); rect(120, 16, 80, 67, '#41a6f6');
      for (let i = 0; i < 7; i++) { rect(120, 16 + i * 10, 80, 1, '#73eff7'); rect(120 + i * 12, 16, 1, 67, '#73eff7'); }
      c.fillStyle = '#ffcd75'; c.beginPath(); c.moveTo(160, 27); c.lineTo(181, 49); c.lineTo(160, 72); c.lineTo(139, 49); c.fill();
      rect(153, 43, 14, 14, '#f4f4f4');
    }
  }
  private close(): void { this.dismissed = true; this.stop(); this.g.screens.show('gameover'); }
  stop(): void { this.active = false; this.narrator.stop(); this.hud.hidden = true; }
}
