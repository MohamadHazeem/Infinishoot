# Gate 1 menus

## Before the changes

A press is an activation from the title. Directional focus moves, typing a code, picking individual values and finishing gameplay are separate. These are shortest routes on the unmodified build.

| Destination | Before | Route |
|---|---:|---|
| Play hub, unlocks, extras, settings | 1 | Title |
| Profile, season, first steps, event booth | 0–2 | Title cards when present, otherwise Extras |
| Solo mode, hero, difficulty, squad, casual preset, ascension | 2 | Play → Play Solo |
| Loadout, heat, weekly rules, trials, challenge and raid records | 3 | Play → Play Solo → feature |
| Start a solo run | 4 | Play → Play Solo → Next: Loadout → Start (Quick Start also opens Loadout) |
| Online, local co-op, training | 2 | Play → launcher (first training offer also on title) |
| Host, join, friends, public rooms, weekly team board, bot versus, spectate | 3 | Play → Online → action |
| In-room settings, ready, invite, kick, chat, start | 3+ | Online → host/join; membership required |
| Collection features listed below | 2 | Extras → feature |
| Lore codex, tournament, save data | 2–3 | Extras → Enemy Guide / Compete, or Unlocks → Save Data |
| Settings tab, key bindings, touch layout, voice test, content packs, help, replays | 1–3 | Settings → tab or Help → tool |
| Story skip, pause, level-up, relic, route, shop, trade, party, results, replay | contextual | Require a story, run, room, reward or recorded replay |

First-time vocabulary included loadout, mods (also used for content packs), heat, ascension, New Game+, relics, overdrive, evolutions, shards, bolts, kits, casual preset, gauntlet, raid, weekly seed, codex, wardrobe, souvenirs, jukebox, PvP, versus, spectate, PTT, CRT, VSync and custom relay. The title mixed training, first steps, seasonal rewards, profile/quests, rankings, news and credits around four large buttons. PLAY asked where to play before showing any run configuration. Solo offered eleven hero names, seven rule sets and four difficulty levels before the player saw a weapon.

### Screen and control inventory

The following inventory comes from the English DOM. Equipment, key bindings, reward and shop lists depend on the save and current run. An empty row means the screen renders through its own launch action or needs a gameplay fixture. The additional populated path captures are in `shots/menus/before/path-*`.

