// Seven-pixel enamel pins. Each pattern is an earned cosmetic, indexed by tier.
const pins = [
  ['yellow', '..#.#.. .#####. ##...## .#.##.. ##...## .#####. ..#.#..'], // cog
  ['cyan', '##...## .##.##. ..###.. .#####. .##.##. .#####. ..###..'], // ribbon
  ['white', '...#... #..#..# ##.#.## .#####. .#####. ....... .#####.'], // paper crown
  ['yellow', '..###.. ..#.#.. .#####. .#...#. .#.#.#. .#####. ..###..'], // lantern
  ['cyan', '......# ....##. .#.#... ##...## ...#### .#####. ..###..'], // twin comets
  ['lime', '...#... ..###.. .#####. ..###.. ...#... ....#.. ...#...'], // kite
  ['yellow', '...#... ..###.. .#####. .#####. .#####. ####### ...#...'], // bell
  ['red', '.##.##. ##.#.## ####### ####### .#####. ..###.. ...#...'], // glass heart
  ['sky', '.#####. ###.### ###.### ###.### .##.##. ..###.. ...#...'], // shield
  ['yellow', '..###.. .###... ###.... ###.... ####... .#####. ..###..'], // moon
  ['orange', '.###... ##.##.. .###... ...#... ....#.. .....## .....#.'], // key
  ['lime', '...#... ..###.. ####### .#####. ..###.. .##.##. .#...#.'], // medic star
  ['sky', '....##. ....##. .....#. .#...#. ##...#. .##.##. ..###..'], // hook
  ['red', '...###. #..##.. ##.#... .#####. ...#.## ..##..# .###...'], // pinwheel
  ['orange', '..###.. .#...#. #.###.# #.#.#.# #.###.# .#...#. ..###..'], // seal
  ['orange', '....#.. ...##.. .#.##.. .#####. ###.### .##.##. ..###..'], // ember
  ['cyan', '.####.. .###### .#####. .#..... .#..... .#..... ###....'], // flag
  ['yellow', '...##.. ...#### #.####. .#####. ..###.. ..#.#.. .##.##.'], // finch
  ['lime', '#..#..# ##.#.## .#####. ..###.. .#####. ..#.#.. ...#...'], // crest
  ['yellow', '#..#..# .#####. .#####. ###.### .#####. .#####. #..#..#'], // sun
] as const;

const images: string[] = [];
export function ascensionBadge(tier: number): string {
  const pin = pins[tier - 1];
  if (!pin) return '';
  if (images[tier]) return images[tier];
  const [color, rows] = pin;
  const squares: string[] = [];
  rows.split(' ').forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === '#') squares.push(`M${x} ${y}h1v1h-1z`);
  });
  return (images[tier] =
    `<svg class="asc-pin" aria-hidden="true" viewBox="0 0 7 7" fill="var(--${color})" shape-rendering="crispEdges"><path d="${squares.join('')}"/></svg>`);
}
