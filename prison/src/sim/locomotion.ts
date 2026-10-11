import { walkableNeighbours } from './pathfinding';
import type { Agent } from './types';
import type { World } from './world';

/** How close an agent must be to a waypoint centre before advancing. */
const ARRIVE_EPSILON = 0.06;

/**
 * Requests a path to any of `goals`. Returns false when nothing is reachable,
 * which callers treat as "pick a different target".
 */
export function goTo(world: World, agent: Agent, goals: readonly number[]): boolean {
  if (goals.length === 0) return false;
  const start = world.tileIndexOf(agent);
  const path = world.pathfinder.find(start, goals);
  if (!path) return false;
  agent.path = path;
  agent.pathCursor = 0;
  agent.targetTile = path[path.length - 1];
  return true;
}

/** Walkable tiles from which an object can be reached. */
export function approachTiles(world: World, x: number, y: number): number[] {
  const tiles = walkableNeighbours(world.map, x, y);
  // An object sitting on a walkable tile (never happens today, but harmless)
  // can also be approached by standing on it.
  if (world.map.isWalkable(x, y)) tiles.push(world.map.index(x, y));
  return tiles;
}

/**
 * Advances along the current path. Returns 'arrived' on the final waypoint,
 * 'blocked' when terrain changed under the agent, 'moving' otherwise.
 */
export function followPath(world: World, agent: Agent, simSeconds: number): 'moving' | 'arrived' | 'blocked' {
  const path = agent.path;
  if (!path || path.length === 0) return 'arrived';

  let budget = agent.speed * simSeconds;
  while (budget > 0) {
    if (agent.pathCursor >= path.length) {
      agent.path = null;
      return 'arrived';
    }
    const tile = path[agent.pathCursor];
    const tx = world.map.tileX(tile) + 0.5;
    const ty = world.map.tileY(tile) + 0.5;

    if (!world.map.isWalkable(world.map.tileX(tile), world.map.tileY(tile))) {
      agent.path = null;
      return 'blocked';
    }

    const dx = tx - agent.x;
    const dy = ty - agent.y;
    const remaining = Math.hypot(dx, dy);

    if (remaining <= ARRIVE_EPSILON || remaining <= budget) {
      agent.x = tx;
      agent.y = ty;
      budget -= remaining;
      agent.pathCursor++;
      if (agent.pathCursor >= path.length) {
        agent.path = null;
        return 'arrived';
      }
    } else {
      agent.x += (dx / remaining) * budget;
      agent.y += (dy / remaining) * budget;
      budget = 0;
    }
  }
  return 'moving';
}

/** Picks a random reachable tile inside a room, for loitering and patrols. */
export function randomTileIn(world: World, roomId: number): number | null {
  const room = world.rooms[roomId];
  if (!room) return null;
  for (let attempt = 0; attempt < 12; attempt++) {
    const tile = world.rng.pick(room.tiles);
    if (tile === undefined) return null;
    if (world.map.isWalkable(world.map.tileX(tile), world.map.tileY(tile))) return tile;
  }
  return null;
}
