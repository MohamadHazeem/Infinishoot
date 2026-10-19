# Lane: tips2 (teach every new mechanic)

## What players get
- **64 new first-time tips**, one at a time, through the existing tip panel and queue (src/game/onboarding.ts). They follow SETTINGS > TIPS, show once per save (`save.tips`), keep the 3.5 s gap between in-fight tips, wait out the stage banner, and name buttons with `promptText` (rebinds, Xbox/PlayStation glyph names, keyboard fallback for pad actions with no glyph such as TRADE).
  - Time and gameplay: rewind (low life with rewind history), last stand (x50 combo), combo cash-in, mech suit, supply crates, mutations, weapon overload.
  - Co-op: team move (TEAM meter linking), team ultimate (your ult ready in co-op), shared lives / buy-back (downed with the pool on), carry a teammate, buddy link, trading, ping wheel and emotes, roles, autopilot (drop-out), co-op objectives.
  - Skill: parry (enemy shots on screen), perfect dodge (after one, or from stage 2).
  - Build, run, modes: weapon fusion (a fusion is ready), route map (menu tip on the ROUTE screen), heat, Survival Gauntlet, Ascension, rhythm stage, Pacifist road, bonus mini-games.
  - Raid: the Hydra Engine roles, parry the missiles, burn the stump, feed the cannons, overdrive.
  - Competitive: race, PvP duel, 2-team PvP, best of 3.
  - Secrets and seasons: secret relay room nearby (within 20 m), Goldbug (hints at the Golden King), Halloween candy, pets learning skills.
  - Heroes: Ronin's sword combo and Iaido dash, Tinker's bots and beacon.
  - Bosses and enemies: Glitch DJ, Boxer Jack, Admiral Gale, Pumpking, Titan Goliath, Omega Overlord, boss rematches, mini-bosses, secret bosses, the Reaper, Swarm Queen, Mirror Bot, diggers, Phantoms.
  - World events: floor collapse, flash flood, island split, the Colossus, eclipse, giant flower, eruption, Night Raid.
  - Style meter and hero ultimates were already taught by the original `style` / `ult` tips.
