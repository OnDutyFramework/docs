import { clamp } from '../core/math';

export const MIN_ZOOM = 9;
export const MAX_ZOOM = 54;

/**
 * Maps tile space to screen space. Centre is held in tile coordinates so the
 * view stays anchored to the same part of the prison across zoom changes.
 */
export class Camera {
  /** Tile coordinate at the centre of the viewport. */
  cx: number;
  cy: number;
  /** Device-independent pixels per tile. */
  zoom = 24;

  viewWidth = 1;
  viewHeight = 1;

  constructor(
    private mapWidth: number,
    private mapHeight: number,
  ) {
    this.cx = mapWidth / 2;
    this.cy = mapHeight / 2;
  }

  resize(width: number, height: number): void {
    this.viewWidth = width;
    this.viewHeight = height;
    this.clampCentre();
  }

  worldToScreenX(tileX: number): number {
    return (tileX - this.cx) * this.zoom + this.viewWidth / 2;
  }

  worldToScreenY(tileY: number): number {
    return (tileY - this.cy) * this.zoom + this.viewHeight / 2;
  }

  screenToWorldX(px: number): number {
    return (px - this.viewWidth / 2) / this.zoom + this.cx;
  }

  screenToWorldY(py: number): number {
    return (py - this.viewHeight / 2) / this.zoom + this.cy;
  }

  panByPixels(dx: number, dy: number): void {
    this.cx -= dx / this.zoom;
    this.cy -= dy / this.zoom;
    this.clampCentre();
  }

  panByTiles(dx: number, dy: number): void {
    this.cx += dx;
    this.cy += dy;
    this.clampCentre();
  }

  /** Zooms while keeping the tile under (px, py) fixed on screen. */
  zoomAt(px: number, py: number, factor: number): void {
    const worldX = this.screenToWorldX(px);
    const worldY = this.screenToWorldY(py);
    this.zoom = clamp(this.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    this.cx = worldX - (px - this.viewWidth / 2) / this.zoom;
    this.cy = worldY - (py - this.viewHeight / 2) / this.zoom;
    this.clampCentre();
  }

  centreOn(tileX: number, tileY: number): void {
    this.cx = tileX;
    this.cy = tileY;
    this.clampCentre();
  }

  /** Inclusive tile bounds currently on screen, padded by one tile. */
  visibleBounds(): { x0: number; y0: number; x1: number; y1: number } {
    return {
      x0: Math.max(0, Math.floor(this.screenToWorldX(0)) - 1),
      y0: Math.max(0, Math.floor(this.screenToWorldY(0)) - 1),
      x1: Math.min(this.mapWidth - 1, Math.ceil(this.screenToWorldX(this.viewWidth)) + 1),
      y1: Math.min(this.mapHeight - 1, Math.ceil(this.screenToWorldY(this.viewHeight)) + 1),
    };
  }

  /** Keeps a margin of the map on screen so the player cannot get lost. */
  private clampCentre(): void {
    const marginX = this.viewWidth / this.zoom / 2;
    const marginY = this.viewHeight / this.zoom / 2;
    const slack = 6;
    this.cx = clamp(this.cx, Math.min(marginX, this.mapWidth / 2) - slack, Math.max(this.mapWidth - marginX, this.mapWidth / 2) + slack);
    this.cy = clamp(this.cy, Math.min(marginY, this.mapHeight / 2) - slack, Math.max(this.mapHeight - marginY, this.mapHeight / 2) + slack);
  }
}
