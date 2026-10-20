# arabic2 — post-merge Arabic coverage

## Players get

- 633 additional English/Arabic keys (631 canonical display strings plus two volume-control labels), bringing both catalogs to 5,599 keys. Settings descriptions/options, multiplayer lobby/party/friends/chat controls, race/ranked/tournaments, Gauntlet/Ascension, weapon ranks, achievements/profile, death guidance and combat banners are covered.
- Live redraws stay Arabic: settings focus/reset/tab changes, lobby updates, voice controls and reconnect countdowns. Player names, chat messages and room codes stay literal; escaped `bdi` elements isolate them from surrounding Arabic.
- Arabic layouts wrap lobby kits and seasonal rewards, give bestiary headings/descriptions the full card width, preserve record-board line breaks, and fit settings, Trials, story and raid/race HUD text on short landscape displays.
- Strict coverage is the default again. `I18N_STRICT=0` is an explicit local inventory aid only; release checks use the default or `I18N_STRICT=1`.

## Implementation and tuning

No gameplay, balance, saves, network payloads or runtime dependencies changed. Translation stays at the display boundary. Existing language/text/UI-scale and reduced-effects settings remain authoritative.

Arabic CSS is injected by `src/i18n/layout.ts`: settings tabs 13 px; descriptions 16 px (14 px in short windows); short-window settings lists scroll; Trials titles 18 px/1.6; short-window raid text 12 px/1.5; Gauntlet HUD 14 px/1.5; race board 220 px wide at y=90; story headings 22 px with wrapping and a 40 vh comic in short windows. The compact minimap moves away from the mirrored goals/raid panel. Existing text scaling applies. Map glyphs keep the Latin pixel font and 24 px sizing.

Do not use broad display templates such as `⟪n⟫ TO ⟪tier⟫` or `Double ⟪name⟫`: they capture unrelated prose/captions. Rank progress now says `POINTS TO`; doubled elite names have explicit entries. The tests guard unrelated codex prose and all captions. Recursive coverage includes the `text` field of every weapon level, evolution and track rank, including numerical descriptions that a capitalized-string audit misses.

`tests/heroes4.test.ts` had a pre-existing race with lazy language loading. Its two language switches now await `setLanguage`; translation assertions themselves are unchanged.

## Files

- Catalogs/runtime/layout: `src/i18n/{arabic2,en,ar,de,es,fr,pt-BR,tr,index,layout}.ts`.
- Surgical display routing: `src/ui/{settingsScreen,lobbyScreen,friendsScreen,partyScreen,raceUi,voiceUi,firstten,netOverlay}.ts`; Gauntlet's live label in `src/game/systems/gauntlet.ts`.
- Coverage: `tests/i18n.test.ts`, `tests/arabic2.test.ts`, async setup fix in `tests/heroes4.test.ts`.
- Workflow: `CONTRIBUTING.md`, `PLAN.md`, this note.

## QA links and capture procedure

Prefix with `?test&lang=ar`. All registered screens were exercised at 1280×720 and 844×390, plus six settings tabs, story sequences and combat HUDs. Captures and JSON audits are local/ignored in `shots/arabic2/`; the matrix waits for `window.game`, then four seconds, and opens lazily registered screens via their normal buttons. Direct early `screen=customise`/other lazy-screen links can run before registration; that existing startup timing issue is outside this lane.

- Main menus: `&screen=title|play|pause|settings|loadout|extras|modes|controls|savedata|history|unlocks|bestiary|jukebox|wardrobe|arsenal` (one value at a time); `&discover=all` for arsenal; `&settingstab=0..5`.
- Meta: `&metascreen=heat|weekly|codex|rewards`, `&codexall`; `&trainingdone`; `&m2screen=profile|achievements&m2demo&m2lv=37`; `&story=codex`.
- Multiplayer: `&lobbyx`, `&party`, `&friends`, `&voicedemo=screen`, `&mate&tradedemo&trade=1`, `&mvp=4`.
- Competition: `&compete=challenge`, `&compete=ranked&rating=1620&rkhist`, `&tourney=demo|new`, `&racex=end`, `&gauntletscreen=records`.
- Seasonal/editor/trials: `&treats&season=on`, `&spscreen=season&sptier=12`, `&editorscreen=list`, `&editor=demo`, `&trialscreen=select|intro|result`.
- Combat/cards: `&stage=2&weapons=drones:5`, `&levelup`, `&shop&gold=100`, `&route&stage=3`, `&recap` (continue past MVP for game over); secret merchant relic offers exercised with `hero.openShop(true)` then `presentShop(hero)` in the QA harness.
- Special HUDs: `&mode=raid&raidfire`, `&mode=raid&raidphase=core`, `&racex`, `&pvp=ffa&pvpn=4`, `&pvp=teams&pvpn=4`, `&pvp=ffa&pvpn=2&pvpboard`.
- Story: `&story=intro|ending&storyframe=1&storypin`; credits use `&story=credits&storypin&reduceeffects` (no `storyframe=1`, which selects the ending panel).

Long menus were also captured after scrolling their inner panels to the bottom. Physical key labels, technical formats/credits, product names and literal player names intentionally remain Latin.

## Validation

- `npm run typecheck`: pass.
- `npx vite build`: pass (existing large-chunk advisory only).
- `I18N_STRICT=1` i18n test/main-screen scanner: pass, 5,599 keys. The intentional missing-key fallback probe logs one warning; 24 identical entries are physical keys, product/language names and technical literals.
- `tests/arabic2.test.ts`: pass (Arabic cold boot, live descriptions, literal names, DOM reuse, multiline switching and ticking Gauntlet copy).
- `npm test`: all 117 test files passed. Strict i18n was rerun after the final numeric rank-description additions and passed.
- `npm run smoke`: pass across all smoke scenarios.
- `COOP_TIMEOUT_MS=120000 COOP_LOW=1 npm run coop -- --offline --angle metal --out shots/arabic2-coop`: pass (real WebRTC, local signaling, reconnect/state/effects checks).
- Required `npm run shot -- "?test&lang=ar&stage=2&weapons=drones:5" shots/arabic2-required-hud.png --wait 4`: pass, inspected (local Chromium wrapper selects Metal).
- 79 Arabic scenes × two sizes = 158 final captures, no page errors or detected overflowing text; contact sheets and relevant full-size PNGs inspected. Thirteen long panels also captured at their scrolled bottoms; English settings/lobby control captures inspected. Final merged audit: `shots/arabic2/review.json`.

Heavy benchmark (production, Metal, 1280×720, HIGH, 10 s after 4 s warm-up, seeded 200-enemy/500-projectile fixture): Arabic 61.5 fps / 2.98 ms frame CPU; English control 61.7 fps / 2.90 ms. Arabic measured 296 average active enemies and 502 projectiles. The 0.08 ms difference is within run-to-run variance. No new simulation work.

## Remaining scope / integration notes

- Arabic has complete key parity and strict content/scanner coverage. The five other languages explicitly inherit this lane's English base strings until their native translations are supplied; this is documented fallback, not completed translation for those languages.
- Screens with long content intentionally scroll. No external APIs were called; online validation uses local signaling with real WebRTC.
- Future copy must add matching English/Arabic keys and localize every live DOM write. Extend the scanner when extracting a new screen; await language loading in tests. Details are in CONTRIBUTING.md.
- No push or merge; integrate the commits on `lane/arabic2`.
