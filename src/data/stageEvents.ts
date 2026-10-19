/**
 * Mid-stage events (one per stage, at a random moment) and side challenges
 * (one per stage). Behaviour lives in src/game/runEvents.ts.
 */
export type EventId = 'meteors' | 'goldrush' | 'fog' | 'parade' | 'stampede' | 'garden' | 'rebellion' | 'gravity' | 'goblins' | 'blackout' | 'turrets';

export interface StageEventDef {
  id: EventId;
  name: string;
  sub: string;
  seconds: number;
  good: boolean;
}

export const STAGE_EVENTS: Record<EventId, StageEventDef> = {
  garden: { id: 'garden', name: 'METEOR GARDEN!', sub: 'DODGE THE BLOOMS • HARVEST THE HEARTS', seconds: 24, good: false },
  rebellion: { id: 'rebellion', name: 'ROBOT REBELLION!', sub: 'ROBOTS TURN ON THEIR NEIGHBOURS', seconds: 20, good: true },
  gravity: { id: 'gravity', name: 'GRAVITY STORM!', sub: 'THE VORTEX GATHERS THE HORDE', seconds: 22, good: false },
  goblins: { id: 'goblins', name: 'TREASURE GOBLIN PARADE!', sub: 'THREE GOLDBUGS • CATCH THEIR JACKPOTS', seconds: 24, good: true },
  blackout: { id: 'blackout', name: 'BLACKOUT!', sub: 'KEEP MOVING • WATCH THE AIM LINES', seconds: 20, good: false },
  turrets: { id: 'turrets', name: 'TURRET PARTY!', sub: 'FRIENDLY SENTRY RINGS • FIGHT NEAR THEM', seconds: 24, good: true },
  meteors: { id: 'meteors', name: 'METEOR SHOWER!', sub: 'WATCH THE SKY', seconds: 18, good: false },
  goldrush: { id: 'goldrush', name: 'GOLD RUSH!', sub: 'ENEMIES DROP GOLD', seconds: 20, good: true },
  fog: { id: 'fog', name: 'FOG BANK', sub: 'STAY SHARP', seconds: 25, good: false },
  parade: { id: 'parade', name: 'ELITE PARADE!', sub: 'THREE ELITES INCOMING', seconds: 8, good: false },
  stampede: { id: 'stampede', name: 'STAMPEDE!', sub: 'HERE THEY COME', seconds: 10, good: false },
};

export const EVENT_IDS = Object.keys(STAGE_EVENTS) as EventId[];

export type ChallengeKind = 'nohit' | 'tagkills' | 'combo' | 'chests' | 'elites';
