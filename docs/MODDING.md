# Player-made content

Open **SETTINGS → MODS** to import a `.json` or `.zip`, inspect validation errors, enable packs, and arrange their load order. New packs start **disabled**. Changes are saved separately from your progress and apply on the **next launch**. **RESTART GAME ends the current run/online session.** Later packs override earlier packs. A bad pack is skipped in its entirety; other valid packs still load.

On desktop, **OPEN MODS FOLDER** opens `<Electron userData>/mods`, next to the Chromium storage containing your save. Typical locations are `%APPDATA%/InfiniShoot/mods` on Windows and `~/Library/Application Support/InfiniShoot/mods` on macOS; the screen shows the actual path (development builds may use a different app name). Drop JSON files directly in that folder, restart, enable them, then restart again. Files are read in filename order until you choose an order. Editing/deleting a desktop file takes effect on the next launch. Desktop discovery does not recurse or follow symlinks. ZIPs are imported through the screen on both platforms.

Browser imports are copied into this browser profile's local storage. Clearing site data removes them. Keep your original pack files. The desktop folder and browser imports share one load-order list. Remove imported packs with **REMOVE**; remove desktop packs using your file manager. Storage failures appear on the MODS screen.

## First pack

[Mint Circuit](mods/example.json) demonstrates every category: a drone weapon, Bopper variant, stat relic, shop Mod, biome with crystal props on stage 2, and a gold-rush event. Import the file unchanged to try it. No build tools or account are required.

```json
{
  "schemaVersion": 1,
  "id": "my_pack",
  "name": "My Pack",
  "version": "1.0.0",
  "content": {
    "enemies": [
      {
        "id": "my_pack_bopper",
        "base": "bopper",
        "set": { "name": "Green Bopper", "hp": 40, "bodyColor": "#38b764" }
      }
    ]
  }
}
```

`description` is optional. `content` may contain `weapons`, `enemies`, `relics`, `mods`, `biomes`, and `events`, each an array. Every entry needs `id`, `base`, and `set` (an object containing only the fields you change). Omitted values inherit the shipped template. **Bases always refer to shipped content**, never to another pack. This makes load order predictable and avoids hidden dependencies. Unknown fields, types, templates and out-of-range numbers are errors, with paths such as `content.enemies[0].set.hp`.

Pack/content IDs use 2–48 lowercase letters, digits, underscores or hyphens, beginning with a letter. New content IDs must start with `<pack-id>_`. Use a short pack ID to leave room for item names. Duplicate IDs inside one category are rejected. Duplicate enabled pack IDs skip the later pack with an error.

To override shipped content, use its own ID as both `id` and `base`, plus `"override": true`. An override cannot change the underlying behaviour. Each override starts from the shipped template, so the last override replaces the earlier one rather than accumulating its changes. Disable/restart to restore the original definitions.

```json
{ "id": "bopper", "base": "bopper", "override": true, "set": { "hp": 60 } }
```

Names/descriptions are plain text: no HTML metacharacters (`< > & " '`) or control characters. Colours are six-digit `#rrggbb` strings. Rarity is `common`, `uncommon`, `rare`, or `legendary`. Packs cannot run JavaScript, load external assets, replace audio, or introduce new AI/weapon code.

## Supported content

### Weapons

Schema v1 exposes three complete, parameter-driven auto-weapon behaviours: **`drones`**, **`aura`**, **`nova`**. They use the existing orbit, area-tick and frost-blast implementations, including host simulation, effects, rendering and net state. New weapons are available from the first run in ordinary level-up offers. Both additions and explicit overrides support:

- `name`, `desc`, `color`, `rarity`.
- `params`: a partial numeric parameter object. Its values replace those keys in **every level and the partner evolution**; other level parameters still progress normally. Original level/evolution text is inherited, so supply an accurate `desc` for your changes. The original partner passive and icon silhouette are retained.

| Template | Numeric parameters |
| --- | --- |
| `drones` | `count`, `dmg`, `radius`, `spin`, `size` |
| `aura` | Read the `aura.levels[0].p` keys in `src/data/weapons.ts` (damage, tick, radius and slow) |
| `nova` | Read the `nova.levels[0].p` keys in the same file (damage, cooldown, radius, freeze and shatter) |

The validator uses the actual shipped parameter keys. Drone count is an integer 1–8 (the existing pool capacity), size 0.1–5, spin 0–30; radii/ranges ≤30; tick/cooldown ≥0.05 s. The template's status effects and secondary highlight colours remain. The pack colour changes the main mesh/effect colour. Damage attribution uses the new ID. Existing fusion/weapon-combo recipes still require their original weapon IDs. Arm weapons and other auto behaviours are not exposed in v1: their projectile-source mapping or special rendering needs additional adapters before they can safely be cloned.

### Enemies

`base` can name a regular director-spawned enemy in `src/data/enemies.ts`. Bosses, mini-bosses, hidden stand-ins, negative-minute/scripted spawns and special encounters are rejected. Behaviour, model, voice, biome restrictions, death effects, split/spawn children and veteran relationships are inherited.

Allowed `set` fields:

- `name`, `bodyColor`, `accentColor`.
- `hp` 1–100000, `speed` 0.1–40, `radius` 0.1–3, `contactDamage` 0–1000, `knockbackResist` 0–1.
- `xp` 0–1000, `score` 0–10000, `minMinute` 0–10, `minStage` integer 1–1000, `weight` 0–100.
- `pack`: `[minimum, maximum]`, integers 1–12; `maxAlive`: integer 1–100.
- Numeric partial patches to an existing template's `lunge`, `shoot`, `charge`, `fuse`, `guard`, `leap`, `heal`, or `mortar` object. You cannot attach a behaviour object the base does not have or change its string-valued pattern. Counts/bullets/shells are integers 1–8; intervals/windups/recovery/durations 0.05–120 s; ranges/radii ≤30; fractions ≤1. Other numeric fields are 0–1000.

