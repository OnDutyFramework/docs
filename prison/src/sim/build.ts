import { OBJECTS, TERRAIN_COST } from './catalog';
import type { World } from './world';
import { FLOOR, WALL, type FloorId, type ObjectKind } from './types';

export type ToolId =
  | 'select'
  | 'wall'
  | 'door'
  | 'floor-concrete'
  | 'floor-polished'
  | 'floor-yard'
  | 'bed'
  | 'toilet'
  | 'table'
  | 'bench'
  | 'shower'
  | 'tv'
  | 'cell'
  | 'demolish';

export type DragMode = 'none' | 'rect-fill' | 'rect-outline' | 'rect-prefab';

export interface ToolDef {
  id: ToolId;
  label: string;
  group: 'cursor' | 'structure' | 'surface' | 'furniture' | 'template' | 'destructive';
  hotkey: string;
  dragMode: DragMode;
  /** Price per tile, or the template's typical total. */
  cost: number;
  hint: string;
}

export const TOOLS: readonly ToolDef[] = [
  {
    id: 'select',
    label: 'Inspect',
    group: 'cursor',
    hotkey: '1',
    dragMode: 'none',
    cost: 0,
    hint: 'Click an inmate, a guard or a room to open their record.',
  },
  {
    id: 'cell',
    label: 'Cell template',
    group: 'template',
    hotkey: '2',
    dragMode: 'rect-prefab',
    cost: 0,
    hint: 'Drag a 4\u00d74 or larger box. Places walls, floor, a door, a bed and a toilet in one stroke.',
  },
  {
    id: 'wall',
    label: 'Wall',
    group: 'structure',
    hotkey: '3',
    dragMode: 'rect-outline',
    cost: TERRAIN_COST.wall,
    hint: 'Drag a box \u2014 walls follow the perimeter, so one stroke encloses a room.',
  },
  {
    id: 'door',
    label: 'Door',
    group: 'structure',
    hotkey: '4',
    dragMode: 'rect-fill',
    cost: TERRAIN_COST.door,
    hint: 'Doors let people through but still separate rooms.',
  },
  {
    id: 'floor-concrete',
    label: 'Concrete',
    group: 'surface',
    hotkey: '5',
    dragMode: 'rect-fill',
    cost: TERRAIN_COST.floorConcrete,
    hint: 'An enclosed area needs a floor before it counts as a room.',
  },
  {
    id: 'floor-polished',
    label: 'Tiling',
    group: 'surface',
    hotkey: '6',
    dragMode: 'rect-fill',
    cost: TERRAIN_COST.floorPolished,
    hint: 'Hard-wearing surface for canteens and bathrooms.',
  },
  {
    id: 'floor-yard',
    label: 'Yard',
    group: 'surface',
    hotkey: '7',
    dragMode: 'rect-fill',
    cost: TERRAIN_COST.floorYard,
    hint: 'Open ground. Counts as a yard without needing walls.',
  },
  {
    id: 'bed',
    label: 'Bed',
    group: 'furniture',
    hotkey: 'Q',
    dragMode: 'rect-fill',
    cost: OBJECTS.bed.cost,
    hint: OBJECTS.bed.description,
  },
  {
    id: 'toilet',
    label: 'Toilet',
    group: 'furniture',
    hotkey: 'W',
    dragMode: 'rect-fill',
    cost: OBJECTS.toilet.cost,
    hint: OBJECTS.toilet.description,
  },
  {
    id: 'table',
    label: 'Table',
    group: 'furniture',
    hotkey: 'E',
    dragMode: 'rect-fill',
    cost: OBJECTS.table.cost,
    hint: OBJECTS.table.description,
  },
  {
    id: 'bench',
    label: 'Bench',
    group: 'furniture',
    hotkey: 'R',
    dragMode: 'rect-fill',
    cost: OBJECTS.bench.cost,
    hint: OBJECTS.bench.description,
  },
  {
    id: 'shower',
    label: 'Shower',
    group: 'furniture',
    hotkey: 'T',
    dragMode: 'rect-fill',
    cost: OBJECTS.shower.cost,
    hint: OBJECTS.shower.description,
  },
  {
    id: 'tv',
    label: 'TV',
    group: 'furniture',
    hotkey: 'Y',
    dragMode: 'rect-fill',
    cost: OBJECTS.tv.cost,
    hint: OBJECTS.tv.description,
  },
  {
    id: 'demolish',
    label: 'Demolish',
    group: 'destructive',
    hotkey: 'X',
    dragMode: 'rect-fill',
    cost: 0,
    hint: 'Clears walls, floors and furniture. Refunds 30%.',
  },
];

