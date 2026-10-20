LANE: langs — more languages

The game has an i18n system (src/i18n: English base en.ts, Arabic ar.ts with RTL, t()/localize(), LANGUAGE setting). Add five more languages with natural, gamer-friendly translations (not word-for-word): Spanish (es), French (fr), Brazilian Portuguese (pt-BR), German (de) and Turkish (tr).
1. One catalog file per language (src/i18n/es.ts ...) covering every key in en.ts (UI, content names and descriptions, tips, story, captions, achievements...). Keep placeholders (⟪0⟫ etc.) and formatting intact; game terms consistent across a language (glossary at the top of each file).
2. Load non-English catalogs lazily (dynamic import) so the initial bundle doesn't grow; LANGUAGE setting lists all 7 (each in its own name); default from the browser language.
3. Fonts: make sure the bundled pixel fonts cover the accented Latin and Turkish characters (ğ ş ı İ ç ö ü ã õ é è ê à ñ ¿ ¡ ß); if a glyph is missing, add a fallback font (local, OFL) for those languages only.
4. Text fitting: German and French are long — screenshot the main screens in each language (?lang=de etc. at 1280x720 and 844x390) and fix overflow with existing fitting tools (shrink-to-fit, wrapping), not by cutting text.
5. Tests: every language has every key (fallback to English allowed only with a warning), placeholders match, no empty strings.
Owns: new src/i18n/{es,fr,pt-BR,de,tr}.ts, src/i18n/index.ts (language list, lazy loading), settings language options, font fallbacks, tests/langs.test.ts.
