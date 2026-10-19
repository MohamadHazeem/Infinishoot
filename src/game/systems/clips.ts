/** Local cosmetic recording; no authority or wire state. Event callers run on each peer. */
import type { Game } from '../game';
import { HighlightRecorder, clipsAllowed, type HighlightKind } from '../../platform/clips';
import { settings } from '../settings';
import { renderQuality } from '../../render/quality';
import { t } from '../../i18n';
const states = new WeakMap<Game, HighlightRecorder>();
export function clipsFor(g: Game): HighlightRecorder {
  let s = states.get(g); if (!s) { s = new HighlightRecorder(); states.set(g, s); } return s;
}
export function resetClips(g: Game): void { states.get(g)?.reset(); }
export function markClip(g: Game, kind: HighlightKind): void { states.get(g)?.mark(kind, g.stage, g.runTime); }
export function clipInput(g: Game): void {
  const s = states.get(g);
  if (!s || g.screens.current !== 'none' || g.paused || !g.input.actionPressed('clip')) return;
  const h = s.mark('manual', g.stage, g.runTime, true);
  if (!h) { g.hud.toast(t('clips.unavailable'), 3); return; }
  g.hud.toast(t('clips.encoding'), 4);
  void s.save(h).then(() => g.hud.toast(t('clips.download'), 3)).catch(() => g.hud.toast(t('clips.error'), 4));
}
export function captureClips(g: Game, canvas: HTMLCanvasElement, dt: number): void {
  const s = clipsFor(g);
  if (!clipsAllowed(settings.highlightClips, renderQuality.level, !document.hidden)) { s.stop(true); return; }
  if (g.paused || g.mode === 'title' || g.mode === 'dead' || g.mode === 'shop' || g.mode === 'levelup') { s.stop(); return; }
  s.capture(canvas, dt);
  if (s.combo.check(g.combo)) s.mark('combo', g.stage, g.runTime);
}
