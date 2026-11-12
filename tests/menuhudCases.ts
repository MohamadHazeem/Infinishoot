// menuhud lane: game-over blocks measured in headless Chromium at 1280x720 (shots/menuhud/cases-probe.json:
// a first run with NEW HIGH SCORE, NEXT TRY, 6 damage rows, 3 closest unlocks, a 6-stage timeline, 5 Mods,
// 2 new achievements, the profile and season strips, the clips panel and 2 high scores). Outer heights in px.
// Re-record after changing the game-over layout: the probe prints these objects.
export interface GameOverCase { lang: string; padTop: number; padBottom: number; gap: number; margin: number; head: [string, number][]; items: [string, number][]; bodyH: number; before: number }

export const GAME_OVER_720: GameOverCase[] = [
  { lang: 'en', padTop: 9, padBottom: 12, gap: 9, margin: 9, head: [['ko', 48], ['newbest', 12], ['ft-next', 75], ['menu', 32]],
    items: [['summary', 185], ['dmg-table', 174], ['ob-unlocks', 201], ['ob-recap', 99], ['build', 93], ['unlocked', 30], ['m2-strip', 39], ['sp-strip', 36], ['clips-panel', 163], ['hiscores', 92]],
    bodyH: 384, before: 1305 },
  { lang: 'ar', padTop: 9, padBottom: 12, gap: 9, margin: 9, head: [['ko', 46], ['newbest', 10], ['ft-next', 75], ['menu', 34]],
    items: [['summary', 190], ['dmg-table', 197], ['ob-unlocks', 242], ['ob-recap', 134], ['build', 88], ['unlocked', 38], ['m2-strip', 61], ['sp-strip', 57], ['clips-panel', 189], ['hiscores', 125]],
    bodyH: 462, before: 1612 },
];
