import { clamp01 } from '../core/math';
import type { BuildPlan, Rect } from '../sim/build';
import { ROOM_META } from '../sim/rooms';
import { FLOOR, WALL, type Agent, type ObjectKind, type PlacedObject, type Room } from '../sim/types';
import type { World } from '../sim/world';
import { Camera } from './camera';
import {
  C,
  FONT_UI,
  GUARD_UNIFORM,
  GUARD_UNIFORM_DARK,
  OBJECT_COLORS,
  PRISONER_SUIT,
  PRISONER_SUIT_DARK,
  ROOM_ACCENT,
  ROOM_TINT,
  SECURITY_COLORS,
  SKIN,
} from './palette';

export type Selection = { kind: 'agent'; id: number } | { kind: 'room'; id: number } | null;

export interface ViewState {
  hoverTile: number | null;
  selection: Selection;
  preview: { rect: Rect; plan: BuildPlan } | null;
  /** Draws every agent's current route, not just the selected one. */
  showRoutes: boolean;
  showRoomTints: boolean;
}

const LABEL_ZOOM = 17;
const NAME_ZOOM = 27;
const DETAIL_ZOOM = 14;

/**
 * Draws the world. Holds no simulation state of its own — given the same
 * World and ViewState it always produces the same frame.
 */