The combined enemy registry is capped at 256 types because snapshots use one byte for the type. A pack exceeding that capacity is rejected atomically.

### Relics

Use a **stat relic** as the base, such as `r_ironheart`, `r_feather`, `r_drum`, or `r_holster`. `name`, `desc`, `color`, `rarity`, and `add` are editable. `add` is a partial map of the numeric stat names in `src/game/stats.ts`, merged with the template's stat bonuses. Values are −0.5–100 (chance fields cap at 1). Normal game stat clamps still apply. Use `0` to remove an inherited bonus. Scripted rule relics use hard-coded IDs and cannot be cloned in schema v1.

### Shop Mods

These are the ordered shop perks, distinct from a content pack. Any shipped ID in `src/data/mods.ts` is an audited **hook template**. For example, `glass_cannon` preserves its damage/life tradeoff and `riposte_cell` preserves its parry trigger. Supported overrides: `name`, `desc`, `color`, `rarity`, `price` (integer 0–100), `maxLevel` (integer 1–5), and existing numeric `flags` keys. Hook functions, tags, co-op-only gating, curses and trigger timing are inherited. Boolean flags cannot be edited. Changing numeric flags does not generate new description text: provide matching `desc`. Omitting `desc` retains the template's level-aware description. Code and new hook functions are never accepted.

### Biomes

Any shipped biome in `src/data/biomes.ts` can be the base. Override palettes and props with:

- `name`; colour strings `groundTint`, `pathTint`, `wallTint`, `capColor`, `pillarTint`, `leafTint`, `trunk`, `fog`, `dust`, `prints`.
- Colour arrays (1–8 entries): `rockColors`, `tileColors`, `blockColors`, `tufts`.
- `tree`: `round`, `cactus`, `pine`, `dead`, `toy`, `lamp`.
- `rock`: `stone`, `block`, `column`, `basalt`, `pumpkin`, `crystal`.
- `clusters`: four 0–1 weights for ruins/crates/trees/rocks; at least one positive.
- `light`: partial `sun`, `sky`, `ground` entries, each `[r,g,b]` in 0–1.
- `edge`: partial `colors` and `shape` (`bush`, `ball`, `block`).

Textures, music, weather, hazards and special arena geometry come from the base. Add `stages: [2, 6]` **beside** `set` to use this biome at those exact stages (1–1000; max 32 assignments per entry). Later assignments win. Without `stages`, new biomes can be selected with `?test&biome=<id>`. Overriding an existing biome affects its normal rotation/remixes. Explicit dev `biome=` wins over pack assignments; pack assignments win over seasonal/default rotation. Online peers build the same map from the same registered data and seed.

### Stage events

Supported templates: `meteors`, `goldrush`, `fog`, `parade`, `stampede`. Set `name`, `sub`, and `seconds` (3–90). New events join the normal classic-event roll; world events may still take that stage. Their gameplay runs exclusively on the host. The existing event snapshot carries the custom ID and timer; both peers look up the same definition. Durations do not increase the fixed number of parade/stampede spawns. New world-event geometries and director2 event templates are outside schema v1.

## ZIP format and limits

A ZIP can hold several JSON packs in nested directories. Non-JSON files are ignored; no files are extracted to disk. Stored and Deflate entries work; encryption, split archives and ZIP64 do not. Unsafe paths, duplicate filenames, truncated data, invalid UTF-8, checksum/size mismatches and oversized expanded data fail the import. ZIP order follows its directory order; use the screen to reorder after import.

Limits: 512 KiB per JSON, 4 MiB per import/library, 32 imported packs, 32 desktop JSON files, 32 active packs, 64 content entries per pack, 128 ZIP directory entries and 32 JSON entries per ZIP. This is a data format, not an unrestricted scripting system. Large stat changes can still make the game easier/harder and are the author's responsibility.

## Online play

Every launch computes SHA-256 over the validated enabled packs, including their content, versions and order, with object keys sorted so whitespace/key formatting does not matter. Disabled/invalid packs do not contribute. The active count and short hash appear in MODS.

A host rejects a different hash **before lobby admission or a drop-in/reconnect**. The client also checks the host's lobby hash. Share the same files and order with friends, then restart; alternatively disable all packs on every machine and restart. Packs are never downloaded automatically. Old clients without a hash may connect only to a vanilla host. This is a compatibility check, not anti-cheat or authentication. Preferences changed in a session remain pending and do not change that session's hash.

Modded runs currently use the normal local progress/history rules; use a separate profile if you want to keep your progression vanilla. No existing save version or profile fields change.

## Author checks

Run `npm run typecheck`, `npm test`, `npm run smoke`, `npx vite build`, and `npm run coop` after code changes. Useful test links (the example is session-only and never persisted):

- `?test&modexample&screen=contentmods`
- `?test&modexample&lang=ar&screen=contentmods`
- `?test&modexample&stage=2&weapons=mint_drones:5&spawn=mint_bopper:12&god`
- `?test&modexample&event=mint_rush&wevoff&god`

`npm run shot -- "?test&modexample&stage=2&weapons=mint_drones:5&spawn=mint_bopper:12&god" shots/modsupport-play.png --wait 4`

The strict source of truth is `src/mods/schema.ts`; validation/loading/archive/persistence and actual weapon/event/codec behaviour are covered by `tests/modsupport.test.ts`.
