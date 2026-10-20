LANE: mvp — end-of-run awards and band mode

1. MVP screen at the end of every co-op run (and a solo version): per player damage, kills, revives, saves (killed an enemy about to hit a downed ally), damage taken, best combo, gold shared; 6-8 fun awards ("Most Dramatic Revive", "Hoarder", "Pacifist Moment", "Glass Cannon", "Bodyguard", "Speed Demon"...) with portraits and confetti, vo_mvp; a highlight list of the run's big moments (boss finisher, clutch revive, legendary, fusion) with timestamps. Host computes, clients receive.
2. BAND MODE (co-op music): each player's weapons play their own instrument layer (src/audio/stems.ts), and in co-op the stems of nearby teammates join yours, so a 4-player team plays one song together; a short band "line-up" card on the MVP screen showing who played what. Keep the voice budget sane with 8 players.
Owns: new src/game/systems/mvp.ts, src/ui/mvpScreen.ts, stems/music hooks (additive, careful), tests/mvp.test.ts.
