/** Local presentation only: applied after composition to canvas AND DOM cues. */
export type ColorblindMode = 'off' | 'protanopia' | 'deuteranopia' | 'tritanopia';

/** Preserve neutral greys; move red/green or blue/green differences into surviving channels.
 * These are assistance palettes, not simulations of a colour vision deficiency. */
export const COLORBLIND_MATRICES: Record<ColorblindMode, readonly number[]> = {
  off: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  protanopia: [0.6, 0.4, 0, 0.2, 0.8, 0, 0.6, -0.6, 1],
  deuteranopia: [0.8, 0.2, 0, 0.4, 0.6, 0, 0.7, -0.7, 1],
  tritanopia: [1, -0.6, 0.6, 0, 0.8, 0.2, 0, 0.4, 0.6],
};

export function correctedColor(rgb: readonly number[], mode: ColorblindMode): number[] {
  const m = COLORBLIND_MATRICES[mode];
  return [0, 1, 2].map((i) => Math.max(0, Math.min(1, m[i * 3] * rgb[0] + m[i * 3 + 1] * rgb[1] + m[i * 3 + 2] * rgb[2])));
}

export function applyColorblind(mode: ColorblindMode): void {
  if (typeof document === 'undefined') return;
  if (!document.getElementById('settings-color-filters')) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'settings-color-filters';
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none';
    svg.innerHTML = `<defs>${Object.entries(COLORBLIND_MATRICES).map(([key, m]) => {
      const values = `${m.slice(0, 3).join(' ')} 0 0 ${m.slice(3, 6).join(' ')} 0 0 ${m.slice(6).join(' ')} 0 0 0 0 0 1 0`;
      return `<filter id="settings-color-${key}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="${values}"/></filter>`;
    }).join('')}</defs>`;
    document.body.append(svg);
  }
  // A single final composite includes every current/future lane's cues, even inline DOM colours.
  document.documentElement.style.filter = mode in COLORBLIND_MATRICES && mode !== 'off' ? `url("#settings-color-${mode}")` : '';
}
