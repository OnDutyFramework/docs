import { clamp } from '../core/math';
import { SECONDS_PER_HOUR } from './clock';
import { followPath, goTo, randomTileIn } from './locomotion';
import type { Agent, RoomKind } from './types';
import type { World } from './world';

/** Unrest above this pulls a guard off patrol. */
export const RESPONSE_THRESHOLD = 55;
/** How close a guard must be to start calming someone down. */
const INTERVENE_RANGE = 1.8;
/** Radius within which a guard's presence passively suppresses unrest. */
export const PRESENCE_RADIUS = 7;

/** Where patrols want to be, in priority order. */
const PATROL_PRIORITY: readonly RoomKind[] = ['corridor', 'cell', 'canteen', 'common', 'yard', 'holding'];

export function updateGuard(world: World, agent: Agent, simSeconds: number, simHours: number): void {
  if (agent.repathCooldown > 0) agent.repathCooldown -= simSeconds;

  const target = pickResponseTarget(world, agent);
  if (target) {
    if (agent.focusAgentId !== target.id) {
      agent.focusAgentId = target.id;
      agent.path = null;
      agent.activity = 'responding';
      agent.lastDecision = `Responding to ${target.profile.fullName}`;
    }
    handleResponse(world, agent, target, simSeconds, simHours);
    return;
  }

  if (agent.focusAgentId !== null) {
    agent.focusAgentId = null;
    agent.path = null;
    agent.activity = 'patrolling';
    agent.lastDecision = 'Resuming patrol';
  }

  patrol(world, agent, simSeconds);
}

function pickResponseTarget(world: World, guard: Agent): Agent | null {
  let best: Agent | null = null;
  let bestScore = -Infinity;

  for (const prisoner of world.agents.values()) {
    if (prisoner.role !== 'prisoner') continue;
    if (prisoner.unrest < RESPONSE_THRESHOLD) continue;
    // Don't pile on: another officer already has this one.
    if (isClaimedByAnother(world, guard, prisoner.id)) continue;
    const distance = Math.hypot(prisoner.x - guard.x, prisoner.y - guard.y);
    const score = prisoner.unrest - distance * 2.5;
    if (score > bestScore) {
      bestScore = score;
      best = prisoner;
    }
  }
  return best;
}

function isClaimedByAnother(world: World, guard: Agent, prisonerId: number): boolean {
  for (const other of world.agents.values()) {
    if (other.role !== 'guard' || other.id === guard.id) continue;
    if (other.focusAgentId === prisonerId) return true;
  }
  return false;
}

function handleResponse(world: World, guard: Agent, target: Agent, simSeconds: number, simHours: number): void {
  const distance = Math.hypot(target.x - guard.x, target.y - guard.y);

  if (distance <= INTERVENE_RANGE) {
    guard.path = null;
    guard.activity = 'suppressing';
    guard.lastDecision = `Calming ${target.profile.fullName}`;
    target.unrest = clamp(target.unrest - 55 * simHours, 0, 100);
    if (target.unrest < RESPONSE_THRESHOLD * 0.6) {
      world.remember(target, `${guard.profile.fullName} defused the situation.`, 'info');
    }
    return;
  }

  if (guard.activity !== 'responding' || guard.path === null) {
    guard.activity = 'responding';
    if (guard.repathCooldown <= 0) {
      const tile = world.tileIndexOf(target);
      if (!goTo(world, guard, [tile])) guard.repathCooldown = 0.2 * SECONDS_PER_HOUR;
    }
  }
  if (guard.path) {
    const result = followPath(world, guard, simSeconds);
    // Agents move, so refresh the route when it runs out before arrival.
    if (result !== 'moving') guard.path = null;
  }
}

function patrol(world: World, guard: Agent, simSeconds: number): void {
  if (guard.path) {
    const result = followPath(world, guard, simSeconds);
    if (result === 'moving') return;
    guard.path = null;
    guard.activityTimer = 0.25 * SECONDS_PER_HOUR;
    return;
  }

  if (guard.activityTimer > 0) {
    guard.activityTimer -= simSeconds;
    return;
  }
  if (guard.repathCooldown > 0) return;

  guard.activity = 'patrolling';
  const rooms = world.rooms
    .filter((room) => PATROL_PRIORITY.includes(room.kind))
    .sort((a, b) => PATROL_PRIORITY.indexOf(a.kind) - PATROL_PRIORITY.indexOf(b.kind));

  // Mostly sweep the high-priority areas, sometimes wander anywhere.
  const pool = world.rng.next() < 0.7 ? rooms.slice(0, Math.max(1, Math.ceil(rooms.length / 2))) : rooms;
  const room = world.rng.pick(pool);
  if (!room) {
    guard.repathCooldown = 0.5 * SECONDS_PER_HOUR;
    return;
  }
  const tile = randomTileIn(world, room.id);
  if (tile === null || !goTo(world, guard, [tile])) {
    guard.repathCooldown = 0.3 * SECONDS_PER_HOUR;
    return;
  }
  guard.lastDecision = `Patrolling the ${room.kind}`;
}

/** 0..1 measure of how closely supervised a prisoner currently is. */
export function guardPressureOn(world: World, prisoner: Agent): number {
  let pressure = 0;
  for (const guard of world.agents.values()) {
    if (guard.role !== 'guard') continue;
    const distance = Math.hypot(guard.x - prisoner.x, guard.y - prisoner.y);
    if (distance > PRESENCE_RADIUS) continue;
    pressure += 1 - distance / PRESENCE_RADIUS;
  }
  return clamp(pressure * 0.5, 0, 1);
}
