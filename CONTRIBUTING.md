# Contributing to InfiniShoot

These rules are for everyone working on the game: people, Claude, Codex. Read `CLAUDE.md` (code conventions) and `PLAN.md` (roadmap and decision log) first.

## Where things live
- `src/game/game.ts`: the `Game` class (state, constructor, main `update()` loop). Most of its methods live in **`src/game/systems/*.ts`** as `export function name(this: Game, ...)`, installed on the class as fields (`name = CombatSys.name`). Add new Game behaviour to the matching system file, or a new one, not to game.ts.
- Content is data: `src/data/` (weapons, specials, passives, Mods, enemies, bosses, biomes, relics, heroes...).
- Weapon behaviour: `src/game/weapons/` (one class per weapon, registered in index.ts). Enemies: `src/game/enemies.ts`. Audio: `src/audio/`. Rendering: `src/render/`. UI: `src/ui/`. Online: `src/net/` + `systems/netHost.ts` / `netClient.ts`.

## Workflow
1. Branch from the latest `main` (`git pull` first). One branch per task.
2. Only touch the files your task owns. If you must change a shared file (game.ts, hero.ts, hud.ts, screens.ts, style.css), keep the edit small and self-contained so merges stay clean.
3. Before you finish, all of these must pass:
   - `npm run typecheck`
   - `npm test` (unit tests in `tests/*.test.ts`; add one for new pure logic)
   - `npm run smoke` (the autoplay bot plays every mode headlessly; fails on any runtime error)
4. Visual changes: check them with a screenshot, e.g. `npm run shot -- "?test&stage=4&boss" shots/boss.png` (see test links below), and look at the PNG.
5. Commit with a clear message (what and why). Don't commit `.env*`, `shots/`, `dist/`, `release/` or `node_modules/`.
6. Write a short decision-log paragraph for `PLAN.md` describing what changed and why (numbers included).

