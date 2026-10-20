LANE: arabic — English + Arabic

1. i18n framework: all player-facing strings go through t('key') with an English base (src/i18n/en.ts) and Arabic (src/i18n/ar.ts); a LANGUAGE setting (English / العربية), default from the browser language. Extract strings from screens, HUD, cards, tips, toasts, banners, settings, codex/arsenal descriptions, item/weapon/enemy names and descriptions (data files: add translation keys without breaking the data shape; a lookup by id is fine).
2. Arabic: natural, gamer-friendly Modern Standard Arabic (not word-for-word), right-to-left layout for menus and HUD (dir="rtl", mirrored layouts where it makes sense; numbers and timers stay readable), an Arabic pixel-friendly font bundled locally (e.g. a free OFL Arabic font that reads well at small sizes; no CDN), line-breaking and text fitting checked on every screen with screenshots.
3. A test that every key exists in both languages and no player-facing English string is left hard-coded in the main screens (a simple scanner). Captions/subtitles also translated.
4. Other lanes add strings tonight: make adding a string easy (document it in CONTRIBUTING.md) and fall back to English when an Arabic key is missing.
Owns: new src/i18n/*, string replacement across src/ui/* and data display (wide but mechanical; keep each edit minimal so other lanes' merges stay clean), settings option, tests/i18n.test.ts.
