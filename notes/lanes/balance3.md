# balance3 — Titan, Aegis, Ascension audit

2026-11-12. **Implemented and measured: all three requested balance targets and all four required commands pass.** One downstream raw-TTK tolerance exception and browser-only checks remain explicitly documented below. Continuation preserved the diff and frozen before runner; no stash, commit, push, browser, external service, dependency or save/protocol change. Read CLAUDE.md, CONTRIBUTING.md and balance2/bosses2/gauntlet/ci2. Decisions are recorded here instead of editing shared PLAN.md.

## Titan: fix access before tuning life

Current paired baseline: eight standard stage-11 god runs, median **77.50s**, maximum **381.50s** vulnerable time. Two causes: moving hands have no shared still window, and the torso traps the approach behind stone while the bot keeps firing. The exposed targets remain damageable; the body obstructs projectiles.

| Knob | Before | Final |
|---|---|---|
| Sweep hold | 0.35s | 3.00s |
| Shared harmless still time after 0.75s double-sweep stagger | none | 2.25s |
| Torso width × depth | 14 × 8m | 12.5 × 3.5m |
| Rear / front face z | −6 / 2m | −1.5 / 2m |
| Base life | 8,500 | 2,500 |
| Stage-11 scaled life | 6,273,000 | 1,845,000 |

The front face stays fixed. The visible torso mesh and solid walls derive from the same layout. Arms (13m each), shoulders and ~40m total span retain the arena-sized set piece. All five weak points, four phases, attacks, damage values, telegraphs and body terrain remain. Existing host/client tests agree on walls, head removal and phase/kill transitions. New regression exercises the real Autopilot with body collision for both eye and core: the old silhouette stalls; the current route reaches the rear and opposite side. It clears unrelated enemies/projectiles to isolate geometry, without changing the bot.

| Paired candidate, eight standard seeds | Median vulnerable time | Worst | Decision |
|---|---|---|---|
| Before | 77.50s | 381.50s | Outside target |
| Hold only, original body/life | 58.75s | 263.20s | Helps hands, leaves obstruction |
| Hold + 14×6m body + 4,250 life | 34.75s | 60.30s | Still outside both limits |
| Hold + 14×6m body + 3,500 life | 30.10s | 102.30s | Life cut alone is insufficient |
| Hold + 14×3.5m body + 3,500 life | 29.40s | 74.20s | Median passes, worst still fails |
| Hold + 12.5×3.5m body + 3,500 life | 28.65s | 78.10s | Routes pass but total combat still too long; reduce remaining life budget |
| Final footprint + 2,500 life | **26.05s** | **56.60s** | **PASS: 20–30s median, <60s worst** |

Final eight vulnerable times: **Buster 56.6/30.7**, **Scatter 24.4/5.5**, **Laser 4.4/27.4**, **Whip 24.7/37.1s** (seeds 1/2). All eight kill Titan. [Final paired audit](../balance/b3-after-audit.md) includes phases, every seed, Ascension death evidence and all tolerance flags. Worst Buster's hand phase is now 21.17s, eye 9.55s, core 14.52s; the long inaccessible-target tail is gone in this sample. This is a two-seed-per-kit acceptance sample, not a guarantee for every possible build/seed.

Worst baseline Buster seed: hands **231.68 → 42.27s** with hold-only, but core then takes 169.68s. The depth-6/3,500-life retry spends all 19.75 eye seconds behind a wall and 19.12 of 36.02 core seconds behind one. A shallower 14×3.5m intermediate still takes 74.2s for that seed (eye 17.87s, blocked 15.68s), motivating the width change. Static blocked-angle counts are descriptive; the real orbit regression tests permanent stalls. Intermediate reports: [hold](../balance/b3-hold-audit.md), [4,250 life](../balance/b3-candidate-audit.md), [depth 6](../balance/b3-depth6-audit.md).

## Aegis: reward a successful defense