## Test links
Open the game straight into a situation: `http://localhost:5173/?test&...` (also works on the live site).
- `stage=4`, `boss` (skip to the boss), `god` (no damage), `seed=42`
- `hero=ace`, `mode=endless`, `difficulty=hard`, `loadout=laser,well,meteor` (left, right, special)
- `weapons=drones:6,aura:5` (6 levels = evolved), `passives=armor:2`, `gold=200`
- `elite=charger:shielded`, `event=meteors`
- Cover: `smash=2` (stand by the nearest ruin wall, rock or tree and smash it after 2 s, like Rex does)
- Areas: `biome=neon` / `biome=sky` (any biome id, whatever the stage); `at=holo`, `at=vent`, `at=sign`, `at=flag`, `at=gap` start next to that piece
- Bosses: `bossnow` (the stage boss right away), `phase=2` (push it into a phase once its entrance ends), `miniboss` (this stage's mini-boss now), `nointro` (skip entrances)
- Titan, rematches, duel: `titan` (the stage boss is the Titan), `titanphase=3` (break the earlier weak points), `titanmove=beam`, `remix` (the boss's rematch), `duel` (straight to its last phase: the ring of fire); see src/dev/bossLinks.ts
- Biome bosses: `biome=neon|factory|sky` with `bossnow` (Glitch DJ, Boxer Jack, Admiral Gale on any stage), `b3move=grid` (only that attack; see src/dev/bosses3Links.ts), `b3near` (move the boss in front of you for screenshots)
- Host migration: `mate&hostmig=probe` / `hostmig=join` (the client's migration panel), `mate&hostmig=banner` (NEW HOST banner); see src/dev/hostmigLinks.ts
- Sound lane 2: `band=cowbell,sax` (or `band=all`: the run's soundtrack already has them), `instrument=steel` (that pickup lands near you), `duelmusic`, `tension` (comeback music), `djnow` (the radio DJ keeps talking), `crowd=cheer`, `audio` (unlock audio without a click); see src/dev/sound2Links.ts

## Rules of thumb
- Gameplay runs in `update()` and on the host; anything clients need goes through snapshots or the effects bus (`game.vfx`). Cosmetic-only things can be derived locally in render.
- No new runtime dependencies without a good reason; the game must stay small and load fast.
- Secrets (API keys) live only in `.env.local`, never in code: the game is public. Generated assets (audio, images) are committed; the keys that made them are not.

## Parallel builds
Big batches run many builders at once, one git worktree per lane: see docs/parallel-builds/README.md (briefs, merge helper, checklist).

## English and Arabic UI
- Add a stable key to `src/i18n/en.ts` and the same key with natural Arabic to `src/i18n/ar.ts`. Use `t('menu.example')` from `src/i18n` for new player-facing copy. Preserve interpolation slots: English `Stage ⟪stage⟫`, Arabic `المرحلة ⟪stage⟫`, then `t(key, { stage })`. Keep whole sentences together so Arabic can reorder them.
- Existing canonical data names, descriptions, tips, host banners and captions use `localize(text)` at the display boundary; it resolves the English catalog entry through `t`. Keep IDs, save data and network messages canonical. For existing markup use `localizeHtml(html)`; it translates text/accessible labels without changing attributes used by gameplay. Escape user values before HTML insertion; wrap player names and room codes in `<bdi>` (or `translate="no"` for text nodes). Never translate user-entered names.
- English is the base/fallback. New keys missing an Arabic value display English at runtime; the catalog parity test flags the missing translation before release. New lanes should add both entries, not copy translated text into gameplay code. Existing generated `text.*` keys stay stable when their copy changes.
- Language defaults to the browser's first preferred language (`ar-*` → Arabic, otherwise English), then respects the saved LANGUAGE setting. Switching updates visible UI in place. `?lang=ar` / `?lang=en` overrides the initial locale for QA; subsequent settings changes save normally.
- Arabic layout/font rules live in `src/i18n/layout.ts`; the locally bundled Noto Sans Arabic font is OFL licensed (`public/fonts/NotoSansArabic-OFL.txt`). Use logical CSS properties, preserve left-to-right numeric timers and the Mod slot pipeline, and avoid letter spacing on Arabic. Do not load fonts from a CDN.
- Check `npm test` (includes `tests/i18n.test.ts`: catalog/slot parity, content/captions, fallback, switching and a main-screen DOM-write scanner). When moving a main screen to a new module, add it to the scanner's file list. Visual links: `?test&lang=ar&screen=settings`, `?test&lang=ar&screen=arsenal&discover=all`, `?test&lang=ar&levelup`, `?test&lang=ar&shop&gold=60`, `?test&lang=ar&stage=2&weapons=drones:5`. Inspect both languages after changing layout.
- Arabic coverage is strict by default (`tests/i18n.test.ts`, equivalent to `I18N_STRICT=1`). `I18N_STRICT=0` is only a local inventory aid; never use it for release checks. Coverage includes weapon levels/tracks, achievements, settings labels/options/focus descriptions, profile counters, death advice and the main-screen DOM-write scanner. Add extracted screens to that scanner too.
- Check live redraws as well as screen entry: changing tabs, resetting settings, lobby readiness/chat, race results and reconnect countdowns must still call `t`/`localize` at the final display boundary. Resolve translated data through getters when module-level data outlives a language switch. Keep dynamic names/codes in escaped `<bdi>` elements and leave free-form chat literal. Do not add overly broad templates such as `⟪n⟫ TO ⟪name⟫`: they can match unrelated prose. Use context such as `⟪n⟫ POINTS TO ⟪tier⟫`.
- `src/i18n/arabic2.ts` contains the new English base copy; matching Arabic entries live in `ar.ts`. Its explicit English fallback in the other five catalogs is pending their native translation, not completed localization. Replace those fallback values with native overrides as they are translated. Verify Arabic at 1280×720 and 844×390, including scrolled menu contents and focus descriptions.
