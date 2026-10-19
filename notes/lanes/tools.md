# Lane: tools (photo mode, leaner co-op, parry swings, weather setting)

## What players get
- **Photo mode** (PAUSE > PHOTO MODE). The world freezes (rain stops mid-air), the HUD and crosshair hide and a free camera takes over:
  - Move: WASD / arrows / left stick, or drag with the left mouse button. Turn: Q / E. Tilt: R / F. Right-drag turns and tilts. Zoom: Z / X, - / =, the mouse wheel, LT / RT. Shift = 3x faster. 0 / Home / L3 / R3 resets the view.
  - Limits: the focus stays within 32 m of where photo mode opened, 5-70 m from the ground, pitch 12-89 degrees, free 360-degree orbit. Zooming out pushes the fog back the same way the mouse-wheel zoom does.
  - Six filters (1 / 2, LB / RB, or the arrows on the bar): NORMAL, RETRO CRT (scanlines, colour fringe, phosphor columns, vignette), SEPIA (with grain), COMIC INK (ink lines on the dark side of edges, 4-level posterize, halftone shadows), NEON GLOW (dull colours sink into a blue night, saturated ones glow with a soft halo), BLACK & WHITE (contrast, grain, vignette).
  - Frames (3, D-pad up): NONE, SNAPSHOT (instant-photo border with a "STAGE n - NAME - SCORE" caption), FILM (sprocket strip), ARCADE (blue bezel with 1UP score and stage), COMIC ("MEANWHILE, ON STAGE n..." caption box).
  - Stickers (4 / Y picks one, click or X places it; Backspace / D-pad left undoes, C / D-pad right clears, up to 24): star, heart, bolt, crown, skull, POW!, GG!, WOW!, 1UP. Logo on/off (5 / D-pad down): an extruded INFINISHOOT in the corner.
  - SNAP (Enter / P / Space / A, or the red button): the `photo_shutter` sample, a white flash (15% with REDUCE FLASHING), and a PNG download named `InfiniShoot-YYYY-MM-DD-HHMMSS.png`. In the desktop app the download opens a save dialog titled "Save InfiniShoot photo" starting in Pictures.
  - H / Select hides the photo UI (a small "H: SHOW UI" hint stays). Esc / B / Start goes back to the pause menu.
  - Solo only. Online the button reads "PHOTO MODE (SOLO ONLY)" and only plays the deny sound: the co-op world keeps running behind the pause menu, and a host-wide pause would freeze everyone, so a free camera there would either leave your hero defenceless or stop the team.
- **Leaner co-op**: about 56% fewer bytes per snapshot (numbers below). Nothing looks different.
- **Everyone's parry swings**: every parry attempt (clean or a whiff) shows on every screen as a ring at the hand plus an arc of seven cyan sparks across the aim. Before, other players only saw the PARRY! burst on a success.
- **WEATHER** setting (SETTINGS, on by default): off hides rain, snow, pollen, sand and embers, the rain darkening and lightning (and with them rain and thunder sounds).

## Leaner co-op network: design and numbers
Measured with `npm run coop` (which now reports the real wire size: PeerJS binarypack bytes, plus a per-field breakdown):

| | before | after |
|---|---|---|
| average snapshot | 5038 B | 2193 B (-56%) |
| largest snapshot | 19201 B | 7098 B (-63%) |
| snapshots over 16 KB (PeerJS chunks them) | 1 | 0 |
| effects (`ev` -> `fx`) | 1347 B | 372 B |
| enemies (`en`) | 1646 B | 764 B |
| pickups (`pk`) | 526 B | 167 B |
| everything else (heroes, you, team, skill, arena, boss -> `b`) | ~1100 B | 342 B |
| bullets (`bu`, unchanged) | 375 B | 487 B (busier run) |

At 20 Hz that is roughly 100 KB/s -> 44 KB/s per client. Same scenario list, similar or busier activity (the client received 10.9k bursts, 9.6k sounds, 1.8k corpses in the "after" run vs 9.1k / 7.3k / 1.3k before). The final run with everything in (a bit calmer: 7.1k bursts) averaged 1663 B (max 5152 B; effects 240, enemies 652, bullets 441, pickups 136, body 309) and passed every check, with all 11 parry swings (`sw`) delivered.

How:
1. **Effects bus** (src/net/fxCodec.ts, `FxEncoder` / `decodeFx`): one binary buffer per snapshot. Strings (colours, sound names, enemy ids, banner text) are written once and referenced by index. Burst options become deduplicated templates; a burst is a tag byte, a position and a template index (its direction, when it has one, is a per-event angle so all hit sparks of one enemy type share a template); identical consecutive bursts merge into one record with a repeat count. Positions are centimetres in Int16; an event at the same x/z as the previous one skips them (death burst + sound + scar + corpse at one spot). Damage labels like "57!" or "12 FIRE" are a number plus a suffix id. Sounds farther than 34 m and shakes farther than 30 m from that client's hero are not sent (they did nothing there anyway: hearing range 32 m, shake falloff 28 m). Anything the codec doesn't know (a new event kind, HUD sub-kind, number kind or burst option) falls back to a generic lossless encoding, so other lanes' additions keep working.
2. **Snapshot body** (src/net/snapCodec.ts, `SnapEncoder` per client on the host, `SnapDecoder` on the client): a compact, lossless value encoding instead of binarypack for everything that isn't a binary record. Keys and common strings come from a shared dictionary (1 byte), small ints are 1 byte, and numbers exact at 2-3 decimals (everything rounded with `r2`) are scaled varints instead of 9-byte doubles; decoded values are bit-identical. Top-level fields, `you` fields and each hero's fields that encode to the same bytes as last time are left out; the decoder re-decodes its copy of the last bytes, so `applySnapshot` sees exactly the object the host built.
3. **Enemy records**: per client, each 22-byte record is sent as a byte mask of what changed since that client's previous record for the same uid, then only those bytes (sorted by uid, uid as a varint delta). Int16 positions mostly change only in their low byte, so a moving enemy costs ~10 bytes. The codec doesn't know the layout (record size travels with the data), so codec.ts can change freely.
4. **Pickup records**: a bitmap of which records from that client's previous list are still there, plus the new ones.
5. **Keyframes**: every 40th snapshot (2 s) drops all baselines and sends everything in full. The deltas rely on the data channel being reliable and ordered (PeerJS `reliable: true`).
6. The peer id prefix went from `infinishoot-v2-` to `infinishoot-v3-`, so old and new builds can't join each other (they'd misread snapshots).