export class Renderer {
  readonly camera: Camera;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private width = 1;
  private height = 1;
  private vignette: CanvasGradient | null = null;
  /** Seconds of wall-clock time, for selection pulses. */
  private time = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private world: World,
  ) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
    this.camera = new Camera(world.map.width, world.map.height);
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = Math.max(1, Math.floor(rect.width));
    this.height = Math.max(1, Math.floor(rect.height));
    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);
    this.camera.resize(this.width, this.height);

    const gradient = this.ctx.createRadialGradient(
      this.width / 2,
      this.height / 2,
      Math.min(this.width, this.height) * 0.35,
      this.width / 2,
      this.height / 2,
      Math.max(this.width, this.height) * 0.78,
    );
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.38)');
    this.vignette = gradient;
  }

  draw(view: ViewState, realDelta: number): void {
    this.time += realDelta;
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;

    ctx.fillStyle = C.ink;
    ctx.fillRect(0, 0, this.width, this.height);

    const bounds = this.camera.visibleBounds();
    this.drawTerrain(bounds);
    this.drawFloors(bounds);
    if (view.showRoomTints) this.drawRoomTints(bounds);
    this.drawWallShadows(bounds);
    this.drawObjects(bounds);
    // Night falls on the ground and the furniture but not on the structure —
    // walls stay legible so the plan of the prison is always readable.
    this.drawNight();
    this.drawWalls(bounds);
    this.drawSelectionUnderlay(view);
    this.drawRoutes(view);
    this.drawAgents();
    if (this.camera.zoom >= LABEL_ZOOM) this.drawRoomLabels(bounds);
    this.drawPreview(view);
    this.drawHover(view);
    this.drawVignette();
  }

  // ------------------------------------------------------------- geometry

  private px(tileX: number): number {
    return Math.round(this.camera.worldToScreenX(tileX));
  }

  private py(tileY: number): number {
    return Math.round(this.camera.worldToScreenY(tileY));
  }

  /** Pixel rect for a tile, snapped so neighbouring tiles never show seams. */
  private tileRect(x: number, y: number): [number, number, number, number] {
    const x0 = this.px(x);
    const y0 = this.py(y);
    return [x0, y0, this.px(x + 1) - x0, this.py(y + 1) - y0];
  }

  // -------------------------------------------------------------- terrain

  private drawTerrain(b: Rect): void {
    const { ctx } = this;
    const [x0, y0] = this.tileRect(b.x0, b.y0);
    const x1 = this.px(b.x1 + 1);
    const y1 = this.py(b.y1 + 1);
    ctx.fillStyle = C.terrain;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);

    if (this.camera.zoom < DETAIL_ZOOM) return;
    // Sparse specks give the ground texture without reading as noise.
    ctx.fillStyle = C.terrainSpeck;
    const step = 2;
    for (let y = b.y0 - (b.y0 % step); y <= b.y1; y += step) {
      for (let x = b.x0 - (b.x0 % step); x <= b.x1; x += step) {
        if (((x * 31 + y * 17) & 7) !== 0) continue;
        ctx.fillRect(this.px(x) + 2, this.py(y) + 2, 2, 2);
      }
    }
  }

  private drawFloors(b: Rect): void {
    const { ctx } = this;
    const { map } = this.world;
    const detail = this.camera.zoom >= DETAIL_ZOOM;

    for (let y = b.y0; y <= b.y1; y++) {
      for (let x = b.x0; x <= b.x1; x++) {
        const floor = map.floors[map.index(x, y)];
        if (floor === FLOOR.None) continue;
        const [rx, ry, rw, rh] = this.tileRect(x, y);

        if (floor === FLOOR.Yard) {
          ctx.fillStyle = C.yard;
          ctx.fillRect(rx, ry, rw, rh);
          if (detail && ((x * 7 + y * 13) & 3) === 0) {
            ctx.fillStyle = C.yardSpeck;
            ctx.fillRect(rx + rw * 0.3, ry + rh * 0.45, Math.max(1, rw * 0.18), Math.max(1, rh * 0.3));
          }
          continue;
        }

        const polished = floor === FLOOR.Polished;
        ctx.fillStyle = polished ? C.polished : C.concrete;
        ctx.fillRect(rx, ry, rw, rh);
        if (!detail) continue;
        ctx.fillStyle = polished ? C.polishedGrout : C.concreteGrout;
        ctx.fillRect(rx, ry, rw, 1);
        ctx.fillRect(rx, ry, 1, rh);
      }
    }
  }

  private drawRoomTints(b: Rect): void {
    const { ctx } = this;
    const { map } = this.world;
    for (let y = b.y0; y <= b.y1; y++) {
      for (let x = b.x0; x <= b.x1; x++) {
        const roomId = map.rooms[map.index(x, y)];
        if (roomId === -1) continue;
        const room = this.world.rooms[roomId];
        if (!room) continue;
        const [rx, ry, rw, rh] = this.tileRect(x, y);
        ctx.fillStyle = ROOM_TINT[room.kind];
        ctx.fillRect(rx, ry, rw, rh);
      }
    }
  }

  // ---------------------------------------------------------------- walls

  private drawWallShadows(b: Rect): void {
    const { ctx } = this;
    const { map } = this.world;
    const offset = Math.max(2, this.camera.zoom * 0.16);
    ctx.fillStyle = C.wallShadow;
    for (let y = b.y0; y <= b.y1; y++) {
      for (let x = b.x0; x <= b.x1; x++) {
        if (map.walls[map.index(x, y)] !== WALL.Solid) continue;
        const [rx, ry, rw, rh] = this.tileRect(x, y);
        ctx.fillRect(rx + offset, ry + offset, rw, rh);
      }
    }
  }

  private drawWalls(b: Rect): void {
    const { ctx } = this;
    const { map } = this.world;
    const cap = Math.max(2, Math.round(this.camera.zoom * 0.26));

    for (let y = b.y0; y <= b.y1; y++) {
      for (let x = b.x0; x <= b.x1; x++) {
        const wall = map.walls[map.index(x, y)];
        if (wall === WALL.None) continue;
        const [rx, ry, rw, rh] = this.tileRect(x, y);

        if (wall === WALL.Door) {
          this.drawDoor(x, y, rx, ry, rw, rh);
          continue;
        }

        ctx.fillStyle = C.wall;
        ctx.fillRect(rx, ry, rw, rh);
        // Extruded top edge when nothing is stacked above.
        if (map.wallAt(x, y - 1) !== WALL.Solid) {
          ctx.fillStyle = C.wallTop;
          ctx.fillRect(rx, ry, rw, cap);
        }
        if (map.wallAt(x, y + 1) !== WALL.Solid) {
          ctx.fillStyle = C.wallSide;
          ctx.fillRect(rx, ry + rh - Math.max(1, cap * 0.5), rw, Math.max(1, cap * 0.5));
        }
      }
    }
  }

  private drawDoor(x: number, y: number, rx: number, ry: number, rw: number, rh: number): void {
    const { ctx } = this;
    const { map } = this.world;
    const horizontal = map.wallAt(x - 1, y) !== WALL.None || map.wallAt(x + 1, y) !== WALL.None;
    const jamb = Math.max(2, Math.round(this.camera.zoom * 0.2));
    const leaf = Math.max(2, Math.round(this.camera.zoom * 0.22));

    ctx.fillStyle = C.wallSide;
    if (horizontal) {
      ctx.fillRect(rx, ry, jamb, rh);
      ctx.fillRect(rx + rw - jamb, ry, jamb, rh);
      ctx.fillStyle = C.door;
      ctx.fillRect(rx + jamb, ry + (rh - leaf) / 2, rw - jamb * 2, leaf);
    } else {
      ctx.fillRect(rx, ry, rw, jamb);
      ctx.fillRect(rx, ry + rh - jamb, rw, jamb);
      ctx.fillStyle = C.door;
      ctx.fillRect(rx + (rw - leaf) / 2, ry + jamb, leaf, rh - jamb * 2);
    }
  }

  // -------------------------------------------------------------- objects

  private drawObjects(b: Rect): void {
    const { map } = this.world;
    for (let y = b.y0; y <= b.y1; y++) {
      for (let x = b.x0; x <= b.x1; x++) {
        const id = map.objects[map.index(x, y)];
        if (id === -1) continue;
        const object = this.world.objects.get(id);
        if (object) this.drawObject(object);
      }
    }
  }

  private drawObject(object: PlacedObject): void {
    const { ctx } = this;
    const [rx, ry, rw, rh] = this.tileRect(object.x, object.y);
    const colors = OBJECT_COLORS[object.kind];
    const inset = Math.max(1, rw * 0.08);
    const x = rx + inset;
    const y = ry + inset;
    const w = rw - inset * 2;
    const h = rh - inset * 2;

    switch (object.kind) {
      case 'bed': {
        ctx.fillStyle = colors.base;
        roundRect(ctx, x, y, w, h, w * 0.14);
        ctx.fill();
        ctx.fillStyle = colors.accent;
        roundRect(ctx, x + w * 0.14, y + h * 0.34, w * 0.72, h * 0.56, w * 0.1);
        ctx.fill();
        ctx.fillStyle = '#f2f6fb';
        roundRect(ctx, x + w * 0.22, y + h * 0.1, w * 0.56, h * 0.2, w * 0.08);
        ctx.fill();
        break;
      }
      case 'toilet': {
        ctx.fillStyle = colors.base;
        roundRect(ctx, x + w * 0.2, y + h * 0.08, w * 0.6, h * 0.3, w * 0.1);
        ctx.fill();
        ctx.fillStyle = colors.accent;
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h * 0.62, w * 0.3, h * 0.28, 0, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'table': {
        ctx.fillStyle = colors.base;
        roundRect(ctx, x, y, w, h, w * 0.12);
        ctx.fill();
        ctx.fillStyle = colors.accent;
        roundRect(ctx, x + w * 0.12, y + h * 0.12, w * 0.76, h * 0.76, w * 0.08);
        ctx.fill();
        break;
      }
      case 'bench': {
        ctx.fillStyle = colors.base;
        roundRect(ctx, x, y + h * 0.26, w, h * 0.48, h * 0.1);
        ctx.fill();
        ctx.fillStyle = colors.accent;
        ctx.fillRect(x, y + h * 0.36, w, Math.max(1, h * 0.08));
        break;
      }
      case 'shower': {
        ctx.fillStyle = colors.base;
        roundRect(ctx, x, y, w, h, w * 0.16);
        ctx.fill();
        ctx.fillStyle = colors.accent;
        ctx.beginPath();
        ctx.arc(x + w / 2, y + h * 0.3, w * 0.16, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.5;
        for (let i = 0; i < 3; i++) {
          ctx.fillRect(x + w * (0.3 + i * 0.2), y + h * 0.5, Math.max(1, w * 0.06), h * 0.34);
        }
        ctx.globalAlpha = 1;
        break;
      }
      case 'tv': {
        ctx.fillStyle = colors.base;
        roundRect(ctx, x, y + h * 0.16, w, h * 0.68, w * 0.1);
        ctx.fill();
        ctx.fillStyle = colors.accent;
        ctx.globalAlpha = 0.85;
        roundRect(ctx, x + w * 0.1, y + h * 0.26, w * 0.8, h * 0.48, w * 0.06);
        ctx.fill();
        ctx.globalAlpha = 1;
        break;
      }
    }

    // Reserved furniture gets a quiet marker so congestion is visible.
    if (object.userId !== null && this.camera.zoom >= DETAIL_ZOOM) {
      ctx.fillStyle = 'rgba(84, 214, 232, 0.9)';
      ctx.fillRect(rx + rw - 5, ry + 2, 3, 3);
    }
  }

  // --------------------------------------------------------------- agents

  private drawAgents(): void {
    const { ctx } = this;
    const zoom = this.camera.zoom;
    const bodyRadius = Math.max(2.5, zoom * 0.3);

    for (const agent of this.world.agents.values()) {
      const sx = this.camera.worldToScreenX(agent.x);
      const sy = this.camera.worldToScreenY(agent.y);
      if (sx < -40 || sy < -40 || sx > this.width + 40 || sy > this.height + 40) continue;

      // Contact shadow.
      ctx.fillStyle = 'rgba(0,0,0,0.38)';
      ctx.beginPath();
      ctx.ellipse(sx, sy + bodyRadius * 0.55, bodyRadius * 0.95, bodyRadius * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();

      const prisoner = agent.role === 'prisoner';
      if (prisoner && agent.unrest > 55) {
        const pulse = 0.5 + 0.5 * Math.sin(this.time * 5);
        ctx.strokeStyle = `rgba(242, 86, 106, ${0.25 + 0.4 * (agent.unrest / 100) * pulse})`;
        ctx.lineWidth = Math.max(1.5, zoom * 0.09);
        ctx.beginPath();
        ctx.arc(sx, sy, bodyRadius * 1.55, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.fillStyle = prisoner ? PRISONER_SUIT : GUARD_UNIFORM;
      ctx.strokeStyle = prisoner ? PRISONER_SUIT_DARK : GUARD_UNIFORM_DARK;
      ctx.lineWidth = Math.max(1, zoom * 0.055);
      ctx.beginPath();
      ctx.arc(sx, sy, bodyRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      if (zoom >= DETAIL_ZOOM) {
        ctx.fillStyle = SKIN;
        ctx.beginPath();
        ctx.arc(sx, sy - bodyRadius * 0.16, bodyRadius * 0.46, 0, Math.PI * 2);
        ctx.fill();
      }

      // Security classification ring — the fastest read on the field.
      if (prisoner && zoom >= DETAIL_ZOOM) {
        ctx.strokeStyle = SECURITY_COLORS[agent.profile.security];
        ctx.lineWidth = Math.max(1, zoom * 0.07);
        ctx.beginPath();
        ctx.arc(sx, sy, bodyRadius * 1.18, -Math.PI * 0.78, Math.PI * 0.78);
        ctx.stroke();
      }

      if (prisoner && agent.homeRoomId === null && zoom >= DETAIL_ZOOM) {
        ctx.fillStyle = C.red;
        ctx.beginPath();
        ctx.arc(sx + bodyRadius * 1.1, sy - bodyRadius * 1.1, Math.max(2, zoom * 0.1), 0, Math.PI * 2);
        ctx.fill();
      }

      if (agent.activity === 'sleeping' && zoom >= DETAIL_ZOOM) {
        ctx.fillStyle = 'rgba(230, 235, 242, 0.85)';
        ctx.font = `600 ${Math.round(zoom * 0.42)}px ${FONT_UI}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText('z', sx + bodyRadius * 0.85, sy - bodyRadius * 0.9);
      }

      const selected =
        this.selectedAgentId !== null && this.selectedAgentId === agent.id;
      if (selected) {
        const pulse = 1 + 0.08 * Math.sin(this.time * 4);
        ctx.strokeStyle = C.accent;
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.arc(sx, sy, bodyRadius * 1.9 * pulse, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (prisoner && (zoom >= NAME_ZOOM || selected)) {
        this.drawNameTag(agent, sx, sy - bodyRadius * 1.7);
      }
    }
  }

  private selectedAgentId: number | null = null;

  private drawNameTag(agent: Agent, sx: number, sy: number): void {
    const { ctx } = this;
    const label = agent.profile.fullName.split(' ').slice(-1)[0].toUpperCase();
    ctx.font = `600 10px ${FONT_UI}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(label).width + 10;
    ctx.fillStyle = 'rgba(10, 14, 20, 0.78)';
    roundRect(ctx, sx - w / 2, sy - 8, w, 15, 4);
    ctx.fill();
    ctx.fillStyle = C.text;
    ctx.fillText(label, sx, sy);
  }

  // ------------------------------------------------------------- overlays

  private drawRoutes(view: ViewState): void {
    const { ctx } = this;
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    for (const agent of this.world.agents.values()) {
      const highlighted = view.selection?.kind === 'agent' && view.selection.id === agent.id;
      if (!view.showRoutes && !highlighted) continue;
      const path = agent.path;
      if (!path || agent.pathCursor >= path.length) continue;

      ctx.strokeStyle = highlighted ? 'rgba(84, 214, 232, 0.95)' : 'rgba(84, 214, 232, 0.22)';
      ctx.beginPath();
      ctx.moveTo(this.camera.worldToScreenX(agent.x), this.camera.worldToScreenY(agent.y));
      for (let i = agent.pathCursor; i < path.length; i++) {
        const tile = path[i];
        ctx.lineTo(
          this.camera.worldToScreenX(this.world.map.tileX(tile) + 0.5),
          this.camera.worldToScreenY(this.world.map.tileY(tile) + 0.5),
        );
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  private drawSelectionUnderlay(view: ViewState): void {
    this.selectedAgentId = view.selection?.kind === 'agent' ? view.selection.id : null;
    if (view.selection?.kind !== 'room') return;
    const room = this.world.rooms[view.selection.id];
    if (!room) return;

    const { ctx } = this;
    ctx.fillStyle = 'rgba(84, 214, 232, 0.14)';
    for (const tile of room.tiles) {
      const [rx, ry, rw, rh] = this.tileRect(this.world.map.tileX(tile), this.world.map.tileY(tile));
      ctx.fillRect(rx, ry, rw, rh);
    }
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = 1.5;
    this.strokeRegion(room);
  }

  /** Outlines a room by drawing only the edges that face outside it. */
  private strokeRegion(room: Room): void {
    const { ctx } = this;
    const { map } = this.world;
    const inRoom = new Set(room.tiles);
    ctx.beginPath();
    for (const tile of room.tiles) {
      const x = map.tileX(tile);
      const y = map.tileY(tile);
      const [rx, ry, rw, rh] = this.tileRect(x, y);
      if (!inRoom.has(map.index(x, y - 1))) {
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx + rw, ry);
      }
      if (!inRoom.has(map.index(x, y + 1))) {
        ctx.moveTo(rx, ry + rh);
        ctx.lineTo(rx + rw, ry + rh);
      }
      if (!inRoom.has(map.index(x - 1, y))) {
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx, ry + rh);
      }
      if (!inRoom.has(map.index(x + 1, y))) {
        ctx.moveTo(rx + rw, ry);
        ctx.lineTo(rx + rw, ry + rh);
      }
    }
    ctx.stroke();
  }

  private drawRoomLabels(b: Rect): void {
    const { ctx } = this;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const room of this.world.rooms) {
      if (room.area < 6) continue;
      // Small rooms only get a label once there is room to read it.
      if (room.area < 14 && this.camera.zoom < 26) continue;
      if (room.centre.x < b.x0 || room.centre.x > b.x1 + 1) continue;
      if (room.centre.y < b.y0 || room.centre.y > b.y1 + 1) continue;
      if (room.kind === 'corridor') continue;

      const sx = this.camera.worldToScreenX(room.centre.x);
      const sy = this.camera.worldToScreenY(room.centre.y);
      const label = ROOM_META[room.kind].label.toUpperCase();

      ctx.font = `700 10px ${FONT_UI}`;
      const w = ctx.measureText(label).width + 14;
      ctx.fillStyle = 'rgba(10, 14, 20, 0.6)';
      roundRect(ctx, sx - w / 2, sy - 9, w, 18, 9);
      ctx.fill();
      ctx.fillStyle = ROOM_ACCENT[room.kind];
      ctx.fillText(label, sx, sy);
    }
  }

  private drawPreview(view: ViewState): void {
    const preview = view.preview;
    if (!preview) return;
    const { ctx } = this;
    const { map } = this.world;

    for (const op of preview.plan.ops) {
      const [rx, ry, rw, rh] = this.tileRect(map.tileX(op.index), map.tileY(op.index));
      ctx.fillStyle = previewColor(op.type, 'kind' in op ? op.kind : undefined);
      ctx.fillRect(rx, ry, rw, rh);
    }
    ctx.fillStyle = 'rgba(242, 86, 106, 0.4)';
    for (const index of preview.plan.blocked) {
      const [rx, ry, rw, rh] = this.tileRect(map.tileX(index), map.tileY(index));
      ctx.fillRect(rx, ry, rw, rh);
    }

    const [bx, by] = this.tileRect(preview.rect.x0, preview.rect.y0);
    const bw = this.px(preview.rect.x1 + 1) - bx;
    const bh = this.py(preview.rect.y1 + 1) - by;
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
    ctx.setLineDash([]);
  }

  private drawHover(view: ViewState): void {
    if (view.hoverTile === null || view.preview) return;
    const { ctx } = this;
    const { map } = this.world;
    const [rx, ry, rw, rh] = this.tileRect(map.tileX(view.hoverTile), map.tileY(view.hoverTile));
    ctx.strokeStyle = 'rgba(84, 214, 232, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(rx + 0.75, ry + 0.75, rw - 1.5, rh - 1.5);
  }

  private drawNight(): void {
    const alpha = nightAlpha(this.world.clock.hour);
    if (alpha <= 0.002) return;
    const { ctx } = this;
    ctx.fillStyle = withAlpha(C.night, alpha);
    ctx.fillRect(0, 0, this.width, this.height);
    this.drawLitRooms(alpha);
  }

  /**
   * Occupied interiors glow faintly after dark. Cheaper and more readable than
   * real lighting: you can see at a glance which blocks still have people in.
   */
  private drawLitRooms(nightStrength: number): void {
    if (nightStrength < 0.08) return;
    const occupied = new Set<number>();
    for (const agent of this.world.agents.values()) {
      const roomId = this.world.map.roomAt(Math.floor(agent.x), Math.floor(agent.y));
      if (roomId !== -1) occupied.add(roomId);
    }
    if (occupied.size === 0) return;

    const { ctx } = this;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = withAlpha(C.lamp, 0.055 * (nightStrength / 0.5));
    for (const roomId of occupied) {
      const room = this.world.rooms[roomId];
      if (!room || !room.enclosed) continue;
      for (const tile of room.tiles) {
        const [rx, ry, rw, rh] = this.tileRect(this.world.map.tileX(tile), this.world.map.tileY(tile));
        ctx.fillRect(rx, ry, rw, rh);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawVignette(): void {
    if (!this.vignette) return;
    this.ctx.fillStyle = this.vignette;
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  // ----------------------------------------------------------------- hit

  /** Finds the agent nearest a screen point, within a generous grab radius. */
  pickAgent(screenX: number, screenY: number): Agent | null {
    const worldX = this.camera.screenToWorldX(screenX);
    const worldY = this.camera.screenToWorldY(screenY);
    const radius = Math.max(0.5, 16 / this.camera.zoom);
    let best: Agent | null = null;
    let bestDist = radius;
    for (const agent of this.world.agents.values()) {
      const d = Math.hypot(agent.x - worldX, agent.y - worldY);
      if (d < bestDist) {
        bestDist = d;
        best = agent;
      }
    }
    return best;
  }
}

function nightAlpha(hour: number): number {
  const t = Math.cos((hour / 24) * Math.PI * 2);
  return clamp01((t + 0.2) / 1.2) * 0.5;
}

function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function previewColor(type: string, kind?: ObjectKind): string {
  switch (type) {
    case 'wall':
      return 'rgba(221, 229, 239, 0.55)';
    case 'door':
      return 'rgba(245, 185, 66, 0.6)';
    case 'floor':
      return 'rgba(84, 214, 232, 0.28)';
    case 'demolish':
      return 'rgba(242, 86, 106, 0.45)';
    case 'object':
      return kind ? withAlpha(OBJECT_COLORS[kind].accent, 0.6) : 'rgba(84, 214, 232, 0.5)';
    default:
      return 'rgba(84, 214, 232, 0.3)';
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