- **title** — Play, Unlocks, Extras, Settings, first steps, training offer, profile & quests, season and event cards, rankings.
- **play** — PLAY SOLO / PLAY ONLINE / LOCAL CO-OP / TRAINING / ESC BACK
- **modes** — QUICK START ▶ / ROOKIE / 🔒 BULWARK / 🔒 DASH / 🔒 ACE / 🔒 DUELIST / 🔒 FURNACE / 🔒 TWIN / 🔒 RONIN / 🔒 TINKER / 🔒 MEDIC / 🔒 BRAWLER / SQUAD: 0 BOTS / CASUAL PRESET / STANDARD Survive each stage, beat the boss, take the portal. Endless stages. / ENDLESS One arena, no portals. A boss every 4 minutes, the shop between, and it / BOSS RUSH Every boss, two laps. Remixed second lap, timed shops every two bosses / SURVIVAL GAUNTLET Endless arena. Waves 30s, mini-bosses 3m, bosses 6m. No shops, / RAID A colossal three-headed engine. 1–8 heroes, AI role helpers, a 15-minute li / WEEKLY CHALLENGE A shared UTC ISO-week seed, two wild rules, fixed Rookie kit. Y / DAILY CHALLENGE Today's seed, Medium difficulty. Same arenas for everyone; beat / EASY / MEDIUM / HARD / 🔒 NIGHTMARE / − / ASCENSION 0 / 0 + / NEW GAME+ OFF / CHALLENGE RECORDS / HEAT / WEEKLY RULES / NEXT: LOADOUT ▶ / TRIALS / RAID RECORDS / ESC BACK
- **loadout** — START ▶ / ESC BACK
- **extras** — PROFILE / ACHIEVEMENTS / SEASON / WARDROBE / CUSTOMISE / SOUVENIRS / COMPETE / HELP GHOSTS / RUN HISTORY / GHOST RACE / FRIENDS / ENEMY GUIDE / ARSENAL / JUKEBOX / STORY / ARENA EDITOR / ESC BACK
- **unlocks** — SAVE DATA / ESC BACK
- **savedata** — SAVE TO FILE / LOAD FROM FILE / RESET SAVE / ESC BACK
- **settings_0** — VIDEO / AUDIO / CONTROLS / GAMEPLAY / ACCESSIBILITY / CO-OP / WINDOW MODE WINDOWED / RESOLUTION SCALE: 100% / FRAME CAP 60 / VSYNC ON / QUALITY: AUTO / HIGHLIGHT CLIPS ON / BATTERY SAVER OFF / DYNAMIC SHADOWS OFF / RETRO LOOK: 0.50 / GLOW: 0.40 / CRT FILTER OFF / SHOCKWAVES ON / NIGHT STAGES ON / WEATHER ON / ANIME LOOK OFF / UI SCALE: 100% / SHOW FPS OFF / MODS / RESET TAB / HELP / ESC BACK
- **settings_1** — VIDEO / AUDIO / CONTROLS / GAMEPLAY / ACCESSIBILITY / CO-OP / MASTER VOLUME: 0.60 / MUSIC: 0.70 / EFFECTS: 1.00 / AMBIENCE: 0.45 / VOICE: 0.80 / MENU SOUNDS: 0.80 / WEAPON MUSIC LAYERS ON / DRAMATIC MUSIC DIPS ON / LOW HEALTH AUDIO ON / HEADPHONES 3D AUDIO OFF / ANNOUNCER ON / HERO VOICES ON / CROWD ON / RADIO DJ ON / PET SOUNDS ON / TEAMMATE WEAPONS: 0.80 / MODS / RESET TAB / HELP / ESC BACK
- **settings_2** — VIDEO / AUDIO / CONTROLS / GAMEPLAY / ACCESSIBILITY / CO-OP / TOUCH LAYOUT / TOUCH OPACITY: 70 / HIDE UNUSED TOUCH BUTTONS ON / CONTROLLER RUMBLE ON / CHARGE MODE HOLD / DASH-RUN MODE HOLD / REWIND MODE TOGGLE / TEAM MOVE MODE TOGGLE / AIM ASSIST ON / MOUSE AIM ASSIST OFF / REBIND KEYS… / MODS / RESET TAB / HELP / ESC BACK
- **settings_3** — VIDEO / AUDIO / CONTROLS / GAMEPLAY / ACCESSIBILITY / CO-OP / SHARE PLAYTEST DATA · OFF / DELETE MY DATA / WEATHER EFFECTS ON / LANGUAGE English / AUTO-FIRE OFF / FIRST-TIME TIPS ON / DAMAGE NUMBERS AUTO / DYNAMIC CAMERA ON / BOSS INTROS ON / SKILL SLOW-MO ON / DEATH REPLAY ON / CINEMATICS FULL / BOSS FINISHERS ON / CHARACTER POP-INS ON / RESET TIPS / MODS / RESET TAB / HELP / ESC BACK
- **settings_4** — VIDEO / AUDIO / CONTROLS / GAMEPLAY / ACCESSIBILITY / CO-OP / GAME SPEED 100% / ONE-STICK MODE OFF / AUTO-DASH OFF / LONGER HIT PROTECTION OFF / HALF DAMAGE TAKEN OFF / SLOW ENEMY BULLETS OFF / BIGGER PICKUP MAGNET OFF / COLOUR VISION OFF / ALT BULLET PALETTE OFF / TEXT SIZE: 100% / REDUCE SCREEN EFFECTS OFF / REDUCE FLASHING OFF / SCREEN SHAKE: 1.00 / CAPTIONS OFF / SOUND ARROWS OFF / MODS / RESET TAB / HELP / ESC BACK
- **settings_5** — VIDEO / AUDIO / CONTROLS / GAMEPLAY / ACCESSIBILITY / CO-OP / NETWORK STATS OFF / SHARED REVIVE POOL OFF / JOIN IN PROGRESS ON / PUBLIC LOBBY OFF / VOICE CHAT OFF / VOICE MODE PTT / MIC SENSITIVITY: 0.50 / VOICE CHAT VOLUME: 0.90 / TEAM RADIO OFF / VOICE PLAYERS & MIC TEST… / HELP GHOSTS ON / BUDDY TETHER ON / CO-OP CAMERA TEAM / SPECTATORS ON / BROADCAST OVERLAY ON / MODS / RESET TAB / HELP / ESC BACK
- **controls** — W / UP / S / DOWN / A / LEFT / D / RIGHT / SPACE / L-SHIFT / Q / E / C / — / V / — / J / — / B / — / P / — / F / — / R / — / G / — / T / — / H / — / X / — / Z / — / Y / — / N / — / RESET DEFAULTS / ESC BACK
- **online** —  / HOST GAME / FRIENDS / BROWSE GAMES / WEEKLY CO-OP / VERSUS VS AI / CODE / JOIN / JOIN AS SPECTATOR / LOADOUT / TRIALS / ESC BACK
- **mpbrowse** — REFRESH / ESC BACK
- **teamboard** —  / ESC BACK
- **party** —  / / RESTART NOW / LOBBY NOW / RUN SUMMARY / LEAVE PARTY / READY! / ONE SEC! / LET'S GO! / GG! / NICE ONE! / BRB / TYPE HERE... / SAY
- **friends** — COPY MY INVITE LINK / / NAME / CODE OR LINK / SAVE / ESC BACK
- **raceres** — BACK TO TITLE
- **compete** — CHALLENGE A FRIEND / RANKED / TOURNAMENT / ESC BACK
- **tourney** — Contextual screen.
- **halloween** — Contextual screen.
- **story** — HEROES / BOSSES / LORE CHAPTERS / PLAY INTRO / CREDITS / ESC BACK / Rookie / Bulwark / Dash / Ace / Duelist / Furnace / Twin / Ronin / Tinker / Medic / Brawler
- **trials** — Contextual screen.
- **trialintro** — Contextual screen.
- **trialresult** — Contextual screen.
- **arenas** — Contextual screen.
- **arenaedit** — TEXT ENTRY
- **report** — CATEGORY · Bug / / / / SAVE REPORT TO FILE / ESC BACK
- **consent** — NO / YES
- **replay-help** — SAVE REPLAY / WATCH REPLAY / WATCH CRASH REPLAY / ESC BACK
- **desktopKeyboard** — 1 / 2 / 3 / 4 / 5 / 6 / 7 / 8 / 9 / 0 / Q / W / E / R / T / Y / U / I / O / P / A / S / D / F / G / H / J / K / L / - / Z / X / C / V / B / N / M / . / _ / @ / ABC / abc / SPACE / DELETE / CANCEL / DONE / PASTE
- **desktopHelp** — EXPORT ERROR LOG / REPLAYS & CRASH LOGS / ESC BACK
- **clips** — ESC BACK
- **touchlayout** — MOVE ↘ / AIM / FIRE ↘ / DASH ↘ / R-CLICK ↘ / SPECIAL ↘ / PARRY ↘ / ULT ↘ / REWIND ↘ / TEAM ↘ / CASH IN ↘ / REWARD ↘ / HORIZONTAL / VERTICAL / SIZE / RESET LAYOUT / DONE
- **ghostrace** — Contextual screen.
- **season** — Contextual screen.
- **profile** — Contextual screen.
- **achievements** — Contextual screen.
- **ghosts** — Contextual screen.
- **customise** — Contextual screen.
- **voicechat** —  / / / / ESC BACK
- **trade** — Contextual screen.
- **pause** — RESUME / PHOTO MODE / SETTINGS / QUIT RUN / TRIALS / REPORT A PROBLEM
- **levelup** — Contextual screen.
- **shop** — COMMON Pyromaniac / □ LOCK / COMMON Hair Trigger / □ LOCK / COMMON Patience / □ LOCK / COMMON Quick Draw / □ LOCK / REROLL 2 / HEAL 40% 3 / CONTINUE ▶
- **gameover** — RETRY / BUILD CARD / REPORT A PROBLEM / ESC TITLE / RUN TIMELINE ST 1 / VIEW ALL CLIPS
- **wait** — Contextual screen.
- **jukebox** — INSERT COIN / ??? / ??? / ??? / ??? / ??? / ??? / ??? / ??? / ??? / ??? / ??? / ??? / ??? / ??? / ??? / ??? / ARENA · FACE OFF / GAUNTLET · NEVER YIELD / INSERT COIN · AFTER HOURS / ??? / POCKET CHANGE / ??? / ONE MORE COIN / ??? / ??? / ??? / ??? / ??? / STOP / ESC BACK
- **wardrobe** — CLASSIC WEARING / ??? FIRST STEPS / ??? BOSS SLAYER / ??? ELITE HUNTER / ??? EXTERMINATOR / ??? SPEEDSTER / ??? FULL ARSENAL / ??? EVOLUTION / ??? GRADUATE / ??? DEEP DIVER / NO PET Go it alone. / BIT The fetcher: pulls gems and coins to you. Grows a zap, a shield and a revive / ??? BOSS SLAYER / ??? ELITE HUNTER / ??? FIRST STEPS / ??? ELITE HUNTER / ??? ONWARD / ??? DEEP DIVER / ??? SPEEDSTER / ??? FIELD ENGINEER / ESC BACK
- **history** — ESC BACK
- **bestiary** — CODEX & LORE / ESC BACK
- **relic** — Contextual screen.
- **heat** — HOT WHEELS +1 Enemies move 25% faster. / HEAVY METAL +2 Enemies have 35% more life. / HARD KNOCKS +1 Enemies deal 25% more damage. / FULL HOUSE +2 25% more enemies in director waves. / FAST FORWARD +2 Enemy shots travel 35% faster. / NO SNACKS +2 Healing hearts do not drop. / LOST CARGO +1 Map chests arrive half as often. / INFLATION +1 Shop Mods and their upgrades cost 50% more. / HEAVY BOOTS +2 Dash cooldown is 50% longer. / CLEAR HEAT / ESC BACK
- **weekly** — PLAY THIS WEEK / ESC BACK
- **codex** — ELITE ??? / ELITE ??? / ELITE ??? / ELITE ??? / ELITE ??? / ELITE ??? / ELITE ??? / SECRET ??? / SECRET ??? / BOSS ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / BOSS ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / ENEMY SWARMER / ENEMY BOPPER / ENEMY ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / BOSS ??? / BOSS ??? / BOSS ??? / BOSS ??? / BOSS ??? / BOSS ??? / BOSS ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / BOSS ??? / BOSS ??? / BOSS ??? / BOSS ??? / BOSS ??? / BOSS ??? / BOSS ??? / BOSS ??? / BOSS ??? / ENEMY ??? / ENEMY ??? / BOSS ??? / BOSS ??? / BOSS ??? / BOSS ??? / ENEMY ??? / ENEMY ??? / ENEMY ??? / SECRET ??? / SECRET ??? / BIOME BRIGHT MEADOW / BIOME ??? / BIOME ??? / BIOME ??? / BIOME ??? / BIOME ??? / BIOME ??? / BIOME ??? / BIOME ??? / HERO ROOKIE / HERO ??? / HERO ??? / HERO ??? / HERO ??? / HERO ??? / HERO ??? / HERO ??? / HERO ??? / HERO ??? / HERO ??? / BOSS ??? / BOSS ??? / MODE STANDARD / MODE ??? / MODE ??? / MODE ??? / MODE ??? / MODE ??? / MODE ??? / MODE ??? / MODE ??? / MODE ??? / MODE ??? / ESC BACK
- **rewards** — BLUEPRINT ARMOUR Defeat the Architect. Free unlock. / PIXEL RELAY ARMOUR Solve a secret room or discover the old directional code. Fre / HYDRA ARMOUR Complete the Hydra Engine raid. Free unlock. / HYDRA EMBER ARMOUR Complete the Hydra Engine raid. Free unlock. / RELAY GOLD ARMOUR Clear a loop with 4+ heat. Then 80 Bolts. / SIGNAL RUNNER ARMOUR Score 5,000 in a weekly run. Then 80 Bolts. / MINT MONITOR Earn any achievement. Then 30 Bolts. / SUNSET MONITOR Clear a loop with 4+ heat. Then 60 Bolts. / WEEKLY MONITOR Score 5,000 in a weekly run. Then 60 Bolts. / HEAT RUNNER KIT Clear a loop with 4+ heat. Free unlock. / WEEKLY EXPLORER KIT Score 5,000 in a weekly run. Free unlock. / DEFAULT HUD / ESC BACK
- **route** — Contextual screen.
- **contentmods** — IMPORT JSON / ZIP / RESTART GAME / ESC BACK
- **arsenal** — WEAPONS 2/47 / SPECIALS 1/5 / ITEMS 0/26 / MODS 11/63 / RELICS 0/36 / COMBOS 0/6 / EVOLUTIONS 0/64 / STATUSES 0/7 / POWER-UPS 0/5 / Buster LEFT CLICK / ??? LEFT CLICK / ??? LEFT CLICK / ??? LEFT CLICK / ??? LEFT CLICK / ??? LEFT CLICK / ??? LEFT CLICK / ??? LEFT CLICK / ??? LEFT CLICK / Charge Shot RIGHT CLICK / ??? RIGHT CLICK / ??? RIGHT CLICK / ??? RIGHT CLICK / ??? RIGHT CLICK / ??? RIGHT CLICK / ??? RIGHT CLICK / ??? RIGHT CLICK / ??? RIGHT CLICK / ??? RIGHT CLICK / ??? AUTO WEAPON / ??? AUTO WEAPON / ??? AUTO WEAPON / ??? AUTO WEAPON / ??? AUTO WEAPON / ??? AUTO WEAPON / ??? AUTO WEAPON / ??? AUTO WEAPON / ??? AUTO WEAPON / ??? AUTO WEAPON / ??? AUTO WEAPON / ??? AUTO WEAPON / ??? AUTO WEAPON / ??? AUTO WEAPON / ??? AUTO WEAPON / ??? AUTO WEAPON / ??? AUTO WEAPON / ??? AUTO WEAPON / ??? AUTO WEAPON / ??? AUTO WEAPON / ??? AUTO WEAPON / ??? AUTO WEAPON / ??? AUTO WEAPON / ??? AUTO WEAPON / ??? AUTO WEAPON / ??? AUTO WEAPON / ??? AUTO WEAPON / ??? AUTO WEAPON / ESC BACK
- **training** — START A RUN ▶ / ESC TITLE
- **localcoop** — Contextual screen.