One mechanic: an enemy projectile block **or damaging bash** cuts the next recharge by **75%, once per deployment**. Empty casts, friendly/out-of-arc shots and rejected hits earn nothing. Base damage **40**, durability **60**, normal recharge **4.5s** unchanged; earned base recharge **1.125s**, before existing modifiers. Barrages cannot stack the reward. Mirror/Pyre inherit the same condition. Reflections already belong to the hero, use `source: shield` and Expose, so no redundant damage/Expose buff was added.

| Full-reference index | Before | After | Target |
|---|---|---|---|
| Bench | 0.824 | 0.953 | 0.95–1.05 |
| Full kits | 0.939 | 1.008 | 0.95–1.05 |
| Mirror Aegis, equal-rank Omega | 0.771 | 0.878 | ≤1.15 |
| Pyre Aegis, equal-rank Omega | 0.794 | 0.915 | ≤1.15 |

The 50% refund candidate was measured and rejected (bench ~0.903). All 14 final shield full runs clear four stages. [Full-reference report](../balance/b3-shield-audit.md) lists individual kits and shows every other item's main effect remains within 25%. All 12 overlapping measured non-shield controls have identical before/after boss and stage records. All 84 recovered shield-before rows also exactly match the completed full reference, confirming reproducibility.

The 576-row before matrix finished during continuation. Two interrupted non-shield rail/grenade/bomb stage-1 rows were recovered with frozen before code and replaced by ID. After has 84 affected shield rows and 48 measured non-shield controls: 96 match the original cohort, 480 unaffected reference rows are explicitly carried, 36 extra controls are excluded from normalization. This is a targeted rerun, not a claimed fresh 576-case after matrix. Raw partial-cohort reports warn against comparing their internal normalization with the full band.

EN/AR cards explain the condition and percentage. Five other native catalogs update the same three existing shield strings because `tests/langs.test.ts` enforces number parity across all seven languages. Existing authoritative weapon-readiness snapshots convey the reward; no network field is needed.

## Ascension: evidence-based audit

Cumulative A0–A20 tables: [before](../balance/b3-before-rules.md), [after](../balance/b3-after-rules.md). All rules are monotonic. Compare successive nonzero changes to the same rule, skipping levels where it is unchanged: life step ratio max 1.33×, damage 1.50×, speed 1×, count 1.33×, bonus rings 1×. Boolean rules turn on once and remain on.

Only A19 changes: chest frequency **1/6 → 1/5**. Intervals **30/60/90/180 → 30/60/90/150s** turn the last increase **+90 → +60s**: a 3× cliff becomes exactly 2× the previous +30s step. Keep combat rules: A20 life 1.75×, damage 1.40×, speed 1.30×, count 1.60×, double elite effects, no stage healing, 24 bonus-ring bullets, all on top of Hard.

God medians (two seeds per level, four mortal seeds):

| A | Before bosses st1 / 2 / 3 / 4, seconds | After bosses | Maximum after / A10 median |
|---|---|---|---|
| 0 | 16.00 / 19.50 / 92.15 / 28.95 | same | 1.47× |
| 10 | 16.75 / 13.30 / 105.85 / 39.35 | same | 1.00× |
| 15 | 22.60 / 12.60 / 78.45 / 29.40 | same | 1.35× |
| 18 | 25.55 / 23.20 / 60.55 / 31.10 | same | 1.74× |
| 20 | 24.25 / 9.20 / 144.75 / 75.55 | 22.50 / 6.30 / 47.80 / 18.95 | 1.34× |

Before, A20 seed 2 King took 33.1/10.7 = **3.09×** its A10 time. After, no high-level boss exceeds 2.5× A10: maximum median ratio **1.74×**, maximum same-seed ratio **2.10×** (A18 seed 2 King, 22.5/10.7s). A20 clear medians **272.5/131.5/382.5/311 → 271.5/131.5/292.5/262s**; maximum high-Ascension clear-time ratio to A10 ~1.04×. A0–A18 paired records are identical. Earlier A20 supplies alter later build/RNG choices; faster Queen/Omega times are downstream effects, not additional boss nerfs.

