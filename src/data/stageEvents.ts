/**
 * Mid-stage events (one per stage, at a random moment) and side challenges
 * (one per stage). Behaviour lives in src/game/runEvents.ts.
 */
export type EventId = 'meteors' | 'goldrush' | 'fog' | 'parade' | 'stampede';

export interface StageEventDef {
  id: EventId;
  name: string;
  sub: string;
  seconds: number;
  good: boolean;
}

export const STAGE_EVENTS: Record<EventId, StageEventDef> = {
  meteors: { id: 'meteors', name: 'METEOR SHOWER!', sub: 'WATCH THE SKY', seconds: 18, good: false },
  goldrush: { id: 'goldrush', name: 'GOLD RUSH!', sub: 'ENEMIES DROP GOLD', seconds: 20, good: true },
  fog: { id: 'fog', name: 'FOG BANK', sub: 'STAY SHARP', seconds: 25, good: false },
  parade: { id: 'parade', name: 'ELITE PARADE!', sub: 'THREE ELITES INCOMING', seconds: 8, good: false },
  stampede: { id: 'stampede', name: 'STAMPEDE!', sub: 'HERE THEY COME', seconds: 10, good: false },
};

export const EVENT_IDS = Object.keys(STAGE_EVENTS) as EventId[];

export type ChallengeKind = 'nohit' | 'tagkills' | 'combo' | 'chests' | 'elites';
