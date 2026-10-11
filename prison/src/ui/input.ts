import { MAX_ZOOM, MIN_ZOOM } from '../render/camera';
import { commitBuild, normaliseRect, planBuild, TOOL_BY_ID } from '../sim/build';
import type { AppContext } from './context';
import { byId, money } from './dom';

const PAN_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const CLICK_SLOP = 4;

/** All pointer and keyboard interaction with the playfield. */
export class InputController {
  private canvas = byId<HTMLCanvasElement>('field');
  private panning = false;
  private panCandidate = false;
  private dragStart: { x: number; y: number } | null = null;
  private dragFromTile: number | null = null;
  private pointerDownAt = { x: 0, y: 0 };
  private held = new Set<string>();

  constructor(private ctx: AppContext) {}

  mount(): void {
    const { canvas } = this;
    canvas.addEventListener('pointerdown', (event) => this.onPointerDown(event));
    canvas.addEventListener('pointermove', (event) => this.onPointerMove(event));
    canvas.addEventListener('pointerup', (event) => this.onPointerUp(event));
    canvas.addEventListener('pointercancel', () => this.reset());
    canvas.addEventListener('pointerleave', () => {
      this.ctx.state.view.hoverTile = null;
    });
    canvas.addEventListener('wheel', (event) => this.onWheel(event), { passive: false });
    canvas.addEventListener('contextmenu', (event) => event.preventDefault());
    canvas.addEventListener('dblclick', (event) => this.onDoubleClick(event));

    window.addEventListener('keydown', (event) => this.onKeyDown(event));
    window.addEventListener('keyup', (event) => this.held.delete(event.key));
    window.addEventListener('blur', () => this.held.clear());
  }

  /** Called every frame so held arrow keys scroll smoothly. */
  tick(delta: number): void {
    if (this.held.size === 0) return;
    const step = (22 / this.ctx.renderer.camera.zoom) * delta * 60;
    let dx = 0;
    let dy = 0;
    if (this.held.has('ArrowLeft')) dx -= step;
    if (this.held.has('ArrowRight')) dx += step;
    if (this.held.has('ArrowUp')) dy -= step;
    if (this.held.has('ArrowDown')) dy += step;
    if (dx !== 0 || dy !== 0) this.ctx.renderer.camera.panByTiles(dx, dy);
  }

