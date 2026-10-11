import { OBJECTS } from './catalog';
import { SECONDS_PER_HOUR } from './clock';
import { bedOf } from './housing';
import { approachTiles, followPath, goTo, randomTileIn } from './locomotion';
import { CRITICAL, NEED_LABELS, STRAINED, criticalNeeds, restoreNeed } from './needs';
import type { ActivityKind, Agent, NeedKind, ObjectKind, PlacedObject, RegimeBlock } from './types';
import type { World } from './world';

type IntentKind = 'sleep' | 'eat' | 'hygiene' | 'recreation' | 'yard' | 'loiter';

interface Intent {
  kind: IntentKind;
  reason: string;
  urgent: boolean;
}

/** Need priority when several are critical at once. */
const NEED_PRIORITY: readonly NeedKind[] = ['hunger', 'sleep', 'hygiene', 'recreation'];

const INTENT_FOR_NEED: Record<NeedKind, IntentKind> = {
  hunger: 'eat',
  sleep: 'sleep',
  hygiene: 'hygiene',
  recreation: 'recreation',
};

const ACTIVITY_FOR_OBJECT: Record<ObjectKind, ActivityKind> = {
  bed: 'sleeping',
  table: 'eating',
  toilet: 'washing',
  shower: 'washing',
  bench: 'relaxing',
  tv: 'relaxing',
};

/** Recreation gained per simulated hour of standing about in the yard. */
const YARD_RECREATION_RATE = 30;
/** Sleeping on the floor is much less restful than a bed. */
const ROUGH_SLEEP_FACTOR = 0.35;

export function updatePrisoner(world: World, agent: Agent, simSeconds: number, simHours: number): void {
  if (agent.repathCooldown > 0) agent.repathCooldown -= simSeconds;

  switch (agent.activity) {
    case 'walking':
      updateWalking(world, agent, simSeconds);
      break;
    case 'idle':
      if (agent.activityTimer > 0) {
        agent.activityTimer -= simSeconds;
        return;
      }
      decide(world, agent);
      break;
    default:
      updateStationary(world, agent, simSeconds, simHours);
      break;
  }
}

/** The need being served right now, if any, so decay can skip it. */
export function servedNeed(world: World, agent: Agent): { need: NeedKind; rate: number } | null {
  if (agent.activity === 'exercising') return { need: 'recreation', rate: YARD_RECREATION_RATE };
  if (agent.targetObjectId !== null) {
    const object = world.objects.get(agent.targetObjectId);
    if (object && object.userId === agent.id) {
      const def = OBJECTS[object.kind];
      if (def.satisfies && agent.activity !== 'walking') return { need: def.satisfies, rate: def.restoreRate };
    }
    return null;
  }
  if (agent.activity === 'sleeping') {
    return { need: 'sleep', rate: OBJECTS.bed.restoreRate * ROUGH_SLEEP_FACTOR };
  }
  return null;
}

function updateWalking(world: World, agent: Agent, simSeconds: number): void {
  const result = followPath(world, agent, simSeconds);
  if (result === 'moving') return;
  if (result === 'blocked') {
    releaseTarget(world, agent);
    stall(agent, 0.15, 'Route blocked \u2014 rerouting');
    return;
  }
  if (agent.targetObjectId !== null) {
    beginUse(world, agent);
  } else {
    // Arrived at a plain destination: yard tile or a loiter spot.
    const room = world.roomOf(agent);
    if (room && room.kind === 'yard' && world.clock.block() === 'yard') {
      agent.activity = 'exercising';
      agent.activityTimer = 1.2 * SECONDS_PER_HOUR;
      agent.decisionBlock = world.clock.block();
      agent.lastDecision = 'In the yard';
    } else {
      stall(agent, 0.3, agent.lastDecision);
    }
  }
}

function updateStationary(world: World, agent: Agent, simSeconds: number, simHours: number): void {
  const served = servedNeed(world, agent);
  if (served) restoreNeed(agent.needs, served.need, served.rate, simHours);

  agent.activityTimer -= simSeconds;
  const block = world.clock.block();

  let done = false;
  if (served && agent.needs[served.need] >= 97) done = true;
  if (agent.activityTimer <= 0) done = true;
  if (agent.decisionBlock !== block && (!served || agent.needs[served.need] > STRAINED)) done = true;
  // Lockup: once in bed for the night they stay there, rested or not.
  if (agent.activity === 'sleeping' && block === 'sleep' && agent.targetObjectId !== null) done = false;

  if (done) {
    releaseTarget(world, agent);
    stall(agent, 0.1, agent.lastDecision);
  }
}

