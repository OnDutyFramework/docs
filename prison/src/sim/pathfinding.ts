import type { TileMap } from './tilemap';
import { WALL } from './types';

/** Binary min-heap keyed by f-score. Allocated once per Pathfinder. */
class MinHeap {
  private items: number[] = [];
  private keys: Float64Array;

  constructor(capacity: number) {
    this.keys = new Float64Array(capacity);
  }

  clear(): void {
    this.items.length = 0;
  }

  get size(): number {
    return this.items.length;
  }

  push(node: number, key: number): void {
    this.keys[node] = key;
    this.items.push(node);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[this.items[parent]] <= this.keys[this.items[i]]) break;
      const tmp = this.items[parent];
      this.items[parent] = this.items[i];
      this.items[i] = tmp;
      i = parent;
    }
  }

  pop(): number {
    const top = this.items[0];
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let smallest = i;
        if (l < this.items.length && this.keys[this.items[l]] < this.keys[this.items[smallest]]) smallest = l;
        if (r < this.items.length && this.keys[this.items[r]] < this.keys[this.items[smallest]]) smallest = r;
        if (smallest === i) break;
        const tmp = this.items[smallest];
        this.items[smallest] = this.items[i];
        this.items[i] = tmp;
        i = smallest;
      }
    }
    return top;
  }
}

const SQRT2 = Math.SQRT2;

export interface PathStats {
  requests: number;
  failures: number;
  nodesVisited: number;
}

/**
 * A* over the tile grid, 8-directional with no corner cutting through walls.
 * Scratch buffers are reused across queries, so a single Pathfinder instance
 * is shared by every agent and must not be used re-entrantly.
 */
export class Pathfinder {
  private map: TileMap;
  private gScore: Float64Array;
  private cameFrom: Int32Array;
  private state: Uint8Array; // 0 unseen, 1 open, 2 closed
  private stamp: Int32Array;
  private generation = 0;
  private heap: MinHeap;

  readonly stats: PathStats = { requests: 0, failures: 0, nodesVisited: 0 };

  constructor(map: TileMap) {
    this.map = map;
    const n = map.tileCount;
    this.gScore = new Float64Array(n);
    this.cameFrom = new Int32Array(n);
    this.state = new Uint8Array(n);
    this.stamp = new Int32Array(n).fill(-1);
    this.heap = new MinHeap(n);
  }

  /** Doors are passable but slightly discouraged, so agents prefer open floor. */
  private tileCost(index: number): number {
    return this.map.walls[index] === WALL.Door ? 1.45 : 1;
  }

  private passable(x: number, y: number): boolean {
    return this.map.isWalkable(x, y);
  }

  /**
   * Finds a tile-index path from start to goal, inclusive of both ends.
   * Returns null when unreachable. `goalTiles` may hold several acceptable
   * destinations (e.g. every tile adjacent to a bed).
   */
  find(startIndex: number, goalTiles: readonly number[]): number[] | null {
    this.stats.requests++;
    if (goalTiles.length === 0) {
      this.stats.failures++;
      return null;
    }

    const { width } = this.map;
    const goalSet = new Set(goalTiles);
    if (goalSet.has(startIndex)) return [startIndex];

    const gx = this.map.tileX(goalTiles[0]);
    const gy = this.map.tileY(goalTiles[0]);

    this.generation++;
    const gen = this.generation;
    this.heap.clear();

    this.gScore[startIndex] = 0;
    this.cameFrom[startIndex] = -1;
    this.state[startIndex] = 1;
    this.stamp[startIndex] = gen;
    this.heap.push(startIndex, this.heuristic(startIndex, gx, gy));

    let visited = 0;
    while (this.heap.size > 0) {
      const current = this.heap.pop();
      if (this.stamp[current] === gen && this.state[current] === 2) continue;
      this.state[current] = 2;
      visited++;

      if (goalSet.has(current)) {
        this.stats.nodesVisited += visited;
        return this.reconstruct(current, gen);
      }

      const cx = current % width;
      const cy = (current - cx) / width;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (!this.passable(nx, ny)) continue;
          // No squeezing diagonally between two blocked tiles.
          if (dx !== 0 && dy !== 0) {
            if (!this.passable(cx + dx, cy) || !this.passable(cx, cy + dy)) continue;
          }
          const neighbour = ny * width + nx;
          if (this.stamp[neighbour] === gen && this.state[neighbour] === 2) continue;

          const step = (dx !== 0 && dy !== 0 ? SQRT2 : 1) * this.tileCost(neighbour);
          const tentative = this.gScore[current] + step;
          const seen = this.stamp[neighbour] === gen;
          if (seen && tentative >= this.gScore[neighbour]) continue;

          this.stamp[neighbour] = gen;
          this.state[neighbour] = 1;
          this.gScore[neighbour] = tentative;
          this.cameFrom[neighbour] = current;
          this.heap.push(neighbour, tentative + this.heuristic(neighbour, gx, gy));
        }
      }
    }

    this.stats.nodesVisited += visited;
    this.stats.failures++;
    return null;
  }

  private heuristic(index: number, gx: number, gy: number): number {
    const x = this.map.tileX(index);
    const y = this.map.tileY(index);
    const dx = Math.abs(x - gx);
    const dy = Math.abs(y - gy);
    // Octile distance — admissible for 8-way movement.
    return dx + dy + (SQRT2 - 2) * Math.min(dx, dy);
  }

  private reconstruct(goal: number, gen: number): number[] {
    const path: number[] = [];
    let node = goal;
    while (node !== -1) {
      path.push(node);
      if (this.stamp[node] !== gen) break;
      node = this.cameFrom[node];
    }
    path.reverse();
    return path;
  }
}

/** The up-to-eight walkable tiles touching (x, y). */
export function walkableNeighbours(map: TileMap, x: number, y: number): number[] {
  const out: number[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (dx !== 0 && dy !== 0) continue; // cardinal only — agents face the object
      const nx = x + dx;
      const ny = y + dy;
      if (map.isWalkable(nx, ny)) out.push(map.index(nx, ny));
    }
  }
  return out;
}
