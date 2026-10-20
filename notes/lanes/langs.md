# Langs — five additional locales

## Players get

Spanish (`es`), French (`fr`), Brazilian Portuguese (`pt-BR`), German (`de`) and Turkish (`tr`) alongside English and Arabic. Each new catalog has a glossary and every English key: **4,347 entries per language**. Placeholders, line breaks and gameplay numbers are preserved. Main menus, loadouts, items, tips, story, captions and achievements have catalog entries; proper names, technical labels and some remaining English copy stay literal. Loading a catalog warns about retained English entries; a missing value falls back to English with one warning per key. Retained-English counts (including proper names/technical labels) are es 416, fr 253, pt-BR 257, de 514 and tr 678.

LANGUAGE shows native names. The first supported browser preference is used when there is no valid saved choice; Portuguese variants select Brazilian Portuguese. Saved choices still win, and `?lang=es|fr|pt-BR|de|tr|ar|en` overrides the initial choice for QA. No save version changes.

All six non-English catalogs use dynamic imports. The loading shell paints before the heavy game graph, awaits the chosen catalog and installs font CSS early. Switching keeps the old language visible until the new catalog is ready. Concurrent requests share downloads and the latest choice wins. A failed chunk leaves the current language usable and warns to reload; browsers cache failed module fetches, so same-page import retries are not promised. Switching preserves DOM nodes, input values, player names, button listeners and focus. `setLanguage()` and `applyLanguage()` now return promises: await them when immediately asserting translated output. Ordinary settings actions can continue while loading.

## Fonts, layout and performance

The existing Latin Jersey/Silkscreen files cover the requested Western European characters and Turkish dotless ı. Turkish additionally uses the installed Jersey 10/15 Latin Extended files for Ğ/ğ, İ and Ş/ş. These two local OFL files total **22,988 bytes**, are requested only for Turkish glyphs, and have their license in `public/fonts/Jersey-OFL.txt`. No CDN, new dependency, downloaded model or external generation service.

Locale-scoped CSS lives in `src/i18n/layout.ts`: wrapping, automatic hyphenation, normal letter spacing on card names and wrapping settings tabs/footer. Existing scrollable menus and text/UI scale remain in control; text is not truncated. `?test&screen=loadout` now populates the real kit cards rather than showing an empty shell.

No gameplay system, snapshot, effect, audio or network protocol changes. English retains its fast display path. Reverse lookup data is built only for loaded catalogs, display strings retain the 2,048-entry cache, and DOM work happens on language changes/screen entry. Translated templates with no literal context are excluded from reverse matching: an interrupted draft's Turkish `ROUND ⟪n⟫` translation had lost “ROUND” and otherwise matched arbitrary text, including whitespace. Fresh canonical English DOM labels take precedence over inverse suffix templates, preventing Portuguese `SETTINGS` from becoming `SETTINGs`. Already translated complete phrases survive mixed `t()`/HTML adapters without a second substring translation.

Heavy-scene Metal benchmarks, 10 seconds after 4 seconds warm-up at 1280×720/HIGH:

| Locale | FPS | Frame callback CPU | CPU p95 | Average enemies / bullets |
| --- | ---: | ---: | ---: | ---: |
| English | 61.5 | 3.14 ms | 4.37 ms | 297 / 513 |
| German (final) | 61.4 | 2.93 ms | 3.83 ms | 294 / 517 |

Both measured 16.67 ms frame intervals. Clip capture adds about 0.8 ms outside frame callbacks in both runs. These are samples on a shared build machine, not a controlled claim that German is faster.

## Validation

- PASS: `npm run typecheck`, `npx vite build`, `npm run smoke` and the focused `langs` and existing `i18n` tests. Production build retains the existing large-game-chunk advisory; each foreign catalog is a separate chunk.
- PASS: browser checks for an English cold load requesting zero foreign catalogs, actual LANGUAGE button cycling through all seven choices, one request per foreign catalog, native option names, zero page errors, required glyph rendering, and continued English play after a failed locale download with successful recovery on reload. Glyph rasterization is unchanged when the system fallback is changed from serif to monospace; the font proof PNG was inspected.
- PASS: `npm run coop -- --offline --angle metal --out shots/langs-coop`. In-process signaling, real WebRTC: all default scenarios passed, including reconnect and return to lobby. 1,928 snapshots, average 1,791 B, maximum 15,924 B, none over 16 KB.
- New `tests/langs.test.ts` checks all keys, nonempty values, slot names/multiplicity, line breaks, numeric gameplay values, corrupt repetition, literal context in templates, browser locale selection, lazy imports, shared downloads, stale-request cancellation, fallback warnings, fresh canonical DOM labels, already-translated phrases and seven-language DOM round trips.
- Screenshot matrix: title, play, settings, populated loadout, extras, level-up, shop and populated arsenal in all five locales at **1280×720 and 844×390**, with four-second settled captures. Inspected contact sheets and full-size German/French loadout/settings, Turkish gameplay and font proof. German/French accessibility settings were also checked at both sizes. Long menus scroll vertically. Card control measurements can include the intentional 12px selection/badge overhang; text elements do not overflow horizontally.