function decide(world: World, agent: Agent): void {
  const intent = chooseIntent(world, agent);
  agent.decisionBlock = world.clock.block();

  if (resolveIntent(world, agent, intent)) {
    agent.lastDecision = intent.reason;
    return;
  }

  // Fall back to standing around rather than freezing; the failure is logged
  // on the inmate's record because unmet regime is the interesting signal.
  if (intent.urgent) {
    noteFrustration(world, agent, intent);
  }
  if (!loiter(world, agent)) {
    stall(agent, 0.5, `${intent.reason} \u2014 nowhere to go`);
  }
}

function chooseIntent(world: World, agent: Agent): Intent {
  const critical = criticalNeeds(agent.needs);
  if (critical.length > 0) {
    for (const need of NEED_PRIORITY) {
      if (!critical.includes(need)) continue;
      return {
        kind: INTENT_FOR_NEED[need],
        reason: `${NEED_LABELS[need]} is critical`,
        urgent: true,
      };
    }
  }

  const block: RegimeBlock = world.clock.block();
  switch (block) {
    case 'sleep':
    case 'lockup':
      return { kind: 'sleep', reason: 'Lights out \u2014 heading to cell', urgent: false };
    case 'eat':
      return agent.needs.hunger > 94
        ? { kind: 'loiter', reason: 'Not hungry', urgent: false }
        : { kind: 'eat', reason: 'Meal service', urgent: false };
    case 'yard':
      return { kind: 'yard', reason: 'Yard time', urgent: false };
    case 'free': {
      // Nobody goes back to bed in the afternoon; only a critical sleep need,
      // handled above, gets an inmate out of association and into a cell.
      const low = lowestNeedExcludingSleep(agent.needs);
      if (low.value < STRAINED) {
        return {
          kind: INTENT_FOR_NEED[low.kind],
          reason: `Free time \u2014 sorting out ${NEED_LABELS[low.kind].toLowerCase()}`,
          urgent: false,
        };
      }
      return { kind: 'recreation', reason: 'Association time', urgent: false };
    }
  }
}

function lowestNeedExcludingSleep(needs: Agent['needs']): { kind: NeedKind; value: number } {
  let kind: NeedKind = 'hunger';
  let value = Infinity;
  for (const candidate of NEED_PRIORITY) {
    if (candidate === 'sleep') continue;
    if (needs[candidate] < value) {
      value = needs[candidate];
      kind = candidate;
    }
  }
  return { kind, value };
}

function resolveIntent(world: World, agent: Agent, intent: Intent): boolean {
  switch (intent.kind) {
    case 'sleep': {
      const bed = bedOf(world, agent);
      if (bed && (bed.userId === null || bed.userId === agent.id)) {
        if (startUsing(world, agent, bed)) return true;
      }
      if (claimObject(world, agent, ['bed'])) return true;
      return sleepRough(world, agent);
    }
    case 'eat':
      return claimObject(world, agent, ['table']);
    case 'hygiene':
      return claimObject(world, agent, ['shower', 'toilet'], agent.homeRoomId);
    case 'recreation':
      if (claimObject(world, agent, ['tv', 'bench'])) return true;
      return goToYard(world, agent);
    case 'yard':
      if (goToYard(world, agent)) return true;
      return claimObject(world, agent, ['tv', 'bench']);
    case 'loiter':
      return loiter(world, agent);
  }
}

/** Reserves the nearest free, reachable object of any listed kind. */
function claimObject(
  world: World,
  agent: Agent,
  kinds: readonly ObjectKind[],
  preferRoomId: number | null = null,
): boolean {
  if (agent.repathCooldown > 0) return false;

  const candidates: Array<{ object: PlacedObject; score: number }> = [];
  for (const object of world.objects.values()) {
    if (!kinds.includes(object.kind)) continue;
    if (object.userId !== null && object.userId !== agent.id) continue;
    if (object.ownerId !== null && object.ownerId !== agent.id) continue;
    if (object.roomId === -1) continue;
    let score = Math.hypot(object.x + 0.5 - agent.x, object.y + 0.5 - agent.y);
    if (preferRoomId !== null && object.roomId === preferRoomId) score -= 40;
    // Honour the ordering of `kinds` as a preference (shower before toilet).
    score += kinds.indexOf(object.kind) * 6;
    candidates.push({ object, score });
  }
  if (candidates.length === 0) return false;

  candidates.sort((a, b) => a.score - b.score);
  for (const candidate of candidates.slice(0, 4)) {
    if (startUsing(world, agent, candidate.object)) return true;
  }
  agent.repathCooldown = 0.4 * SECONDS_PER_HOUR;
  return false;
}

