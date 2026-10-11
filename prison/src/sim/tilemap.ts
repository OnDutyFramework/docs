import { FLOOR, WALL, type FloorId, type WallId } from './types';

/**
 * Flat typed-array tile storage. Everything downstream (rooms, pathfinding,
 * rendering) reads from here, so this is the single source of truth for terrain.
 */
export class TileMap {
  readonly width: number;
  readonly height: number;
  readonly floors: Uint8Array;
  readonly walls: Uint8Array;
  /** Object id occupying a tile, or -1. */
  readonly objects: Int32Array;
  /** Room id per tile, or -1. */
  readonly rooms: Int32Array;

  /** Bumped whenever terrain changes so caches (paths, rooms) can invalidate. */
  version = 0;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    const n = width * height;
    this.floors = new Uint8Array(n);
    this.walls = new Uint8Array(n);
    this.objects = new Int32Array(n).fill(-1);
    this.rooms = new Int32Array(n).fill(-1);
  }

  get tileCount(): number {
    return this.width * this.height;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  index(x: number, y: number): number {
    return y * this.width + x;
  }

  tileX(index: number): number {
    return index % this.width;
  }

  tileY(index: number): number {
    return Math.floor(index / this.width);
  }

  floorAt(x: number, y: number): FloorId {
    if (!this.inBounds(x, y)) return FLOOR.None;
    return this.floors[this.index(x, y)] as FloorId;
  }

  wallAt(x: number, y: number): WallId {
    if (!this.inBounds(x, y)) return WALL.Solid;
    return this.walls[this.index(x, y)] as WallId;
  }

  objectAt(x: number, y: number): number {
    if (!this.inBounds(x, y)) return -1;
    return this.objects[this.index(x, y)];
  }

  roomAt(x: number, y: number): number {
    if (!this.inBounds(x, y)) return -1;
    return this.rooms[this.index(x, y)];
  }

  /** Solid walls block movement; doors do not. Objects are walkable-adjacent only. */
  isWalkable(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    const i = this.index(x, y);
    if (this.walls[i] === WALL.Solid) return false;
    if (this.objects[i] !== -1) return false;
    return true;
  }

  /** Walls and doors both separate rooms. */
  isRoomBarrier(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return true;
    return this.walls[this.index(x, y)] !== WALL.None;
  }

  markDirty(): void {
    this.version++;
  }
}
