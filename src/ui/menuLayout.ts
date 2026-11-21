export const MENU_LAYOUT = `
/* Back is anchored to the same logical corner on destination screens. */
#hud .screen [data-shell-back] { position:fixed; inset-block-start:calc(5 * var(--p)); inset-inline-start:calc(6 * var(--p)); z-index:6; width:auto; min-width:0; min-height:calc(12 * var(--p)); margin:0; padding:calc(2 * var(--p)) calc(4 * var(--p)); font:calc(6 * var(--p))/1.2 var(--font); }
#hud #scr-extras .menu > [data-shell-back] { min-width:0; min-height:calc(12 * var(--p)); font-size:calc(6 * var(--p)); }
.setup-gear p { margin:calc(2 * var(--p)) 0 0; font:calc(5 * var(--p))/1.2 var(--font); color:var(--mist); }
/* Player menus. MoreCue can scroll the choice list independently of the start action. */
#hud [data-menu-folded], #hud :is(#scr-settings,#scr-title,#scr-play,#scr-online,#scr-modes,#scr-extras) [hidden] { display:none !important }
#hud #scr-title.menu-home .menu-primary > :not(.menu),
#hud #scr-title.menu-home .menu-profile, #hud #scr-title.menu-home .menu-activity,
#hud #scr-title.menu-home .desktop-update { display:none !important }
#hud #scr-title.menu-home { justify-content:center; align-items:flex-start; padding-inline:clamp(calc(7 * var(--p)),8vw,calc(50 * var(--p))); }
#hud #scr-title.menu-home .menu-home-body { width:min(100%,calc(118 * var(--p))); }
#hud #scr-title.menu-home .menu-primary { width:100%; }
#hud #scr-title.menu-home .menu-primary > .menu { display:flex; flex-flow:column; align-items:stretch; }
#hud #scr-title.menu-home .menu-primary > .menu > button { min-width:0; text-align:start; font-size:calc(9 * var(--p)); }
#hud #scr-title.menu-home .menu-play { display:flex; justify-content:space-between; align-items:center; gap:calc(6 * var(--p)); }
#hud #scr-title.menu-home .menu-play b { font-size:calc(14 * var(--p)); }
#hud #scr-title.menu-home .menu-masthead { padding:0; }
#hud #scr-title.menu-home .menu-footer { margin-top:0; }
#hud #scr-title.menu-home .credits { max-width:90%; }
#hud #scr-title.menu-home .tagline { letter-spacing:0; }
#hud :is(#scr-play,#scr-modes,#scr-extras,#scr-settings,#scr-online,#scr-activity) > h1 { font:calc(16 * var(--p))/1.2 var(--display); color:var(--yellow); margin:0; }
#hud :is(#scr-play,#scr-extras,#scr-modes,#scr-activity) { justify-content:safe center; gap:calc(5 * var(--p)); }
.run-layout { width:min(94%,calc(285 * var(--p))); display:grid; grid-template-columns:minmax(0,2fr) minmax(0,3fr); align-items:start; gap:calc(6 * var(--p)); text-align:start; }
.run-layout .px, .setup-gear, .activity-card { --bg:var(--ink); --hi:var(--slate); --lo:var(--night); --ring:var(--ink); padding:calc(6 * var(--p)); }
.run-layout h2, .setup-gear h2, #scr-extras [data-group] h2 { font:calc(5 * var(--p))/1.35 var(--label); color:var(--cyan); margin:0 0 calc(3 * var(--p)); letter-spacing:0; }
.run-help { color:var(--mist); font:calc(5 * var(--p))/1.35 var(--font); margin:calc(3 * var(--p)) 0 0; }
.run-summary { color:var(--white); font:calc(9 * var(--p))/1.15 var(--font); margin:0 0 calc(7 * var(--p)); }
#hud #scr-play .menu-launch { width:auto; max-width:none; min-width:0; display:grid; gap:calc(3 * var(--p)); margin-top:calc(3 * var(--p)); }
#hud #scr-play .run-card button { width:100%; min-height:calc(14 * var(--p)); font:calc(8 * var(--p))/1.2 var(--font); white-space:normal; padding:calc(2 * var(--p)) calc(4 * var(--p)); text-align:start; }
#hud #scr-play .run-card > .continue { font-size:calc(11 * var(--p)); }
.run-modes { display:grid; gap:calc(2 * var(--p)); max-height:58vh; overflow:auto; padding:calc(2 * var(--p)); }
.run-modes button { display:grid; text-align:start; gap:var(--p); padding:calc(2 * var(--p)) calc(4 * var(--p)); white-space:normal; }
.run-modes button[aria-pressed=true] { --bg:var(--navy); --hi:var(--cyan); border-inline-start:calc(2 * var(--p)) solid var(--cyan); }
.run-modes b { font:calc(8 * var(--p))/1.1 var(--display); }
.run-modes small { font:calc(5.5 * var(--p))/1.15 var(--font); color:var(--white); }
.run-modes em { color:var(--yellow); font:calc(3.5 * var(--p))/1 var(--label); }
#hud #scr-modes .setup-gear { text-align:start; }
.setup-gear > div, #scr-extras [data-group] { display:flex; gap:calc(3 * var(--p)); }
.setup-gear button { flex:1; display:flex; align-items:center; gap:calc(3 * var(--p)); text-align:start; white-space:normal; }
.setup-gear button:disabled { opacity:1; --bg:var(--night); }
.setup-gear small,.setup-gear b { display:block; }
.setup-gear small { font:calc(4 * var(--p))/1.35 var(--label); color:var(--cyan); }
.setup-gear b { font:calc(8 * var(--p))/1.2 var(--font); }
#hud #scr-modes { gap:calc(2.5 * var(--p)); }
#hud #scr-modes .hero-row { max-width:min(94vw,calc(290 * var(--p))); flex-wrap:wrap; }
#hud #scr-modes > .menu.row:last-child { flex-wrap:wrap; }
#hud #scr-extras.menu-consistent > .menu { width:min(95%,calc(320 * var(--p))); grid-template-columns:repeat(3,minmax(0,1fr)); align-items:start; }
#scr-extras [data-group] { flex-direction:column; background:var(--ink); padding:calc(4 * var(--p)); text-align:start; }
#scr-extras [data-group] button { white-space:normal; font-size:calc(7 * var(--p)); min-height:calc(13 * var(--p)); line-height:1.2; text-align:start; }
#hud #scr-extras > .menu > [data-act=ex-back] { grid-column:1/-1; justify-self:center; min-width:calc(48 * var(--p)); }
#scr-activity .activity-list { width:min(92vw,calc(285 * var(--p))); max-height:72vh; padding:calc(2 * var(--p)); overflow:auto; display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); align-items:start; gap:calc(4 * var(--p)); }
#scr-activity .activity-card { background:var(--ink); font-size:calc(6 * var(--p)); text-align:start; }
#scr-activity .ft-list { grid-row:1 / span 2; grid-column:1; display:grid; gap:calc(2 * var(--p)); }
#scr-activity .ft-hide { justify-self:end; font-size:calc(6 * var(--p)); }
#scr-activity .activity-card .hd, #scr-activity .activity-card .qh { display:flex; flex-wrap:wrap; align-items:baseline; gap:calc(3 * var(--p)); }
#scr-activity .activity-card .hd { color:var(--yellow); }
#scr-activity .activity-card .m2-xpbar { width:100%; }
#scr-activity .activity-card .qh { color:var(--cyan); }
#scr-activity .activity-card .q { margin-block:calc(2 * var(--p)); }
#scr-activity .activity-card em { color:var(--yellow); margin-inline-end:calc(2 * var(--p)); }
#scr-activity small { display:block; }
#hud #scr-online.lob-in:not(.room-options) { padding-inline:calc(6 * var(--p)); }
#hud #scr-online.lob-in:not(.room-options) .lob-card .lob-line { display:none; }
#hud #scr-online.lob-in:not(.room-options) > .lobby { width:min(94%,calc(290 * var(--p))); columns:auto; }
#hud #scr-online.lob-in:not(.room-options) .players { display:grid; grid-template-columns:repeat(auto-fit,minmax(calc(52 * var(--p)),1fr)); }
#hud #scr-online.room-options { gap:calc(2 * var(--p)); justify-content:safe center; }
#hud #scr-online.room-options.lob-in > .lobby { width:100%; max-height:55vh; overflow-y:auto; overflow-x:hidden; display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); align-items:start; columns:auto; padding:calc(4 * var(--p)); text-align:start; }
#hud #scr-online.room-options.lob-in > .lobby > :is(.code-label,.code-big,.players,.lob-x) { grid-column:1/-1; }
#hud #scr-online.room-options.lob-in .lob-line { white-space:normal; overflow-wrap:anywhere; }
#hud #scr-online.room-options.lob-in > .lobby .players { grid-template-columns:repeat(auto-fit,minmax(calc(48 * var(--p)),1fr)); }
#hud #scr-online .menu.row, #hud #scr-online .join-row { flex-wrap:wrap; justify-content:center; }
#hud #scr-pause:not(.build-open) > .menu { min-width:calc(75 * var(--p)); }
#hud #scr-settings .settings-advanced { display:grid; gap:calc(3 * var(--p)); }
#hud #scr-settings .settings-advanced > :is(button,label) { width:100%; min-height:calc(14 * var(--p)); font-size:calc(7 * var(--p)); white-space:normal; }
#scr-settings [data-advanced] { color:var(--cyan); }
#scr-settings .settings-footer { flex-wrap:wrap; justify-content:center; }
[dir=rtl] #hud .screen :is(.run-summary,.run-modes small,.setup-gear b) { line-height:1.55; }
.setup-layout { display:grid; grid-template-columns:minmax(0,3fr) minmax(0,2fr); gap:calc(6 * var(--p)); width:min(calc(365 * var(--p)),94%); }
.setup-main,.setup-side { display:flex; flex-flow:column; gap:calc(3 * var(--p)); padding:calc(5 * var(--p)); text-align:start; --bg:var(--ink); --hi:var(--slate); --lo:var(--night); --ring:var(--ink); }
#hud #scr-modes .setup-layout .section,.setup-side h2 { color:var(--cyan); font:calc(5 * var(--p))/1.35 var(--label); margin:0; text-align:start; }
#hud #scr-modes .setup-layout .menu.row { width:100%; min-width:0; justify-content:flex-start; gap:calc(2 * var(--p)); flex-wrap:wrap; }
#hud #scr-modes .setup-layout .note { margin:0; text-align:start; }
#hud #scr-modes .setup-layout .setup-gear { box-shadow:none; padding:0; width:100%; }
#hud #scr-modes .setup-gear button { padding:calc(2 * var(--p)); min-width:0; }
#hud #scr-modes .setup-gear button span { min-width:0; }
#hud #scr-modes .setup-gear .px-icon { width:24px; height:24px; }
#hud #scr-modes .setup-gear small { white-space:nowrap; font-size:calc(3.5 * var(--p)); }
#hud #scr-modes .setup-gear b { font-size:calc(7 * var(--p)); }
#hud #scr-modes .setup-side > :is(.casual-preset,.squad-options) { width:auto; max-width:none; margin:0; justify-content:flex-start; flex-wrap:wrap; }
#hud #scr-modes .setup-side :is(.g-note,.challenge-help,.casual-preset span) { font:calc(5.5 * var(--p))/1.25 var(--font); text-align:start; }
#hud #scr-modes .setup-side .g-options button { font-size:calc(6 * var(--p)); }
#hud #scr-modes > .menu.row:last-child { gap:calc(3 * var(--p)); }
@media(max-height:550px) {
  #hud #scr-title.menu-home { gap:calc(2 * var(--p)); }
  #hud #scr-title.menu-home .menu-primary > .menu { gap:calc(2 * var(--p)); }
  #hud :is(#scr-play,#scr-modes,#scr-extras,#scr-settings,#scr-online,#scr-activity) > h1 { font-size:calc(11 * var(--p)); }
  #hud #scr-play .menu-launch { grid-template-columns:1fr; }
  #hud #scr-modes .setup-gear { max-width:94%; padding:calc(2 * var(--p)); }
  #hud #scr-modes .setup-gear h2 { margin-bottom:var(--p); }
  #hud #scr-modes .setup-gear button { min-height:0; padding:var(--p) calc(2 * var(--p)); }
  #hud #scr-modes .setup-gear .px-icon { width:24px; height:24px; }
  #hud #scr-modes .setup-gear small { font-size:calc(3.5 * var(--p)); }
  #hud #scr-modes .setup-gear b { font-size:calc(6 * var(--p)); }
  #hud .screen [data-shell-back] { inset-block-start:calc(2 * var(--p)); }
  #hud .run-modes { max-height:46vh; }
  #hud #scr-extras [data-group] { gap:calc(2 * var(--p)); }
}
@media(max-width:550px) {
  .run-layout, #hud #scr-extras.menu-consistent > .menu, #scr-activity .activity-list { grid-template-columns:1fr; }
  .setup-layout { grid-template-columns:1fr; }
  .setup-gear > div { flex-wrap:wrap; }
}
`;