export const TOOL_BY_ID = new Map<ToolId, ToolDef>(TOOLS.map((tool) => [tool.id, tool]));

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function normaliseRect(ax: number, ay: number, bx: number, by: number): Rect {
  return {
    x0: Math.min(ax, bx),
    y0: Math.min(ay, by),
    x1: Math.max(ax, bx),
    y1: Math.max(ay, by),
  };
}

export type BuildOp =
  | { type: 'wall'; index: number }
  | { type: 'door'; index: number }
  | { type: 'floor'; index: number; floor: FloorId }
  | { type: 'object'; index: number; kind: ObjectKind }
  | { type: 'demolish'; index: number };

export interface BuildPlan {
  ops: BuildOp[];
  cost: number;
  refund: number;
  /** Tiles the player targeted that cannot take this tool. */
  blocked: number[];
  note: string;
}

const EMPTY_PLAN: BuildPlan = { ops: [], cost: 0, refund: 0, blocked: [], note: '' };

/**
 * Works out exactly what a drag would do without mutating anything, so the
 * renderer can draw a truthful ghost and the toolbar can quote a price.
 */
export function planBuild(world: World, tool: ToolId, rect: Rect): BuildPlan {
  const def = TOOL_BY_ID.get(tool);
  if (!def || tool === 'select') return EMPTY_PLAN;

  if (tool === 'cell') return planCell(world, rect);

  const ops: BuildOp[] = [];
  const blocked: number[] = [];
  let cost = 0;
  let refund = 0;
  let note = '';

  const { map } = world;
  const tiles = def.dragMode === 'rect-outline' ? perimeterTiles(world, rect) : fillTiles(world, rect);

  for (const index of tiles) {
    const x = map.tileX(index);
    const y = map.tileY(index);

    switch (tool) {
      case 'wall': {
        if (map.walls[index] === WALL.Solid) break;
        ops.push({ type: 'wall', index });
        cost += TERRAIN_COST.wall;
        if (map.objects[index] !== -1) refund += refundFor(world, index);
        break;
      }
      case 'door': {
        if (map.walls[index] === WALL.Door) break;
        ops.push({ type: 'door', index });
        cost += TERRAIN_COST.door;
        if (map.objects[index] !== -1) refund += refundFor(world, index);
        break;
      }
      case 'floor-concrete':
      case 'floor-polished':
      case 'floor-yard': {
        const floor =
          tool === 'floor-concrete' ? FLOOR.Concrete : tool === 'floor-polished' ? FLOOR.Polished : FLOOR.Yard;
        if (map.floors[index] === floor) break;
        ops.push({ type: 'floor', index, floor });
        cost += def.cost;
        break;
      }
      case 'demolish': {
        if (map.floors[index] === FLOOR.None && map.walls[index] === WALL.None && map.objects[index] === -1) break;
        ops.push({ type: 'demolish', index });
        refund += refundFor(world, index);
        break;
      }
      default: {
        const kind = tool as ObjectKind;
        if (!OBJECTS[kind]) break;
        if (!canPlaceObject(world, x, y)) {
          blocked.push(index);
          break;
        }
        ops.push({ type: 'object', index, kind });
        cost += OBJECTS[kind].cost;
        break;
      }
    }
  }

  if (blocked.length > 0 && ops.length === 0) {
    note = 'Needs a floor, and a tile free of walls and furniture.';
  }

  return { ops, cost, refund, blocked, note };
}

