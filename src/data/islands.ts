/** Permanent chart order. Coordinates are pixels on the 240 × 144 sea chart. */
export const ISLANDS = [
  { id: 'meadow', x: 30, y: 108, stages: 1, port: 'market' },
  { id: 'dunes', x: 79, y: 113, stages: 2, port: 'rest' },
  { id: 'peaks', x: 129, y: 99, stages: 2, port: 'ferry' },
  { id: 'neon', x: 191, y: 108, stages: 2 },
  { id: 'factory', x: 202, y: 58, stages: 2 },
  { id: 'candy', x: 148, y: 40, stages: 2 },
  { id: 'ruins', x: 101, y: 61, stages: 2 },
  { id: 'magma', x: 56, y: 48, stages: 2 },
  { id: 'sky', x: 33, y: 21, stages: 2 },
] as const;
export type Island = (typeof ISLANDS)[number];
export type Passage = 'coast' | 'market' | 'rest' | 'ferry';
export type Dispatch = 'fast' | 'shielded';

export function ports(cleared: number, island: Island): Passage[] {
  const paths: Passage[] = ['coast'];
  if (island.stages === 2)
    for (const p of ISLANDS.slice(0, cleared)) {
      if ('port' in p) paths.push(p.port);
    }
  return paths;
}

export function legCount(island: Island, passage: Passage): number {
  return passage === 'ferry' ? 1 : island.stages;
}
