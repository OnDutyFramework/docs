import type { Agent, PlacedObject } from './types';
import type { World } from './world';

/** The bed reserved for this inmate, if any. */
export function bedOf(world: World, agent: Agent): PlacedObject | null {
  for (const object of world.objects.values()) {
    if (object.kind === 'bed' && object.ownerId === agent.id) return object;
  }
  return null;
}

/**
 * Assigns a bed to every unhoused inmate, preferring proper cells over
 * dormitories. Runs whenever rooms are rebuilt or a prisoner arrives, so
 * building a new cell immediately rehouses whoever was sleeping rough.
 */
export function assignHousing(world: World): number {
  const owned = new Set<number>();
  const free: PlacedObject[] = [];

  for (const object of world.objects.values()) {
    if (object.kind !== 'bed') continue;
    if (object.ownerId !== null && world.agents.has(object.ownerId)) {
      owned.add(object.ownerId);
    } else {
      object.ownerId = null;
      free.push(object);
    }
  }

  // Cells first, then dormitories, then stray beds in unassigned rooms.
  const rank = (object: PlacedObject): number => {
    const room = world.rooms[object.roomId];
    if (!room) return 3;
    if (room.kind === 'cell') return 0;
    if (room.kind === 'holding') return 1;
    return 2;
  };
  free.sort((a, b) => rank(a) - rank(b));

  let housed = 0;
  for (const agent of world.prisoners()) {
    if (owned.has(agent.id)) {
      const bed = bedOf(world, agent);
      agent.homeRoomId = bed ? bed.roomId : null;
      continue;
    }
    const bed = free.pop();
    if (!bed) {
      agent.homeRoomId = null;
      continue;
    }
    bed.ownerId = agent.id;
    agent.homeRoomId = bed.roomId;
    const room = world.rooms[bed.roomId];
    if (room && !room.assignedPrisoners.includes(agent.id)) room.assignedPrisoners.push(agent.id);
    housed++;
    world.remember(agent, `Assigned a bed in ${room ? room.kind : 'an unassigned room'}.`, 'good');
  }
  return housed;
}

/** Inmates with nowhere to sleep — the clearest overcrowding signal. */
export function unhousedCount(world: World): number {
  let count = 0;
  for (const agent of world.prisoners()) if (agent.homeRoomId === null) count++;
  return count;
}
