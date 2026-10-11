import { EventBus } from '../core/events';
import { Rng } from '../core/math';
import { Clock } from './clock';
import { Economy } from './economy';
import { makeNeeds } from './needs';
import { makeGuardProfile, makePrisonerProfile, pushMemory } from './people';
import { Pathfinder } from './pathfinding';
import { detectRooms } from './rooms';
import { TileMap } from './tilemap';
import { OBJECTS } from './catalog';
import type { Agent, MemoryEntry, ObjectKind, PlacedObject, Room, SimEvents } from './types';

export interface FacilityLogEntry extends MemoryEntry {
  id: number;
}

const FACILITY_LOG_LIMIT = 60;

export interface WorldStats {
  population: number;
  guards: number;
  capacity: number;
  /** 0..100 — the headline danger readout. */
  danger: number;
  /** Mean wellbeing across the population, 0..100. */
  comfort: number;
  released: number;
  admitted: number;
  incidents: number;
}

/**
 * The entire mutable state of a running prison. Systems are plain functions
 * that take a World; nothing in here touches the DOM or the canvas, which is
 * what lets the simulation be tested and rendered independently.
 */
export class World {
  readonly map: TileMap;
  readonly objects = new Map<number, PlacedObject>();
  readonly agents = new Map<number, Agent>();
  rooms: Room[] = [];

  readonly clock = new Clock();
  readonly economy = new Economy();
  readonly pathfinder: Pathfinder;
  readonly rng: Rng;
  readonly bus = new EventBus<SimEvents>();

  /** Tile where new arrivals appear — the gate. */
  intakeTile = 0;

  readonly log: FacilityLogEntry[] = [];
  readonly stats: WorldStats = {
    population: 0,
    guards: 0,
    capacity: 0,
    danger: 0,
    comfort: 70,
    released: 0,
    admitted: 0,
    incidents: 0,
  };

  private roomsDirty = true;
  private nextObjectId = 1;
  private nextAgentId = 1;
  private nextLogId = 1;

  constructor(width = 64, height = 46, seed = 20261011) {
    this.map = new TileMap(width, height);
    this.pathfinder = new Pathfinder(this.map);
    this.rng = new Rng(seed);
    this.intakeTile = this.map.index(2, Math.floor(height / 2));
  }

  // ---------------------------------------------------------------- terrain

  markRoomsDirty(): void {
    this.roomsDirty = true;
    this.map.markDirty();
  }

  get roomsAreDirty(): boolean {
    return this.roomsDirty;
  }

  rebuildRooms(): void {
    this.rooms = detectRooms(this.map, this.objects);
    // Re-derive cell occupancy from bed ownership so rooms stay stateless.
    for (const object of this.objects.values()) {
      if (object.kind !== 'bed' || object.ownerId === null) continue;
      const room = this.rooms[object.roomId];
      if (room && !room.assignedPrisoners.includes(object.ownerId)) {
        room.assignedPrisoners.push(object.ownerId);
      }
    }
    this.roomsDirty = false;
    this.bus.emit('rooms:rebuilt', { count: this.rooms.length });
  }

  roomOf(agent: Agent): Room | null {
    const id = this.map.roomAt(Math.floor(agent.x), Math.floor(agent.y));
    return id === -1 ? null : this.rooms[id] ?? null;
  }

  // ---------------------------------------------------------------- objects

  addObject(kind: ObjectKind, x: number, y: number): PlacedObject | null {
    if (!this.map.inBounds(x, y)) return null;
    const index = this.map.index(x, y);
    if (this.map.objects[index] !== -1) return null;
    if (this.map.walls[index] !== 0) return null;
    if (this.map.floors[index] === 0) return null;

    const object: PlacedObject = {
      id: this.nextObjectId++,
      kind,
      x,
      y,
      userId: null,
      ownerId: null,
      roomId: -1,
    };
    this.objects.set(object.id, object);
    this.map.objects[index] = object.id;
    this.markRoomsDirty();
    return object;
  }

  removeObject(id: number): PlacedObject | null {
    const object = this.objects.get(id);
    if (!object) return null;
    this.objects.delete(id);
    this.map.objects[this.map.index(object.x, object.y)] = -1;
    // Anyone using or owning it is immediately homeless / interrupted.
    for (const agent of this.agents.values()) {
      if (agent.targetObjectId === id) {
        agent.targetObjectId = null;
        agent.path = null;
        agent.activity = 'idle';
      }
    }
    this.markRoomsDirty();
    return object;
  }