Mortal clears per seed: A0 `1,2,4,4`; A10 `0,0,0,0`; A15 `0,1,0,3`; A18 `1,0,0,0`; final A20 `0,0,0,0` (before `0,0,0,3`). Thus some A15+ bots pass stage 1, but all four final A20 seeds die there. Fatal source: **King Bopper shockwaves**, A20 raw **29.12**, actual **26–29** against max life **100/120/140**; A15 raw 26, actual 25–26. Ring fire also chips 5–7 life. Fatal-stage landed-hit minimum gaps are **0.70–0.77s**, never within active hurt immunity. Largest hit stays at the existing ~35% max-life cap (rounding applies); no one-shot or faster-than-i-frame chain. Human QA should inspect repeated King rings and arena-edge ring fire. No unsupported combat nerf.

## Reproduction

Frozen `node_modules/.sweep/b3-before.mjs` predates gameplay edits; no stash required. Original full reference used two workers; continuation uses `--jobs=4`, targeted configurations. Raw results and reports live in notes/balance.

```sh
npm run sweep -- --sets=loops,asc --asc=0,10,15,18,20 --seeds=2 --jobs=4 --tag=b3-before
npm run sweep -- --sets=bench,kits --seeds=2 --jobs=2 --tag=b3-before-kits
npm run sweep -- --sets=bench,kits --seeds=2 --jobs=4 --only=/shield/ --runner=node_modules/.sweep/b3-before.mjs --tag=b3-before-shield
npm run sweep -- --sets=bench,kits,loops --seeds=2 --jobs=4 '--only=loops:|/shield/' --tag=b3-candidate
# Thirty unchanged after-Ascension rows already completed in b3-hold:
npm run sweep -- --sets=loops --seeds=2 --jobs=4 --merge=notes/balance/sweep-2026-11-12-b3-hold.json --tag=b3-after
# Final repeat, same eight loop configs, scheduled as pairs to share the machine:
# Repeat for buster, scatter, laser, whip (each command runs both seeds).
npm run sweep -- --sets=loops --seeds=2 --jobs=4 --only=loops:buster/ --runner=node_modules/.sweep/b3-hp2500.mjs --tag=b3-hp2500-buster
node scripts/balance/compare-b3.mjs notes/balance/sweep-2026-11-12-b3-before.json notes/balance/sweep-2026-11-12-b3-after.json
node scripts/balance/shieldReport.mjs notes/balance/sweep-2026-11-12-b3-before-kits.json notes/balance/sweep-2026-11-12-b3-after-kits.json
```

`b3-after.json` combines the eight final `b3-hp2500-{buster,scatter,laser,whip}` rows with 30 unchanged after-Ascension rows from `b3-hold`: exactly the same 38 IDs as before, no duplicates/errors. `b3-after-kits.json` records provenance: 84 affected rows from the final 75% refund candidate, 48 unaffected controls from the 50% run. Subsequent Titan changes cannot execute in A0 loop-1 configurations. The recovery command for the two baseline errors is `--sets=bench --seeds=2 --jobs=4 --only=bench:rail/grenade/bomb:st1r3: --runner=node_modules/.sweep/b3-before.mjs --tag=b3-before-recover`. Interrupted/error attempts are labelled and not accepted evidence. `b3-final.mjs` was the intermediate 3,500-life bundle; the final frozen Titan runner is **b3-hp2500.mjs**.

Diagnostics only read state: phase clocks/no-hit time/travel/blocked shots and mortal hit source/raw/actual damage/life/immunity timestamps. Phase clocks exclude rise (strong builds can break plates during it); acceptance uses official vulnerable time.

## Checks and handoff

Final code (2,500 life) passes all four required commands. One earlier co-op help-ghost fade timing failure passed a focused retry and subsequent full suites; no unrelated test timing was edited.

