/** The wire order is stable. Zero bits describe a Gunner, including late arrivals. */
export const stations = ['gunner', 'pilot', 'scout', 'commander'] as const;
export type Station = (typeof stations)[number];
export const rolesFlag = 1 << 16;
export const seatLimit = 8;
export const asymRoleTuning = {
  pilotCycle: 75, // includes the existing 30-second mech sortie
  scoutSpeed: 1.18,
  reviveSpeed: 0.6,
  scanEvery: 4,
  markRange: 24,
  revealRange: 30,
  rallyRange: 15,
  droneSpeed: 22,
  supportHp: 0.94,
};

export function stationIndex(value: unknown): number {
  return Math.max(0, stations.indexOf(value as Station));
}

export function validRoles(word: unknown): number {
  return typeof word === 'number' &&
    Number.isInteger(word) &&
    word >= rolesFlag &&
    word < 2 * rolesFlag
    ? word
    : 0;
}

export function stationAt(word: number, seat: number): Station {
  return stations[seat >= 0 && seat < seatLimit ? (word >>> (seat * 2)) & 3 : 0];
}

export function packStations(picks: readonly Station[]): number {
  let word = rolesFlag;
  for (let i = 0; i < Math.min(picks.length, seatLimit); i++)
    word |= stationIndex(picks[i]) << (i * 2);
  return word;
}

/** Fill missing jobs before duplicating the leader's choice. */
export function squadStations(leader: Station): Station[] {
  const fill: Station[] = ['pilot', 'scout', 'commander', 'gunner'];
  return [leader, ...fill.filter((r) => r !== leader)];
}