### Populated contextual controls on the original build

- **story-play** — NEXT / SKIP STORY
- **online** — READY UP / COPY INVITE LINK / KICK LINA / KICK OMAR / KICK SKY / CO-OP / PVP / VERSUS / WEEKLY / RACE / RAID / PUBLIC: OFF / EASY / MEDIUM / HARD / 🔒 NIGHTMARE / 🔒 LEGEND / ARENA: STANDARD FIELDS / OFF / SHARED LIVES / CLOSED / OPEN / LOADOUT / HOST HEAT / START GAME / TRIALS / ESC BACK / READY! / ONE SEC! / LET'S GO! / GG! / NICE ONE! / BRB / TYPE HERE... / SAY
- **online** — READY UP / COPY INVITE LINK / KICK MIA / KICK BO / KICK KENJI / KICK LULU / KICK RAVI / KICK ZOE / KICK MAXIMILIAN / CO-OP / PVP / VERSUS / WEEKLY / RACE / RAID / PUBLIC: OFF / EASY / MEDIUM / HARD / 🔒 NIGHTMARE / 🔒 LEGEND / ARENA: STANDARD FIELDS / OFF / SHARED LIVES / CLOSED / OPEN / LOADOUT / HOST HEAT / START GAME / TRIALS / ESC BACK / READY! / ONE SEC! / LET'S GO! / GG! / NICE ONE! / BRB / TYPE HERE... / SAY
- **party** — VOTE RESTART 0/2 / BACK TO LOBBY 0/2 / RESTART NOW / LOBBY NOW / RUN SUMMARY / LEAVE PARTY / READY! / ONE SEC! / LET'S GO! / GG! / NICE ONE! / BRB / TYPE HERE... / SAY
- **friends** — COPY MY INVITE LINK / HOST WITH MY CODE: ON / NAME / CODE OR LINK / SAVE / JOIN / REMOVE / ESC BACK
- **trialresult** — RETRY / TRIAL SELECT / ESC BACK
- **arenas** — NEW ARENA / SAMPLE: SUNNY PLAZA / IMPORT CODE / ESC BACK
- **arenaedit** — Arena name / WALL 4 / LONG WALL 2 / COVER BLOCK 4 / PILLAR 2 / TOPPLING PILLAR 2 / ROCK 3 / TREE 3 / CRATE 1 / CRATE STACK 1 / BARREL 2 / LAVA 1 / ICE 1 / QUICKSAND 1 / THORNS 1 / POND 1 / TURRET 2/6 / JUMP PAD 2/8 / CONVEYOR 2/8 / HERO SPAWN 4/8 / BOSS MARKER 1/1 / CHEST SPOT 3/8 / ENEMY GATE 3/6 / ERASE / BUILD / RULES / SHARE / PLAY ▶ / HOST ONLINE / SAVE / UNDO / REDO / SIZE: MEDIUM / GRID: ON / CLEAR / EDIT MAP / ESC BACK
- **profile** — YOUR TITLE · 3/18 Rookie NEXT · Cadet · LV 2 / BANNER · 3/12 Navy NEXT · Teal · LV 4 / HUD THEME · 1/7 Classic NEXT · Lime · LV 7 / PET HAT · 0/7 None NEXT · Ball Cap · LV 6 / TRAIL · 0/8 None NEXT · Stardust · LV 3 / ESC BACK
- **achievements** — ALL / ITEM UNLOCKS / COMBAT / BOSSES / SKILL / BUILDS / MODES / ASCENSION / CO-OP & PVP / HEROES & WORLD / PROFILE / SECRETS / ESC BACK
- **tourney** — PLAY: SKY'S TURN / NEW TOURNAMENT / ESC BACK
- **trade** — GIVE 5 / GIVE 25 / GIVE HALF 30 / GIVE A GEAR / GIVE A RELIC ▶ / ESC BACK
- **mvp** — RUN SUMMARY → / VIEW ALL CLIPS
- **localcoop** — MODE: STANDARD / ESC BACK
- **voicechat** — VOICE CHAT OFF / TEST MIC (HEAR YOURSELF) OFF / VOICE MODE PUSH TO TALK / TEAM RADIO OFF / - / + / MUTE / MUTED / ESC BACK
- **architect-ending** — NEXT FRAME
- **Challenge records and Raid records** — local history, eligible online records and Back. An empty history displays an explanation.
- **Relic pick** — three free relic cards with rarity, name, effect and Take free. The ordinary shop follows the selection.
- **Trials** — challenge selection, unlocked medals and personal best, trial briefing and start, medal result and retry/return.
- **Route** — branching stage choices, eligibility, preview and the co-op vote. **Wait** — room or teammate status. **Race results** — finishing order and Continue.