The full unit-suite gate is **not green**: failures in `eightp.test.ts`, `followups.test.ts`, `raceCoop.test.ts` and `spectateCoop.test.ts` also reproduce from an untouched `e409d58` archive. Eight-player setup accesses a null connection; the other fixtures retain older roster/lobby expectations. No unrelated game code or assertions were changed to mask them. The first run also had an intermittent coop2 help-ghost assertion; it passed in the subsequent run. Raw logs are ignored local artifacts (`/tmp/langs-tests-final.log`, `/tmp/langs-baseline-tests.log`, `/tmp/langs-baseline-spectate.log`).

## Files and integration

- New: `src/i18n/{es,fr,pt-BR,de,tr}.ts`, `tests/langs.test.ts`, two extended font files and their OFL license, this note.
- Owned locale infrastructure: `src/i18n/index.ts`, `src/i18n/layout.ts`.
- Small integration hooks: `src/game/settings.ts`, `src/ui/settingsScreen.ts`, `src/ui/loadingScreen.ts`, one populated-loadout line in `src/dev/testLinks.ts`.
- Additive English/Arabic settings labels, native-menu helpers, voice-chat binding label, numeric unlock templates and standalone card/shop tutorial text fragments. Existing shield, Flare Buster and rainbow-lance descriptions were aligned with current weapon data while retaining their keys. The Arabic content assertion permits the already documented technical literals UTC/ISO.
- Existing locale tests in biome3, followups, i18n, menu, mvp, pets2, story, tips2, ultboss and weather2 now await language selection. No changes to their gameplay assertions, except the UTC/ISO localization allowance above.

## Reproduction and remaining risks

```sh
npm run shot -- '?test&lang=de&screen=loadout&seed=42&season=off' shots/langs-de-loadout.png --size 1280x720 --wait 4
npm run shot -- '?test&lang=fr&screen=settings&settingstab=3' shots/langs-fr-settings.png --size 844x390 --wait 4
npm run shot -- '?test&lang=tr&stage=2&weapons=drones:5' shots/langs-gameplay.png --wait 4
npm run shot -- '?test&lang=es&screen=arsenal&discover=all' shots/langs-es-arsenal.png --wait 4
npm run shot -- '?test&lang=pt-BR&shop&gold=100' shots/langs-pt-shop.png --wait 4
npm run coop -- --offline --angle metal --out shots/langs-coop
npm run bench -- --gpu metal --seconds 10 --warmup 4 --dev
```

On this Mac, screenshots used an ignored executable wrapper that appends `--use-angle=metal` to the installed Playwright Chromium, selected via `SHOT_CHROME`; this does not change assertions. Screenshots and browser QA scripts/reports are ignored under `shots/langs-*`.

Key coverage is not a claim of complete editorial sign-off. The interrupted catalogs needed substantial repairs: blank/corrupt entries, repeated Turkish words, lost numbers and prompts, mistranslated mechanics and inconsistent equipment names. Core copy, equipment, common tips, the final boss ending and discovered numeric errors were revised directly. The final audit translated another 471 retained-English Spanish/French/Portuguese entries, rewrote common shop/item copy across five languages, and repaired additional Turkish weapon descriptions and HUD objectives. Some inherited long-tail wording is still awkward and requires native editorial review before claiming fully polished localization; this is unfinished copy work, especially in German/Turkish. Some legacy UI writes (for example COMPETE in Extras and newer settings descriptions) have no English catalog entry or localization boundary; they can still display English or partially localized text. Those broader owning modules were not rewritten. Future lanes adding English keys must add all six matching foreign values or deliberately use the warned English fallback.

For the lead's PLAN decision log: seven locales, lazy foreign catalogs, browser defaults, race-safe live switching, 23 KB of Turkish pixel-font coverage, wrapping/hyphenation for longer Latin copy, and catalog/placeholder/number regression gates. No save or protocol migration. Full-suite baseline failures and remaining copy-review limits are explicit above.
