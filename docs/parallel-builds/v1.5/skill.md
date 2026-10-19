LANE: skill

Goal: a skill layer that rewards good play, plus hero ultimates and weapon feel.
Build:
1. Perfect dash: dashing through an attack/bullet in the last moment triggers a brief slow-mo, a sparkle, a short damage buff and refunds the dash cooldown.
2. Parry: a timed defensive press (pick a binding that doesn't clash: check keybinds.ts; gamepad too) just as a bullet/melee arrives reflects bullets back as player bullets and stuns melee attackers. Clear feedback (flash, freeze frame, 'parry' sound if available).
3. Style meter graded D, C, B, A, S, SS: rises with varied, skilful play (different weapons dealing kills, perfect dashes, parries, multi-kills, no-hit streaks, kills on the music beat via music.pulse / a beat check), decays over time and drops on hit. Rank multiplies score and slightly XP. HUD widget in a new file src/ui/styleMeter.ts (bold letter with juice). End-of-run shows best rank.
4. Hero ultimates: each hero (src/data/heroes.ts) gets a unique ultimate that charges from damage dealt and kills, activated with a key (bindable) / gamepad button; big, screen-filling, fun (e.g. a bullet-time barrage, a mech stomp, a healing nova). Show charge in the HUD.
5. Weapon feel pass: every weapon gets its own recoil/camera kick, muzzle flash scale, hit-stop weight, knockback and crit feel (crits: bigger flash, sharper sound pitch, small hit-stop) tuned per weapon in data, not hardcoded.
6. Co-op: perfect dash/parry/ultimates work for every player (clients send input; host simulates) and are visible to all.
Owns: src/game/player.ts, src/game/hero.ts (keep it additive), src/game/juice.ts, src/game/weapons/base.ts, src/data/weapons.ts (feel fields only), src/data/heroes.ts, src/core/keybinds.ts, new src/game/style.ts, src/game/ultimates.ts, src/ui/styleMeter.ts, a new system file, tests/skill.test.ts.