| Command | Result | Evidence |
|---|---|---|
| `npm run typecheck` | PASS | `notes/balance/b3-typecheck.log` |
| `npx vite build` | PASS | `notes/balance/b3-build.log` |
| `npm test` | PASS, all 120 files | `notes/balance/b3-tests-hp2500.log` |
| `npm run smoke` | PASS | `notes/balance/b3-smoke-hp2500.log` |

**25% audit:** every other item main effect remains within tolerance; all eight loop runs reproduce stage/boss records through stage 10 exactly. A0–A18 Ascension records match exactly. The intended Titan/A19 changes cause later RNG/loot divergence. Stage-12 Omega raw vulnerable-time median is **23.90 → 17.30s (−27.6%, outside 25%)**; this is an unresolved secondary tolerance exception, not a PASS. Its HP remains **4,347,000** in all 16 before/after observations, Mods/auto ranks match, and end-of-run relics differ. Stage-12 clear median is **303.5 → 300.5s (−1.0%)**, level **103 → 102**, ranks **36 → 36**, kills **43,001 → 42,326 (−1.6%)**. [Downstream audit](../balance/b3-downstream-audit.md) lists every seed. Decision: do not retune unchanged Omega mechanics merely to compensate for this downstream sample; lead review/additional seeds are needed if strict raw-boss parity is required. The raw paired report also retains individual >25% changes, including A20's intended supply effect.

- `tests/balance3.test.ts`: refund eligibility/cap/reset/breaking shot, bash rejection, modifiers, both evolutions, reflection ownership/Expose, player cap/i-frames, monotonic rules and chest intervals.
- `tests/bossLane.test.ts`: shared harmless fist window, real eye/core routing, existing host/client five-part terrain/phase/clear coverage.
- Browser use is prohibited. `npm run balance`/visual screenshots cannot run here; do not replace `tests/visual/balance.json` with non-equivalent jsdom data. Lead must run browser balance after integration and refresh reviewed intentional changes with `-- --update` if needed. Its shield fixture is rail/shield/storm, seed 4242, two stages; the other three fixtures have no shield, and Titan/A19 cannot affect two-stage A0 runs.
- A supplementary before/after jsdom proxy for that shield fixture passes the 25% stage-metric tolerance: stage times 254/259 → 253/267s, stage kills 5296/7604 → 5208/8456, levels 19/27 → 19/30, ranks 13/24 → 13/26. Largest relative change 11.2%. Raw files `b3-before-ci-proxy` / `b3-after-ci-proxy`; command `--sets=kits --kits=rail/shield/storm --seed0=4242 --seeds=1 --stages=2 --jobs=4` with frozen before/final runners. These are not browser baseline replacements (sweep reports per-stage time/kills; CI reports cumulative values).
- Human test links: `?test&stage=11&bossnow&god&nointro`; `?test&stage=11&bossnow&god&titanphase=2&titanmove=sweep2`; `?test&loadout=buster,shield,bomb&bossnow&god&nointro`; `?test&ascension=20&bossnow&nointro`. Repeat shield/Ascension with `&lang=ar`. Review the slimmer body visually and play mortal King rings.
- Owned files: titan.ts; Titan-only bossRemix.ts; shield-only weapons.ts and game/weapons/shield.ts; ascension.ts; EN/AR strings; scripts/balance/{sweepRunner.ts,ascensionAudit.ts,titanGeometry.ts,compare-b3.mjs,shieldReport.mjs}; the two tests; notes/balance and this note.
- Small necessary exceptions: scripts/balance-sweep.mjs adds `--asc=` and completed-row checkpoints; i18n/arabic2.ts contains the existing English A19 string; exactly three existing shield strings each in es.ts/fr.ts/de.ts/pt-BR.ts/tr.ts maintain mandatory number parity. No shared gameplay, tracks, save or `.env*` changes. Pre-existing untracked `.lane-brief.md` untouched.