  private localPoint(event: PointerEvent | WheelEvent | MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private tileAt(px: number, py: number): number | null {
    const { camera } = this.ctx.renderer;
    const { map } = this.ctx.world;
    const x = Math.floor(camera.screenToWorldX(px));
    const y = Math.floor(camera.screenToWorldY(py));
    return map.inBounds(x, y) ? map.index(x, y) : null;
  }

  private onPointerDown(event: PointerEvent): void {
    const point = this.localPoint(event);
    this.pointerDownAt = point;
    this.canvas.setPointerCapture(event.pointerId);

    const middleOrRight = event.button === 1 || event.button === 2;
    if (middleOrRight) {
      this.panning = true;
      this.dragStart = point;
      this.canvas.classList.add('is-panning');
      return;
    }
    if (event.button !== 0) return;

    const tool = this.ctx.state.tool;
    if (tool === 'select') {
      // Left-drag pans while inspecting; a click without movement selects.
      this.panCandidate = true;
      this.dragStart = point;
      return;
    }

    this.dragFromTile = this.tileAt(point.x, point.y);
    this.updatePreview(point);
  }

  private onPointerMove(event: PointerEvent): void {
    const point = this.localPoint(event);
    this.ctx.state.view.hoverTile = this.tileAt(point.x, point.y);

    if (this.panning && this.dragStart) {
      this.ctx.renderer.camera.panByPixels(point.x - this.dragStart.x, point.y - this.dragStart.y);
      this.dragStart = point;
      return;
    }

    if (this.panCandidate && this.dragStart) {
      const moved = Math.hypot(point.x - this.pointerDownAt.x, point.y - this.pointerDownAt.y);
      if (moved > CLICK_SLOP) {
        this.panning = true;
        this.canvas.classList.add('is-panning');
        this.ctx.renderer.camera.panByPixels(point.x - this.dragStart.x, point.y - this.dragStart.y);
        this.dragStart = point;
      }
      return;
    }

    if (this.dragFromTile !== null) this.updatePreview(point);
  }

  private onPointerUp(event: PointerEvent): void {
    const point = this.localPoint(event);
    const wasPanning = this.panning;
    const hadDrag = this.dragFromTile !== null;

    if (hadDrag) this.commit(point);

    if (this.panCandidate && !wasPanning) {
      const moved = Math.hypot(point.x - this.pointerDownAt.x, point.y - this.pointerDownAt.y);
      if (moved <= CLICK_SLOP) this.selectAt(point);
    }

    this.reset();
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
  }

  private reset(): void {
    this.panning = false;
    this.panCandidate = false;
    this.dragStart = null;
    this.dragFromTile = null;
    this.ctx.state.view.preview = null;
    this.canvas.classList.remove('is-panning');
  }

  private updatePreview(point: { x: number; y: number }): void {
    const { state, world } = this.ctx;
    if (this.dragFromTile === null) return;
    const to = this.tileAt(point.x, point.y) ?? this.dragFromTile;
    const rect = normaliseRect(
      world.map.tileX(this.dragFromTile),
      world.map.tileY(this.dragFromTile),
      world.map.tileX(to),
      world.map.tileY(to),
    );
    const plan = planBuild(world, state.tool, rect);
    state.view.preview = { rect, plan };

    const net = plan.cost - plan.refund;
    const def = TOOL_BY_ID.get(state.tool);
    if (plan.note) {
      this.ctx.notify(plan.note, 'warn');
    } else if (plan.ops.length > 0) {
      const affordable = world.economy.canAfford(net);
      this.ctx.notify(
        `${def?.label ?? 'Build'} \u00b7 ${plan.ops.length} tile${plan.ops.length === 1 ? '' : 's'} \u00b7 ${money(
          -net,
        )}`,
        affordable ? 'info' : 'warn',
      );
    }
  }

  private commit(point: { x: number; y: number }): void {
    const { state, world } = this.ctx;
    this.updatePreview(point);
    const preview = state.view.preview;
    if (!preview) return;

    const def = TOOL_BY_ID.get(state.tool);
    const result = commitBuild(world, preview.plan, def?.label ?? 'Construction');
    if (!result.ok) {
      if (result.message) this.ctx.notify(result.message, 'warn');
      return;
    }

    this.ctx.notify(
      result.spent >= 0
        ? `${def?.label ?? 'Built'} \u2014 spent ${money(result.spent)}`
        : `${def?.label ?? 'Cleared'} \u2014 recovered ${money(-result.spent)}`,
    );
  }

  private selectAt(point: { x: number; y: number }): void {
    const agent = this.ctx.renderer.pickAgent(point.x, point.y);
    if (agent) {
      this.ctx.select({ kind: 'agent', id: agent.id });
      return;
    }
    const tile = this.tileAt(point.x, point.y);
    if (tile === null) {
      this.ctx.select(null);
      return;
    }
    const roomId = this.ctx.world.map.rooms[tile];
    this.ctx.select(roomId === -1 ? null : { kind: 'room', id: roomId });
  }

  private onDoubleClick(event: MouseEvent): void {
    const point = this.localPoint(event);
    const agent = this.ctx.renderer.pickAgent(point.x, point.y);
    if (agent) this.ctx.renderer.camera.centreOn(agent.x, agent.y);
  }

  private onWheel(event: WheelEvent): void {
    event.preventDefault();
    const point = this.localPoint(event);
    const factor = Math.pow(0.9988, event.deltaY);
    const { camera } = this.ctx.renderer;
    if ((camera.zoom <= MIN_ZOOM && factor < 1) || (camera.zoom >= MAX_ZOOM && factor > 1)) return;
    camera.zoomAt(point.x, point.y, factor);
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (PAN_KEYS.has(event.key)) {
      this.held.add(event.key);
      event.preventDefault();
      return;
    }
    if (event.code === 'Space') {
      event.preventDefault();
      this.ctx.sim.togglePause();
      return;
    }
    if (event.key === ',') this.ctx.sim.setSpeed(Math.max(1, this.ctx.sim.speedIndex - 1) as 1 | 2 | 3);
    if (event.key === '.') this.ctx.sim.setSpeed(Math.min(3, this.ctx.sim.speedIndex + 1) as 1 | 2 | 3);
  }
}
