import { getLanguage, setLanguage, relocalizeDom, type Language } from './index';

/** Locally bundled OFL font: no network requests, including in Electron/offline builds. */
const CSS = `
@font-face { font-family: 'Infini Arabic'; src: url('${(import.meta.env?.BASE_URL ?? '/')}fonts/NotoSansArabic.ttf') format('truetype'); font-weight: 100 900; font-style: normal; font-display: swap; }
:root[lang=ar] { --font: 'Infini Arabic', sans-serif; --display: 'Infini Arabic', sans-serif; --label: 'Infini Arabic', sans-serif; }
[lang=ar] #hud, [lang=ar] #hud * { letter-spacing: 0; }
[lang=ar] .screen { line-height: 1.65; }
[lang=ar] .screen h1 { font-size: 34px; line-height: 1.6; margin-block: 0; }
[lang=ar] .screen button { font-size: 19px; line-height: 1.6; }
[lang=ar] .screen .note, [lang=ar] .screen .desc, [lang=ar] .screen small { line-height: 1.7; }
[lang=ar] .screen .note { font-size: 15px; }
[lang=ar] .menu.settings { width: min(620px, 90vw); }
[lang=ar] .menu.settings label, [lang=ar] .menu.settings button { font-size: 17px; gap: 12px; text-align: start; }
[lang=ar] .menu.settings button b { margin-inline-start: auto; margin-inline-end: 0; }
[lang=ar] #scr-loadout { gap: 10px; }
[lang=ar] #scr-loadout .lo-card { text-align: start; }
[lang=ar] #scr-loadout .lo-card .name { font-size: 18px; line-height: 1.4; }
[lang=ar] #scr-loadout .lo-card .desc { font-size: 14px; line-height: 1.55; }
[lang=ar] .screen .menu > button.focused::before { left: auto; right: calc(-5 * var(--p)); transform: scaleX(-1); }
[lang=ar] .card .name, [lang=ar] .lo-card .name, [lang=ar] .mod-card .name { font-size: 21px; line-height: 1.55; }
[lang=ar] .card .desc, [lang=ar] .lo-card .desc, [lang=ar] .mod-card .desc { font-size: 15px; line-height: 1.7; }
[lang=ar] .card, [lang=ar] .lo-card, [lang=ar] .mod-card { min-width: 0; overflow-wrap: anywhere; }
[lang=ar] .tip { text-align: right; line-height: 1.7; }
[lang=ar] .tip b { line-height: 1.6; }
[lang=ar] #caps .cap { white-space: normal; line-height: 1.6; font-size: 18px; }
[lang=ar] #caps .cap b { font-size: 13px; margin-inline-end: 8px; }
[lang=ar] #timer .clock, [lang=ar] #score, [lang=ar] #hp .num, [lang=ar] #combo .mult,
[lang=ar] .code-big, [lang=ar] #mp-code, [lang=ar] input[type=range], [lang=ar] kbd,
[lang=ar] .cnums, [lang=ar] .pv-rows, [lang=ar] .owned-mods, [lang=ar] #mods,
[lang=ar] .logo, [lang=ar] .history, [lang=ar] .code { direction: ltr; unicode-bidi: isolate; }
[lang=ar] .owned-mods .desc, [lang=ar] .owned-mods .name, [lang=ar] .history td { direction: rtl; }
[lang=ar] .logo { font-family: var(--logo); }
[lang=ar] #timer .clock, [lang=ar] #score, [lang=ar] #combo .mult { font-family: 'Jersey 10', monospace; }
[lang=ar] #xpbar .fill { transform-origin: right; }
[lang=ar] #hud #ingame #xpbar .lv { left: auto; right: 18px; }
[lang=ar] #hud #ingame.has-face #xpbar .lv { left: auto; right: calc(18px + 64px + 4 * var(--p)); }
[lang=ar] #hud #ingame > #hp, [lang=ar] #hud #ingame > #runinfo { left: auto; right: calc(18px + 18 * var(--p) + 14px); }
[lang=ar] #hud #ingame.has-face > #hp, [lang=ar] #hud #ingame.has-face > #runinfo { left: auto; right: calc(18px + 64px + 4 * var(--p) + 18 * var(--p) + 14px); }
[lang=ar] #hudface { left: auto; right: 18px; }
[lang=ar] #goals { left: auto; right: 18px; text-align: right; }
[lang=ar] #score, [lang=ar] #combo { right: auto; left: 20px; text-align: left; }
[lang=ar] #loadout { left: auto; right: 20px; }
[lang=ar] #mods { right: auto; left: 20px; }
[lang=ar] #pausebtn { left: auto; right: calc(50% + 84px); }
[lang=ar] #xpbar .lv b { font-family: 'Jersey 10', monospace; }
[lang=ar] .bst p, [lang=ar] .meta-content p { font-size: 15px; line-height: 1.8; }
[lang=ar] #ob-tip, [lang=ar] .ob-offer { line-height: 1.7; }
[lang=ar] #scr-title .ob-offer > span { font-size: 15px; line-height: 1.8; }
[lang=ar] #scr-title { gap: 12px; }
[lang=ar] #scr-title .menu { gap: 8px; }
[lang=ar] #scr-title .menu > button { padding-block: 4px; }
[lang=ar] #scr-title .logo { font-size: clamp(72px, 12vw, 144px); }
[lang=ar] .credits { font-size: 10px; line-height: 1.6; }
[lang=ar] bdi { unicode-bidi: isolate; }
`;

export function applyLanguage(language: Language): void {
  if (typeof document === 'undefined') { setLanguage(language); return; }
  if (!document.getElementById('i18n-css')) {
    const style = document.createElement('style');
    style.id = 'i18n-css';
    style.textContent = CSS;
    document.head.appendChild(style);
  }
  const previous = getLanguage();
  setLanguage(language);
  if (previous !== language) relocalizeDom(document.body, previous);
}