function canPlaceObject(world: World, x: number, y: number): boolean {
  const { map } = world;
  if (!map.inBounds(x, y)) return false;
  const index = map.index(x, y);
  return map.floors[index] !== FLOOR.None && map.walls[index] === WALL.None && map.objects[index] === -1;
}

function refundFor(world: World, index: number): number {
  const { map } = world;
  let value = 0;
  if (map.walls[index] === WALL.Solid) value += TERRAIN_COST.wall;
  if (map.walls[index] === WALL.Door) value += TERRAIN_COST.door;
  if (map.floors[index] === FLOOR.Concrete) value += TERRAIN_COST.floorConcrete;
  if (map.floors[index] === FLOOR.Polished) value += TERRAIN_COST.floorPolished;
  if (map.floors[index] === FLOOR.Yard) value += TERRAIN_COST.floorYard;
  const objectId = map.objects[index];
  if (objectId !== -1) {
    const object = world.objects.get(objectId);
    if (object) value += OBJECTS[object.kind].cost;
  }
  return Math.round(value * TERRAIN_COST.demolishRefundRate);
}

/**
 * The one-stroke cell: perimeter walls, concrete inside, a door facing the
 * nearest existing floor, plus a bed and a toilet. This is the template idea
 * from the design doc — structure, surface and furniture in a single gesture.
 */
function planCell(world: World, rect: Rect): BuildPlan {
  const { map } = world;
  const w = rect.x1 - rect.x0 + 1;
  const h = rect.y1 - rect.y0 + 1;
  if (w < 4 || h < 4) {
    return { ops: [], cost: 0, refund: 0, blocked: fillTiles(world, rect), note: 'Cells need to be at least 4\u00d74.' };
  }

  const ops: BuildOp[] = [];
  let cost = 0;
  let refund = 0;

  for (const index of perimeterTiles(world, rect)) {
    if (map.walls[index] !== WALL.Solid) {
      ops.push({ type: 'wall', index });
      cost += TERRAIN_COST.wall;
      if (map.objects[index] !== -1) refund += refundFor(world, index);
    }
  }

  const interior: number[] = [];
  for (let y = rect.y0 + 1; y <= rect.y1 - 1; y++) {
    for (let x = rect.x0 + 1; x <= rect.x1 - 1; x++) {
      if (!map.inBounds(x, y)) continue;
      const index = map.index(x, y);
      interior.push(index);
      if (map.floors[index] !== FLOOR.Concrete) {
        ops.push({ type: 'floor', index, floor: FLOOR.Concrete });
        cost += TERRAIN_COST.floorConcrete;
      }
      if (map.walls[index] !== WALL.None) {
        ops.push({ type: 'demolish', index });
        refund += refundFor(world, index);
      }
    }
  }

  const doorIndex = chooseDoorTile(world, rect);
  if (doorIndex !== null) {
    ops.push({ type: 'door', index: doorIndex });
    cost += TERRAIN_COST.door;
  }

  const bedTile = interior[0];
  const toiletTile = interior.length > 1 ? interior[w - 3 >= 1 ? w - 3 : interior.length - 1] : undefined;
  if (bedTile !== undefined && map.objects[bedTile] === -1) {
    ops.push({ type: 'object', index: bedTile, kind: 'bed' });
    cost += OBJECTS.bed.cost;
  }
  if (toiletTile !== undefined && toiletTile !== bedTile && map.objects[toiletTile] === -1) {
    ops.push({ type: 'object', index: toiletTile, kind: 'toilet' });
    cost += OBJECTS.toilet.cost;
  }

  return { ops, cost, refund, blocked: [], note: '' };
}