/** Paths to an object and reserves it for the journey. */
function startUsing(world: World, agent: Agent, object: PlacedObject): boolean {
  const goals = approachTiles(world, object.x, object.y);
  if (goals.length === 0) return false;

  releaseTarget(world, agent);
  if (!goTo(world, agent, goals)) return false;

  object.userId = agent.id;
  agent.targetObjectId = object.id;
  agent.activity = 'walking';
  return true;
}

function beginUse(world: World, agent: Agent): void {
  const object = agent.targetObjectId === null ? null : world.objects.get(agent.targetObjectId);
  if (!object || object.userId !== agent.id) {
    releaseTarget(world, agent);
    stall(agent, 0.2, 'Space was taken');
    return;
  }

  const def = OBJECTS[object.kind];
  // Agents stand beside tables but lie in beds, so occupy the tile visually.
  if (!def.useFromAdjacent) {
    agent.x = object.x + 0.5;
    agent.y = object.y + 0.5;
  }
  agent.activity = ACTIVITY_FOR_OBJECT[object.kind];
  agent.activityTimer = def.defaultUseHours * SECONDS_PER_HOUR;
  agent.decisionBlock = world.clock.block();
  agent.lastDecision = describeUse(object.kind);
}

function describeUse(kind: ObjectKind): string {
  switch (kind) {
    case 'bed':
      return 'Asleep in own bed';
    case 'table':
      return 'Eating a meal';
    case 'toilet':
      return 'Using the toilet';
    case 'shower':
      return 'Showering';
    case 'bench':
      return 'Sitting on a bench';
    case 'tv':
      return 'Watching television';
  }
}

function releaseTarget(world: World, agent: Agent): void {
  if (agent.targetObjectId !== null) {
    const object = world.objects.get(agent.targetObjectId);
    if (object && object.userId === agent.id) {
      object.userId = null;
      // Step off the furniture back onto the approach tile.
      const approach = agent.targetTile;
      if (approach !== null && !OBJECTS[object.kind].useFromAdjacent) {
        agent.x = world.map.tileX(approach) + 0.5;
        agent.y = world.map.tileY(approach) + 0.5;
      }
    }
    agent.targetObjectId = null;
  }
  agent.path = null;
  agent.targetTile = null;
}

function sleepRough(world: World, agent: Agent): boolean {
  if (agent.needs.sleep > CRITICAL) return false;
  agent.activity = 'sleeping';
  agent.activityTimer = 2 * SECONDS_PER_HOUR;
  agent.decisionBlock = world.clock.block();
  agent.lastDecision = 'Sleeping on the floor \u2014 no bed';
  agent.unrest = Math.min(100, agent.unrest + 8);
  world.remember(agent, 'Slept on the floor. No bed was assigned.', 'bad');
  return true;
}

function goToYard(world: World, agent: Agent): boolean {
  if (agent.repathCooldown > 0) return false;
  const yards = world.rooms.filter((room) => room.kind === 'yard');
  if (yards.length === 0) return false;
  releaseTarget(world, agent);
  for (const yard of yards) {
    const tile = randomTileIn(world, yard.id);
    if (tile === null) continue;
    if (goTo(world, agent, [tile])) {
      agent.activity = 'walking';
      return true;
    }
  }
  agent.repathCooldown = 0.5 * SECONDS_PER_HOUR;
  return false;
}

function loiter(world: World, agent: Agent): boolean {
  if (agent.repathCooldown > 0) return false;
  releaseTarget(world, agent);
  const room = world.roomOf(agent);
  const options = room ? [room] : world.rooms.filter((candidate) => candidate.kind !== 'cell');
  for (const candidate of options.slice(0, 3)) {
    const tile = randomTileIn(world, candidate.id);
    if (tile === null) continue;
    if (goTo(world, agent, [tile])) {
      agent.activity = 'walking';
      agent.targetObjectId = null;
      return true;
    }
  }
  agent.repathCooldown = 0.3 * SECONDS_PER_HOUR;
  return false;
}

function stall(agent: Agent, hours: number, decision: string): void {
  agent.activity = 'idle';
  agent.activityTimer = hours * SECONDS_PER_HOUR;
  agent.lastDecision = decision;
}

function noteFrustration(world: World, agent: Agent, intent: Intent): void {
  agent.unrest = Math.min(100, agent.unrest + 4);
  switch (intent.kind) {
    case 'eat':
      world.remember(agent, 'Missed a meal \u2014 no canteen table free.', 'bad');
      break;
    case 'hygiene':
      world.remember(agent, 'Could not wash \u2014 no toilet or shower available.', 'warn');
      break;
    case 'recreation':
      world.remember(agent, 'Nothing to do. No yard, no association space.', 'warn');
      break;
    case 'sleep':
      world.remember(agent, 'Nowhere to sleep.', 'bad');
      break;
    default:
      break;
  }
}
