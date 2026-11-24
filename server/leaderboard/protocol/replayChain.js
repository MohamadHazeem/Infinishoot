// Wire format 1: a bounded replay of the scoring HUD and the pilot's position/life.
// Each integer sample links to its predecessor, including the board/build/hero/seed in the first link.
export const PERIOD = 15000;
export const MAX_ROWS = Math.ceil(86400000 / PERIOD) + 2;
export function checksum(previous, fields) {
  const text = JSON.stringify(fields);
  for (let i = 0; i < text.length; i++) previous = Math.imul(previous ^ text.charCodeAt(i), 16777619);
  return previous >>> 0;
}
export function firstLink(board, build, hero, seed) {
  return checksum(2166136261, [1, board, build, hero, seed]);
}
