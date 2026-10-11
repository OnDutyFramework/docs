import type { TileMap } from './tilemap';
import { FLOOR, WALL, type ObjectKind, type PlacedObject, type Room, type RoomKind } from './types';

export interface RoomMeta {
  kind: RoomKind;
  label: string;
  /** Short line shown in the inspector. */
  blurb: string;
}

export const ROOM_META: Record<RoomKind, RoomMeta> = {
  unassigned: { kind: 'unassigned', label: 'Unassigned room', blurb: 'Enclosed, but nothing in it yet.' },
  cell: { kind: 'cell', label: 'Cell', blurb: 'Sleeping quarters for one or two inmates.' },
  canteen: { kind: 'canteen', label: 'Canteen', blurb: 'Meals are served here during eat blocks.' },
  yard: { kind: 'yard', label: 'Yard', blurb: 'Outdoor exercise. Restores recreation.' },
  common: { kind: 'common', label: 'Common room', blurb: 'Association space for free time.' },
  bathroom: { kind: 'bathroom', label: 'Bathroom', blurb: 'Shared hygiene facilities.' },
  holding: { kind: 'holding', label: 'Dormitory', blurb: 'Three or more beds — crowded, cheap, tense.' },
  corridor: { kind: 'corridor', label: 'Walkway', blurb: 'Circulation space. Not a room.' },
};

/**
 * Rebuilds every room from scratch by flood-filling floored tiles, using walls
 * and doors as barriers. Cheap enough (a few thousand tiles) to run on any
 * terrain edit rather than maintaining incremental state.
 */
export function detectRooms(map: TileMap, objects: Map<number, PlacedObject>): Room[] {
  const { width, height } = map;
  const total = width * height;
  map.rooms.fill(-1);

  const rooms: Room[] = [];
  const queue = new Int32Array(total);

  for (let start = 0; start < total; start++) {
    if (map.rooms[start] !== -1) continue;
    if (map.floors[start] === FLOOR.None) continue;
    if (map.walls[start] !== 0) continue;

    const id = rooms.length;
    const tiles: number[] = [];
    let enclosed = true;
    let sumX = 0;
    let sumY = 0;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const boundaryDoors = new Set<number>();
    const floorCounts = new Map<number, number>();

    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    map.rooms[start] = id;

    while (head < tail) {
      const current = queue[head++];
      tiles.push(current);
      const cx = current % width;
      const cy = (current - cx) / width;
      sumX += cx;
      sumY += cy;
      if (cx < minX) minX = cx;
      if (cx > maxX) maxX = cx;
      if (cy < minY) minY = cy;
      if (cy > maxY) maxY = cy;
      const floor = map.floors[current];
      floorCounts.set(floor, (floorCounts.get(floor) ?? 0) + 1);

      for (let d = 0; d < 4; d++) {
        const nx = cx + (d === 0 ? 1 : d === 1 ? -1 : 0);
        const ny = cy + (d === 2 ? 1 : d === 3 ? -1 : 0);
        if (!map.inBounds(nx, ny)) {
          enclosed = false;
          continue;
        }
        const n = ny * width + nx;
        if (map.walls[n] !== 0) {
          // Wall or door — a legitimate boundary. Doors hint at circulation.
          if (map.walls[n] === WALL.Door) boundaryDoors.add(n);
          continue;
        }
        if (map.floors[n] === FLOOR.None) {
          enclosed = false; // leaks out onto bare ground
          continue;
        }
        if (map.rooms[n] !== -1) continue;
        map.rooms[n] = id;
        queue[tail++] = n;
      }
    }

    const objectIds: number[] = [];
    for (const index of tiles) {
      const objectId = map.objects[index];
      if (objectId !== -1) objectIds.push(objectId);
    }

    let dominantFloor = FLOOR.Concrete as number;
    let best = -1;
    for (const [floor, count] of floorCounts) {
      if (count > best) {
        best = count;
        dominantFloor = floor;
      }
    }

    const centre = pickCentre(map, tiles, sumX / tiles.length, sumY / tiles.length);
    const kind = classify(objectIds, objects, dominantFloor, enclosed, {
      doors: boundaryDoors.size,
      extentX: maxX - minX + 1,
      extentY: maxY - minY + 1,
      area: tiles.length,
    });

    const room: Room = {
      id,
      kind,
      tiles,
      centre,
      area: tiles.length,
      enclosed,
      objectIds,
      assignedPrisoners: [],
    };
    rooms.push(room);

    for (const objectId of objectIds) {
      const object = objects.get(objectId);
      if (object) object.roomId = id;
    }
  }

  // Objects buried inside walls or on bare ground belong to no room.
  for (const object of objects.values()) {
    if (map.rooms[map.index(object.x, object.y)] === -1) object.roomId = -1;
  }

  return rooms;
}

function pickCentre(map: TileMap, tiles: number[], avgX: number, avgY: number): { x: number; y: number } {
  let bestTile = tiles[0];
  let bestDist = Infinity;
  for (const index of tiles) {
    const x = map.tileX(index);
    const y = map.tileY(index);
    const d = (x - avgX) ** 2 + (y - avgY) ** 2;
    if (d < bestDist) {
      bestDist = d;
      bestTile = index;
    }
  }
  return { x: map.tileX(bestTile) + 0.5, y: map.tileY(bestTile) + 0.5 };
}

/**
 * Room type is inferred from contents, not painted by the player — the same
 * rule Prison Architect uses, minus the manual zoning step.
 */
interface Shape {
  doors: number;
  extentX: number;
  extentY: number;
  area: number;
}

function classify(
  objectIds: readonly number[],
  objects: Map<number, PlacedObject>,
  dominantFloor: number,
  enclosed: boolean,
  shape: Shape,
): RoomKind {
  const counts: Partial<Record<ObjectKind, number>> = {};
  for (const id of objectIds) {
    const object = objects.get(id);
    if (!object) continue;
    counts[object.kind] = (counts[object.kind] ?? 0) + 1;
  }

  const beds = counts.bed ?? 0;
  const tables = counts.table ?? 0;
  const showers = counts.shower ?? 0;
  const social = (counts.tv ?? 0) + (counts.bench ?? 0);

  if (dominantFloor === FLOOR.Yard) return 'yard';
  if (beds >= 3) return 'holding';
  if (beds >= 1) return 'cell';
  if (tables >= 1) return 'canteen';
  if (showers >= 1) return 'bathroom';
  if (social >= 1) return 'common';

  // An empty space that several doors open onto, or one that is long and thin,
  // is circulation rather than a room awaiting furniture.
  const longest = Math.max(shape.extentX, shape.extentY);
  const shortest = Math.max(1, Math.min(shape.extentX, shape.extentY));
  if (shape.doors >= 3) return 'corridor';
  if (longest / shortest >= 3 && shape.area >= 12) return 'corridor';
  return enclosed ? 'unassigned' : 'corridor';
}
