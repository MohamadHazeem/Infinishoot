import { setLanguage, type Language } from './index';

/** Locally bundled OFL font: no network requests, including in Electron/offline builds. */
const CSS = `
:root:is([lang=es],[lang=fr],[lang=pt-BR],[lang=de],[lang=tr]) :is(.lo-card,.card) .name { hyphens: auto; letter-spacing: 0; }
/* Longer Latin copy uses the existing wrapping/scrolling menus, preserving text scale. */
:root:is([lang=es],[lang=fr],[lang=pt-BR],[lang=de],[lang=tr]) .screen :is(button,.name,.desc,.note) { overflow-wrap: anywhere; }
:root:is([lang=es],[lang=fr],[lang=pt-BR],[lang=de],[lang=tr]) .settings-tabs button { white-space: normal; min-width: 0; padding-inline: calc(2 * var(--p)); }
:root:is([lang=es],[lang=fr],[lang=pt-BR],[lang=de],[lang=tr]) .settings-footer { flex-wrap: wrap; }

@font-face { font-family: 'Infini Turkish Text'; src: url('${(import.meta.env?.BASE_URL ?? '/')}fonts/jersey-15-latin-ext-400-normal.woff2') format('woff2'); font-weight:400; font-display:swap; unicode-range:U+011E-011F,U+0130,U+015E-015F; }
@font-face { font-family: 'Infini Turkish Display'; src: url('${(import.meta.env?.BASE_URL ?? '/')}fonts/jersey-10-latin-ext-400-normal.woff2') format('woff2'); font-weight:400; font-display:swap; unicode-range:U+011E-011F,U+0130,U+015E-015F; }
:root[lang=tr] { --font:'Infini Turkish Text','Jersey 15',monospace; --display:'Infini Turkish Display','Jersey 10',monospace; --label:'Silkscreen','Infini Turkish Text','Jersey 15',monospace; }

@font-face { font-family: 'Infini Arabic'; src: url('${(import.meta.env?.BASE_URL ?? '/')}fonts/NotoSansArabic.ttf') format('truetype'); font-weight: 100 900; font-style: normal; font-display: swap; }
:root[lang=ar] { --font: 'Infini Arabic', sans-serif; --display: 'Infini Arabic', sans-serif; --label: 'Infini Arabic', sans-serif; }
[lang=ar] #hud, [lang=ar] #hud * { letter-spacing: 0; }
[lang=ar] .screen { line-height: 1.65; }
[lang=ar] .screen h1 { font-size: 34px; line-height: 1.6; margin-block: 0; }
[lang=ar] #scr-gameover { justify-content: flex-start; padding-top: 28px; }
[lang=ar] #scr-gameover > h1 { flex-shrink: 0; }
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
/* New lane panels use Arabic line metrics and logical alignment. */
[lang=ar] .screen :is(button,.section,.name,.desc,.note) { letter-spacing: 0; }
[lang=ar] #scr-settings .settings-tabs button { font-size: 13px; line-height: 1.6; white-space: normal; }
[lang=ar] #scr-settings .settings-description { font-size: 16px; line-height: 1.8; }
[lang=ar] #scr-settings .settings button { text-align: start; }
[lang=ar] #scr-settings .settings b { margin-left: 0; margin-inline-start: 8px; }
[lang=ar] .settings-footer { flex-wrap: wrap; gap: 12px; }
[lang=ar] .settings-hint { line-height: 1.7; }
[lang=ar] .bst:not(:has(.sw)):not(.fusion-row) > :is(b,p,small) { grid-column: 1 / -1; }
[lang=ar] :is(.lob-card,.lob-log,.gh-panel,.pty-row .vote) { text-align: start; }
[lang=ar] :is(.lob-card .lob-flag,.lob-card .ping) { margin-left: 0; margin-inline-start: auto; }
[lang=ar] .lob-card .lob-line { white-space: normal; overflow: visible; line-height: 1.6; }
[lang=ar] .lob-card .lob-line.cos { flex-wrap: wrap; }
[lang=ar] :is(.lob-chat-title,.fr-code-big,.lob-card .lob-flag,.lob-log .sys) { letter-spacing: 0; line-height: 1.7; }
[lang=ar] .fr-code-big { direction: ltr; unicode-bidi: isolate; }
[lang=ar] :is(#race-hud,.rr-row,.rk-sub,.tn-slot,.tn-status,.g-board) { line-height: 1.65; }
[lang=ar] #race-hud { right: auto; left: 18px; }
[lang=ar] #race-hud :is(.rc-top,.lb) { font-size: 11px; line-height: 1.6; }
[lang=ar] .pty-row { grid-template-columns: 12px minmax(70px,1fr) auto minmax(40px,140px) 70px minmax(65px,auto); }
[lang=ar] #scr-season button.sp-cell b { white-space: normal; overflow: visible; line-height: 1.6; }
[lang=ar] :is(.rt-map,.rt-cards) .px-icon.glyph { font-family: 'Jersey 10', monospace; }
[lang=ar] #scr-route .rn .glyph { font-size: 24px; line-height: 24px; }
[lang=ar] #story-play h1 { white-space: normal; overflow-wrap: anywhere; line-height: 1.5; flex-shrink: 0; }
[lang=ar] .tl-copy b { font-size: 18px; line-height: 1.6; }
[lang=ar] .tl-tile { min-height: min-content; }
[lang=ar] .tl-grid { grid-auto-rows: minmax(min-content, auto); }
@media(max-height:550px) {
  [lang=ar] #hud #ingame #minimap { left: 12px; right: auto; top: 82px; bottom: auto; }
  [lang=ar] #hud:has(#race-hud:not([hidden])) #ingame #minimap { left: auto; right: 12px; top: auto; bottom: 90px; }
  [lang=ar] .raid-hud { font-size: calc(12px * var(--text-scale, 1)); line-height: 1.5; max-width: 250px; padding: 8px; }
  [lang=ar] #g-challenge { font-size: 14px; line-height: 1.5; }
  [lang=ar] #race-hud { top: 90px; width: 220px; font-size: 13px; }
  [lang=ar] #race-hud .rc-row { padding-block: 0; }
  [lang=ar] #hud:has(#race-hud:not([hidden])) #ob-tip { left: 32%; top: 44%; width: 30%; }
  [lang=ar] #hud:has(#race-hud:not([hidden])) #ob-tip p { font-size: 14px; line-height: 1.6; }
  [lang=ar] #story-play { padding: 8px; gap: 4px; }
  [lang=ar] #story-play h1 { font-size: 22px; padding: 0; }
  [lang=ar] #story-play .story-comic { max-height: 40vh; }
  [lang=ar] #story-play .story-caption { font-size: calc(14px * var(--text-scale, 1)); padding: 6px; }
  [lang=ar] #story-play .story-controls { margin-top: 4px; gap: 8px; }
  [lang=ar] #story-play .story-controls button { font-size: 16px; min-height: 34px; padding-block: 2px; }
  [lang=ar] #scr-settings { gap: 6px; padding: 8px 18px; }
  [lang=ar] #scr-settings h1 { font-size: 26px; }
  [lang=ar] .settings-shell { gap: 8px; flex-shrink: 0; }
  [lang=ar] .settings-shell > * { flex-shrink: 0; }
  [lang=ar] #scr-settings .settings { max-height: 26vh; min-height: 90px; }
  [lang=ar] #scr-settings .settings-description { min-height: 0; font-size: 14px; }
  [lang=ar] #scr-settings .settings-tabs button { min-height: 36px; padding-block: 4px; }
  [lang=ar] #scr-settings .settings-footer button { font-size: 15px; min-height: 36px; }
}

`;

export function applyLanguage(language: Language): Promise<void> {
  if (typeof document === 'undefined') return setLanguage(language);
  if (!document.getElementById('i18n-css')) {
    const style = document.createElement('style');
    style.id = 'i18n-css';
    style.textContent = CSS;
    document.head.appendChild(style);
  }
  return setLanguage(language);
}