- **Codex & Lore**: lore for 16 enemies/bosses that had the generic placeholder (diggers, mirrors, Swarm Queen and her eggs and walls, the biome natives, the three remixes), field tips for 16 that had none (Halloween four, Pumpking, Omega, the mini-bosses, Royal Hive, Reaper, secret bosses, remixes), all 21 veterans (a veteran line plus their base enemy's lore and tip), lore for Toy Factory, Neon City and Sky Fortress, and new entries: Titan Goliath and the Hydra Engine (hidden enemies, so they had none), every MODE (the 7 solo modes plus Online Co-op, PvP, Race, Versus Swarm). Modes, the Titan and the Hydra are discovered by playing them.
- **Arsenal**: a POWER-UPS tab (Mech Suit, Minigun, Railgun, Flamethrower, Halloween Candy), discovered by piloting / holding / seeing them. Every weapon, fusion, special, item, Mod, relic, combo and evolution already had an entry through the generated Arsenal; the test now checks it.
- **Arabic** for everything above, plus 39 existing Codex sentences other lanes left in English (bosses3, Halloween, enemies2, Duelist/Furnace/Twin/Ronin/Tinker lore, Ronin and Tinker descriptions, two mode descriptions).

## How it works
- src/data/tips2.ts: ids (`TIP2_IDS`), which prompts each tip names, times, queue priority (`TIP2_PRIORITY`: falling floors, stumps, shared lives, PvP and race 0; bosses, raid steps, eruption, Colossus, Reaper 1; trivia 9), menu tips (`TIP2_MENUS`: route). Titles are canonical English (the tip panel localizes them); texts come from `t('tips2.<id>.text', { k, k2 })`, so the button labels are filled in after translation.
- src/game/tips.ts: `TipId` and `TIPS` / `TIP_PRIORITY` include the new ones (one spread each).
- src/game/systems/tips2.ts: `DETECT[id](g)` reads only state this machine has (host/solo values or the client's snapshot mirrors: `timeState().net`, `coopState().net`, `gpWorld`, `coopPlayState`, `raidRuntime().state`, `worldEventOf`, `secretsState`, the client's `netEnemies` for boss ids). One pass over enemies per poll into a reused scan object; seen tips are skipped first. A detector that throws (a lane missing in some setup) just doesn't tip.
- **Stale moments**: 36 tips are about a moment (a mech on the ground, a falling floor, a boss on screen...). If one reaches the front of the queue after its moment passed, `tip2Still` drops it without marking it seen, and it comes back next time. Explainers of a lasting state (mode, hero, heat) stay queued.
- Hooks in shared files (one line each): `onboarding.ts` (merge `TIP2_MENUS`, call `detectTips2` in `detectTips`, `tip2Still` in `tickTip`), `codex.ts` (fallbacks to codex2.ts, `...EXTRA_CODEX`), `arsenal.ts` (the POWER-UPS tab), `en.ts` / `ar.ts` (`...tips2En` / `...tips2Ar`).
- Cost: every 10 steps, one enemy pass plus up to 64 cheap checks, skipped once seen. No per-frame work, no allocations in hot paths.
- Co-op: no messages. Each machine tips its own player from what it mirrors (like the original tips).

## Files
New: src/data/tips2.ts, src/data/codex2.ts, src/game/systems/tips2.ts, src/i18n/tips2.ts, tests/tips2.test.ts, notes/lanes/tips2.md.
Small edits: src/game/tips.ts, src/game/onboarding.ts, src/data/codex.ts, src/data/arsenal.ts, src/i18n/en.ts, src/i18n/ar.ts, src/dev/onboardingLinks.ts.

## Test links
- `?test&god&tip=raid&tipnow`: show any tip at once (`tipnow` skips the stage-banner quiet time; headless shots are too slow to reach it). Any id from src/data/tips2.ts; add `&lang=ar`.
- `?test&screen=arsenal&discover=all&cxtab=powerups`: the new Arsenal tab (`cxtab` = any tab id).
- `?test&screen=codex&codexall`: every Codex & Lore entry discovered (`&lang=ar` for Arabic).
- Natural triggers: `?test&god&nolevel&mechdrop&crate=minigun&mutate=6&combo=95` (mech, crate, mutation, cash-in, last stand tips), `?test&biome=neon&bossnow&god` (Glitch DJ), `?test&god&event=...` world events.

## Tests
tests/tips2.test.ts: catalog parity (title and text in both languages, same button slots), prompts filled, tip lengths and times, priorities, the route menu tip; coverage (every weapon, fusion, special, item, Mod, relic, combo, evolution and power-up has an Arsenal entry; every non-hidden enemy, boss, biome, hero and mode has its own non-placeholder Codex entry; heroes have lore beyond their description); new Codex/Arsenal copy translates to Arabic; in a real jsdom game: last stand then cash-in tips one at a time, TIPS OFF, the rewind tip at low life, mode discovery, an Arabic mech tip and the mech's Arsenal discovery.

## Unfinished or risky
- Nobody has played with them: some tips may land at a busy moment. Priorities put danger first, but a tip still covers the left side of the screen for 5-10 s.
- A brand-new co-op player can meet many tips in the first run (team move, roles, ping wheel, tether...). The 3.5 s gap spaces them; if it feels like too much, raise `firstTenTuning.tipGap` or move more of them behind `g.runTime` checks.
- The POWER-UPS entries use glyphs, not game-icons sprites (no `x_*` icons in scripts/icons.mjs; `npm run icons` wasn't run).
- Mode descriptions in the Codex are the MODES descriptions; if the modes lane rewrites them, add the Arabic for the new copy.
- Tips name what each lane's notes describe; if a lane changes its numbers (rewind seconds, cash-in tiers, raid timings), update src/i18n/tips2.ts.
- Mod-pack content (src/game/modsupport) gets no tips or Codex lore; content packs registered at runtime aren't covered by the coverage test (it uses the shipped data).

## Validation (2026-10-20)
- PASS: `npm run typecheck`, `npx vite build`, `npm run smoke`, tests/tips2.test.ts (run 6 times in a row, stable).
- `npm test`: 5 files fail. Three fail the same way on the base commit 309ab1e: coopplayCoop (bomb carry), meta2 (achievement names/medals) and tradingCoop (lobby title). pvp2 and raceCoop failed once while the machine was loaded with screenshot runs, then passed twice each on this branch, and they pass on base.
- `npm run coop`: the first run had two 21 s host stalls (other builders were loading the machine) and 12 failures in party/kick/turret/carry. The second run had one failure (the co-op vault door timing) and no page errors.
- Screenshots looked at: shots/tips2-raid-en.png, tips2-ronin-en.png, tips2-cashin-ar.png (Arabic, Z/X prompts), tips2-arsenal.png (POWER-UPS tab).