## What players get

The fresh title has four buttons in this order — Play, Play with friends, Collection, Settings. Electron adds Quit after a finished run. Desktop Help and the native window controls still offer Close on the first launch. Scores, the eight First Steps, quests, profile, seasonal rewards and unlocks now have destinations in Collection. The title has no competing activity card.

Play remembers the last mode, eligible hero, three weapon slots and difficulty. The summary names the equipment the hero actually carries. Weekly shows the fixed Rookie kit, Daily and Weekly use Medium, and solo Ascension shows Hard. Change setup puts the hero, weapons, difficulty, squad and assists on one screen. Selecting an editable weapon cycles owned alternatives. Fixed hero weapons stay visible alongside their input prompts. A veteran can still shop for their first upgrade.

On the first Standard solo run, Start equips the first affordable, non-cursed offer in the guided opening shop and continues into the arena. Change setup → Start keeps the shop interactive, including on a fresh save. The opening kit message explains the shortcut before activation. Training is optional on the first Play visit and stays available afterward. The first-visit offer survives a consent or story redraw. In a clean production browser the elapsed time was 799 ms from navigation through choosing No on consent to combat, including 428 ms from the title. The intro fixture closed with one activation of Skip. These are local timings, excluding installation and network download.

Fresh saves see Standard. A finished run, a run-history entry or the existing First Steps run milestone reveals the other six existing game types and Trials. An existing selected game type remains accessible on an imported save. Ascension requires an unlocked level. The New badge lasts until a player selects the newly visible entry. Badge acknowledgements use a separate normalized storage key, `infinishoot.menus.seenModes.v1`. History and ghost recordings appear in Collection after a player has played. Core save, difficulty rules and network messages use their existing formats.