  objectsOfKind(kind: ObjectKind): PlacedObject[] {
    const out: PlacedObject[] = [];
    for (const object of this.objects.values()) if (object.kind === kind) out.push(object);
    return out;
  }

  // ----------------------------------------------------------------- agents

  spawnPrisoner(x?: number, y?: number): Agent {
    const tile = this.intakeTile;
    const profile = makePrisonerProfile(this.rng, this.clock.day);
    const agent = this.makeAgent('prisoner', profile, x ?? this.map.tileX(tile) + 0.5, y ?? this.map.tileY(tile) + 0.5);
    agent.speed = 3.6 + this.rng.range(-0.3, 0.3);
    agent.needs = makeNeeds(62 + this.rng.range(-10, 14));
    this.remember(agent, `Admitted to the facility. ${profile.sentenceDays} days.`, 'info');
    this.stats.admitted++;
    this.bus.emit('prisoner:arrived', { agentId: agent.id });
    this.logEvent(`${profile.fullName} admitted \u2014 ${profile.charge}, ${profile.sentenceDays} days`, 'info');
    return agent;
  }

  spawnGuard(x?: number, y?: number): Agent {
    const tile = this.intakeTile;
    const profile = makeGuardProfile(this.rng, this.clock.day);
    const agent = this.makeAgent('guard', profile, x ?? this.map.tileX(tile) + 0.5, y ?? this.map.tileY(tile) + 0.5);
    agent.speed = 4.4;
    agent.activity = 'patrolling';
    return agent;
  }

  private makeAgent(role: Agent['role'], profile: Agent['profile'], x: number, y: number): Agent {
    const agent: Agent = {
      id: this.nextAgentId++,
      role,
      name: profile.fullName,
      x,
      y,
      speed: 3.6,
      needs: makeNeeds(),
      unrest: 0,
      activity: 'idle',
      activityTimer: 0,
      path: null,
      pathCursor: 0,
      targetObjectId: null,
      targetTile: null,
      homeRoomId: null,
      focusAgentId: null,
      repathCooldown: 0,
      decisionBlock: null,
      lastDecision: role === 'guard' ? 'Reporting for duty' : 'Processing intake',
      profile,
      memory: [],
      trajectory: 0,
    };
    this.agents.set(agent.id, agent);
    return agent;
  }

  removeAgent(id: number): void {
    const agent = this.agents.get(id);
    if (!agent) return;
    for (const object of this.objects.values()) {
      if (object.userId === id) object.userId = null;
      if (object.ownerId === id) object.ownerId = null;
    }
    this.agents.delete(id);
    this.markRoomsDirty();
  }

  prisoners(): Agent[] {
    const out: Agent[] = [];
    for (const agent of this.agents.values()) if (agent.role === 'prisoner') out.push(agent);
    return out;
  }

  guards(): Agent[] {
    const out: Agent[] = [];
    for (const agent of this.agents.values()) if (agent.role === 'guard') out.push(agent);
    return out;
  }

  tileIndexOf(agent: Agent): number {
    const x = Math.min(this.map.width - 1, Math.max(0, Math.floor(agent.x)));
    const y = Math.min(this.map.height - 1, Math.max(0, Math.floor(agent.y)));
    return this.map.index(x, y);
  }

  // ------------------------------------------------------------------- logs

  /** Adds to one inmate's personal record. */
  remember(agent: Agent, text: string, tone: MemoryEntry['tone']): void {
    pushMemory(agent.memory, { day: this.clock.day, time: this.clock.formatTime(), text, tone });
  }

  /** Adds to the facility-wide feed shown in the UI. */
  logEvent(text: string, tone: MemoryEntry['tone']): void {
    this.log.unshift({
      id: this.nextLogId++,
      day: this.clock.day,
      time: this.clock.formatTime(),
      text,
      tone,
    });
    if (this.log.length > FACILITY_LOG_LIMIT) this.log.length = FACILITY_LOG_LIMIT;
    this.bus.emit('log', { text, tone });
  }

  /** Beds that exist, which is what the state counts as capacity. */
  recomputeCapacity(): void {
    let beds = 0;
    for (const object of this.objects.values()) if (object.kind === 'bed') beds++;
    this.stats.capacity = beds;
  }

  /** Total build value on the ground, used by the economy panel. */
  assetValue(): number {
    let total = 0;
    for (const object of this.objects.values()) total += OBJECTS[object.kind].cost;
    return total;
  }
}
