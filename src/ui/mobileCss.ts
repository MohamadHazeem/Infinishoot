/** Responsive rules kept in the mobile lane; no shared stylesheet changes. */
export function injectMobileCss(): void {
  if (document.getElementById('mobile-css')) return;
  const st = document.createElement('style');
  st.id = 'mobile-css';
  st.textContent = `
#game { touch-action:none; }
#hud:has(#scr-touchlayout:not([hidden])) #ob-tip { display:none; }
#touch { inset:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }
#touch[hidden], #touch [hidden] { display:none !important; }
#touch .tbtn, #touch .tstick { right:auto; bottom:auto; margin:0; padding:3px; touch-action:none; }
#touch .tstick { display:grid; pointer-events:auto; }
#touch .tstick i { width:36%; height:36%; pointer-events:none; }
#touch .tbtn { font-size:11px; overflow-wrap:anywhere; }
#touch .parry { --bg:var(--teal); --hi:var(--green); }
#touch .ult { --bg:var(--plum); --hi:var(--red); background:linear-gradient(to top,var(--orange) calc(var(--k,0)*100%),var(--bg) 0); }
#touch .ult.ready { --ring:var(--yellow); color:var(--yellow); }
#hud #scr-touchlayout { justify-content:flex-start; gap:6px; padding:8px; overflow:hidden; background:var(--ink); }
#hud #scr-touchlayout h1 { font-size:26px; z-index:1; pointer-events:none; }
#scr-touchlayout > * { zoom:1; flex-shrink:0; }
.touch-help { margin:0; text-align:center; color:var(--cyan); z-index:1; pointer-events:none; font-size:16px; }
.touch-board { position:absolute; inset:0; width:100%; height:100%; min-height:0; border:0; background:var(--ink); overflow:hidden; }
#scr-touchlayout .touch-preview { position:absolute; margin:0; padding:3px; font:10px var(--label); touch-action:none; --bg:var(--navy); --hi:var(--blue); --lo:var(--ink); }
#scr-touchlayout .touch-preview.selected { --ring:var(--yellow); z-index:1; }
#scr-touchlayout .touch-preview:is(.move,.aim) { --bg:var(--teal); }
.touch-grip { position:absolute; right:0; bottom:0; width:30px; height:30px; display:grid; place-items:center; background:var(--blue); color:var(--white); }
.touch-tools { position:absolute; top:76px; left:50%; transform:translateX(-50%); z-index:2; max-width:780px; padding:6px; background:var(--ink); display:flex; flex-wrap:wrap; align-items:center; justify-content:center; gap:12px; width:100%; }
.touch-tools label { display:flex; align-items:center; gap:8px; }
.touch-tools input { width:80px; min-height:44px; }
.touch-tools button { min-height:48px; font-size:20px; }
@media(max-width:900px), (max-height:500px), (pointer:coarse) {
  #hud .screen { padding: max(12px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(16px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left)); gap:16px; overflow-x:hidden; }
  #hud .screen > * { flex-shrink:0; max-width:100%; }
  #hud .screen:not(#scr-settings) > * { zoom:max(1,var(--ui)); }
  #hud .screen .bind-list { width:100%; }
  #hud .screen .bind-row { grid-template-columns:minmax(90px,1.4fr) repeat(2,minmax(70px,1fr)); gap:8px; }
  #hud .screen .skin-grid { width:100%; grid-template-columns:repeat(auto-fit,minmax(145px,1fr)); }
  #hud .screen button, #hud .screen input, #hud .screen select { min-height:48px; min-width:44px; }
  #hud .screen button { white-space:normal; overflow-wrap:anywhere; }
  #hud .screen h1 { font-size:36px; }
  #hud .screen .menu.row { flex-wrap:wrap; justify-content:center; }
  #hud .screen .scroll { width:100%; min-width:0; max-height:none; overflow:visible; }
  #hud .screen .cards { gap:18px; width:100%; }
  #hud .screen button.card { width: min(228px,100%); min-height:220px; gap:6px; padding-bottom:10px; }
  #hud .screen .card .desc { font-size:18px; line-height:1.15; }
  #hud .screen .card .icon { width:54px; height:54px; flex:none; }
  #hud .screen .card .icon img.px-icon { width:48px; height:48px; }
  #hud .screen .card .reel, #hud .screen .card .reel .strip > * { width:48px; height:48px; }
  #hud .screen .card .reel .strip { transform:translateY(calc(var(--k,0) * -48px)); }
  #hud .screen .card .name { font-size:24px; }
  #hud .screen .menu { max-width:100%; }
  #hud #scr-settings .settings-shell { flex-shrink:1; }
  #hud #scr-settings .settings { max-height:42vh; }
  #hud .screen.meta-screen { overflow-y:auto; }
  #hud #scr-loadout .lo-cards { flex-wrap:wrap; }
  #hud #scr-loadout .lo-row { max-width:100%; }
  #hud .screen :is(.shop-body,.shop-main,.shop-side,.build,.columns) { max-width:100%; min-width:0; }
  #hud #scr-title .ha-banner { position:static; margin:0; order:-1; font-size:12px; }
  #hud .screen .logo { font-size:clamp(48px,12vw,88px); }
  #hud #ingame #pausebtn { width:48px; height:48px; top:20px; left:auto; right:12px; zoom:1; }
  #hud #ingame #hp { width:auto; }
  #hud #ingame #hp .bar { width:140px; flex:none; }
  #hud #ingame #hp .num { font-size:12px; }
  #hud #ingame #score { right:76px; font-size:24px; top:22px; }
  #hud #ingame #combo { right:76px; top:52px; }
  #hud #ingame #goals { top:95px; max-width:210px; font-size:15px; }
  #hud #ingame #goals #spice > div { min-width:0; font-size:15px; }
  #hud #ingame #minimap { width:72px; height:72px; right:12px; top:82px; bottom:auto; }
  #hud #ingame #loadout { left:50%; bottom:8px; transform:translateX(-50%); }
  #hud #ingame #mods { left:50%; bottom:70px; right:auto; transform:translateX(-50%); gap:8px; }
  #hud #ingame #meters { left:50%; bottom:112px; transform:translateX(-50%); gap:8px; }
  #hud #ingame #loadout { width:210px; gap:8px; }
  #hud #ingame #loadout .row { flex-wrap:wrap; justify-content:center; gap:8px; }
  #hud #ingame #loadout .slot, #hud #ingame #mods .mod { width:28px; height:28px; }
  #hud #ingame :is(#loadout,#mods) img.px-icon { width:24px; height:24px; }
  #hud #ingame #meters .pip { width:38px; height:34px; }
  #hud #ingame #meters .pip span { font-size:7px; letter-spacing:0; }
  #hud #ingame #meters .pip svg { max-height:12px; }
  #hud #ingame #meters .pip .pg { display:none; }
  #hud #ingame #combo { right:100px; }
  #hud #ingame #gp-cash { top:112px; right:100px; width:150px; padding:6px; }
  #hud #ingame #gp-cash .t:not(.sel), #hud #ingame #gp-cash .f { display:none; }
  #hud #ingame #gp-power { left:50%; bottom:155px; transform:translateX(-50%); width:190px; }
  #hud #ingame #bossbar { width:34%; top:76px; }
  #hud #ingame #banner .t { font-size:36px; }
  #hud #ingame #banner .s { font-size:18px; }
}
@media(max-width:500px) {
  #hud .screen > * { zoom:1; }
  #hud .screen button.card { width:100%; min-height:0; }
  #hud .screen .cards { flex-direction:column; }
  #hud #scr-loadout :is(.lo-rows,.lo-row,.lo-cards) { width:100%; }
  #hud #scr-loadout button.lo-card { width:100%; }
  #hud .screen .pad-legend { grid-template-columns:1fr; }
  #hud #hudface { display:none; }
  #hud #ingame.has-face #xpbar .lv { left:12px; top:24px; }
  #hud #ingame.has-face > #hp, #hud #ingame.has-face > #runinfo { left:80px; }
  #hud #ingame #timer { top:86px; left:50%; }
  #hud #ingame #score { top:100px; right:12px; }
  #hud #ingame #combo { top:128px; right:12px; }
  #hud #ingame #minimap { top:270px; }
  #hud #ingame #gp-cash { top:240px; }
  #hud #ingame #bossbar { width:70%; top:150px; }
  #hud #ingame #goals { top:185px; max-width:170px; }
  #hud #ingame #loadout { bottom:8px; }
  #hud #ingame #mods { bottom:58px; }
  #hud #ingame #meters { bottom:95px; }
}
`;
  document.head.append(st);
}