### After press counts

Counts below end when the feature or its controls are visible. Moving the highlight, cycling a setting, editing text, confirming a purchase, adding tournament contestants and completing gameplay are separate actions. In-room rows assume a successful connection. Locked rewards and time-limited events keep their normal eligibility rules.

| Feature from the title | Presses | Shortest route |
|---|---:|---|
| Solo summary, available game types, optional training offer | 1 | Play |
| Standard combat with first upgrade, or opening shop on a veteran save | 2 | Play → Start run |
| Hero, primary, secondary, special, difficulty, assists, squad bots | 2 | Play → Change setup |
| Start after editing a setup | 3 | Play → Change setup → Start run |
| Endless, Boss Rush, Survival Gauntlet, Raid, Weekly, Daily | 2 to select, 3 to launch | Play → game type → Start run |
| Training, Trials, unlocked Ascension | 2 | Play → entry |
| Heat rules, weekly rule detail, challenge records, raid records | 3 | Play → Change setup → feature |
| Collection categories | 1 | Collection |
| Profile & quests, season, achievements, unlocks, special rewards, history, First Steps & scores | 2 | Collection → entry |
| Outfits & pets, hero appearance, equipment guide, enemy guide, lore codex, jukebox, story, seasonal event | 2 | Collection → entry |
| Friends, help ghosts, ghost races, races & tournaments, arena editor | 2 | Collection → entry |
| Save management, tournament setup, individual collection tabs, arena list tools | 3 | Collection → entry → tool |
| Host, join by code, public room browser | 2 | Play with friends → action |
| Local co-op, spectate, team board, bot versus, online loadout and relay | 2–3 | Play with friends → More options → action |
| Room roster, Ready, Start, game type, difficulty | 2 | Play with friends → host or join |
| Room chat, invites, roles, loadouts, spectators, team rules and moderation | 3 | Play with friends → host or join → More options |
| Common Game settings | 1 | Settings |
| Other common settings, key binding and touch layout entry, in-game voice test entry | 2–3 | Settings → appropriate tab → tool |
| Detailed settings in all six tabs | 2–3 | Settings → tab if needed → Advanced |
| Help, content packs, desktop support and replay tools | 2–3 | Settings → Help or Content packs → tool |
| Pause, report, current build, trade, photo, level-up, route, relic, shop, MVP, results, clips, training results | contextual | These appear in the relevant run, story or room. Pause → Your build exposes equipment, damage, sets, Photo and eligible party actions. |