Host cost: one effects encode per client per snapshot and a byte compare per field; not measurable next to the simulation. No per-frame allocations were added on the solo path.

## Files
- New: src/net/bytes.ts (byte writer/reader), src/net/fxCodec.ts, src/net/snapCodec.ts, src/ui/photoMode.ts (photo mode UI, camera, sprites, saving), src/ui/photoFilters.ts (pure filters, camera clamp, file name), src/dev/netSize.ts (wire-size helper for the coop script), tests/tools.test.ts.
- Owned edits: src/game/systems/netHost.ts (snapshot goes through `SnapEncoder`, effects through `FxEncoder` with the hearing filter), src/game/systems/netClient.ts (`SnapDecoder`, `decodeFx`), src/net/peer.ts (prefix v3), scripts/coop-test.mjs (real wire bytes, per-field breakdown).
- Shared files, small additive edits:
  - src/game/game.ts: `photo` field; `update()` hands the step to photo mode while it's active.
  - src/main.ts: creates `PhotoMode`, calls `photo.frame()` after `game.render` and `photo.afterRender()` right after the WebGL frame (the canvas is only readable in that task); `window.photo` in dev.
  - src/ui/screens.ts: PHOTO MODE button in the pause menu (handled by photoMode.ts through `data-act="photo"`), WEATHER toggle, `ToggleKey`.
  - src/game/settings.ts: `weather` (default on) -> `weatherSettings.enabled`.
  - src/game/ambience.ts: `weatherSettings`; when off, no motes, no rain darkening, no lightning.
  - src/game/systems/skill.ts: `sw` skill event on every parry attempt; `parrySwing` draws locally (fx, not vfx) with the spark arc; every machine draws other heroes' swings from the event.
  - electron/main.cjs: PNG downloads get a photo save dialog (Pictures).
  - src/dev/testLinks.ts: the options below.

## New test-link options
- `&photo=2` opens photo mode after 2 s (pauses first). With it:
  - `&photofilter=neon` (normal, crt, sepia, comic, neon, bw)
  - `&photoframe=film` (none, snapshot, film, arcade, comic)
  - `&stickers=star@0.3,0.4;pow@0.7,0.3` (star, heart, bolt, crown, skull, pow, gg, wow, oneup; positions are 0..1 of the picture)
  - `&nologo`, `&photohide` (hide the photo UI), `&photocam=0.6,40,18` (yaw radians, pitch degrees, distance m), `&photosnap` (save a PNG)
- Example: `npm run shot -- "?test&stage=2&god&swarm=40&photo=3&photofilter=comic&photoframe=comic&photohide" shots/photo.png --wait 5`
- Dev console: `photo.configure({ filter: 'crt', frame: 'arcade', dist: 30 })`, `photo.snap()`, `photo.lastSaved` (PNG bytes).

## Tests
- tests/tools.test.ts: every effect kind round-trips (positions to 1 cm, angles to 0.001 rad, labels exact, merged bursts replay), a busy effect list shrinks ~10x (34417 -> 3493 bytes in the test), the hearing filter, Uint8Array views (chunked PeerJS messages), unknown kinds/options via the generic fallback; compact values round-trip exactly (2-decimal floats, pi, NaN, unicode, binary); 85 snapshots with moving, dying and arriving enemies and pickups across two keyframes decode to exactly what the host built, at under half of plain binarypack; the six filters' properties, the camera clamp, the PNG scale and the file name.
- Checked by hand in headless Chromium: photo mode opens from the pause menu with the keyboard (stays frozen, runTime unchanged), Esc returns to the pause menu, resume runs the game again; SNAP downloads a 1920x1080 PNG (at 270p internal, x4) with the filter, frame and stickers; screenshots of every filter and frame looked right.
- `npm run typecheck`, `npm test`, `npm run smoke` pass; `npm run coop` results above.

## Not done / risks
- Photo mode is solo only (decision above). Gamepad controls were written against the standard mapping but not tried on a real pad here; touch screens can drag and tap the bar but have no pinch zoom.
- The parry swing arc is drawn at the swinging hero's current aim on every machine; a remote hero's aim on a client is the last snapshot's (at most 50 ms old).
- Deltas assume reliable, ordered delivery. If a snapshot were ever lost, enemies without a baseline would vanish until the next keyframe (at most 2 s) and the pickup list would rebuild from the new records. Not seen in testing.
- Bullets (`bu`) are still the plain 14-byte records (now the biggest part in busy fights). A follow-up could send bullet spawns once and let clients fly them, or quantise velocity/life harder.
- New fields anywhere in the snapshot body need no codec work; a new binary record type would need adding to `SnapRecords` to get deltas (or it can ride along unchanged in `extra`).
- The coop script's turret scenario failed once in one of my three full runs (host owner 0 after 3 s, likely the host frozen on a level-up while the client stood on the pad; nothing in this lane touches turrets or client input); it passed in the baseline and the final run.