/** Prefers an edge tile whose outward neighbour is already floored. */
function chooseDoorTile(world: World, rect: Rect): number | null {
  const { map } = world;
  const candidates: Array<{ index: number; score: number }> = [];
  const push = (x: number, y: number, ox: number, oy: number) => {
    if (!map.inBounds(x, y)) return;
    const outside = map.inBounds(x + ox, y + oy) ? map.index(x + ox, y + oy) : -1;
    let score = 0;
    if (outside !== -1 && map.floors[outside] !== FLOOR.None) score += 10;
    if (outside !== -1 && map.walls[outside] === WALL.None) score += 5;
    candidates.push({ index: map.index(x, y), score });
  };

  const midX = Math.floor((rect.x0 + rect.x1) / 2);
  const midY = Math.floor((rect.y0 + rect.y1) / 2);
  push(midX, rect.y1, 0, 1);
  push(midX, rect.y0, 0, -1);
  push(rect.x0, midY, -1, 0);
  push(rect.x1, midY, 1, 0);

  candidates.sort((a, b) => b.score - a.score);
  return candidates.length > 0 ? candidates[0].index : null;
}

function fillTiles(world: World, rect: Rect): number[] {
  const out: number[] = [];
  for (let y = rect.y0; y <= rect.y1; y++) {
    for (let x = rect.x0; x <= rect.x1; x++) {
      if (world.map.inBounds(x, y)) out.push(world.map.index(x, y));
    }
  }
  return out;
}

function perimeterTiles(world: World, rect: Rect): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  const add = (x: number, y: number) => {
    if (!world.map.inBounds(x, y)) return;
    const index = world.map.index(x, y);
    if (seen.has(index)) return;
    seen.add(index);
    out.push(index);
  };
  for (let x = rect.x0; x <= rect.x1; x++) {
    add(x, rect.y0);
    add(x, rect.y1);
  }
  for (let y = rect.y0; y <= rect.y1; y++) {
    add(rect.x0, y);
    add(rect.x1, y);
  }
  return out;
}

export interface CommitResult {
  ok: boolean;
  message: string;
  spent: number;
}

/** Applies a plan, charging the economy. All-or-nothing on affordability. */
export function commitBuild(world: World, plan: BuildPlan, label: string): CommitResult {
  if (plan.ops.length === 0) {
    return { ok: false, message: plan.note, spent: 0 };
  }
  const net = plan.cost - plan.refund;
  if (net > 0 && !world.economy.canAfford(net)) {
    return { ok: false, message: `Not enough funds \u2014 needs $${net.toLocaleString()}`, spent: 0 };
  }

  const { map } = world;
  for (const op of plan.ops) {
    const x = map.tileX(op.index);
    const y = map.tileY(op.index);
    switch (op.type) {
      case 'wall':
        clearObject(world, op.index);
        map.walls[op.index] = WALL.Solid;
        break;
      case 'door':
        clearObject(world, op.index);
        map.walls[op.index] = WALL.Door;
        if (map.floors[op.index] === FLOOR.None) map.floors[op.index] = FLOOR.Concrete;
        break;
      case 'floor':
        map.floors[op.index] = op.floor;
        break;
      case 'object':
        world.addObject(op.kind, x, y);
        break;
      case 'demolish':
        clearObject(world, op.index);
        map.walls[op.index] = WALL.None;
        map.floors[op.index] = FLOOR.None;
        break;
    }
  }

  if (plan.refund > 0) world.economy.earn(plan.refund, 'Demolition salvage', world.clock.day);
  if (plan.cost > 0) world.economy.spend(plan.cost, label, world.clock.day);

  world.markRoomsDirty();
  world.rebuildRooms();
  world.recomputeCapacity();
  world.bus.emit('economy:changed', { money: world.economy.money });

  return { ok: true, message: '', spent: net };
}

function clearObject(world: World, index: number): void {
  const objectId = world.map.objects[index];
  if (objectId !== -1) world.removeObject(objectId);
}