### Settings and shell details

Game opens first, with Language, Auto fire and Tips. Other common rows are Aim assist and Rumble under Controls, Quality, Window mode and UI scale under Video, Master, Music and Effects under Audio, Text size, Reduce effects, Colour vision and Captions under Accessibility, and Public lobby, Join in progress and Voice chat under Online. Advanced groups the remaining existing rows per tab. Descriptions follow focus or pointer, and sliders expose their values to assistive technology. Original tab indices are preserved for saved links. Privacy controls remain in Game → Advanced. Help also retains desktop update discovery. The new settings test walks the rendered panels and compares all reachable setting keys against the entire original row registry exactly once.

Destination screens share the existing live Back prompt and a logical-start corner position. Directional navigation filters hidden and folded controls. Scrolling lists reuse the game's MORE button. Arabic uses the opposite logical corner. Pause keeps Resume, Settings, Your build, Quit and the separate reporting action. The reporting and consent modules, game-over reporting action, game update loop, effects and networking systems were left to their owners.

### Files and integration points

- `src/ui/menu.ts`, `menuRun.ts`, `menuSections.ts`, `menuLayout.ts`, `menuFit.ts` implement the title, Play/Collection navigation, combined setup, mode badges, compact lobby/pause and shared shell. The lobby moves the actual browser and local co-op launch controls so their existing event handlers and host/client state still apply.
- Shared `src/ui/screens.ts` adds the Activity screen name, first-run Start shortcut, setup/online presentation hooks, initial Play selection and equipment vocabulary. Shared i18n catalogs `src/i18n/{en,ar,de,es,fr,pt-BR,tr}.ts` include the new `src/i18n/menus.ts` entries. Arabic has native entries and the five fallback languages use English for new copy.
- `src/ui/settingsScreen.ts`, `onboarding.ts`, `firstten.ts`, `modsScreen.ts` cover settings disclosure, the first training offer, updated checklist directions and the Content packs name.
- `tests/menus.test.ts` exercises actual title activations, kit selection, fresh and legacy saves, badge persistence, fixed Ascension difficulty, lazy Collection screens, room options, Arabic and settings coverage. `tests/uxpass.test.ts` adds logical Back placement and scroll-surface coverage. The existing UX and UI polish assertions are retained.

