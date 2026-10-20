LANE: readability2 — readable chaos

Goal: even in the craziest moment (8 players, 300 enemies, every effect on) the player always sees: their hero, enemy bullets, telegraphs and pickups.
1. Audit with screenshots of worst cases (test links: swarm=300, boom, bullets=500, night, rain, eclipse, fog, anime look, mech, team ultimate, 4 heroes) and list what hides what.
2. Effect budget: a global "visual noise" governor that caps particles/debris/smoke/damage numbers/screen flashes per second when the screen is crowded, prioritising danger (enemy bullets, telegraphs) over friendly flash; friendly effects fade/alpha down near the local hero.
3. Enemy bullets: always on top with a dark outline, never the same colours as friendly effects, a subtle pulse; telegraphs (red zones/lines) always visible over weather/fog/night.
4. Damage numbers: merge/cluster when crowded, show only big hits beyond a density threshold; setting already exists for all/mine/off — add AUTO (default) that thins automatically.
5. Screen shake/flash: global caps so stacked explosions never blind the player.
Owns: new src/game/systems/readability2.ts, src/render/noiseGovernor.ts, small hooks in particles/fx/damageNumbers/bullets render, settings option, tests/readability2.test.ts.
