export interface Vec2 {
  x: number;
  y: number;
}

/** Tile floor layer. `None` is bare ground outside the facility. */
export const FLOOR = {
  None: 0,
  Concrete: 1,
  Yard: 2,
  Polished: 3,
} as const;
export type FloorId = (typeof FLOOR)[keyof typeof FLOOR];

/** Tile wall layer. Doors block room detection but not movement. */
export const WALL = {
  None: 0,
  Solid: 1,
  Door: 2,
} as const;
export type WallId = (typeof WALL)[keyof typeof WALL];

export type ObjectKind = 'bed' | 'toilet' | 'table' | 'bench' | 'shower' | 'tv';

export type RoomKind =
  | 'unassigned'
  | 'cell'
  | 'canteen'
  | 'yard'
  | 'common'
  | 'bathroom'
  | 'holding'
  | 'corridor';

export type NeedKind = 'sleep' | 'hunger' | 'hygiene' | 'recreation';

export const NEED_KINDS: readonly NeedKind[] = ['sleep', 'hunger', 'hygiene', 'recreation'];

export type Needs = Record<NeedKind, number>;

export type RegimeBlock = 'sleep' | 'eat' | 'yard' | 'free' | 'lockup';

export interface PlacedObject {
  id: number;
  kind: ObjectKind;
  x: number;
  y: number;
  /** Agent currently using this object, if any. */
  userId: number | null;
  /** Prisoner this object is reserved for (beds are assigned on intake). */
  ownerId: number | null;
  roomId: number;
}

export interface Room {
  id: number;
  kind: RoomKind;
  tiles: number[];
  /** Tile indices, plus a cached centre for labels and goal picking. */
  centre: Vec2;
  area: number;
  enclosed: boolean;
  objectIds: number[];
  /** Prisoners assigned to live here (cells only). */
  assignedPrisoners: number[];
}

export type AgentRole = 'prisoner' | 'guard';

export type ActivityKind =
  | 'idle'
  | 'walking'
  | 'sleeping'
  | 'eating'
  | 'washing'
  | 'relaxing'
  | 'exercising'
  | 'patrolling'
  | 'responding'
  | 'suppressing';

export interface Agent {
  id: number;
  role: AgentRole;
  name: string;
  /** Position in tile-space floats; (0.5, 0.5) is the centre of tile (0,0). */
  x: number;
  y: number;
  speed: number;
  needs: Needs;
  /** 0 = calm, 100 = rioting. Drives the facility danger signal. */
  unrest: number;
  activity: ActivityKind;
  /** Remaining seconds of the current stationary activity, if timed. */
  activityTimer: number;
  path: number[] | null;
  pathCursor: number;
  /** Object the agent is heading to or using. */
  targetObjectId: number | null;
  targetTile: number | null;
  homeRoomId: number | null;
  /** Agent this guard is responding to. */
  focusAgentId: number | null;
  repathCooldown: number;
  /** Regime block in force when the current activity was chosen. */
  decisionBlock: RegimeBlock | null;
  /** Rolling log of recent decisions, surfaced in the inspector. */
  lastDecision: string;
  /** Prisoners only: identity and sentence. Guards carry a name-only profile. */
  profile: Profile;
  /** Most recent first. Capped — see MEMORY_LIMIT. */
  memory: MemoryEntry[];
  /**
   * -1 hardening, +1 settling. Moves slowly with how well the regime treats
   * them; the inspector shows it as the inmate's trajectory.
   */
  trajectory: number;
}

export type SecurityLevel = 'minimum' | 'medium' | 'maximum';

/**
 * Who an inmate is, as opposed to what they currently need. The design bet is
 * that the sentence — not the building — is the game's real clock, so identity
 * and the release countdown are first-class simulation data.
 */
export interface Profile {
  fullName: string;
  age: number;
  charge: string;
  security: SecurityLevel;
  /** Total sentence length in simulated days. */
  sentenceDays: number;
  intakeDay: number;
  /** Day the agent walks out, assuming no changes. */
  releaseDay: number;
  backstory: string;
  traits: string[];
}

/** A timestamped note of what this institution did to a person. */
export interface MemoryEntry {
  day: number;
  time: string;
  text: string;
  tone: 'info' | 'good' | 'warn' | 'bad';
}

export interface LedgerEntry {
  day: number;
  label: string;
  amount: number;
}

export interface SimEvents {
  'day:advanced': { day: number };
  'regime:changed': { block: RegimeBlock };
  'prisoner:arrived': { agentId: number };
  'prisoner:released': { agentId: number; name: string };
  'rooms:rebuilt': { count: number };
  'economy:changed': { money: number };
  'log': { text: string; tone: 'info' | 'good' | 'warn' | 'bad' };
}