### Reproducing the visual checks

Use `?test&fresh` for the fresh title and open Play, Change setup, Collection and First steps & scores from their actual buttons. Use `?test&screen=settings` then each tab and Advanced. Room and gameplay fixtures include `?test&lobby8`, `?test&browse=fake`, `?test&localcoop&lcpads=2`, `?test&party`, `?test&voicedemo=screen`, `?test&mate&tradedemo&trade=1`, `?test&god&setpause=1&weapons=drones:3`, `?test&ftshop`, `?test&ftlvl`, `?test&ftdie=Rhino`, `?test&stage=3&route`, `?test&story=intro&storyframe=0&storypin`, `?test&trialscreen=select` and `?test&m2demo&m2screen=profile`. Append `&lang=ar` for RTL.

- `shots/menus/before/` contains the original screen inventory and populated path fixtures. `shots/menus/after/` contains the screen matrix, production-preview fresh/veteran paths, all six Settings tabs and their expanded states, online landing/More, eight-player lobby/More and pause/build. Filenames identify the screen, language and width (1280×720, 1920×1080, 844×390). `sheet_*.jpg` are labeled contact sheets. `shots/menus/coop/` contains the host, client, spectator and trade captures. There are 98 before states (588 images) and 121 after states (726 images) across the six language and size permutations. Supplemental baseline captures used the original tracked sources at 717b3ed. All screenshots are git-ignored.
- Checked both languages and all three sizes. The 1280×720 production measurements for title, Play, setup, Collection, Activity, settings, online and pause had no page overflow exceeding five pixels. The extra-long mode, settings, activity and full-lobby option lists scroll internally with MORE when needed. The 390-pixel-high phone can also scroll the menu itself. Measurements are in `shots/menus/logs/layout.json`.
- The native screenshot command hit a macOS Chromium bootstrap restriction. The visual checks used managed Playwright against the local game and production preview. Native keyboard Enter/Escape, touch taps at 844×390, simulated standard gamepad A/B, story skip, fresh-run launch and co-op were exercised in Chromium. Physical controllers, Electron window controls and an independent human visual review remain unverified. Direct-route pictures of gameplay-only overlays can be empty without a live event. The separate path fixtures exercise populated states. Individual permutations of generated upgrades, custom content, user saves and private network configurations were not exhaustively navigated.

### Verification

| Command | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npx vite build` | Pass. Vite emitted its existing chunk-size warning. |
| `npm test` | Pass, all 126 test files. A separate full run hit one enemy-speed assertion in `sound2Game.test.ts`. The full rerun passed without a change to sound or enemies. |
| `npm run smoke` | Pass on rerun. The first run's bot missed the stage-two route choice. |
| `npm run coop -- --offline` | Native launch failed before the first scenario. macOS denied Chromium's Mach bootstrap service (1100). The same complete offline scenario body passed through the managed Playwright browser with the simulator and the default 80-second run. |
| `git diff --check` | Pass |

The co-op run covered code-based host/join, gameplay state and effects, trade, spectator views, invitations, reconnects, kicking and restart. Two managed runs passed. The final host produced 1,919 measured snapshots, averaging 1,730 bytes and peaking at 12,305 bytes. Logs are in `shots/menus/logs/`, including `tests-rerun.txt`, `smoke-rerun.txt`, `coop.txt` `coop-managed.txt` and `coop-managed-final.txt`. Only browser launch and local origin selection were adapted for the managed run. The stock native co-op launcher still needs verification on a machine that permits Chromium to start.
