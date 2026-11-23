import { t, getLanguage } from '../i18n';
import { access } from '../game/settings';

export class BeatAccuracyHud {
  private el = document.createElement('i');
  private key = -1;
  private lang = '';

  constructor(private readonly reticle: HTMLElement) {
    if (!document.getElementById('beat-accuracy-style')) {
      const style = document.createElement('style');
      style.id = 'beat-accuracy-style';
      style.textContent = `
#reticle.beat-accuracy-visible #mdbeat { display:none }
.beat-accuracy { position:absolute; left:50%; bottom:calc(100% + var(--p)); width:var(--p); height:var(--p);
  transform:translateX(-50%); background:var(--ink); color:var(--cyan);
  box-shadow:calc(-1 * var(--gap)) 0 currentColor,var(--gap) 0 currentColor; pointer-events:none }
.beat-accuracy[data-pulse="1"] { background:var(--white) }
.beat-accuracy[data-hit="1"] { height:calc(2 * var(--p)); color:var(--yellow); background:var(--yellow) }`;
      document.head.appendChild(style);
    }
    this.el.className = 'beat-accuracy';
    this.el.setAttribute('role', 'img');
    this.el.hidden = true;
    reticle.appendChild(this.el);
  }

  draw(show: boolean, beat: number, bpm: number, accent: number): void {
    if (this.el.hidden === show) {
      this.el.hidden = !show;
      this.reticle.classList.toggle('beat-accuracy-visible', show);
    }
    if (!show) return;
    const phase = beat - Math.floor(beat);
    const gap = access.reduceFlash ? 2 : 1 + Math.round(Math.sin(phase * Math.PI) * 3);
    const pulse = Math.min(phase, 1 - phase) * 60 / bpm <= 0.045;
    const hit = accent >= 0 && Math.abs(beat - accent) * 60 / bpm < 0.17;
    const key = gap * 4 + Number(pulse) * 2 + Number(hit);
    if (this.key !== key) {
      this.key = key;
      this.el.style.setProperty('--gap', `calc(${gap} * var(--p))`);
      this.el.dataset.pulse = pulse ? '1' : '0';
      this.el.dataset.hit = hit ? '1' : '0';
    }
    if (this.lang !== getLanguage()) {
      this.lang = getLanguage();
      this.el.setAttribute('aria-label', t('beat.reticle'));
    }
  }
}
